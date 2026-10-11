package com.github.Qortal.qortalMobile;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * A private Q-App's files, unpacked in memory for {@link PrivateQappStore}.
 * No Android types, so the JVM unit tests can check it.
 *
 * <p>A private Q-App is a zip that a group admin encrypted with the group's
 * key and published on QDN; GO's page downloads and decrypts it. Hub has the
 * node build the zip into a preview (POST /arbitrary/APP/&lt;name&gt;/zip?preview=true),
 * but Core allows that only with the node's API key, which a public node never
 * gives out, and it hands the decrypted app to whoever runs the node. GO
 * unpacks the zip here instead. Nothing is written to disk.
 *
 * <p>The files are the ones Core would serve for the same zip
 * (ArbitraryResource.upload with zipped=true, ZipUtils.unzip):
 * <ul>
 *   <li>when the zip holds one top-level entry, not counting names that start
 *   with "_" (macOS adds __MACOSX), that entry is the app: a folder's contents,
 *   or a single file;</li>
 *   <li>an entry whose path leaves the zip ("..") fails the whole zip, as in
 *   Core. A leading "/" or "./" is dropped, and "\" counts as "/";</li>
 *   <li>Core's own ".qortal" metadata folder is left out.</li>
 * </ul>
 */
public final class PrivateQappArchive {
    /** A private app's zip is at most 50 MB; text packs well, so allow more unpacked. */
    static final long MAX_UNPACKED_BYTES = 200L * 1024 * 1024;
    static final int MAX_ENTRIES = 20_000;

    private static final String QORTAL_METADATA = ".qortal";

    /** Why a zip cannot become an app. The message is for the log only. */
    public static final class InvalidArchiveException extends Exception {
        InvalidArchiveException(String message) {
            super(message);
        }
    }

    /** "dir/file.ext" to bytes. */
    private final Map<String, byte[]> files;
    /** "dir", "dir/sub"; the root itself is not listed. */
    private final Set<String> directories;
    /** Names directly in the root (files and folders), sorted. */
    private final List<String> rootNames;
    private final long size;

    private PrivateQappArchive(Map<String, byte[]> files, Set<String> directories) {
        this.files = files;
        this.directories = directories;
        Set<String> names = new TreeSet<>();
        long total = 0;
        for (Map.Entry<String, byte[]> file : files.entrySet()) {
            names.add(firstSegment(file.getKey()));
            total += file.getValue().length;
        }
        for (String dir : directories) {
            names.add(firstSegment(dir));
        }
        this.rootNames = Collections.unmodifiableList(new ArrayList<>(names));
        this.size = total;
    }

    public static PrivateQappArchive unzip(byte[] zip) throws IOException, InvalidArchiveException {
        return unzip(new ByteArrayInputStream(zip), MAX_UNPACKED_BYTES, MAX_ENTRIES);
    }

    static PrivateQappArchive unzip(InputStream zip, long maxBytes, int maxEntries)
        throws IOException, InvalidArchiveException {
        Map<String, byte[]> files = new HashMap<>();
        Set<String> directories = new HashSet<>();
        long total = 0;
        int entries = 0;
        byte[] buffer = new byte[64 * 1024];
        try (ZipInputStream in = new ZipInputStream(zip)) {
            ZipEntry entry;
            while ((entry = in.getNextEntry()) != null) {
                if (++entries > maxEntries) {
                    throw new InvalidArchiveException("too many entries");
                }
                String path = entryPath(entry.getName());
                if (path.isEmpty()) {
                    continue;
                }
                if (entry.isDirectory()) {
                    addWithParents(directories, path);
                    continue;
                }
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                int n;
                while ((n = in.read(buffer)) > 0) {
                    total += n;
                    if (total > maxBytes) {
                        throw new InvalidArchiveException("too large");
                    }
                    out.write(buffer, 0, n);
                }
                files.put(path, out.toByteArray());
                addWithParents(directories, parentOf(path));
            }
        }
        // A later file with a folder's name replaces the folder, as on disk.
        directories.removeAll(files.keySet());
        return fromUnpacked(files, directories);
    }

    /** Core's choice of what the app is, then its metadata folder left out. */
    static PrivateQappArchive fromUnpacked(Map<String, byte[]> files, Set<String> directories)
        throws InvalidArchiveException {
        Set<String> top = new TreeSet<>();
        for (String path : files.keySet()) {
            top.add(firstSegment(path));
        }
        for (String dir : directories) {
            top.add(firstSegment(dir));
        }
        List<String> visible = new ArrayList<>();
        for (String name : top) {
            if (!name.startsWith("_")) {
                visible.add(name);
            }
        }
        Map<String, byte[]> rootFiles = files;
        Set<String> rootDirs = directories;
        if (visible.size() == 1) {
            String only = visible.get(0);
            rootFiles = new HashMap<>();
            rootDirs = new HashSet<>();
            if (files.containsKey(only)) {
                rootFiles.put(only, files.get(only));
            } else {
                String prefix = only + "/";
                for (Map.Entry<String, byte[]> file : files.entrySet()) {
                    if (file.getKey().startsWith(prefix)) {
                        rootFiles.put(file.getKey().substring(prefix.length()), file.getValue());
                    }
                }
                for (String dir : directories) {
                    if (dir.startsWith(prefix)) {
                        rootDirs.add(dir.substring(prefix.length()));
                    }
                }
            }
        }
        Map<String, byte[]> keptFiles = new HashMap<>();
        for (Map.Entry<String, byte[]> file : rootFiles.entrySet()) {
            if (!isMetadata(file.getKey())) {
                keptFiles.put(file.getKey(), file.getValue());
            }
        }
        Set<String> keptDirs = new HashSet<>();
        for (String dir : rootDirs) {
            if (!dir.isEmpty() && !isMetadata(dir)) {
                keptDirs.add(dir);
            }
        }
        if (keptFiles.isEmpty()) {
            throw new InvalidArchiveException("no files");
        }
        return new PrivateQappArchive(keptFiles, keptDirs);
    }

    /**
     * The entry's path inside the zip: "/" separators, no empty or "." parts.
     * Throws for a ".." part: Core refuses a zip with an entry outside it.
     */
    static String entryPath(String name) throws InvalidArchiveException {
        if (name == null) {
            return "";
        }
        StringBuilder out = new StringBuilder();
        for (String part : name.replace('\\', '/').split("/")) {
            if (part.isEmpty() || ".".equals(part)) {
                continue;
            }
            if ("..".equals(part) || part.indexOf('\0') >= 0) {
                throw new InvalidArchiveException("entry outside the zip");
            }
            if (out.length() > 0) {
                out.append('/');
            }
            out.append(part);
        }
        return out.toString();
    }

    private static boolean isMetadata(String path) {
        return QORTAL_METADATA.equals(path) || path.startsWith(QORTAL_METADATA + "/");
    }

    private static String firstSegment(String path) {
        int slash = path.indexOf('/');
        return slash < 0 ? path : path.substring(0, slash);
    }

    private static String parentOf(String path) {
        int slash = path.lastIndexOf('/');
        return slash < 0 ? "" : path.substring(0, slash);
    }

    private static void addWithParents(Set<String> directories, String dir) {
        String current = dir;
        while (!current.isEmpty() && directories.add(current)) {
            current = parentOf(current);
        }
    }

    /** The file at {@code path} ("dir/file.ext"), or null. */
    public byte[] file(String path) {
        return files.get(path);
    }

    /** True for the root ("") and every folder in the app. */
    public boolean isDirectory(String path) {
        return path.isEmpty() || directories.contains(path);
    }

    /** Names directly in the root, files and folders, sorted. */
    public List<String> rootNames() {
        return rootNames;
    }

    /** Unpacked bytes, for the store's memory limit. */
    public long size() {
        return size;
    }

    public int fileCount() {
        return files.size();
    }
}
