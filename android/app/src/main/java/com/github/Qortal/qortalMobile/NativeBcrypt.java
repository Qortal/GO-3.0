package com.github.Qortal.qortalMobile;

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
    // Leave one core for the UI/render thread and run below it in priority:
    // KDF batches fire during the fingerprint scan, and saturating every core
    // at MAX_PRIORITY visibly delays the biometric prompt on mid-range devices.
    private final ExecutorService executor = Executors.newFixedThreadPool(
        Math.max(2, Runtime.getRuntime().availableProcessors() - 1),
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
    public void hashPassword(PluginCall call) {
        String password = call.getString("password");
        String salt = call.getString("salt");

        if (password == null || salt == null) {
            call.reject("Password or salt is missing");
            return;
        }

        executor.execute(() -> {
            try {
                // Perform bcrypt hashing
                String hash = BCrypt.hashpw(password, salt);

                // Prepare the result
                JSObject result = new JSObject();
                result.put("hash", hash);

                // Resolve the call on the main thread
                getActivity().runOnUiThread(() -> call.resolve(result));
            } catch (Exception e) {
                // Reject the call on the main thread in case of an error
                getActivity().runOnUiThread(() -> call.reject("Hashing failed: " + e.getMessage()));
            }
        });
    }

    @PluginMethod
    public void hashPasswordBatch(PluginCall call) {
        JSArray jobs = call.getArray("jobs");
        if (jobs == null || jobs.length() == 0) {
            call.reject("jobs array is required");
            return;
        }

        final int count = jobs.length();
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
                    JSObject result = new JSObject();
                    result.put("hashes", hashes);
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

    @Override
    public void handleOnDestroy() {
        super.handleOnDestroy();
        executor.shutdown(); // Shutdown the executor to release resources
    }
}
