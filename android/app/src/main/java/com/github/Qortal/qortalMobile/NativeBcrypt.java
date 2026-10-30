package com.github.Qortal.qortalMobile;

import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.os.Environment;
import android.util.Log;
import android.webkit.WebView;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadFactory;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONException;
import org.json.JSONObject;
import org.mindrot.jbcrypt.BCrypt;

@CapacitorPlugin(name = "NativeBcrypt")
public class NativeBcrypt extends Plugin {
    private static final String TAG = "NativeBcrypt";
    // Speed probe: one cost-6 hash. Compiled Java takes a few ms on a mid-range
    // phone; interpreted Java (debuggable build on GrapheneOS) ~80 ms.
    private static final String PROBE_SALT = "$2a$06$IxVE941tXVUD4cW0TNVm.O";

    // Leave one core for the UI/render thread and run below it in priority:
    // KDF batches fire during the fingerprint scan, and saturating every core
    // at MAX_PRIORITY visibly delays the biometric prompt on mid-range devices.
    private final int poolSize = Math.max(
        2,
        Runtime.getRuntime().availableProcessors() - 1
    );
    private final ExecutorService executor = Executors.newFixedThreadPool(
        poolSize,
        new ThreadFactory() {
            @Override
            public Thread newThread(Runnable r) {
                Thread thread = new Thread(r);
                thread.setPriority(Thread.NORM_PRIORITY);
                return thread;
            }
        }
    );

    @PluginMethod
    public void hashPasswordBatch(PluginCall call) {
        JSArray jobs = call.getArray("jobs");
        if (jobs == null || jobs.length() == 0) {
            call.reject("jobs array is required");
            return;
        }

        final int count = jobs.length();
        final long startedNs = System.nanoTime();
        List<CompletableFuture<String>> futures = new ArrayList<>(count);

        for (int i = 0; i < count; i++) {
            String password;
            String salt;
            try {
                JSONObject job = jobs.getJSONObject(i);
                password = job.getString("password");
                salt = job.getString("salt");
            } catch (JSONException e) {
                call.reject("Invalid job at index " + i + ": " + e.getMessage());
                return;
            }
            if (password == null || salt == null) {
                call.reject("Password or salt is missing at index " + i);
                return;
            }
            futures.add(
                CompletableFuture.supplyAsync(
                    () -> BCrypt.hashpw(password, salt),
                    executor
                )
            );
        }

        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
            .thenRun(() -> {
                try {
                    JSArray hashes = new JSArray();
                    for (CompletableFuture<String> future : futures) {
                        hashes.put(future.join());
                    }
                    long elapsedMs = (System.nanoTime() - startedNs) / 1_000_000L;
                    boolean debuggable = isDebuggable();
                    // Log.i stays in logcat on release builds, where
                    // Capacitor's console logging is off.
                    Log.i(
                        TAG,
                        "batch jobs=" + count + " pool=" + poolSize +
                        " ms=" + elapsedMs + " debuggable=" + debuggable
                    );
                    JSObject result = new JSObject();
                    result.put("hashes", hashes);
                    result.put("elapsedMs", elapsedMs);
                    result.put("poolSize", poolSize);
                    result.put("debuggable", debuggable);
                    getActivity().runOnUiThread(() -> call.resolve(result));
                } catch (Exception e) {
                    getActivity()
                        .runOnUiThread(
                            () ->
                                call.reject(
                                    "Batch hashing failed: " + e.getMessage()
                                )
                        );
                }
            })
            .exceptionally(ex -> {
                getActivity()
                    .runOnUiThread(
                        () ->
                            call.reject(
                                "Batch hashing failed: " + ex.getMessage()
                            )
                    );
                return null;
            });
    }

    /**
     * Build, Java speed and WebView facts for Copy diagnostics.
     * webViewJitRestricted is GrapheneOS's own "WebView JIT" switch for GO
     * (null when the OS has no such flag); webViewPackage/webViewVersion name
     * the WebView provider.
     */
    @PluginMethod
    public void runtimeInfo(PluginCall call) {
        final boolean debuggable = isDebuggable();
        // Own short-lived thread, not the KDF pool: while an unlock batch is
        // running, a queued probe would wait behind it and the report would
        // lose the build type too.
        new Thread(() -> {
            try {
                long startedNs = System.nanoTime();
                BCrypt.hashpw("qortal-go-speed-probe", PROBE_SALT);
                long probeMs = Math.round(
                    (System.nanoTime() - startedNs) / 1_000_000.0
                );
                JSObject result = new JSObject();
                result.put("debuggable", debuggable);
                result.put("poolSize", poolSize);
                result.put(
                    "cores",
                    Runtime.getRuntime().availableProcessors()
                );
                result.put("probeMs", probeMs);
                Boolean jitRestricted = EnvironmentFlag.read(
                    Environment.class,
                    EnvironmentFlag.WEBVIEW_DCL_RESTRICTED
                );
                // An explicit null tells "this OS has no flag" apart from an
                // older app that never sent the field.
                result.put(
                    "webViewJitRestricted",
                    jitRestricted != null ? jitRestricted : JSONObject.NULL
                );
                PackageInfo webView = currentWebViewPackage();
                if (webView != null) {
                    result.put("webViewPackage", webView.packageName);
                    result.put("webViewVersion", webView.versionName);
                }
                getActivity().runOnUiThread(() -> call.resolve(result));
            } catch (Exception e) {
                getActivity()
                    .runOnUiThread(
                        () -> call.reject("Probe failed: " + e.getMessage())
                    );
            }
        }, "NativeBcrypt-probe").start();
    }

    /** The WebView provider in use; null if Android cannot say. */
    private static PackageInfo currentWebViewPackage() {
        try {
            return WebView.getCurrentWebViewPackage();
        } catch (Throwable ignored) {
            return null;
        }
    }

    private boolean isDebuggable() {
        int flags = getContext().getApplicationInfo().flags;
        return (flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    @Override
    public void handleOnDestroy() {
        super.handleOnDestroy();
        executor.shutdown(); // Shutdown the executor to release resources
    }
}
