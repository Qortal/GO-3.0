#include <android/log.h>
#include <dlfcn.h>
#include <jni.h>
#include <sys/system_properties.h>

#include <algorithm>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <sched.h>
#include <string>
#include <unistd.h>
#include <utility>
#include <vector>

#include "ggml-backend.h"
#include "ggml-cpu.h"
#include "llama.h"

#define LOG_TAG "QortinoLlm"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace {

std::mutex g_mutex;
llama_model * g_model = nullptr;
llama_context * g_ctx = nullptr;
/** Decode and prompt pools of g_ctx; the same pool when the counts match. */
ggml_threadpool_t g_threadpool = nullptr;
ggml_threadpool_t g_threadpool_batch = nullptr;
/**
 * The CPU backend in use, and its thread pool functions. On ARM the backend
 * is a library picked at runtime (load_cpu_backend), so these are looked up
 * through ggml rather than linked.
 */
std::string g_cpu_backend;
decltype(&ggml_threadpool_new) g_threadpool_new = nullptr;
decltype(&ggml_threadpool_free) g_threadpool_free = nullptr;
std::atomic<bool> g_cancel{false};
std::string g_model_path;
uint32_t g_model_batch = 0;
uint32_t g_model_ubatch = 0;
/**
 * Tokens resident in the chat KV cache, in order: the last prompt plus the
 * reply generated after it. The next prompt repeats that conversation, so
 * only the part after the shared prefix has to be read again.
 */
std::vector<llama_token> g_prompt_cache;

struct JniCallback {
    JavaVM * vm = nullptr;
    jobject listener = nullptr;
};

JniCallback g_token_cb;

/** Sampler settings for one reply; JS passes the model's recommended values. */
struct SamplingParams {
    float temperature = 0.7f;
    int32_t top_k = 20;
    float top_p = 0.8f;
    float min_p = 0.0f;
    float repeat_penalty = 1.0f;
    float presence_penalty = 0.0f;
};

/** JNI NewStringUTF aborts on invalid modified-UTF-8; strip bad bytes. */
std::string utf8_for_jni(const std::string & in) {
    std::string out;
    out.reserve(in.size());
    const unsigned char * p = reinterpret_cast<const unsigned char *>(in.data());
    const unsigned char * end = p + in.size();
    while (p < end) {
        if (*p < 0x80) {
            if (*p == 0) {
                out.push_back('?');
            } else {
                out.push_back(static_cast<char>(*p));
            }
            ++p;
            continue;
        }
        int need = 0;
        if ((*p & 0xE0) == 0xC0) need = 1;
        else if ((*p & 0xF0) == 0xE0) need = 2;
        else if ((*p & 0xF8) == 0xF0) need = 3;
        else {
            ++p;
            continue;
        }
        if (p + need >= end) break;
        bool ok = true;
        for (int i = 1; i <= need; ++i) {
            if ((p[i] & 0xC0) != 0x80) {
                ok = false;
                break;
            }
        }
        if (!ok) {
            ++p;
            continue;
        }
        for (int i = 0; i <= need; ++i) out.push_back(static_cast<char>(p[i]));
        p += need + 1;
    }
    return out;
}

jstring new_jstring(JNIEnv * env, const std::string & s) {
    const std::string safe = utf8_for_jni(s);
    return env->NewStringUTF(safe.c_str());
}

/** Error returns are prefixed so success can be any generated UTF-8 text. */
constexpr const char * kCompleteErrPrefix = "ERR\x1f";

jstring complete_error(JNIEnv * env, const std::string & message) {
    return new_jstring(env, std::string(kCompleteErrPrefix) + message);
}

bool cancel_abort_cb(void *) {
    return g_cancel.load();
}

long long now_ms() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()
    ).count();
}

long read_cpu_value(long cpu, const char * file) {
    char path[96];
    std::snprintf(path, sizeof(path), "/sys/devices/system/cpu/cpu%ld/%s", cpu, file);
    FILE * f = std::fopen(path, "r");
    if (f == nullptr) return 0;
    long value = 0;
    if (std::fscanf(f, "%ld", &value) != 1) value = 0;
    std::fclose(f);
    return value;
}

/**
 * The cores worth running model threads on. Phones pair big cores with
 * efficiency cores at well under half their speed, and every step of a
 * reply waits for its slowest thread, so those are left out. Judged by the
 * scheduler's cpu_capacity (at least half the fastest core's), else by top
 * clock (at least 3/4 of it): a flagship whose cores are all big keeps them
 * all. Empty when sysfs says nothing, so the caller falls back to counts.
 */
std::vector<int> fast_cpus() {
    struct Source {
        const char * file;
        long num; // a core counts when value * den >= fastest * num
        long den;
    };
    const long n = std::min<long>(sysconf(_SC_NPROCESSORS_CONF), GGML_MAX_N_THREADS);
    for (const Source & src : { Source{ "cpu_capacity", 1, 2 }, Source{ "cpufreq/cpuinfo_max_freq", 3, 4 } }) {
        std::vector<std::pair<int, long>> cores;
        for (long i = 0; i < n; ++i) {
            const long v = read_cpu_value(i, src.file);
            if (v > 0) cores.emplace_back(static_cast<int>(i), v);
        }
        if (cores.size() < 2) continue;
        long best = 0;
        for (const auto & c : cores) best = std::max(best, c.second);
        std::vector<int> fast;
        for (const auto & c : cores) {
            if (c.second * src.den >= best * src.num) fast.push_back(c.first);
        }
        return fast;
    }
    return {};
}

/** Restrict the calling thread to `cpus`, or let it run anywhere when empty. */
void set_thread_cpus(const std::vector<int> & cpus) {
    cpu_set_t set;
    CPU_ZERO(&set);
    if (cpus.empty()) {
        const long n = std::min<long>(sysconf(_SC_NPROCESSORS_CONF), CPU_SETSIZE);
        for (long i = 0; i < n; ++i) CPU_SET(i, &set);
    } else {
        for (int cpu : cpus) CPU_SET(cpu, &set);
    }
    if (sched_setaffinity(0, sizeof(set), &set) != 0) {
        LOGE("sched_setaffinity failed: %d", errno);
    }
}

/**
 * A pool that lives as long as the context, its threads held on `cpus`.
 * Without a pool, ggml starts new threads for every token, and Android puts
 * fresh threads wherever it likes, little cores included. ggml's own core
 * pinning builds only for glibc Linux and does nothing on Android; new
 * threads inherit their creator's mask instead, so the calling thread (the
 * plugin's single worker, which also computes) is pinned first.
 */
ggml_threadpool_t new_threadpool(int n_threads, const std::vector<int> & cpus) {
    if (g_threadpool_new == nullptr || g_threadpool_free == nullptr) return nullptr;
    set_thread_cpus(cpus);
    ggml_threadpool_params params = ggml_threadpool_params_default(n_threads);
    params.paused = true; // sleeps until the first run
    return g_threadpool_new(&params);
}

/**
 * Load ggml's CPU backend. On ARM it comes as one library per feature level,
 * and each reports through ggml_backend_score() whether this phone's CPU can
 * run it (0 when an instruction set it was built for is missing); the best
 * one is loaded. For testing, `adb shell setprop debug.qortino.cpu
 * android_armv8.2_2` caps the choice at that variant. Returns the library
 * name, empty when none can run here.
 */
std::string load_cpu_backend() {
#if defined(QORTINO_CPU_VARIANTS)
    static const char * const kVariants[] = {
        "android_armv9.2_2", "android_armv9.2_1", "android_armv9.0_1", "android_armv8.6_1",
        "android_armv8.2_2", "android_armv8.2_1", "android_armv8.0_1",
    };
    char cap[PROP_VALUE_MAX] = {0};
    __system_property_get("debug.qortino.cpu", cap);
    bool allowed = cap[0] == '\0';
    std::string best;
    int best_score = 0;
    for (const char * variant : kVariants) {
        allowed = allowed || std::strcmp(variant, cap) == 0;
        if (!allowed) continue;
        const std::string lib = std::string("libggml-cpu-") + variant + ".so";
        void * handle = dlopen(lib.c_str(), RTLD_NOW | RTLD_LOCAL);
        if (handle == nullptr) continue;
        auto score_fn = reinterpret_cast<int (*)()>(dlsym(handle, "ggml_backend_score"));
        const int score = score_fn != nullptr ? score_fn() : 0;
        dlclose(handle);
        if (score > best_score) {
            best_score = score;
            best = lib;
        }
    }
    if (best.empty() || ggml_backend_load(best.c_str()) == nullptr) return {};
    return best;
#else
    ggml_backend_load_all(); // statically linked: nothing to choose
    return "built in";
#endif
}

void emit_progress(const char * stage, const std::string & detail, float percent) {
    if (g_token_cb.vm == nullptr || g_token_cb.listener == nullptr) {
        return;
    }
    JNIEnv * env = nullptr;
    bool attached = false;
    jint status = g_token_cb.vm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6);
    if (status == JNI_EDETACHED) {
        if (g_token_cb.vm->AttachCurrentThread(&env, nullptr) != 0) {
            return;
        }
        attached = true;
    } else if (status != JNI_OK || env == nullptr) {
        return;
    }

    jclass cls = env->GetObjectClass(g_token_cb.listener);
    if (cls != nullptr) {
        jmethodID mid = env->GetMethodID(
            cls,
            "onNativeProgress",
            "(Ljava/lang/String;Ljava/lang/String;F)V"
        );
        if (mid != nullptr) {
            jstring jStage = new_jstring(env, stage ? stage : "");
            jstring jDetail = new_jstring(env, detail);
            env->CallVoidMethod(g_token_cb.listener, mid, jStage, jDetail, percent);
            if (jStage != nullptr) env->DeleteLocalRef(jStage);
            if (jDetail != nullptr) env->DeleteLocalRef(jDetail);
        }
        env->DeleteLocalRef(cls);
    }

    if (attached) {
        g_token_cb.vm->DetachCurrentThread();
    }
}

void release_listener_locked() {
    if (g_token_cb.vm != nullptr && g_token_cb.listener != nullptr) {
        JNIEnv * env = nullptr;
        if (g_token_cb.vm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) == JNI_OK && env != nullptr) {
            env->DeleteGlobalRef(g_token_cb.listener);
        }
    }
    g_token_cb.listener = nullptr;
}

void emit_token(const std::string & token, bool done, const char * error) {
    if (g_token_cb.vm == nullptr || g_token_cb.listener == nullptr) {
        return;
    }
    JNIEnv * env = nullptr;
    bool attached = false;
    jint status = g_token_cb.vm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6);
    if (status == JNI_EDETACHED) {
        if (g_token_cb.vm->AttachCurrentThread(&env, nullptr) != 0) {
            return;
        }
        attached = true;
    } else if (status != JNI_OK || env == nullptr) {
        return;
    }

    jclass cls = env->GetObjectClass(g_token_cb.listener);
    if (cls != nullptr) {
        jmethodID mid = env->GetMethodID(cls, "onNativeToken", "(Ljava/lang/String;ZLjava/lang/String;)V");
        if (mid != nullptr) {
            jstring jToken = new_jstring(env, token);
            jstring jErr = error != nullptr ? new_jstring(env, error) : nullptr;
            env->CallVoidMethod(g_token_cb.listener, mid, jToken, done ? JNI_TRUE : JNI_FALSE, jErr);
            if (jToken != nullptr) env->DeleteLocalRef(jToken);
            if (jErr != nullptr) env->DeleteLocalRef(jErr);
        }
        env->DeleteLocalRef(cls);
    }

    if (attached) {
        g_token_cb.vm->DetachCurrentThread();
    }
}

void unload_chat_locked() {
    if (g_ctx != nullptr) {
        llama_free(g_ctx);
        g_ctx = nullptr;
    }
    if (g_threadpool_batch != nullptr && g_threadpool_batch != g_threadpool) {
        g_threadpool_free(g_threadpool_batch);
    }
    if (g_threadpool != nullptr) {
        g_threadpool_free(g_threadpool);
    }
    g_threadpool = nullptr;
    g_threadpool_batch = nullptr;
    if (g_model != nullptr) {
        llama_model_free(g_model);
        g_model = nullptr;
    }
    g_model_path.clear();
    g_model_batch = 0;
    g_model_ubatch = 0;
    g_prompt_cache.clear();
}

std::string jstring_to_string(JNIEnv * env, jstring value) {
    if (value == nullptr) {
        return {};
    }
    const char * chars = env->GetStringUTFChars(value, nullptr);
    if (chars == nullptr) {
        return {};
    }
    std::string out(chars);
    env->ReleaseStringUTFChars(value, chars);
    return out;
}

std::string token_to_piece(const llama_vocab * vocab, llama_token token) {
    char buf[256];
    int32_t n = llama_token_to_piece(vocab, token, buf, sizeof(buf), 0, true);
    if (n < 0) {
        std::vector<char> bigger(-n);
        n = llama_token_to_piece(vocab, token, bigger.data(), bigger.size(), 0, true);
        if (n < 0) {
            return {};
        }
        return std::string(bigger.data(), n);
    }
    return std::string(buf, n);
}

bool tokenize_prompt(const llama_vocab * vocab, const std::string & prompt, std::vector<llama_token> & out) {
    const int n_prompt = -llama_tokenize(vocab, prompt.c_str(), prompt.size(), nullptr, 0, true, true);
    if (n_prompt <= 0) {
        return false;
    }
    out.resize(static_cast<size_t>(n_prompt));
    return llama_tokenize(vocab, prompt.c_str(), prompt.size(), out.data(), out.size(), true, true) >= 0;
}

/** Outcome codes for prefill_locked. */
constexpr int kPrefillCancelled = -2;
constexpr int kPrefillUnloaded = -3;
/** Shortest run of cached tokens worth moving instead of reading again. */
constexpr size_t kMinShiftChunk = 32;

/**
 * Bring the KV cache to exactly `tokens`, reading only what follows the
 * prefix it already holds. On success g_prompt_cache == tokens.
 *
 * The lock is released while progress events go out (the Capacitor bridge
 * must not wait on it); unload can run in that gap, so the model and context
 * are re-checked after every relock.
 */
int prefill_locked(
    std::unique_lock<std::mutex> & lock,
    const std::vector<llama_token> & tokens,
    const char * stage,
    size_t * reused_out
) {
    llama_model * model = g_model;
    llama_context * ctx = g_ctx;
    if (model == nullptr || ctx == nullptr) return kPrefillUnloaded;

    size_t n_reuse = 0;
    const size_t lim = std::min(g_prompt_cache.size(), tokens.size());
    while (n_reuse < lim && g_prompt_cache[n_reuse] == tokens[n_reuse]) {
        ++n_reuse;
    }
    // The last prompt token must be decoded again for fresh logits.
    if (n_reuse == tokens.size() && n_reuse > 0) {
        --n_reuse;
    }

    llama_memory_t mem = llama_get_memory(ctx);
    // A long chat drops its oldest turns from the prompt, but they still sit
    // in the KV right after the system prompt. Cut them out and slide the
    // turns that remain down into place (llama-server's cache reuse):
    // reading those turns again costs the better part of a minute on a phone.
    if (n_reuse > 0 && n_reuse < g_prompt_cache.size() && llama_memory_can_shift(mem)) {
        size_t head_p = n_reuse;
        size_t head_c = n_reuse;
        while (head_c < g_prompt_cache.size() && head_p < tokens.size()) {
            size_t n_match = 0;
            while (head_c + n_match < g_prompt_cache.size() && head_p + n_match < tokens.size() &&
                   g_prompt_cache[head_c + n_match] == tokens[head_p + n_match]) {
                ++n_match;
            }
            if (n_match < kMinShiftChunk) {
                ++head_c;
                continue;
            }
            const auto p = static_cast<llama_pos>(head_p);
            const auto c = static_cast<llama_pos>(head_c);
            llama_memory_seq_rm(mem, 0, p, c);
            llama_memory_seq_add(mem, 0, c, c + static_cast<llama_pos>(n_match), p - c);
            for (size_t i = 0; i < n_match; ++i) g_prompt_cache[head_p + i] = g_prompt_cache[head_c + i];
            LOGI("Kept %zu cached tokens, moved back by %zu", n_match, head_c - head_p);
            head_p += n_match;
            head_c += n_match;
        }
        n_reuse = head_p;
        if (n_reuse == tokens.size()) --n_reuse;
    }
    if (n_reuse == 0) {
        llama_memory_clear(mem, true);
    } else if (!llama_memory_seq_rm(mem, 0, static_cast<llama_pos>(n_reuse), -1)) {
        llama_memory_clear(mem, true);
        n_reuse = 0;
    }
    // Until this prefill succeeds the cache no longer matches the KV.
    g_prompt_cache.resize(n_reuse);
    if (reused_out != nullptr) *reused_out = n_reuse;

    // Stopped part-way: keep what was read. Tokens go in order, so the KV
    // holds exactly tokens[0, pos_max]; an aborted decode leaves its finished
    // ubatches in, and pos_max says how far it got.
    auto keep_prefix_and_cancel = [&]() -> int {
        if (g_ctx == ctx && g_model == model) {
            llama_memory_t m = llama_get_memory(ctx);
            const llama_pos pos_max = llama_memory_seq_pos_max(m, 0);
            const size_t have = std::min(tokens.size(), static_cast<size_t>(std::max<llama_pos>(0, pos_max + 1)));
            llama_memory_seq_rm(m, 0, static_cast<llama_pos>(have), -1);
            g_prompt_cache.assign(tokens.begin(), tokens.begin() + static_cast<long>(have));
        }
        return kPrefillCancelled;
    };

    const uint32_t ubatch = std::max(1u, llama_n_ubatch(ctx));
    // Big slices are fastest; smaller ones are the fallback when a phone is
    // short on memory for the compute buffers.
    const uint32_t slices[] = { ubatch, std::min(ubatch, 64u), 16u };
    int rc = 0;
    for (uint32_t slice : slices) {
        rc = 0;
        size_t i = n_reuse;
        long long last_emit = 0;
        while (i < tokens.size()) {
            if (g_cancel.load()) return keep_prefix_and_cancel();
            if (g_ctx != ctx || g_model != model) return kPrefillUnloaded;
            const int32_t n_eval = static_cast<int32_t>(std::min(tokens.size() - i, static_cast<size_t>(slice)));
            llama_batch batch = llama_batch_get_one(const_cast<llama_token *>(tokens.data()) + i, n_eval);
            rc = llama_decode(ctx, batch);
            if (rc != 0) {
                LOGE("prefill decode failed rc=%d at %zu/%zu slice=%u", rc, i, tokens.size(), slice);
                break;
            }
            i += static_cast<size_t>(n_eval);
            const long long t = now_ms();
            if (i >= tokens.size() || t - last_emit >= 250) {
                last_emit = t;
                const float done = static_cast<float>(i - n_reuse);
                const float total = static_cast<float>(std::max<size_t>(1, tokens.size() - n_reuse));
                char detail[96];
                std::snprintf(detail, sizeof(detail), "%zu/%zu", i, tokens.size());
                lock.unlock();
                emit_progress(stage, detail, done / total);
                lock.lock();
            }
        }
        if (rc == 0) break;
        if (rc == 2 || g_cancel.load()) return keep_prefix_and_cancel();
        // Retry the rest with a smaller slice from a clean cache.
        if (g_ctx != ctx || g_model != model) return kPrefillUnloaded;
        llama_memory_clear(llama_get_memory(ctx), true);
        n_reuse = 0;
        g_prompt_cache.clear();
    }
    if (rc != 0) return rc;
    g_prompt_cache = tokens;
    return 0;
}

std::vector<std::pair<std::string, std::string>> unpack_turns(const std::string & packed) {
    std::vector<std::pair<std::string, std::string>> turns;
    // packed format: role\x1fcontent\x1e role\x1fcontent ...
    size_t start = 0;
    while (start < packed.size()) {
        size_t sep = packed.find('\x1e', start);
        std::string item = packed.substr(start, sep == std::string::npos ? std::string::npos : sep - start);
        size_t roleSep = item.find('\x1f');
        if (roleSep != std::string::npos) {
            turns.emplace_back(item.substr(0, roleSep), item.substr(roleSep + 1));
        }
        if (sep == std::string::npos) break;
        start = sep + 1;
    }
    return turns;
}

} // namespace

extern "C" JNIEXPORT jboolean JNICALL
Java_com_github_Qortal_qortalMobile_QortinoLlmPlugin_nativeInitBackend(JNIEnv *, jobject) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_cpu_backend.empty()) return JNI_TRUE;
    g_cpu_backend = load_cpu_backend();
    ggml_backend_dev_t cpu = ggml_backend_dev_by_type(GGML_BACKEND_DEVICE_TYPE_CPU);
    ggml_backend_reg_t reg = cpu != nullptr ? ggml_backend_dev_backend_reg(cpu) : nullptr;
    if (g_cpu_backend.empty() || reg == nullptr) {
        g_cpu_backend.clear();
        LOGE("No ggml CPU backend can run on this CPU");
        return JNI_FALSE;
    }
    g_threadpool_new = reinterpret_cast<decltype(g_threadpool_new)>(
        ggml_backend_reg_get_proc_address(reg, "ggml_threadpool_new"));
    g_threadpool_free = reinterpret_cast<decltype(g_threadpool_free)>(
        ggml_backend_reg_get_proc_address(reg, "ggml_threadpool_free"));
    LOGI("CPU backend: %s", g_cpu_backend.c_str());
    return JNI_TRUE;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_github_Qortal_qortalMobile_QortinoLlmPlugin_nativeLoadModel(
    JNIEnv * env,
    jobject,
    jstring jPath,
    jint nCtx,
    jint nThreads,
    jint nThreadsBatch,
    jint nBatch,
    jint nUbatch
) {
    std::lock_guard<std::mutex> lock(g_mutex);
    const std::string path = jstring_to_string(env, jPath);
    if (path.empty()) {
        return env->NewStringUTF("Model path is empty");
    }
    if (g_cpu_backend.empty()) {
        return env->NewStringUTF("This phone's processor cannot run Qortino's model");
    }
    const uint32_t want_ctx = nCtx > 0 ? static_cast<uint32_t>(nCtx) : 4096;
    const uint32_t want_batch = std::min(want_ctx, nBatch > 0 ? static_cast<uint32_t>(nBatch) : 512u);
    const uint32_t want_ubatch = std::min(want_batch, nUbatch > 0 ? static_cast<uint32_t>(nUbatch) : 256u);
    if (g_model != nullptr && g_model_path == path && g_ctx != nullptr &&
        llama_n_ctx(g_ctx) == want_ctx && g_model_batch == want_batch && g_model_ubatch == want_ubatch) {
        return nullptr;
    }

    unload_chat_locked();
    const long long t0 = now_ms();

    llama_model_params model_params = llama_model_default_params();
    model_params.n_gpu_layers = 0; // CPU-only on Capacitor Android

    // A split model (name-00001-of-0000N.gguf) is opened by its first part;
    // llama.cpp finds the other parts beside it.
    g_model = llama_model_load_from_file(path.c_str(), model_params);
    if (g_model == nullptr) {
        return env->NewStringUTF("Unable to load GGUF model");
    }
    const long long t_model = now_ms();

    llama_context_params ctx_params = llama_context_default_params();
    ctx_params.n_ctx = want_ctx;
    ctx_params.n_batch = want_batch;
    ctx_params.n_ubatch = want_ubatch;
    const int hw = (int) sysconf(_SC_NPROCESSORS_ONLN);
    const std::vector<int> fast = fast_cpus();
    const int perf = static_cast<int>(fast.size());
    // Writing is bound by memory speed: on a vivo (5 fast cores) 3, 4 and 5
    // threads all wrote ~5 tok/s, so 4 leaves a fast core for the screen.
    // Reading a prompt is compute-bound and takes every fast core (8 threads,
    // little cores included, read slower than the 5 fast ones).
    int decode_threads = perf > 0 ? std::clamp(perf, 2, 4) : std::max(1, std::min(4, hw));
    int batch_threads = perf > 0 ? std::clamp(perf, 2, 6) : (hw >= 8 ? 6 : std::max(1, std::min(4, hw)));
    if (nThreads > 0) {
        decode_threads = nThreads;
        batch_threads = nThreads;
    }
    if (nThreadsBatch > 0) {
        batch_threads = nThreadsBatch;
    }
    ctx_params.n_threads = decode_threads;
    ctx_params.n_threads_batch = batch_threads;
    ctx_params.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_ENABLED;
    // Quantized KV halves the cache next to f16; Q8 keeps answers clean.
    ctx_params.type_k = GGML_TYPE_Q8_0;
    ctx_params.type_v = GGML_TYPE_Q8_0;
    ctx_params.abort_callback = cancel_abort_cb;
    ctx_params.abort_callback_data = nullptr;

    g_ctx = llama_init_from_model(g_model, ctx_params);
    if (g_ctx == nullptr) {
        // Smaller compute buffers for phones short on memory.
        ctx_params.n_batch = std::min(want_batch, 128u);
        ctx_params.n_ubatch = std::min(want_ubatch, 64u);
        g_ctx = llama_init_from_model(g_model, ctx_params);
    }
    if (g_ctx == nullptr) {
        ctx_params.type_k = GGML_TYPE_F16;
        ctx_params.type_v = GGML_TYPE_F16;
        ctx_params.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_AUTO;
        g_ctx = llama_init_from_model(g_model, ctx_params);
    }
    if (g_ctx == nullptr) {
        unload_chat_locked();
        return env->NewStringUTF("Failed to create llama context");
    }

    llama_set_abort_callback(g_ctx, cancel_abort_cb, nullptr);

    // Threads beyond the fast cores may spill onto the little ones.
    const auto pool_cpus = [&](int n_threads) {
        return n_threads <= perf ? fast : std::vector<int>();
    };
    // Decode pool last: the calling thread keeps that pool's cores.
    if (batch_threads != decode_threads) {
        g_threadpool_batch = new_threadpool(batch_threads, pool_cpus(batch_threads));
    }
    g_threadpool = new_threadpool(decode_threads, pool_cpus(decode_threads));
    if (batch_threads == decode_threads) {
        g_threadpool_batch = g_threadpool;
    }
    if (g_threadpool != nullptr && g_threadpool_batch != nullptr) {
        llama_attach_threadpool(g_ctx, g_threadpool, g_threadpool_batch);
    } else {
        LOGE("Thread pool failed; ggml starts threads per run");
    }

    g_model_path = path;
    g_model_batch = want_batch;
    g_model_ubatch = want_ubatch;
    const long long t1 = now_ms();
    std::string fast_list;
    for (int cpu : fast) fast_list += (fast_list.empty() ? "" : ",") + std::to_string(cpu);
    LOGI("Loaded chat model %s in %lld ms (weights %lld ms; n_ctx=%u n_batch=%u n_ubatch=%u threads=%d/%d fast_cpus=%s cpu=%s)",
         path.c_str(), t1 - t0, t_model - t0, ctx_params.n_ctx, ctx_params.n_batch, ctx_params.n_ubatch,
         (int) ctx_params.n_threads, (int) ctx_params.n_threads_batch, fast_list.empty() ? "?" : fast_list.c_str(),
         g_cpu_backend.c_str());
    return nullptr;
}

extern "C" JNIEXPORT void JNICALL
Java_com_github_Qortal_qortalMobile_QortinoLlmPlugin_nativeUnload(JNIEnv *, jobject) {
    std::lock_guard<std::mutex> lock(g_mutex);
    g_cancel.store(true);
    unload_chat_locked();
    release_listener_locked();
}

extern "C" JNIEXPORT void JNICALL
Java_com_github_Qortal_qortalMobile_QortinoLlmPlugin_nativeCancel(JNIEnv *, jobject) {
    g_cancel.store(true);
}

/**
 * Clear a cancel before new work starts. Java calls this under the same lock
 * it cancels with, after checking no cancel came for this request: clearing
 * it inside nativeComplete instead lost a Stop pressed before the reply began.
 */
extern "C" JNIEXPORT void JNICALL
Java_com_github_Qortal_qortalMobile_QortinoLlmPlugin_nativeResetCancel(JNIEnv *, jobject) {
    g_cancel.store(false);
}

extern "C" JNIEXPORT void JNICALL
Java_com_github_Qortal_qortalMobile_QortinoLlmPlugin_nativeSetTokenListener(
    JNIEnv * env,
    jobject,
    jobject listener
) {
    std::lock_guard<std::mutex> lock(g_mutex);
    release_listener_locked();
    if (listener == nullptr) {
        return;
    }
    env->GetJavaVM(&g_token_cb.vm);
    g_token_cb.listener = env->NewGlobalRef(listener);
}

/**
 * Read a prompt prefix (the system prompt) into the KV cache ahead of the
 * first question, so the first answer starts without reading it. Returns null
 * on success, otherwise an error message.
 *
 * With a `cachePath`, the KV state of that prefix is kept in a file: later
 * loads read it back in a fraction of a second instead of running the prompt
 * through the model again (tens of seconds on a phone CPU). The caller names
 * the file after the prompt, model and context, so a stale file never fits.
 */
extern "C" JNIEXPORT jstring JNICALL
Java_com_github_Qortal_qortalMobile_QortinoLlmPlugin_nativeWarmup(
    JNIEnv * env,
    jobject,
    jstring jPrompt,
    jstring jCachePath
) {
    const std::string prompt = jstring_to_string(env, jPrompt);
    const std::string cache_path = jstring_to_string(env, jCachePath);
    if (prompt.empty()) return nullptr;

    std::unique_lock<std::mutex> lock(g_mutex);
    if (g_model == nullptr || g_ctx == nullptr) {
        return env->NewStringUTF("Model is not loaded");
    }

    std::vector<llama_token> tokens;
    if (!tokenize_prompt(llama_model_get_vocab(g_model), prompt, tokens) || tokens.empty()) {
        return env->NewStringUTF("Failed to tokenize warmup prompt");
    }
    if (tokens.size() + 64 >= llama_n_ctx(g_ctx)) {
        return env->NewStringUTF("Warmup prompt does not fit the context");
    }
    // Already resident (same system prompt as last time): nothing to read.
    if (g_prompt_cache.size() >= tokens.size() &&
        std::equal(tokens.begin(), tokens.end(), g_prompt_cache.begin())) {
        return nullptr;
    }

    const long long t0 = now_ms();
    llama_memory_t mem = llama_get_memory(g_ctx);
    if (!cache_path.empty() && access(cache_path.c_str(), R_OK) == 0) {
        llama_memory_clear(mem, true);
        g_prompt_cache.clear();
        std::vector<llama_token> stored(tokens.size());
        size_t n_stored = 0;
        const size_t read = llama_state_seq_load_file(
            g_ctx, cache_path.c_str(), 0, stored.data(), stored.size(), &n_stored);
        if (read > 0 && n_stored == tokens.size() &&
            std::equal(tokens.begin(), tokens.end(), stored.begin())) {
            g_prompt_cache = tokens;
            LOGI("Warmup: %zu tokens from saved state in %lld ms", tokens.size(), now_ms() - t0);
            return nullptr;
        }
        LOGI("Warmup: saved state did not match (read=%zu tokens=%zu), reading prompt", read, n_stored);
        llama_memory_clear(mem, true);
        unlink(cache_path.c_str());
    }

    size_t reused = 0;
    const int rc = prefill_locked(lock, tokens, "warmup", &reused);
    if (rc == kPrefillCancelled) {
        return env->NewStringUTF("cancelled");
    }
    if (rc != 0) {
        g_prompt_cache.clear();
        if (g_ctx != nullptr) llama_memory_clear(llama_get_memory(g_ctx), true);
        return env->NewStringUTF("Warmup prefill failed");
    }
    LOGI("Warmup: %zu tokens (%zu reused) in %lld ms", tokens.size(), reused, now_ms() - t0);

    if (!cache_path.empty() && g_ctx != nullptr) {
        // Save only the prefix: the KV may hold more after a reused prefix.
        const std::string tmp = cache_path + ".tmp";
        llama_memory_seq_rm(llama_get_memory(g_ctx), 0, static_cast<llama_pos>(tokens.size()), -1);
        g_prompt_cache = tokens;
        const size_t written = llama_state_seq_save_file(g_ctx, tmp.c_str(), 0, tokens.data(), tokens.size());
        if (written > 0 && rename(tmp.c_str(), cache_path.c_str()) == 0) {
            LOGI("Warmup: saved state (%zu bytes)", written);
        } else {
            unlink(tmp.c_str());
            LOGE("Warmup: could not save state to %s", cache_path.c_str());
        }
    }
    return nullptr;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_github_Qortal_qortalMobile_QortinoLlmPlugin_nativeComplete(
    JNIEnv * env,
    jobject,
    jstring jPrompt,
    jint maxTokens,
    jfloat temperature,
    jint topK,
    jfloat topP,
    jfloat minP,
    jfloat repeatPenalty,
    jfloat presencePenalty
) {
    std::string prompt = jstring_to_string(env, jPrompt);
    if (prompt.empty()) {
        return complete_error(env, "Prompt is empty");
    }

    SamplingParams sp;
    sp.temperature = temperature > 0.0f ? temperature : sp.temperature;
    sp.top_k = topK >= 0 ? topK : sp.top_k;
    sp.top_p = topP > 0.0f && topP <= 1.0f ? topP : sp.top_p;
    sp.min_p = minP >= 0.0f && minP < 1.0f ? minP : sp.min_p;
    sp.repeat_penalty = repeatPenalty > 0.0f ? repeatPenalty : sp.repeat_penalty;
    sp.presence_penalty = presencePenalty;

    // Hold the lock for generation so unload cannot race. Unlock briefly when
    // emitting tokens so the Capacitor bridge cannot deadlock on the lock.
    std::unique_lock<std::mutex> lock(g_mutex);

    llama_model * model = g_model;
    llama_context * ctx = g_ctx;
    if (model == nullptr || ctx == nullptr) {
        return complete_error(env, "Model is not loaded");
    }

    const llama_vocab * vocab = llama_model_get_vocab(model);
    std::vector<llama_token> prompt_tokens;
    if (!tokenize_prompt(vocab, prompt, prompt_tokens)) {
        return complete_error(env, "Failed to tokenize prompt");
    }

    const uint32_t n_ctx = llama_n_ctx(ctx);
    int n_predict = maxTokens > 0 ? maxTokens : 512;
    if (static_cast<uint32_t>(n_predict) + 64 >= n_ctx) {
        n_predict = static_cast<int>(n_ctx / 2);
    }
    // Leave room for the reply. JS budgets the history to fit; this is the
    // last resort and keeps the tail (the user's question).
    const size_t max_prompt = static_cast<size_t>(n_ctx - static_cast<uint32_t>(n_predict) - 8);
    if (prompt_tokens.size() > max_prompt) {
        const size_t drop = prompt_tokens.size() - max_prompt;
        prompt_tokens.erase(prompt_tokens.begin(), prompt_tokens.begin() + static_cast<long>(drop));
        LOGI("Truncated prompt by %zu tokens (kept %zu)", drop, prompt_tokens.size());
    }
    if (prompt_tokens.empty()) {
        return complete_error(env, "Prompt empty after truncate");
    }

    const long long t0 = now_ms();
    size_t n_reuse = 0;
    const int pref_rc = prefill_locked(lock, prompt_tokens, "prefill", &n_reuse);
    if (pref_rc == kPrefillCancelled) {
        lock.unlock();
        emit_token("", true, "cancelled");
        return complete_error(env, "cancelled");
    }
    if (pref_rc != 0) {
        g_prompt_cache.clear();
        if (g_ctx != nullptr) llama_memory_clear(llama_get_memory(g_ctx), true);
        if (pref_rc == kPrefillUnloaded) {
            return complete_error(env, "Model unloaded during prefill");
        }
        lock.unlock();
        emit_token("", true, "llama_decode failed during prompt");
        return complete_error(env, "llama_decode failed during prompt");
    }
    const long long t_prefill = now_ms();
    LOGI("Prefill: %zu tokens (%zu reused) in %lld ms", prompt_tokens.size(), n_reuse, t_prefill - t0);

    auto sparams = llama_sampler_chain_default_params();
    llama_sampler * smpl = llama_sampler_chain_init(sparams);
    // Fresh seed each reply — otherwise the model keeps replaying the same
    // high-probability stock answers across sessions.
    const uint32_t seed = static_cast<uint32_t>(
        std::chrono::high_resolution_clock::now().time_since_epoch().count() ^
        (static_cast<uint64_t>(getpid()) << 16) ^
        static_cast<uint64_t>(reinterpret_cast<uintptr_t>(ctx))
    );
    if (sp.repeat_penalty != 1.0f || sp.presence_penalty != 0.0f) {
        llama_sampler_chain_add(smpl, llama_sampler_init_penalties(
            /*last_n*/ 64, sp.repeat_penalty, /*freq*/ 0.0f, sp.presence_penalty));
    }
    if (sp.top_k > 0) llama_sampler_chain_add(smpl, llama_sampler_init_top_k(sp.top_k));
    if (sp.top_p < 1.0f) llama_sampler_chain_add(smpl, llama_sampler_init_top_p(sp.top_p, 1));
    if (sp.min_p > 0.0f) llama_sampler_chain_add(smpl, llama_sampler_init_min_p(sp.min_p, 1));
    llama_sampler_chain_add(smpl, llama_sampler_init_temp(sp.temperature));
    llama_sampler_chain_add(smpl, llama_sampler_init_dist(seed));
    LOGI("Sampler seed=%u temp=%.2f top_k=%d top_p=%.2f min_p=%.2f repeat=%.2f presence=%.2f",
         seed, sp.temperature, sp.top_k, sp.top_p, sp.min_p, sp.repeat_penalty, sp.presence_penalty);

    {
        lock.unlock();
        emit_progress("generate", "0", 0.0f);
        lock.lock();
    }

    std::string reply;
    reply.reserve(2048);
    int generated = 0;
    int same_token_streak = 0;
    llama_token prev_id = -1;
    bool kv_ok = true;
    long long last_emit = 0;
    while (generated < n_predict && !g_cancel.load()) {
        if (g_ctx != ctx || g_model != model) {
            kv_ok = false;
            break;
        }
        llama_token id = llama_sampler_sample(smpl, ctx, -1);
        llama_sampler_accept(smpl, id);

        if (llama_vocab_is_eog(vocab, id)) {
            break;
        }

        if (id == prev_id) {
            same_token_streak++;
            if (same_token_streak >= 12) {
                LOGI("Stopping: repeated token streak");
                break;
            }
        } else {
            same_token_streak = 0;
            prev_id = id;
        }

        const std::string piece = token_to_piece(vocab, id);
        reply += piece;

        // Bail out of degenerate loops ("aml aml aml…"), not markdown rules.
        if (reply.size() >= 96) {
            const std::string tail = reply.substr(reply.size() - 96);
            const std::string half = tail.substr(48);
            const bool wordy = std::count_if(half.begin(), half.end(), [](char c) {
                return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
            }) >= 8;
            if (wordy && tail.compare(0, 48, half) == 0) {
                LOGI("Stopping: detected repeating text loop");
                break;
            }
        }

        lock.unlock();
        emit_token(piece, false, nullptr);
        const long long t = now_ms();
        if (generated == 0 || t - last_emit >= 400) {
            last_emit = t;
            char detail[32];
            std::snprintf(detail, sizeof(detail), "%d", generated + 1);
            emit_progress("generate", detail, static_cast<float>(generated + 1) / static_cast<float>(n_predict));
        }
        lock.lock();
        generated++;

        if (g_ctx != ctx || g_model != model) {
            kv_ok = false;
            break;
        }
        llama_batch batch = llama_batch_get_one(&id, 1);
        const int rc = llama_decode(ctx, batch);
        if (rc == 2) {
            // Stopped by the user mid-step: the token may or may not be in
            // the KV, so cut it back to what the cache lists.
            llama_memory_seq_rm(llama_get_memory(ctx), 0, static_cast<llama_pos>(g_prompt_cache.size()), -1);
            break;
        }
        if (rc != 0) {
            LOGE("llama_decode generate failed rc=%d after %d tokens", rc, generated);
            kv_ok = false;
            break;
        }
        g_prompt_cache.push_back(id);
        if (llama_memory_seq_pos_max(llama_get_memory(ctx), 0) + 1 >= static_cast<llama_pos>(n_ctx)) {
            break;
        }
    }

    llama_sampler_free(smpl);
    // The reply stays in the KV cache: the next prompt repeats it as history,
    // so only the new question has to be read.
    if (!kv_ok) {
        g_prompt_cache.clear();
        if (g_ctx != nullptr) llama_memory_clear(llama_get_memory(g_ctx), true);
    }
    const long long t_done = now_ms();
    LOGI("Complete finished: generated=%d in %lld ms (%.1f tok/s) cancelled=%d bytes=%zu cache=%zu",
         generated, t_done - t_prefill,
         generated > 0 ? 1000.0 * generated / std::max<long long>(1, t_done - t_prefill) : 0.0,
         (int) g_cancel.load(), reply.size(), g_prompt_cache.size());
    lock.unlock();
    emit_progress("done", std::to_string(generated), 1.0f);
    emit_token("", true, g_cancel.load() ? "cancelled" : nullptr);
    // Return the full reply so JS does not depend on streamed bridge events.
    return new_jstring(env, reply);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_github_Qortal_qortalMobile_QortinoLlmPlugin_nativeApplyChatTemplate(
    JNIEnv * env,
    jobject,
    jstring jSystem,
    jstring jMessagesJson,
    jstring jContextJson,
    jboolean jAddAssistant
) {
    std::lock_guard<std::mutex> lock(g_mutex);

    const std::string system = jstring_to_string(env, jSystem);
    const std::string packed = jstring_to_string(env, jMessagesJson);
    const std::string context = jstring_to_string(env, jContextJson);
    const bool add_assistant = jAddAssistant == JNI_TRUE;

    // Keep system prompt stable; attach retrieved notes to the latest user turn
    // so the KV cache can reuse the persona across questions.
    const bool has_context = !context.empty() && context != "[]";
    auto with_context = [&](const std::string & user_content) -> std::string {
        if (!has_context) return user_content;
        return std::string("Use this retrieved knowledge when relevant:\n") +
               context + "\n\nUser question:\n" + user_content;
    };

    std::vector<llama_chat_message> chat;
    std::vector<std::string> storage;
    std::vector<std::pair<std::string, std::string>> turns = unpack_turns(packed);
    storage.reserve(turns.size() * 2 + 2);

    if (has_context) {
        bool injected = false;
        for (int i = static_cast<int>(turns.size()) - 1; i >= 0; --i) {
            if (turns[static_cast<size_t>(i)].first == "user") {
                turns[static_cast<size_t>(i)].second =
                    with_context(turns[static_cast<size_t>(i)].second);
                injected = true;
                break;
            }
        }
        if (!injected) {
            turns.emplace_back("user", with_context(""));
        }
    }

    auto build_fallback = [&]() -> std::string {
        std::string prompt;
        if (!system.empty()) {
            prompt += system;
        }
        for (const auto & turn : turns) {
            prompt += "\n\n";
            prompt += turn.first;
            prompt += ": ";
            prompt += turn.second;
        }
        if (add_assistant) {
            prompt += "\n\nassistant: ";
        }
        return prompt;
    };

    if (g_model == nullptr) {
        return new_jstring(env, build_fallback());
    }

    if (!system.empty()) {
        storage.push_back(system);
        chat.push_back({"system", storage.back().c_str()});
    }
    for (auto & turn : turns) {
        storage.push_back(turn.first);
        storage.push_back(turn.second);
        chat.push_back({storage[storage.size() - 2].c_str(), storage[storage.size() - 1].c_str()});
    }

    if (chat.empty()) {
        return new_jstring(env, build_fallback());
    }

    const char * tmpl = llama_model_chat_template(g_model, nullptr);
    // Probe required size first — undersized buffers used to truncate with
    // strncpy and then we read past the vector end (crash / empty reply).
    int32_t n = llama_chat_apply_template(tmpl, chat.data(), chat.size(), add_assistant, nullptr, 0);
    if (n < 0) {
        LOGE("chat template failed (%d); using fallback prompt", n);
        return new_jstring(env, build_fallback());
    }
    std::vector<char> buf(static_cast<size_t>(n) + 1);
    n = llama_chat_apply_template(tmpl, chat.data(), chat.size(), add_assistant, buf.data(), static_cast<int32_t>(buf.size()));
    if (n < 0) {
        LOGE("chat template second pass failed (%d); using fallback prompt", n);
        return new_jstring(env, build_fallback());
    }
    LOGI("Built chat prompt (%d bytes, %zu messages)", n, chat.size());
    return new_jstring(env, std::string(buf.data(), static_cast<size_t>(n)));
}
