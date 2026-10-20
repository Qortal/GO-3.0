package com.github.Qortal.qortalMobile;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;

/**
 * Reads a GrapheneOS boolean from {@code android.os.Environment} by
 * reflection, the same way Vanadium's WebView reads it from inside apps.
 *
 * {@link #WEBVIEW_DCL_RESTRICTED} is true when the per-app (or global)
 * "WebView JIT" exploit protection is on for GO: Vanadium then starts GO's
 * renderer with --jitless --wasm_jitless, so all JavaScript and WebAssembly
 * run interpreted. WebAssembly stays available, which is why the page cannot
 * tell this on its own.
 *
 * Plain Java with no Android types so the JVM tests can cover it.
 */
final class EnvironmentFlag {
    /** GrapheneOS 2026050400 and later; hidden API, unsupported-list. */
    static final String WEBVIEW_DCL_RESTRICTED = "isWebViewDclRestricted";

    private EnvironmentFlag() {}

    /**
     * The value of the static, no-argument boolean method {@code name} on
     * {@code environment}, or null when it is missing (stock Android, older
     * GrapheneOS), has another shape, is not reachable or fails.
     */
    static Boolean read(Class<?> environment, String name) {
        try {
            Method method = environment.getDeclaredMethod(name);
            Class<?> type = method.getReturnType();
            if (type != boolean.class && type != Boolean.class) return null;
            if (!Modifier.isStatic(method.getModifiers())) return null;
            Object value = method.invoke(null);
            return value instanceof Boolean ? (Boolean) value : null;
        } catch (Throwable ignored) {
            // NoSuchMethod, hidden-API denial, SecurityException, a throw
            // inside the method: all mean "unknown", never a crash.
            return null;
        }
    }
}
