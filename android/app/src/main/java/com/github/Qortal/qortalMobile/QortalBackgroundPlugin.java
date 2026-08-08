package com.github.Qortal.qortalMobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import androidx.localbroadcastmanager.content.LocalBroadcastManager;

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
    private String pendingAlertFromAddress;
    private String pendingAlertType;

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

        consumeLaunchIntent(getActivity() != null ? getActivity().getIntent() : null);
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
        super.handleOnDestroy();
    }

    @PluginMethod
    public void startPersistentStatus(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Context not available");
            return;
        }

        String title = call.getString("title", "Qortal GO 2.0");
        String detail = call.getString("detail", "Connected");
        String nodeLabel = call.getString("nodeLabel", "Public node");
        String syncLabel = call.getString("syncLabel", "Sync status unknown");
        String peersLabel = call.getString("peersLabel", "0 connected peers");
        QortalForegroundService.startOrUpdate(
            context,
            title,
            detail,
            nodeLabel,
            syncLabel,
            peersLabel
        );

        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void updatePersistentStatus(PluginCall call) {
        startPersistentStatus(call);
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
        String title = call.getString("title", "Qortal GO 2.0");
        String body = call.getString("body", "");
        String iconUrl = call.getString("iconUrl", "");
        String fromAddress = call.getString("fromAddress", "");
        String notificationType = call.getString("notificationType", "");
        QortalForegroundService.showAlert(
            context,
            alertId,
            title,
            body,
            iconUrl,
            fromAddress,
            notificationType
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
            ongoing
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

    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Context not available");
            return;
        }

        PowerManager powerManager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        boolean ignoring = powerManager != null &&
            powerManager.isIgnoringBatteryOptimizations(context.getPackageName());

        JSObject ret = new JSObject();
        ret.put("ignoring", ignoring);
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
}
