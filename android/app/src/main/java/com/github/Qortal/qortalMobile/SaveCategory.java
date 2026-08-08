package com.github.Qortal.qortalMobile;

import android.text.TextUtils;

import java.util.Locale;

/**
 * Sorts saved files into per-type folders under Documents/Qortal Go:
 * Images, Videos, Audio, Documents, Apps (.apk) and "GO state" (.bin).
 *
 * Single source of truth for both the WebView download listener and the
 * FileWriter plugin, so a file lands in the same place however it was saved.
 */
public final class SaveCategory {

    public static final String BASE_FOLDER = "Qortal Go";

    public static final String IMAGES = "Images";
    public static final String VIDEOS = "Videos";
    public static final String AUDIO = "Audio";
    public static final String DOCUMENTS = "Documents";
    public static final String APPS = "Apps";
    public static final String GO_STATE = "GO state";
    /** Qortino AI model packs / knowledge. */
    public static final String QORTINO = "Qortino AI";

    private SaveCategory() {}

    /** Lowercase extension without the dot ("" when there is none). */
    public static String extensionOf(String displayName) {
        if (TextUtils.isEmpty(displayName)) return "";
        String name = displayName;
        int slash = name.lastIndexOf('/');
        if (slash >= 0) name = name.substring(slash + 1);
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) return "";
        return name.substring(dot + 1).toLowerCase(Locale.US);
    }

    /** Folder name for a file, e.g. "Images". */
    public static String categorize(String displayName, String mimeType) {
        String ext = extensionOf(displayName);
        String mime = mimeType == null ? "" : mimeType.toLowerCase(Locale.US);

        if (ext.equals("apk") || ext.equals("aab") || ext.equals("apks")
            || mime.contains("android.package-archive")) {
            return APPS;
        }
        if (ext.equals("bin")) {
            return GO_STATE;
        }
        if (ext.equals("gguf")) {
            return QORTINO;
        }

        if (mime.startsWith("image/")) return IMAGES;
        if (mime.startsWith("video/")) return VIDEOS;
        if (mime.startsWith("audio/")) return AUDIO;

        switch (ext) {
            case "jpg":
            case "jpeg":
            case "png":
            case "gif":
            case "webp":
            case "bmp":
            case "heic":
            case "heif":
            case "svg":
            case "avif":
            case "tif":
            case "tiff":
                return IMAGES;
            case "mp4":
            case "mov":
            case "webm":
            case "mkv":
            case "avi":
            case "m4v":
            case "3gp":
            case "mpg":
            case "mpeg":
            case "ts":
                return VIDEOS;
            case "mp3":
            case "m4a":
            case "wav":
            case "ogg":
            case "oga":
            case "opus":
            case "flac":
            case "aac":
            case "wma":
            case "mid":
            case "midi":
                return AUDIO;
            default:
                return DOCUMENTS;
        }
    }

    /**
     * Full relative folder for a save, e.g. "Qortal Go/Images". Keeps any
     * category the caller already appended (e.g. "Qortal Go/Qortino AI").
     */
    public static String folderFor(String baseFolder, String displayName, String mimeType) {
        String base = TextUtils.isEmpty(baseFolder) ? BASE_FOLDER : baseFolder;
        return base + "/" + categorize(displayName, mimeType);
    }
}
