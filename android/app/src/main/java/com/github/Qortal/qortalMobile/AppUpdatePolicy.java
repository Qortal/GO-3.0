package com.github.Qortal.qortalMobile;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Pure rules behind {@link AppUpdatePlugin}: no Android types, so the JVM unit
 * tests can check them.
 *
 * The updater is the one place where GO hands a file to Android's package
 * installer, and the build it installs is named by whatever node GO talks to.
 * So before the installer is started the downloaded file has to prove it is a
 * newer GO, signed by the same key as the GO that is installed:
 * <ul>
 *   <li>its package name is GO's own, so a look-alike app with another
 *   package name (which Android would install next to GO) is refused;</li>
 *   <li>its signing certificate is the installed one, or a newer key the
 *   installed one rotated to (APK Signature Scheme v3 lineage);</li>
 *   <li>its versionCode is higher than the installed one.</li>
 * </ul>
 * The download itself only goes over HTTPS, or plain HTTP to a node on this
 * phone, so nobody on the network path can swap the file or read the node's
 * API key.
 */
public final class AppUpdatePolicy {
    private AppUpdatePolicy() {}

    /** What the check found; {@link #code} is what the JS side translates. */
    public enum Verdict {
        OK("OK"),
        /** Android could not read the file as an app package at all. */
        UNREADABLE("UPDATE_UNREADABLE"),
        /** A different app: its package name is not GO's. */
        WRONG_PACKAGE("UPDATE_WRONG_PACKAGE"),
        /** Not signed, or signed by a key that is not the installed GO's. */
        WRONG_SIGNER("UPDATE_WRONG_SIGNER"),
        /** The same or an older build than the one installed. */
        NOT_NEWER("UPDATE_NOT_NEWER");

        public final String code;

        Verdict(String code) {
            this.code = code;
        }
    }

    /** Download address verdict. */
    public enum UrlVerdict {
        OK("OK"),
        /** Plain HTTP to a node that is not on this phone. */
        INSECURE("UPDATE_INSECURE_URL"),
        /** Not an http(s) URL with a host. */
        INVALID("UPDATE_BAD_URL");

        public final String code;

        UrlVerdict(String code) {
            this.code = code;
        }
    }

    /** The parts of a package (installed or archive) the check compares. */
    public static final class PackageFacts {
        public final String packageName;
        public final long versionCode;
        /** SHA-256 (hex) of each certificate the package is signed with now. */
        public final Set<String> signers;
        /**
         * Certificates the package proves it rotated from (oldest first, the
         * current one last). Empty when the package has no rotation proof.
         */
        public final List<String> signerHistory;

        public PackageFacts(
            String packageName,
            long versionCode,
            List<String> signers,
            List<String> signerHistory
        ) {
            this.packageName = packageName;
            this.versionCode = versionCode;
            this.signers = normalizeDigests(signers);
            List<String> history = new ArrayList<>();
            if (signerHistory != null) {
                for (String digest : signerHistory) {
                    String normalized = normalizeDigest(digest);
                    if (!normalized.isEmpty()) history.add(normalized);
                }
            }
            this.signerHistory = Collections.unmodifiableList(history);
        }
    }

    /**
     * Whether {@code archive} may be handed to the installer as an update of
     * {@code installed}. The package name is checked first, then the signer,
     * then the version, so the reason given is the most telling one.
     */
    public static Verdict checkArchive(PackageFacts archive, PackageFacts installed) {
        if (archive == null || archive.packageName == null || archive.packageName.isEmpty()) {
            return Verdict.UNREADABLE;
        }
        if (installed == null || !archive.packageName.equals(installed.packageName)) {
            return Verdict.WRONG_PACKAGE;
        }
        if (!signedBySameKey(archive, installed)) {
            return Verdict.WRONG_SIGNER;
        }
        if (archive.versionCode <= installed.versionCode) {
            return Verdict.NOT_NEWER;
        }
        return Verdict.OK;
    }

    /**
     * Same signer set, or (single signer on both sides) the archive's rotation
     * history includes the installed signer. Android re-checks all of this when
     * it installs; refusing here keeps GO from ever starting an install Android
     * would only stop at the last step, and keeps a different signer from being
     * presented as "the update".
     */
    static boolean signedBySameKey(PackageFacts archive, PackageFacts installed) {
        if (archive.signers.isEmpty() || installed.signers.isEmpty()) {
            return false;
        }
        if (archive.signers.equals(installed.signers)) {
            return true;
        }
        if (archive.signers.size() == 1 && installed.signers.size() == 1) {
            String installedSigner = installed.signers.iterator().next();
            return archive.signerHistory.contains(installedSigner);
        }
        return false;
    }

    /**
     * HTTPS anywhere; plain HTTP only to this phone (127.0.0.0/8, ::1,
     * localhost), where there is no network path to tamper with.
     *
     * An HTTPS host java.net.URI cannot read (an underscore, another script)
     * is still accepted: TLS checks it, and HttpURLConnection connects to it.
     * Plain HTTP needs a loopback literal that java.net.URI itself read, so no
     * odd spelling ("127.1", "0x7f.0.0.1", "localhost.") counts as this phone.
     */
    public static UrlVerdict checkDownloadUrl(String url) {
        if (url == null || url.trim().isEmpty()) return UrlVerdict.INVALID;
        UrlOrigin origin = UrlOrigin.parse(url);
        if (origin == null) return UrlVerdict.INVALID;
        if ("https".equals(origin.scheme)) return UrlVerdict.OK;
        if ("http".equals(origin.scheme)) {
            return origin.strictHost && isLoopbackHost(origin.host)
                ? UrlVerdict.OK
                : UrlVerdict.INSECURE;
        }
        return UrlVerdict.INVALID;
    }

    /**
     * localhost, 127.x.x.x or ::1, given as a literal (no DNS lookup). Only
     * the plain spellings count: a trailing dot ("localhost.") makes a fully
     * qualified name the resolver may ask DNS about, and a leading zero
     * ("127.0.0.08") is read as octal, or not as an address at all, by the C
     * resolver.
     */
    public static boolean isLoopbackHost(String rawHost) {
        if (rawHost == null) return false;
        String host = rawHost.trim().toLowerCase(Locale.ROOT);
        if (host.startsWith("[") && host.endsWith("]")) {
            host = host.substring(1, host.length() - 1);
        }
        if (host.equals("localhost")) return true;
        if (host.equals("::1") || host.equals("0:0:0:0:0:0:0:1")) return true;
        String[] parts = host.split("\\.", -1);
        if (parts.length != 4) return false;
        for (int i = 0; i < 4; i++) {
            String part = parts[i];
            if (part.isEmpty() || part.length() > 3) return false;
            if (part.length() > 1 && part.charAt(0) == '0') return false;
            for (int c = 0; c < part.length(); c++) {
                char digit = part.charAt(c);
                // ASCII only: Character.isDigit also takes other scripts' digits.
                if (digit < '0' || digit > '9') return false;
            }
            int value = Integer.parseInt(part);
            if (value > 255) return false;
            if (i == 0 && value != 127) return false;
        }
        return true;
    }

    /**
     * True when {@code canonicalFile} lies inside {@code canonicalDirectory}.
     * Both must already be canonical (File.getCanonicalPath()), so "..",
     * symlinks and a sibling with a shared prefix ("updates-evil") cannot pass.
     */
    public static boolean isInsideDirectory(String canonicalFile, String canonicalDirectory) {
        if (canonicalFile == null || canonicalDirectory == null) return false;
        if (canonicalDirectory.isEmpty()) return false;
        String dir = canonicalDirectory.endsWith(File.separator)
            ? canonicalDirectory
            : canonicalDirectory + File.separator;
        return canonicalFile.length() > dir.length() && canonicalFile.startsWith(dir);
    }

    /** A file name safe to create in the update folder. */
    public static String safeFileName(String filename) {
        String name = filename == null ? "" : filename.replaceAll("[^A-Za-z0-9._-]", "_");
        // Never "." or "..", which would name the folder or its parent.
        if (name.isEmpty() || name.matches("\\.+")) return "update.apk";
        return name;
    }

    /** Lowercase hex of a byte array (a certificate digest). */
    public static String hex(byte[] bytes) {
        if (bytes == null) return "";
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            out.append(Character.forDigit((b >> 4) & 0xF, 16));
            out.append(Character.forDigit(b & 0xF, 16));
        }
        return out.toString();
    }

    private static Set<String> normalizeDigests(List<String> digests) {
        Set<String> out = new HashSet<>();
        if (digests == null) return Collections.unmodifiableSet(out);
        for (String digest : digests) {
            String normalized = normalizeDigest(digest);
            if (!normalized.isEmpty()) out.add(normalized);
        }
        return Collections.unmodifiableSet(out);
    }

    private static String normalizeDigest(String digest) {
        if (digest == null) return "";
        return digest.replace(":", "").trim().toLowerCase(Locale.ROOT);
    }
}
