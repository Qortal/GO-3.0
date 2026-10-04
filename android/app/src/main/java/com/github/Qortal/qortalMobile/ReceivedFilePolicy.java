package com.github.Qortal.qortalMobile;

/**
 * Pure rules for files received in Q-Chat (a DM file a peer sent and the user
 * accepted): no Android types, so the JVM unit tests can check them.
 *
 * Received files stay inside GO. They are written to {@link #PRIVATE_DIR}
 * under the app's internal files directory, which no other app can read on
 * any Android version, and leave it only when the user taps "Save to device"
 * (one file, into Documents/Qortal Go) or opens one in another app. Builds up
 * to v0.0.14 kept them in app-specific external storage ({@link #LEGACY_DIR})
 * and copied every one into public Downloads; those files are still read
 * from there.
 *
 * The plugin methods that read, save or delete a received file take a path
 * from JS. They only act on a path inside one of these directories, so they
 * cannot be pointed at the wallet or any other app file.
 */
public final class ReceivedFilePolicy {
    private ReceivedFilePolicy() {}

    /** Directory under Context.getFilesDir() that holds received files. */
    public static final String PRIVATE_DIR = "qchat-received";
    /** Directory under getExternalFilesDir(DOWNLOADS) used by older builds. */
    public static final String LEGACY_DIR = "QortalFiles";
    /** Largest slice one read call returns (about 1.4 MB once base64). */
    public static final int MAX_READ_BYTES = 1024 * 1024;
    /** Slice size when the caller asks for none. */
    public static final int DEFAULT_READ_BYTES = 512 * 1024;

    /**
     * True when {@code path} is a file strictly inside one of {@code roots}.
     * Both must be canonical (File.getCanonicalPath): symbolic links resolved
     * and no "." or ".." segments. A path that still has such a segment is
     * refused, so a caller that forgot to canonicalise fails closed. A root
     * itself is not inside itself, and "/x/qchat-received2/a" is not inside
     * "/x/qchat-received".
     */
    public static boolean isInside(String path, String... roots) {
        if (path == null || path.isEmpty() || hasDotSegment(path)) {
            return false;
        }
        if (roots == null) {
            return false;
        }
        for (String root : roots) {
            if (root == null || root.isEmpty() || hasDotSegment(root)) {
                continue;
            }
            String prefix = root.endsWith("/") ? root : root + "/";
            if (path.length() > prefix.length() && path.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }

    /**
     * How many bytes one read call returns: {@code requested} (or
     * {@link #DEFAULT_READ_BYTES} when it is not positive), at most
     * {@link #MAX_READ_BYTES}, and never past the end of the file. Zero at or
     * past the end; -1 for a negative offset.
     */
    public static int readLength(long fileSize, long offset, int requested) {
        if (offset < 0 || fileSize < 0) {
            return -1;
        }
        if (offset >= fileSize) {
            return 0;
        }
        int want = requested > 0 ? Math.min(requested, MAX_READ_BYTES) : DEFAULT_READ_BYTES;
        long left = fileSize - offset;
        return (int) Math.min(want, left);
    }

    private static boolean hasDotSegment(String path) {
        String p = path.replace('\\', '/');
        return p.equals(".")
            || p.equals("..")
            || p.startsWith("./")
            || p.startsWith("../")
            || p.contains("/./")
            || p.contains("/../")
            || p.endsWith("/.")
            || p.endsWith("/..");
    }
}
