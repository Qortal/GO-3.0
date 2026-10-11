package com.github.Qortal.qortalMobile;

import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Lets GO's page hand a decrypted private Q-App zip to {@link PrivateQappStore},
 * which serves it to the app's frame from memory (see there for why).
 *
 * <p>The zip comes as base64 in pieces (begin, append..., finish) so no single
 * bridge message holds a whole app: a private app may be 50 MB. finish unpacks
 * it on a thread of its own, not the plugins' shared one.
 */
@CapacitorPlugin(name = "PrivateQappHost")
public class PrivateQappPlugin extends Plugin {
    private static final String TAG = "PrivateQappHost";
    /** A private app's zip is at most 50 MB (Hub's upload limit), plus some room. */
    static final long MAX_ZIP_BYTES = 64L * 1024 * 1024;
    /** An upload the page left unfinished (a reload) is dropped after this. */
    private static final long STALE_UPLOAD_MS = 5 * 60_000;

    private static final class Upload {
        final String nodeUrl;
        final ByteArrayOutputStream zip = new ByteArrayOutputStream();
        final long startedAt = System.currentTimeMillis();

        Upload(String nodeUrl) {
            this.nodeUrl = nodeUrl;
        }
    }

    private final Map<String, Upload> uploads = new HashMap<>();
    private final ExecutorService unpacker = Executors.newSingleThreadExecutor();
    private int nextUpload = 1;

    @Override
    protected void handleOnDestroy() {
        unpacker.shutdown();
    }

    @PluginMethod
    public void begin(PluginCall call) {
        String nodeUrl = call.getString("nodeUrl");
        if (nodeUrl == null || nodeUrl.isEmpty()) {
            call.reject("no node address");
            return;
        }
        String id;
        synchronized (uploads) {
            dropStaleUploads();
            id = Integer.toString(nextUpload++);
            uploads.put(id, new Upload(nodeUrl));
        }
        JSObject result = new JSObject();
        result.put("upload", id);
        call.resolve(result);
    }

    @PluginMethod
    public void append(PluginCall call) {
        String id = call.getString("upload");
        String chunk = call.getString("chunk");
        Upload upload;
        synchronized (uploads) {
            upload = id == null ? null : uploads.get(id);
        }
        if (upload == null || chunk == null) {
            call.reject("no such upload");
            return;
        }
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(chunk);
        } catch (IllegalArgumentException e) {
            forget(id);
            call.reject("not base64");
            return;
        }
        synchronized (upload) {
            if (upload.zip.size() + (long) bytes.length > MAX_ZIP_BYTES) {
                forget(id);
                call.reject("too large");
                return;
            }
            upload.zip.write(bytes, 0, bytes.length);
        }
        call.resolve();
    }

    @PluginMethod
    public void finish(PluginCall call) {
        String id = call.getString("upload");
        Upload upload = forget(id);
        if (upload == null) {
            call.reject("no such upload");
            return;
        }
        unpacker.execute(() -> {
            try {
                byte[] zip;
                synchronized (upload) {
                    zip = upload.zip.toByteArray();
                }
                PrivateQappArchive archive = PrivateQappArchive.unzip(zip);
                String appId = PrivateQappStore.shared().add(upload.nodeUrl, archive, System.currentTimeMillis());
                JSObject result = new JSObject();
                result.put("id", appId);
                result.put("files", archive.fileCount());
                call.resolve(result);
            } catch (PrivateQappArchive.InvalidArchiveException e) {
                Log.w(TAG, "Private Q-App not opened: " + e.getMessage());
                call.reject("invalid app: " + e.getMessage());
            } catch (OutOfMemoryError e) {
                Log.w(TAG, "Private Q-App too large for memory");
                call.reject("too large");
            } catch (Exception e) {
                Log.w(TAG, "Private Q-App not opened", e);
                call.reject("invalid app");
            }
        });
    }

    @PluginMethod
    public void has(PluginCall call) {
        JSObject result = new JSObject();
        result.put("kept", PrivateQappStore.shared().has(call.getString("id")));
        call.resolve(result);
    }

    @PluginMethod
    public void release(PluginCall call) {
        PrivateQappStore.shared().release(call.getString("id"));
        call.resolve();
    }

    /** Releases every app whose id is not listed (tabs closed), except ones just added. */
    @PluginMethod
    public void retain(PluginCall call) {
        JSArray ids = call.getArray("ids");
        List<String> keep = new ArrayList<>();
        if (ids != null) {
            for (int i = 0; i < ids.length(); i++) {
                String id = ids.optString(i, null);
                if (id != null) {
                    keep.add(id);
                }
            }
        }
        PrivateQappStore.shared().retainOnly(keep, System.currentTimeMillis());
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        synchronized (uploads) {
            uploads.clear();
        }
        PrivateQappStore.shared().clear();
        call.resolve();
    }

    private Upload forget(String id) {
        synchronized (uploads) {
            return id == null ? null : uploads.remove(id);
        }
    }

    private void dropStaleUploads() {
        long now = System.currentTimeMillis();
        Iterator<Map.Entry<String, Upload>> it = uploads.entrySet().iterator();
        while (it.hasNext()) {
            if (now - it.next().getValue().startedAt > STALE_UPLOAD_MS) {
                it.remove();
            }
        }
    }
}
