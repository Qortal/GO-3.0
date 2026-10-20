package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class EnvironmentFlagTest {
    /** GrapheneOS 2026050400+, WebView JIT off for the app. */
    static final class JitOffEnvironment {
        public static boolean isWebViewDclRestricted() {
            return true;
        }
    }

    /** GrapheneOS 2026050400+, WebView JIT allowed. */
    static final class JitOnEnvironment {
        public static boolean isWebViewDclRestricted() {
            return false;
        }
    }

    /** Stock Android or an older GrapheneOS: no such method. */
    static final class StockEnvironment {
        public static boolean isExternalStorageEmulated() {
            return true;
        }
    }

    static final class OddEnvironment {
        public static String isWebViewDclRestricted() {
            return "true";
        }
    }

    static final class InstanceEnvironment {
        public boolean isWebViewDclRestricted() {
            return true;
        }
    }

    static final class ThrowingEnvironment {
        public static boolean isWebViewDclRestricted() {
            throw new SecurityException("hidden API blocked");
        }
    }

    static final class BoxedEnvironment {
        private static Boolean value = null;

        public static Boolean isWebViewDclRestricted() {
            return value;
        }
    }

    private static Boolean read(Class<?> environment) {
        return EnvironmentFlag.read(environment, EnvironmentFlag.WEBVIEW_DCL_RESTRICTED);
    }

    @Test
    public void readsTheFlagWhenTheMethodExists() {
        assertEquals(Boolean.TRUE, read(JitOffEnvironment.class));
        assertEquals(Boolean.FALSE, read(JitOnEnvironment.class));
    }

    @Test
    public void isNullWhenTheMethodIsMissing() {
        assertNull(read(StockEnvironment.class));
    }

    @Test
    public void isNullForAnyOtherShapeOrAFailure() {
        assertNull(read(OddEnvironment.class));
        assertNull(read(InstanceEnvironment.class));
        assertNull(read(ThrowingEnvironment.class));
    }

    @Test
    public void acceptsABoxedBooleanButNotANullOne() {
        BoxedEnvironment.value = null;
        assertNull(read(BoxedEnvironment.class));
        BoxedEnvironment.value = Boolean.TRUE;
        assertEquals(Boolean.TRUE, read(BoxedEnvironment.class));
        BoxedEnvironment.value = null;
    }
}
