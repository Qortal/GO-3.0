#include <android/log.h>
#include <jni.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <mutex>
#include <string>
#include <unistd.h>
#include <utility>
#include <vector>

#include "llama.h"

#define LOG_TAG "QortinoLlm"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace {

std::mutex g_mutex;
llama_model * g_model = nullptr;
llama_context * g_ctx = nullptr;
std::atomic<bool> g_cancel{false};
std::string g_model_path;
/** Tokens currently resident in the chat KV cache (prompt only, no reply). */
std::vector<llama_token> g_prompt_cache;

struct JniCallback {
    JavaVM * vm = nullptr;
    jobject listener = nullptr;
};

JniCallback g_token_cb;

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
    if (g_model != nullptr) {
        llama_model_free(g_model);
        g_model = nullptr;
    }
    g_model_path.clear();
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

} // namespace

extern "C" JNIEXPORT jboolean JNICALL
Java_com_github_Qortal_qortalMobile_QortinoLlmPlugin_nativeInitBackend(JNIEnv *, jobject) {
    ggml_backend_load_all();
    return JNI_TRUE;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_github_Qortal_qortalMobile_QortinoLlmPlugin_nativeLoadModel(
    JNIEnv * env,
    jobject,
    jstring jPath,
    jint nCtx,
    jint nThreads
) {
    std::lock_guard<std::mutex> lock(g_mutex);
    const std::string path = jstring_to_string(env, jPath);
    if (path.empty()) {
        return env->NewStringUTF("Model path is empty");
    }
    const uint32_t want_ctx = nCtx > 0 ? static_cast<uint32_t>(nCtx) : 1024;
    if (g_model != nullptr && g_model_path == path && g_ctx != nullptr && llama_n_ctx(g_ctx) == want_ctx) {
        return nullptr;
    }

    unload_chat_locked();

    llama_model_params model_params = llama_model_default_params();
    model_params.n_gpu_layers = 0; // CPU-only on Capacitor Android for v1

    g_model = llama_model_load_from_file(path.c_str(), model_params);
    if (g_model == nullptr) {
        return env->NewStringUTF("Unable to load GGUF model");
    }

    llama_context_params ctx_params = llama_context_default_params();
    // Modest context + quantized KV keeps the 3B pack usable on phones.
    // Keep batch sizes moderate — huge ubatches were causing llama_decode
    // prefill failures (OOM / KV pressure) on Max.
    ctx_params.n_ctx = want_ctx;
    ctx_params.n_batch = std::min(want_ctx, 128u);
    ctx_params.n_ubatch = std::min(ctx_params.n_batch, 64u);
    // Off Grid AI guidance: 4–6 threads for decode; more for prompt batching.
    const int hw = (int) sysconf(_SC_NPROCESSORS_ONLN);
    int auto_threads = 4;
    if (hw >= 8) auto_threads = 6;
    else if (hw >= 4) auto_threads = std::min(4, hw);
    else if (hw > 0) auto_threads = hw;
    ctx_params.n_threads = nThreads > 0 ? nThreads : auto_threads;
    const int batch_threads = hw > 0 ? std::min(std::max(auto_threads, hw - 1), 8) : auto_threads;
    ctx_params.n_threads_batch = nThreads > 0 ? nThreads : batch_threads;
    ctx_params.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_ENABLED;
    // Q4 KV was causing Fast-mode gibberish/repetition on Qwen; stay on Q8.
    ctx_params.type_k = GGML_TYPE_Q8_0;
    ctx_params.type_v = GGML_TYPE_Q8_0;
    ctx_params.abort_callback = cancel_abort_cb;
    ctx_params.abort_callback_data = nullptr;

    g_ctx = llama_init_from_model(g_model, ctx_params);
    if (g_ctx == nullptr) {
        // Fall back through safer KV / attention settings.
        ctx_params.type_k = GGML_TYPE_Q8_0;
        ctx_params.type_v = GGML_TYPE_Q8_0;
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

    g_model_path = path;
    LOGI("Loaded chat model %s (n_ctx=%u n_batch=%u n_ubatch=%u threads=%d)",
         path.c_str(), ctx_params.n_ctx, ctx_params.n_batch, ctx_params.n_ubatch,
         (int) ctx_params.n_threads);
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

extern "C" JNIEXPORT jstring JNICALL
Java_com_github_Qortal_qortalMobile_QortinoLlmPlugin_nativeComplete(
    JNIEnv * env,
    jobject,
    jstring jPrompt,
    jint maxTokens,
    jfloat temperature
) {
    std::string prompt = jstring_to_string(env, jPrompt);
    if (prompt.empty()) {
        return complete_error(env, "Prompt is empty");
    }

    // Hold the lock for generation so unload cannot race. Unlock briefly when
    // emitting tokens so the Capacitor bridge cannot deadlock on the lock.
    std::unique_lock<std::mutex> lock(g_mutex);

    llama_model * model = g_model;
    llama_context * ctx = g_ctx;
    if (model == nullptr || ctx == nullptr) {
        return complete_error(env, "Model is not loaded");
    }

    g_cancel.store(false);

    const llama_vocab * vocab = llama_model_get_vocab(model);
    const int n_prompt = -llama_tokenize(vocab, prompt.c_str(), prompt.size(), nullptr, 0, true, true);
    if (n_prompt <= 0) {
        return complete_error(env, "Failed to tokenize prompt");
    }

    std::vector<llama_token> prompt_tokens(static_cast<size_t>(n_prompt));
    if (llama_tokenize(vocab, prompt.c_str(), prompt.size(), prompt_tokens.data(), prompt_tokens.size(), true, true) < 0) {
        return complete_error(env, "Tokenize failed");
    }

    const uint32_t n_ctx = llama_n_ctx(ctx);
    const uint32_t n_batch = std::max(1u, std::min(llama_n_batch(ctx), llama_n_ubatch(ctx)));
    int n_predict = maxTokens > 0 ? maxTokens : 256;
    // Leave room for the reply; keep the tail of the prompt (user turn).
    const size_t max_prompt = n_ctx > (uint32_t) n_predict + 8
        ? static_cast<size_t>(n_ctx - (uint32_t) n_predict - 8)
        : n_ctx / 2;
    if (prompt_tokens.size() > max_prompt) {
        const size_t drop = prompt_tokens.size() - max_prompt;
        prompt_tokens.erase(prompt_tokens.begin(), prompt_tokens.begin() + static_cast<long>(drop));
        g_prompt_cache.clear();
        LOGI("Truncated prompt by %zu tokens (kept %zu)", drop, prompt_tokens.size());
    }
    if (prompt_tokens.empty()) {
        return complete_error(env, "Prompt empty after truncate");
    }

    // Small prefill slices are slower but far more stable on phones.
    // Large slices (256+) were a common cause of "llama_decode failed during prompt".
    uint32_t slice = std::max(8u, std::min(n_batch, 32u));

    size_t n_reuse = 0;
    const size_t lim = std::min(g_prompt_cache.size(), prompt_tokens.size());
    while (n_reuse < lim && g_prompt_cache[n_reuse] == prompt_tokens[n_reuse]) {
        ++n_reuse;
    }

    llama_memory_t mem = llama_get_memory(ctx);
    if (n_reuse == 0) {
        llama_memory_clear(mem, true);
    } else {
        // Drop diverging prompt tokens AND any leftover generated tokens.
        if (!llama_memory_seq_rm(mem, 0, static_cast<llama_pos>(n_reuse), -1)) {
            llama_memory_clear(mem, true);
            n_reuse = 0;
        }
    }

    LOGI(
        "Completing: prompt_tokens=%zu reuse=%zu n_ctx=%u slice=%u max_gen=%d",
        prompt_tokens.size(),
        n_reuse,
        n_ctx,
        slice,
        n_predict
    );

    {
        lock.unlock();
        emit_progress(
            "prefill",
            n_reuse > 32
                ? "Picking up where we left off…"
                : "Reading your question — carefully, twice…",
            0.02f
        );
        lock.lock();
    }

    auto sparams = llama_sampler_chain_default_params();
    llama_sampler * smpl = llama_sampler_chain_init(sparams);
    // Fresh seed each reply — otherwise small models keep replaying the same
    // high-probability stock answers (e.g. the atom joke) across sessions.
    const uint32_t seed = static_cast<uint32_t>(
        std::chrono::high_resolution_clock::now().time_since_epoch().count() ^
        (static_cast<uint64_t>(getpid()) << 16) ^
        static_cast<uint64_t>(reinterpret_cast<uintptr_t>(ctx))
    );
    const float temp = temperature < 0.25f ? 0.65f : temperature;
    llama_sampler_chain_add(smpl, llama_sampler_init_penalties(/*last_n*/ 96, /*repeat*/ 1.18f, /*freq*/ 0.05f, /*present*/ 0.0f));
    llama_sampler_chain_add(smpl, llama_sampler_init_top_k(60));
    llama_sampler_chain_add(smpl, llama_sampler_init_top_p(0.92f, 1));
    llama_sampler_chain_add(smpl, llama_sampler_init_temp(temp));
    llama_sampler_chain_add(smpl, llama_sampler_init_dist(seed));
    LOGI("Sampler seed=%u temp=%.2f", seed, temp);

    auto run_prefill = [&](size_t start_i, uint32_t use_slice) -> int {
        for (size_t i = start_i; i < prompt_tokens.size();) {
            if (g_cancel.load()) return -2;
            if (g_ctx == nullptr) return -3;
            ctx = g_ctx;
            const size_t remaining = prompt_tokens.size() - i;
            const int32_t n_eval = static_cast<int32_t>(
                std::min(remaining, static_cast<size_t>(use_slice))
            );
            llama_batch batch = llama_batch_get_one(prompt_tokens.data() + i, n_eval);
            const int rc = llama_decode(ctx, batch);
            if (rc != 0) {
                LOGE("llama_decode prefill failed rc=%d at token %zu/%zu slice=%u",
                     rc, i, prompt_tokens.size(), use_slice);
                return rc;
            }
            i += static_cast<size_t>(n_eval);
            // Live progress every ~16 tokens so Assembling… updates during Max.
            if (i >= prompt_tokens.size() || (i - start_i) % 16u < static_cast<size_t>(n_eval)) {
                const float denom = (float) std::max<size_t>(1, prompt_tokens.size() - start_i);
                const float pct = 0.05f + 0.55f * (float) (i - start_i) / denom;
                char detail[160];
                std::snprintf(
                    detail,
                    sizeof(detail),
                    "Warming local weights · %zu / %zu tokens",
                    i,
                    prompt_tokens.size()
                );
                lock.unlock();
                emit_progress("prefill", detail, pct);
                lock.lock();
            }
        }
        return 0;
    };

    int pref_rc = run_prefill(n_reuse, slice);
    if (pref_rc == -2) {
        llama_sampler_free(smpl);
        g_prompt_cache.clear();
        lock.unlock();
        emit_token("", true, "cancelled");
        return complete_error(env, "cancelled");
    }
    if (pref_rc == -3) {
        llama_sampler_free(smpl);
        g_prompt_cache.clear();
        return complete_error(env, "Model unloaded during prefill");
    }
    if (pref_rc != 0) {
        // Retry once from scratch with tiny batches — recovers most phone OOMs.
        LOGI("Retrying prefill with clear KV and slice=8");
        lock.unlock();
        emit_progress("prefill", "Retrying with a lighter assemble pass…", 0.08f);
        lock.lock();
        if (g_ctx == nullptr) {
            llama_sampler_free(smpl);
            g_prompt_cache.clear();
            return complete_error(env, "Model unloaded during prefill");
        }
        ctx = g_ctx;
        llama_memory_clear(llama_get_memory(ctx), true);
        g_prompt_cache.clear();
        n_reuse = 0;
        slice = 8;
        pref_rc = run_prefill(0, slice);
        if (pref_rc != 0) {
            llama_sampler_free(smpl);
            g_prompt_cache.clear();
            lock.unlock();
            emit_token("", true, "llama_decode failed during prompt");
            return complete_error(env, "llama_decode failed during prompt");
        }
    }

    g_prompt_cache = prompt_tokens;

    {
        lock.unlock();
        emit_progress("generate", "Weaving your notes into an answer…", 0.62f);
        lock.lock();
    }

    std::string reply;
    reply.reserve(512);
    int generated = 0;
    int same_token_streak = 0;
    llama_token prev_id = -1;
    while (generated < n_predict && !g_cancel.load()) {
        if (g_ctx == nullptr || g_model == nullptr) {
            break;
        }
        llama_token id = llama_sampler_sample(smpl, ctx, -1);
        llama_sampler_accept(smpl, id);

        if (llama_vocab_is_eog(vocab, id)) {
            break;
        }

        if (id == prev_id) {
            same_token_streak++;
            if (same_token_streak >= 4) {
                LOGI("Stopping: repeated token streak");
                break;
            }
        } else {
            same_token_streak = 0;
            prev_id = id;
        }

        const std::string piece = token_to_piece(vocab, id);
        reply += piece;

        // Bail out of nonsense loops like "aml aml aml…".
        if (reply.size() >= 24) {
            const std::string tail = reply.substr(reply.size() - 24);
            const size_t half = tail.size() / 2;
            if (half > 0 && tail.substr(0, half) == tail.substr(half)) {
                LOGI("Stopping: detected repeating text loop");
                break;
            }
        }

        lock.unlock();
        emit_token(piece, false, nullptr);
        // Every 4 tokens so Assembling… shows live progress during Max.
        if (generated == 0 || (generated % 4) == 0) {
            char detail[120];
            std::snprintf(
                detail,
                sizeof(detail),
                "Writing offline · %d tokens and counting…",
                generated + 1
            );
            emit_progress("generate", detail, 0.65f + 0.3f * ((float) generated / (float) n_predict));
        }
        lock.lock();
        generated++;

        if (g_ctx == nullptr) {
            break;
        }
        llama_batch batch = llama_batch_get_one(&id, 1);
        const int rc = llama_decode(ctx, batch);
        if (rc != 0) {
            LOGE("llama_decode generate failed rc=%d after %d tokens", rc, generated);
            break;
        }
        if (llama_memory_seq_pos_max(llama_get_memory(ctx), 0) + 1 >= static_cast<llama_pos>(n_ctx)) {
            break;
        }
    }

    llama_sampler_free(smpl);
    // Keep only the prompt in KV so the next turn can reuse the shared prefix.
    if (g_ctx != nullptr) {
        llama_memory_seq_rm(
            llama_get_memory(g_ctx),
            0,
            static_cast<llama_pos>(prompt_tokens.size()),
            -1
        );
    }
    LOGI("Complete finished: generated=%d cancelled=%d bytes=%zu reuse_next=%zu",
         generated, (int) g_cancel.load(), reply.size(), g_prompt_cache.size());
    lock.unlock();
    emit_progress(
        "done",
        generated > 0
            ? "Ready — made on this phone, for you \xf0\x9f\x8c\xb1"
            : "Done. No cloud was harmed in the making of this reply.",
        1.0f
    );
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
    jstring jContextJson
) {
    std::lock_guard<std::mutex> lock(g_mutex);

    const std::string system = jstring_to_string(env, jSystem);
    const std::string packed = jstring_to_string(env, jMessagesJson);
    const std::string context = jstring_to_string(env, jContextJson);

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
    storage.reserve(24);
    std::vector<std::pair<std::string, std::string>> turns;
    turns.reserve(12);

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
        prompt += "\n\nassistant: ";
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
    int32_t n = llama_chat_apply_template(tmpl, chat.data(), chat.size(), true, nullptr, 0);
    if (n < 0) {
        LOGE("chat template failed (%d); using fallback prompt", n);
        return new_jstring(env, build_fallback());
    }
    std::vector<char> buf(static_cast<size_t>(n) + 1);
    n = llama_chat_apply_template(tmpl, chat.data(), chat.size(), true, buf.data(), static_cast<int32_t>(buf.size()));
    if (n < 0) {
        LOGE("chat template second pass failed (%d); using fallback prompt", n);
        return new_jstring(env, build_fallback());
    }
    LOGI("Built chat prompt (%d bytes, %zu messages)", n, chat.size());
    return new_jstring(env, std::string(buf.data(), static_cast<size_t>(n)));
}
