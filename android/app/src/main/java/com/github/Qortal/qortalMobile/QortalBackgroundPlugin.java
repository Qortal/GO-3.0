package com.github.Qortal.qortalMobile;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import androidx.localbroadcastmanager.content.LocalBroadcastManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "QortalBackground")
public class QortalBackgroundPlugin extends Plugin {
    private static final String TAG = "QortalBackgroundPlugin";
    private BroadcastReceiver incomingCallReceiver;
    private BroadcastReceiver presenceTickReceiver;
    private BroadcastReceiver airplaneModeReceiver;
    private ConnectivityManager.NetworkCallback networkCallback;
    private boolean deviceNetworkWatchersRegistered = false;
    private Boolean lastEmittedDeviceOnline = null;
    private String pendingAlertFromAddress;
    private String pendingAlertType;
    private BackgroundKeepAlive.Listener keepAliveListener;

    @Override
    public void load() {
        super.load();

        incomingCallReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                JSObject payload = new JSObject();
                payload.put("callId", intent.getStringExtra(QortalForegroundService.EXTRA_CALL_ID));
                payload.put("action", intent.getStringExtra(QortalForegroundService.EXTRA_CALL_ACTION));
                notifyListeners("incomingCallAction", payload);
            }
        };

        IntentFilter filter = new IntentFilter(QortalForegroundService.BROADCAST_INCOMING_CALL_ACTION);
        LocalBroadcastManager.getInstance(getContext()).registerReceiver(incomingCallReceiver, filter);
        Log.d(TAG, "Incoming call broadcast receiver registered");

        // Native-driven presence tick: keeps JS presence heartbeats firing
        // while the WebView's own timers are throttled in the background.
        presenceTickReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                notifyListeners("presenceTick", new JSObject());
            }
        };
        LocalBroadcastManager.getInstance(getContext()).registerReceiver(
            presenceTickReceiver,
            new IntentFilter(QortalForegroundService.BROADCAST_PRESENCE_TICK)
        );

        registerDeviceNetworkWatchers();
        emitDeviceNetwork();

        keepAliveListener = new BackgroundKeepAlive.Listener() {
            @Override
            public void onRelayProfileChanged(String profile) {
                JSObject payload = new JSObject();
                payload.put("profile", profile);
                notifyListeners("relayProfileChanged", payload);
            }

            @Override
            public void onVendorFreezeDetected(
                int count,
                VendorFreezeLog.Entry entry,
                String manufacturer
            ) {
                notifyListeners(
                    VendorFreezeLog.EVENT_DETECTED,
                    toJSObject(VendorFreezeLog.eventFields(count, entry, manufacturer))
                );
            }
        };
        BackgroundKeepAlive.get(getContext()).setListener(keepAliveListener);

        // A page runs again: the status notification may use its text.
        QortalForegroundService.onPageLoaded();

        consumeLaunchIntent(getActivity() != null ? getActivity().getIntent() : null);
    }

    /**
     * The real "GO is on screen" edge (document.visibilityState is not one).
     * Restarts the status service and the hubs after a pause (Android's
     * time-out or GO's own 6 h battery limit).
     */
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        Context context = getContext();
        if (context != null) {
            QortalForegroundService.onAppForeground(context);
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        consumeLaunchIntent(intent);
        emitPendingAlertNotification();
    }

    private void consumeLaunchIntent(Intent intent) {
        if (intent == null) {
            return;
        }

        String fromAddress = intent.getStringExtra(QortalForegroundService.EXTRA_ALERT_FROM_ADDRESS);
        String alertType = intent.getStringExtra(QortalForegroundService.EXTRA_ALERT_TYPE);
        if (fromAddress != null && !fromAddress.trim().isEmpty()) {
            pendingAlertFromAddress = fromAddress.trim();
            pendingAlertType = alertType != null ? alertType.trim() : "";
            intent.removeExtra(QortalForegroundService.EXTRA_ALERT_FROM_ADDRESS);
            intent.removeExtra(QortalForegroundService.EXTRA_ALERT_TYPE);
        }
    }

    private void emitPendingAlertNotification() {
        if (pendingAlertFromAddress == null || pendingAlertFromAddress.isEmpty()) {
            return;
        }

        JSObject payload = new JSObject();
        payload.put("fromAddress", pendingAlertFromAddress);
        payload.put("type", pendingAlertType != null ? pendingAlertType : "");
        notifyListeners("alertNotificationAction", payload);
        pendingAlertFromAddress = null;
        pendingAlertType = null;
    }

    @Override
    protected void handleOnDestroy() {
        if (incomingCallReceiver != null) {
            LocalBroadcastManager.getInstance(getContext()).unregisterReceiver(incomingCallReceiver);
        }
        if (presenceTickReceiver != null) {
            LocalBroadcastManager.getInstance(getContext()).unregisterReceiver(presenceTickReceiver);
        }
        unregisterDeviceNetworkWatchers();
        if (keepAliveListener != null && getContext() != null) {
            BackgroundKeepAlive.get(getContext()).clearListener(keepAliveListener);
            keepAliveListener = null;
        }
        // The WebView and its chat engine go with this bridge: the status
        // notification must stop saying "online".
        QortalForegroundService.onPageGone();
        super.handleOnDestroy();
    }

    private JSObject deviceNetworkPayload() {
        JSObject payload = new JSObject();
        payload.put("online", DeviceNetwork.isAvailable(getContext()));
        return payload;
    }

    private void emitDeviceNetwork() {
        boolean online = DeviceNetwork.isAvailable(getContext());
        if (lastEmittedDeviceOnline != null && lastEmittedDeviceOnline == online) {
            return;
        }
        lastEmittedDeviceOnline = online;
        notifyListeners("deviceNetwork", deviceNetworkPayload());
    }

    private void registerDeviceNetworkWatchers() {
        if (deviceNetworkWatchersRegistered) return;
        Context context = getContext();
        if (context == null) return;

        airplaneModeReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                emitDeviceNetwork();
            }
        };
        IntentFilter airplaneFilter = new IntentFilter(Intent.ACTION_AIRPLANE_MODE_CHANGED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(airplaneModeReceiver, airplaneFilter, Context.RECEIVER_EXPORTED);
        } else {
            context.registerReceiver(airplaneModeReceiver, airplaneFilter);
        }

        ConnectivityManager cm = context.getSystemService(ConnectivityManager.class);
        if (cm != null) {
            networkCallback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    emitDeviceNetwork();
                }

                @Override
                public void onLost(Network network) {
                    emitDeviceNetwork();
                }

                @Override
                public void onCapabilitiesChanged(
                    Network network,
                    NetworkCapabilities networkCapabilities
                ) {
                    emitDeviceNetwork();
                }
            };
            try {
                cm.registerDefaultNetworkCallback(networkCallback);
            } catch (RuntimeException ignored) {
                networkCallback = null;
            }
        }
        deviceNetworkWatchersRegistered = true;
    }

    private void unregisterDeviceNetworkWatchers() {
        if (!deviceNetworkWatchersRegistered) return;
        Context context = getContext();
        if (context != null && airplaneModeReceiver != null) {
            try {
                context.unregisterReceiver(airplaneModeReceiver);
            } catch (RuntimeException ignored) {
            }
        }
        if (context != null && networkCallback != null) {
            ConnectivityManager cm = context.getSystemService(ConnectivityManager.class);
            if (cm != null) {
                try {
                    cm.unregisterNetworkCallback(networkCallback);
                } catch (RuntimeException ignored) {
                }
            }
        }
        airplaneModeReceiver = null;
        networkCallback = null;
        deviceNetworkWatchersRegistered = false;
    }

    @PluginMethod
    public void getDeviceNetwork(PluginCall call) {
        call.resolve(deviceNetworkPayload());
    }

    @PluginMethod
    public void startPersistentStatus(PluginCall call) {
        applyPersistentStatus(call, true);
    }

    /**
     * Starts or updates the status notification. Only a start marks the
     * session: a throttled update can still land after logout and must not
     * switch background keep-alive back on for a signed-out page, nor start
     * the stopped service again (which would redial the hubs).
     */
    private void applyPersistentStatus(PluginCall call, boolean markSession) {
        Context context = getContext();
        if (context == null) {
            call.reject("Context not available");
            return;
        }

        String title = call.getString("title", "GO 3.0");
        String detail = call.getString("detail", "Connected");
        String nodeLabel = call.getString("nodeLabel", "Public node");
        String syncLabel = call.getString("syncLabel", "Sync status unknown");
        String peersLabel = call.getString("peersLabel", "0 connected peers");
        String statusKind = call.getString("statusKind", "starting");
        BackgroundKeepAlive keepAlive = BackgroundKeepAlive.get(context);
        if (!KeepAlivePolicy.acceptsStatusPush(markSession, keepAlive.isSessionActive())) {
            // Signed out (logout, reload): restarting the service here would
            // also redial the hubs the logout is closing.
            JSObject skipped = new JSObject();
            skipped.put("success", true);
            skipped.put("skipped", true);
            call.resolve(skipped);
            return;
        }
        // Only a running page pushes; its text is live again.
        QortalForegroundService.onPageStatusPushed();
        // Only a signed-in page starts the status service.
        if (markSession) {
            keepAlive.setSessionActive(true);
        }
        QortalForegroundService.startOrUpdate(
            context,
            title,
            detail,
            nodeLabel,
            syncLabel,
            peersLabel,
            statusKind
        );

        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void updatePersistentStatus(PluginCall call) {
        applyPersistentStatus(call, false);
    }

    @PluginMethod
    public void stopPersistentStatus(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Context not available");
            return;
        }

        QortalForegroundService.stop(context);

        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void showAlertNotification(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Context not available");
            return;
        }

        int alertId = call.getInt("alertId", (int) (System.currentTimeMillis() % 100000));
        String title = call.getString("title", "GO 3.0");
        String body = call.getString("body", "");
        String iconUrl = call.getString("iconUrl", "");
        String fromAddress = call.getString("fromAddress", "");
        String notificationType = call.getString("notificationType", "");
        String alertTag = call.getString("alertTag", "");
        QortalForegroundService.showAlert(
            context,
            alertId,
            title,
            body,
            iconUrl,
            fromAddress,
            notificationType,
            alertTag
        );

        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void showTransferNotification(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Context not available");
            return;
        }

        String transferId = call.getString("transferId", "");
        if (transferId == null || transferId.trim().isEmpty()) {
            call.reject("Missing transferId");
            return;
        }

        String title = call.getString("title", "File transfer");
        String text = call.getString("text", "");
        int progress = call.getInt("progress", -2);
        boolean ongoing = Boolean.TRUE.equals(call.getBoolean("ongoing", false));
        QortalForegroundService.updateTransfer(
            context,
            transferId.trim(),
            title,
            text,
            progress,
            ongoing,
            call.getString("openUri"),
            call.getString("openMimeType"),
            Boolean.TRUE.equals(call.getBoolean("alert", false)),
            call.getString("actionLabel")
        );

        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void dismissTransferNotification(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Context not available");
            return;
        }

        String transferId = call.getString("transferId", "");
        if (transferId == null || transferId.trim().isEmpty()) {
            call.reject("Missing transferId");
            return;
        }

        QortalForegroundService.dismissTransfer(context, transferId.trim());

        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void getPendingAlertNotification(PluginCall call) {
        JSObject ret = new JSObject();
        if (pendingAlertFromAddress != null && !pendingAlertFromAddress.isEmpty()) {
            ret.put("fromAddress", pendingAlertFromAddress);
            ret.put("type", pendingAlertType != null ? pendingAlertType : "");
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void clearPendingAlertNotification(PluginCall call) {
        pendingAlertFromAddress = null;
        pendingAlertType = null;
        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void showIncomingCallNotification(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Context not available");
            return;
        }

        String callId = call.getString("callId", "");
        String fromAddress = call.getString("fromAddress", "");
        String fromName = call.getString("fromName", "Unknown caller");
        QortalForegroundService.showIncomingCall(context, callId, fromAddress, fromName);

        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void dismissIncomingCallNotification(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Context not available");
            return;
        }

        QortalForegroundService.dismissIncomingCall(context);

        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void dismissChatAlertNotifications(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Context not available");
            return;
        }

        QortalForegroundService.dismissChatAlerts(context);

        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    /**
     * Cancel one Group/DM alert by (tag, hashed id). Cancels directly on the
     * NotificationManager: a startService() from the background throws on
     * API 26+ and a foreground start is not warranted for a cancel.
     */
    @PluginMethod
    public void dismissChatAlertNotification(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Context not available");
            return;
        }

        Integer alertId = call.getInt("alertId");
        if (alertId == null) {
            call.reject("alertId is required");
            return;
        }
        String alertTag = call.getString("alertTag");
        if (alertTag != null && alertTag.isEmpty()) {
            alertTag = null;
        }

        try {
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.cancel(alertTag, QortalForegroundService.alertNotificationId(alertId));
            }
        } catch (Exception error) {
            Log.w(TAG, "Failed to cancel chat alert notification", error);
        }

        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    /** Background sync mode: off | charging (default) | always. Persisted natively. */
    @PluginMethod
    public void setBackgroundSyncMode(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Context not available");
            return;
        }
        String mode = KeepAlivePolicy.parseMode(call.getString("mode"));
        JSObject ret = new JSObject();
        if (mode == null) {
            // Unknown value: keep the current mode.
            ret.put("ok", false);
            call.resolve(ret);
            return;
        }
        BackgroundKeepAlive.get(context).setMode(mode);
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void getBackgroundSyncState(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Context not available");
            return;
        }
        BackgroundKeepAlive.State state = BackgroundKeepAlive.get(context).getState();
        JSObject ret = new JSObject();
        ret.put("mode", state.mode);
        ret.put("charging", state.charging);
        ret.put("unmetered", state.unmetered);
        ret.put("relayProfile", state.relayProfile);
        ret.put("keepAliveActive", state.keepAliveActive);
        ret.put("vendorFreezeCount", state.vendorFreezeCount);
        if (state.vendorFreezeLastAt != null) {
            ret.put("vendorFreezeLastAt", state.vendorFreezeLastAt.longValue());
        } else {
            ret.put("vendorFreezeLastAt", org.json.JSONObject.NULL);
        }
        ret.put("vendorFreezeHintPending", state.vendorFreezeHintPending);
        ret.put("manufacturer", state.manufacturer);
        JSArray recent = new JSArray();
        for (VendorFreezeLog.Entry entry : state.vendorFreezeRecent) {
            recent.put(toJSObject(VendorFreezeLog.fields(entry)));
        }
        ret.put(VendorFreezeLog.STATE_RECENT, recent);
        ret.put(
            VendorFreezeLog.STATE_IGNORING,
            state.ignoringBatteryOptimizations != null
                ? (Object) state.ignoringBatteryOptimizations
                : org.json.JSONObject.NULL
        );
        putDeviceFacts(ret, context);
        call.resolve(ret);
    }

    /**
     * Device facts for Copy diagnostics: one sticky battery read (no
     * receiver is registered) and two PowerManager getters. Read only, no
     * listeners, no new state; a key a phone cannot give is left out.
     */
    private static void putDeviceFacts(JSObject ret, Context context) {
        try {
            Intent battery = context.registerReceiver(
                null,
                new IntentFilter(Intent.ACTION_BATTERY_CHANGED)
            );
            if (battery != null) {
                ret.put(
                    "plugType",
                    KeepAlivePolicy.plugTypeName(
                        battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1)
                    )
                );
                int tenths = battery.getIntExtra(
                    BatteryManager.EXTRA_TEMPERATURE,
                    Integer.MIN_VALUE
                );
                ret.put(
                    "batteryTempC",
                    tenths == Integer.MIN_VALUE
                        ? org.json.JSONObject.NULL
                        : (Object) (tenths / 10.0)
                );
                int pct = KeepAlivePolicy.batteryPercent(
                    battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1),
                    battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
                );
                ret.put("batteryPct", pct < 0 ? org.json.JSONObject.NULL : (Object) pct);
            }
        } catch (RuntimeException ignored) {
            // Diagnostics only.
        }
        try {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                ret.put("powerSave", pm.isPowerSaveMode());
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ret.put("thermalStatus", pm.getCurrentThermalStatus());
                }
            }
        } catch (RuntimeException ignored) {
            // Diagnostics only.
        }
    }

    /** True while own messages still wait to leave the phone (engine's ownOutboxState). */
    @PluginMethod
    public void setOutboxPending(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Context not available");
            return;
        }
        BackgroundKeepAlive.get(context)
            .setOutboxPending(Boolean.TRUE.equals(call.getBoolean("pending", false)));
        // Optional: the number waiting, for the status notification.
        Integer count = call.getInt("count");
        if (count != null) {
            QortalForegroundService.setOutboxCount(count);
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    /** Own messages waiting to send (ownOutboxState.pendingCount), shown while GO is off screen. */
    @PluginMethod
    public void setOutboxCount(PluginCall call) {
        Integer count = call.getInt("count");
        JSObject ret = new JSObject();
        if (count == null) {
            ret.put("ok", false);
            call.resolve(ret);
            return;
        }
        QortalForegroundService.setOutboxCount(count);
        ret.put("ok", true);
        call.resolve(ret);
    }

    /**
     * Translations for texts native code draws itself (paused / waiting /
     * syncing status, the time-out notice). Keys: StatusHonesty.LOCALIZED_KEYS;
     * values may contain {{count}}. Persisted; unknown keys are ignored.
     */
    @PluginMethod
    public void setLocalizedStrings(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Context not available");
            return;
        }
        JSObject strings = call.getObject("strings");
        JSObject ret = new JSObject();
        if (strings == null) {
            ret.put("ok", false);
            call.resolve(ret);
            return;
        }
        java.util.Map<String, String> values = new java.util.HashMap<>();
        java.util.Iterator<String> keys = strings.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            Object value = strings.opt(key);
            if (value instanceof String) {
                values.put(key, (String) value);
            }
        }
        QortalForegroundService.setLocalizedStrings(context, values);
        ret.put("ok", true);
        call.resolve(ret);
    }

    /**
     * Kept for older pages. The flag it clears is no longer set: the page
     * owns the freeze notice policy (see recordVendorFreeze).
     */
    @PluginMethod
    public void acknowledgeVendorFreezeHint(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Context not available");
            return;
        }
        BackgroundKeepAlive.get(context).acknowledgeVendorFreezeHint();
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    /** { ignoring: boolean }; rejects when the system cannot say. */
    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Context not available");
            return;
        }

        Boolean ignoring = BackgroundKeepAlive.get(context).readIgnoringBatteryOptimizations();
        if (ignoring == null) {
            call.reject("Battery optimisation state not available");
            return;
        }

        JSObject ret = new JSObject();
        ret.put("ignoring", ignoring.booleanValue());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Context not available");
            return;
        }

        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + context.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception error) {
            call.reject("Unable to open battery optimization settings", error);
        }
    }

    @PluginMethod
    public void openAppBatterySettings(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Context not available");
            return;
        }

        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + context.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception error) {
            call.reject("Unable to open app settings", error);
        }
    }

    /**
     * "Open battery settings" for the vendor freeze notice: the phone maker's
     * own Battery page where GO knows one (vivo / iQOO, see
     * KeepAlivePolicy.vendorBatteryIntentSpec), else GO's App info page.
     * Resolves { opened: 'vendor' | 'app_details' | null }; never rejects.
     */
    @PluginMethod
    public void openVendorBatterySettings(PluginCall call) {
        Context context = getContext();
        String opened = null;
        if (context != null) {
            KeepAlivePolicy.VendorBatteryIntentSpec spec =
                KeepAlivePolicy.vendorBatteryIntentSpec(Build.MANUFACTURER);
            if (spec != null) {
                Intent vendor = new Intent(spec.action);
                vendor.setPackage(spec.packageName);
                if (startSettingsActivity(context, vendor)) opened = VendorFreezeLog.OPENED_VENDOR;
            }
            if (opened == null) {
                Intent appDetails = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                appDetails.setData(Uri.parse("package:" + context.getPackageName()));
                if (startSettingsActivity(context, appDetails)) {
                    opened = VendorFreezeLog.OPENED_APP_DETAILS;
                }
            }
        }
        JSObject ret = new JSObject();
        ret.put(VendorFreezeLog.RESULT_OPENED, opened != null ? opened : org.json.JSONObject.NULL);
        call.resolve(ret);
    }

    private static JSObject toJSObject(java.util.Map<String, Object> fields) {
        JSObject out = new JSObject();
        for (java.util.Map.Entry<String, Object> field : fields.entrySet()) {
            out.put(field.getKey(), field.getValue());
        }
        return out;
    }

    /**
     * Starts a settings screen from GO's Activity when there is one (Back
     * returns to GO), else as a new task. False when the page is missing or
     * protected on this phone.
     */
    private boolean startSettingsActivity(Context context, Intent intent) {
        Activity activity = getActivity();
        try {
            if (activity != null) {
                activity.startActivity(intent);
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
            }
            return true;
        } catch (ActivityNotFoundException | SecurityException error) {
            Log.w(TAG, "Settings page not available: " + intent.getAction(), error);
            return false;
        } catch (RuntimeException error) {
            Log.w(TAG, "Settings page failed to open: " + intent.getAction(), error);
            return false;
        }
    }
}
