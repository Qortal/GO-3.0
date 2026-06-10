package com.github.Qortal.qortalMobile;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.widget.RemoteViews;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class QortalForegroundService extends Service {
    private static final String TAG = "QortalForegroundService";

    public static final String CHANNEL_STATUS_ID = "qortal_status";
    public static final String CHANNEL_ALERTS_ID = "qortal_alerts";
    public static final String CHANNEL_CALLS_ID = "qortal_calls";

    private static final String CHANNEL_STATUS_NAME = "Qortal status";
    private static final String CHANNEL_ALERTS_NAME = "Qortal alerts";
    private static final String CHANNEL_CALLS_NAME = "Incoming calls";

    public static final int NOTIFICATION_ID_STATUS = 2001;
    public static final int NOTIFICATION_ID_INCOMING_CALL = 2002;
    private static final int NOTIFICATION_ID_ALERT_BASE = 3000;

    public static final String ACTION_START = "com.github.Qortal.qortalMobile.QORTAL_FGS_START";
    public static final String ACTION_UPDATE = "com.github.Qortal.qortalMobile.QORTAL_FGS_UPDATE";
    public static final String ACTION_STOP = "com.github.Qortal.qortalMobile.QORTAL_FGS_STOP";
    public static final String ACTION_SHOW_ALERT = "com.github.Qortal.qortalMobile.QORTAL_FGS_SHOW_ALERT";
    public static final String ACTION_SHOW_INCOMING_CALL =
        "com.github.Qortal.qortalMobile.QORTAL_FGS_SHOW_INCOMING_CALL";
    public static final String ACTION_DISMISS_INCOMING_CALL =
        "com.github.Qortal.qortalMobile.QORTAL_FGS_DISMISS_INCOMING_CALL";

    public static final String ACTION_INCOMING_CALL_ACCEPT =
        "com.github.Qortal.qortalMobile.QORTAL_INCOMING_CALL_ACCEPT";
    public static final String ACTION_INCOMING_CALL_DECLINE =
        "com.github.Qortal.qortalMobile.QORTAL_INCOMING_CALL_DECLINE";

    public static final String BROADCAST_INCOMING_CALL_ACTION =
        "com.github.Qortal.qortalMobile.BROADCAST_INCOMING_CALL_ACTION";

    public static final String EXTRA_STATUS_TITLE = "status_title";
    public static final String EXTRA_STATUS_DETAIL = "status_detail";
    public static final String EXTRA_STATUS_NODE = "status_node";
    public static final String EXTRA_STATUS_SYNC = "status_sync";
    public static final String EXTRA_STATUS_PEERS = "status_peers";
    public static final String EXTRA_ALERT_ID = "alert_id";
    public static final String EXTRA_ALERT_TITLE = "alert_title";
    public static final String EXTRA_ALERT_BODY = "alert_body";
    public static final String EXTRA_ALERT_ICON_URL = "alert_icon_url";
    public static final String EXTRA_ALERT_ICON_BASE64 = "alert_icon_base64";
    public static final String EXTRA_ALERT_FROM_ADDRESS = "alert_from_address";
    public static final String EXTRA_ALERT_TYPE = "alert_type";
    public static final String EXTRA_CALL_ID = "call_id";
    public static final String EXTRA_CALL_FROM = "call_from";
    public static final String EXTRA_CALL_FROM_NAME = "call_from_name";
    public static final String EXTRA_CALL_ACTION = "call_action";

    private static final String GROUP_STATUS = "qortal_connection_status";
    private static final String GROUP_ALERTS = "qortal_message_alerts";
    private String statusTitle = "Qortal GO 2.0";
    private String statusDetail = "Connecting…";
    private String statusNodeLabel = "Public node";
    private String statusSyncLabel = "Sync status unknown";
    private String statusPeersLabel = "0 connected peers";
    private boolean isRunning = false;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannels();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) {
            if (!isRunning) {
                startStatusForeground();
            }
            return START_STICKY;
        }

        switch (intent.getAction()) {
            case ACTION_START:
            case ACTION_UPDATE:
                statusTitle = safeString(intent.getStringExtra(EXTRA_STATUS_TITLE), statusTitle);
                statusDetail = safeString(intent.getStringExtra(EXTRA_STATUS_DETAIL), statusDetail);
                statusNodeLabel = safeString(intent.getStringExtra(EXTRA_STATUS_NODE), statusNodeLabel);
                statusSyncLabel = safeString(intent.getStringExtra(EXTRA_STATUS_SYNC), statusSyncLabel);
                statusPeersLabel = safeString(intent.getStringExtra(EXTRA_STATUS_PEERS), statusPeersLabel);
                if (!isRunning) {
                    startStatusForeground();
                } else {
                    updateStatusNotification();
                }
                break;
            case ACTION_STOP:
                stopForeground(true);
                stopSelf();
                isRunning = false;
                break;
            case ACTION_SHOW_ALERT:
                showAlertNotification(
                    intent.getIntExtra(EXTRA_ALERT_ID, (int) (System.currentTimeMillis() % 100000)),
                    safeString(intent.getStringExtra(EXTRA_ALERT_TITLE), "Qortal GO 2.0"),
                    safeString(intent.getStringExtra(EXTRA_ALERT_BODY), ""),
                    safeString(intent.getStringExtra(EXTRA_ALERT_ICON_URL), ""),
                    safeString(intent.getStringExtra(EXTRA_ALERT_FROM_ADDRESS), ""),
                    safeString(intent.getStringExtra(EXTRA_ALERT_TYPE), "")
                );
                if (!isRunning) {
                    startStatusForeground();
                }
                break;
            case ACTION_SHOW_INCOMING_CALL:
                showIncomingCallNotification(
                    safeString(intent.getStringExtra(EXTRA_CALL_ID), ""),
                    safeString(intent.getStringExtra(EXTRA_CALL_FROM), ""),
                    safeString(intent.getStringExtra(EXTRA_CALL_FROM_NAME), "Unknown caller")
                );
                if (!isRunning) {
                    startStatusForeground();
                }
                break;
            case ACTION_DISMISS_INCOMING_CALL:
                dismissIncomingCallNotification();
                break;
            case ACTION_INCOMING_CALL_ACCEPT:
            case ACTION_INCOMING_CALL_DECLINE:
                handleIncomingCallAction(intent);
                break;
            default:
                break;
        }

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        isRunning = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void startStatusForeground() {
        Notification notification = buildStatusNotification();
        startForeground(NOTIFICATION_ID_STATUS, notification);
        isRunning = true;
        Log.d(TAG, "Status foreground service started");
    }

    private void updateStatusNotification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID_STATUS, buildStatusNotification());
        }
    }

    private NotificationCompat.Builder baseNotificationBuilder(String channelId) {
        int brandColor = getResources().getColor(R.color.qortal_brand, getTheme());
        return new NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.drawable.ic_stat_qortal)
            .setColor(brandColor);
    }

    /** Blue Q in the status bar; the shade uses the transparent large icon. */
    private NotificationCompat.Builder statusNotificationBuilder() {
        int brandColor = getResources().getColor(R.color.qortal_brand, getTheme());
        return new NotificationCompat.Builder(this, CHANNEL_STATUS_ID)
            .setSmallIcon(R.drawable.ic_stat_qortal)
            .setColor(brandColor);
    }

    private String buildStatusExpandedText() {
        return statusDetail
            + "\n\nNode: "
            + statusNodeLabel
            + "\nSync: "
            + statusSyncLabel
            + "\nPeers: "
            + statusPeersLabel;
    }

    private static Boolean isMiuiCached;

    /**
     * MIUI injects the app icon at the left of every notification card, so
     * drawing our own logo there duplicates it. Other skins (AOSP/Pixel,
     * One UI, ...) leave the custom content alone, where we want the big
     * Qortal logo on the left ourselves.
     */
    private static boolean isMiuiDevice() {
        if (isMiuiCached != null) return isMiuiCached;
        try {
            @SuppressWarnings("PrivateApi")
            Class<?> systemProperties = Class.forName("android.os.SystemProperties");
            String version = (String) systemProperties
                .getMethod("get", String.class)
                .invoke(null, "ro.miui.ui.version.name");
            isMiuiCached = version != null && !version.trim().isEmpty();
        } catch (Throwable t) {
            isMiuiCached = false;
        }
        return isMiuiCached;
    }

    /** Hide the in-layout logo on skins that already inject the app icon. */
    private void applyLogoVisibility(RemoteViews views) {
        views.setViewVisibility(
            R.id.notification_logo,
            isMiuiDevice() ? android.view.View.GONE : android.view.View.VISIBLE
        );
    }

    private RemoteViews buildBrandedContentView(String title, String text) {
        RemoteViews views = new RemoteViews(getPackageName(), R.layout.notification_qortal_status);
        views.setTextViewText(R.id.notification_title, title);
        views.setTextViewText(R.id.notification_text, text);
        applyLogoVisibility(views);
        return views;
    }

    private RemoteViews buildExpandedStatusContentView(
        String title,
        String text,
        String nodeLabel,
        String syncLabel,
        String peersLabel
    ) {
        RemoteViews views = new RemoteViews(
            getPackageName(),
            R.layout.notification_qortal_status_expanded
        );
        views.setTextViewText(R.id.notification_title, title);
        views.setTextViewText(R.id.notification_text, text);
        views.setTextViewText(R.id.notification_node, "Node: " + nodeLabel);
        views.setTextViewText(R.id.notification_sync, "Sync: " + syncLabel);
        views.setTextViewText(R.id.notification_peers, "Peers: " + peersLabel);
        applyLogoVisibility(views);
        return views;
    }

    private Notification buildStatusNotification() {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        RemoteViews collapsedView = buildBrandedContentView(statusTitle, statusDetail);
        RemoteViews expandedView = buildExpandedStatusContentView(
            statusTitle,
            statusDetail,
            statusNodeLabel,
            statusSyncLabel,
            statusPeersLabel
        );

        // No DecoratedCustomViewStyle: the decoration draws the small app icon
        // header row; the fully-custom view shows only the big logo on the left.
        NotificationCompat.Builder builder = statusNotificationBuilder()
            .setContentTitle(statusTitle)
            .setContentText(statusDetail)
            .setCustomContentView(collapsedView)
            .setCustomBigContentView(expandedView)
            .setContentIntent(pendingIntent)
            .setShowWhen(false)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setGroup(GROUP_STATUS)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_SUMMARY)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        }

        return builder.build();
    }

    private Bitmap loadBitmapFromUrl(String urlString) {
        if (urlString == null || urlString.isEmpty()) {
            return null;
        }

        String[] candidates = buildAvatarUrlCandidates(urlString);
        for (int attempt = 0; attempt < 4; attempt++) {
            for (String candidate : candidates) {
                Bitmap bitmap = fetchBitmapFromUrl(candidate);
                if (bitmap != null) {
                    return toCircleBitmap(bitmap);
                }
            }
            if (attempt < 3) {
                try {
                    Thread.sleep(450L * (attempt + 1));
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    return null;
                }
            }
        }
        return null;
    }

    private String[] buildAvatarUrlCandidates(String urlString) {
        java.util.LinkedHashSet<String> candidates = new java.util.LinkedHashSet<>();
        candidates.add(urlString);
        if (!urlString.contains("async=true")) {
            candidates.add(
                urlString + (urlString.contains("?") ? "&" : "?") + "async=true"
            );
        } else {
            candidates.add(
                urlString
                    .replace("async=true", "")
                    .replace("?&", "?")
                    .replace("&&", "&")
            );
        }
        return candidates.toArray(new String[0]);
    }

    private Bitmap fetchBitmapFromUrl(String urlString) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(urlString);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setDoInput(true);
            connection.setRequestProperty("User-Agent", "QortalGO/2.0 Android");
            connection.connect();
            int responseCode = connection.getResponseCode();
            if (responseCode < 200 || responseCode >= 300) {
                return null;
            }
            int contentLength = connection.getContentLength();
            if (contentLength == 0) {
                return null;
            }
            InputStream input = connection.getInputStream();
            Bitmap bitmap = BitmapFactory.decodeStream(input);
            input.close();
            if (bitmap == null || bitmap.getWidth() <= 0 || bitmap.getHeight() <= 0) {
                return null;
            }
            return bitmap;
        } catch (Exception error) {
            Log.w(TAG, "Failed to load notification avatar from " + urlString, error);
            return null;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private Bitmap toCircleBitmap(Bitmap source) {
        if (source == null) return null;
        int size = Math.min(source.getWidth(), source.getHeight());
        if (size <= 0) return source;

        Bitmap output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        Rect rect = new Rect(0, 0, size, size);

        canvas.drawARGB(0, 0, 0, 0);
        canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint);
        paint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.SRC_IN));

        int left = (source.getWidth() - size) / 2;
        int top = (source.getHeight() - size) / 2;
        canvas.drawBitmap(source, new Rect(left, top, left + size, top + size), rect, paint);
        return output;
    }

    private Bitmap decodeBase64Image(String dataUrlOrBase64) {
        if (dataUrlOrBase64 == null || dataUrlOrBase64.isEmpty()) {
            return null;
        }

        try {
            String payload = dataUrlOrBase64.trim();
            int comma = payload.indexOf(',');
            if (comma >= 0) {
                payload = payload.substring(comma + 1);
            }
            byte[] bytes = Base64.decode(payload, Base64.DEFAULT);
            Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            return bitmap != null ? toCircleBitmap(bitmap) : null;
        } catch (Exception error) {
            Log.w(TAG, "Failed to decode notification avatar base64", error);
            return null;
        }
    }

    private void showAlertNotification(
        int alertId,
        String title,
        String body,
        String iconUrl,
        String fromAddress,
        String alertType
    ) {
        Runnable publishWithoutAvatar =
            () -> publishAlertNotification(alertId, title, body, null, fromAddress, alertType);

        if (iconUrl != null && iconUrl.startsWith("data:")) {
            // Avatar bytes were already fetched by the WebView (which holds the
            // node connection / apiKey); just decode them.
            Bitmap avatar = decodeBase64Image(iconUrl);
            publishAlertNotification(alertId, title, body, avatar, fromAddress, alertType);
        } else if (iconUrl != null && !iconUrl.isEmpty()) {
            new Thread(() -> {
                Bitmap avatar = loadBitmapFromUrl(iconUrl);
                new Handler(Looper.getMainLooper()).post(
                    () ->
                        publishAlertNotification(
                            alertId,
                            title,
                            body,
                            avatar,
                            fromAddress,
                            alertType
                        )
                );
            }).start();
        } else {
            publishWithoutAvatar.run();
        }
    }

    private void publishAlertNotification(
        int alertId,
        String title,
        String body,
        Bitmap avatarBitmap,
        String fromAddress,
        String alertType
    ) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(
            Intent.FLAG_ACTIVITY_SINGLE_TOP |
            Intent.FLAG_ACTIVITY_CLEAR_TOP |
            Intent.FLAG_ACTIVITY_NEW_TASK
        );
        if (fromAddress != null && !fromAddress.isEmpty()) {
            openIntent.putExtra(EXTRA_ALERT_FROM_ADDRESS, fromAddress);
        }
        if (alertType != null && !alertType.isEmpty()) {
            openIntent.putExtra(EXTRA_ALERT_TYPE, alertType);
        }
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            alertId,
            openIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        NotificationCompat.Builder builder = baseNotificationBuilder(CHANNEL_ALERTS_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)
            .setDefaults(Notification.DEFAULT_ALL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setGroup(GROUP_ALERTS);

        // Plain BigText + large icon: the most widely supported avatar
        // presentation (MessagingStyle hides the large icon on several OEM
        // skins, e.g. MIUI).
        if (avatarBitmap != null) {
            builder.setLargeIcon(avatarBitmap);
            Log.i(
                TAG,
                "Alert avatar set: "
                    + avatarBitmap.getWidth() + "x" + avatarBitmap.getHeight()
            );
        } else {
            Log.i(TAG, "Alert avatar missing (null bitmap)");
        }
        builder.setStyle(
            new NotificationCompat.BigTextStyle().bigText(body).setBigContentTitle(title)
        );

        int notificationId = NOTIFICATION_ID_ALERT_BASE + Math.abs(alertId % 10000);
        manager.notify(notificationId, builder.build());
    }

    private void showIncomingCallNotification(String callId, String fromAddress, String fromName) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(
            Intent.FLAG_ACTIVITY_SINGLE_TOP |
            Intent.FLAG_ACTIVITY_CLEAR_TOP |
            Intent.FLAG_ACTIVITY_NEW_TASK
        );
        openIntent.putExtra(EXTRA_CALL_ID, callId);
        openIntent.putExtra(EXTRA_CALL_ACTION, "open");

        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            1,
            openIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        PendingIntent acceptIntent = buildCallActionPendingIntent(ACTION_INCOMING_CALL_ACCEPT, callId, 2);
        PendingIntent declineIntent = buildCallActionPendingIntent(ACTION_INCOMING_CALL_DECLINE, callId, 3);

        RemoteViews contentView = buildBrandedContentView("Incoming call", fromName);

        NotificationCompat.Builder builder = baseNotificationBuilder(CHANNEL_CALLS_ID)
            .setContentTitle("Incoming call")
            .setContentText(fromName)
            .setCustomContentView(contentView)
            .setCustomBigContentView(contentView)
            .setContentIntent(contentIntent)
            .setAutoCancel(false)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(android.R.drawable.ic_menu_call, "Accept", acceptIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", declineIntent);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            builder.setFullScreenIntent(contentIntent, true);
        }

        manager.notify(NOTIFICATION_ID_INCOMING_CALL, builder.build());
    }

    private PendingIntent buildCallActionPendingIntent(String action, String callId, int requestCode) {
        Intent intent = new Intent(this, QortalForegroundService.class);
        intent.setAction(action);
        intent.putExtra(EXTRA_CALL_ID, callId);
        return PendingIntent.getService(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
    }

    private void dismissIncomingCallNotification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.cancel(NOTIFICATION_ID_INCOMING_CALL);
        }
    }

    private void handleIncomingCallAction(Intent intent) {
        String callId = safeString(intent.getStringExtra(EXTRA_CALL_ID), "");
        String action = ACTION_INCOMING_CALL_ACCEPT.equals(intent.getAction()) ? "accept" : "decline";

        Intent broadcast = new Intent(BROADCAST_INCOMING_CALL_ACTION);
        broadcast.putExtra(EXTRA_CALL_ID, callId);
        broadcast.putExtra(EXTRA_CALL_ACTION, action);
        LocalBroadcastManager.getInstance(this).sendBroadcast(broadcast);

        dismissIncomingCallNotification();

        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        openIntent.putExtra(EXTRA_CALL_ID, callId);
        openIntent.putExtra(EXTRA_CALL_ACTION, action);
        startActivity(openIntent);
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel statusChannel = new NotificationChannel(
            CHANNEL_STATUS_ID,
            CHANNEL_STATUS_NAME,
            NotificationManager.IMPORTANCE_LOW
        );
        statusChannel.setDescription("Persistent Qortal Reticulum connection status");
        statusChannel.setShowBadge(false);

        NotificationChannel alertsChannel = new NotificationChannel(
            CHANNEL_ALERTS_ID,
            CHANNEL_ALERTS_NAME,
            NotificationManager.IMPORTANCE_HIGH
        );
        alertsChannel.setDescription("New messages and Qortal alerts");

        NotificationChannel callsChannel = new NotificationChannel(
            CHANNEL_CALLS_ID,
            CHANNEL_CALLS_NAME,
            NotificationManager.IMPORTANCE_HIGH
        );
        callsChannel.setDescription("Incoming voice calls");
        callsChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

        manager.createNotificationChannel(statusChannel);
        manager.createNotificationChannel(alertsChannel);
        manager.createNotificationChannel(callsChannel);
    }

    private static String safeString(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
    }

    public static void startOrUpdate(
        Context context,
        String statusTitle,
        String statusDetail,
        String statusNodeLabel,
        String statusSyncLabel,
        String statusPeersLabel
    ) {
        Intent intent = new Intent(context, QortalForegroundService.class);
        intent.setAction(ACTION_UPDATE);
        intent.putExtra(EXTRA_STATUS_TITLE, statusTitle);
        intent.putExtra(EXTRA_STATUS_DETAIL, statusDetail);
        intent.putExtra(EXTRA_STATUS_NODE, statusNodeLabel);
        intent.putExtra(EXTRA_STATUS_SYNC, statusSyncLabel);
        intent.putExtra(EXTRA_STATUS_PEERS, statusPeersLabel);
        startServiceCompat(context, intent);
    }

    public static void stop(Context context) {
        Intent intent = new Intent(context, QortalForegroundService.class);
        intent.setAction(ACTION_STOP);
        context.startService(intent);
    }

    public static void showAlert(Context context, int alertId, String title, String body) {
        showAlert(context, alertId, title, body, "", "", "");
    }

    public static void showAlert(
        Context context,
        int alertId,
        String title,
        String body,
        String iconUrl
    ) {
        showAlert(context, alertId, title, body, iconUrl, "", "");
    }

    public static void showAlert(
        Context context,
        int alertId,
        String title,
        String body,
        String iconUrl,
        String fromAddress,
        String alertType
    ) {
        Intent intent = new Intent(context, QortalForegroundService.class);
        intent.setAction(ACTION_SHOW_ALERT);
        intent.putExtra(EXTRA_ALERT_ID, alertId);
        intent.putExtra(EXTRA_ALERT_TITLE, title);
        intent.putExtra(EXTRA_ALERT_BODY, body);
        intent.putExtra(EXTRA_ALERT_ICON_URL, iconUrl != null ? iconUrl : "");
        intent.putExtra(EXTRA_ALERT_FROM_ADDRESS, fromAddress != null ? fromAddress : "");
        intent.putExtra(EXTRA_ALERT_TYPE, alertType != null ? alertType : "");
        startServiceCompat(context, intent);
    }

    public static void showIncomingCall(
        Context context,
        String callId,
        String fromAddress,
        String fromName
    ) {
        Intent intent = new Intent(context, QortalForegroundService.class);
        intent.setAction(ACTION_SHOW_INCOMING_CALL);
        intent.putExtra(EXTRA_CALL_ID, callId);
        intent.putExtra(EXTRA_CALL_FROM, fromAddress);
        intent.putExtra(EXTRA_CALL_FROM_NAME, fromName);
        startServiceCompat(context, intent);
    }

    public static void dismissIncomingCall(Context context) {
        Intent intent = new Intent(context, QortalForegroundService.class);
        intent.setAction(ACTION_DISMISS_INCOMING_CALL);
        context.startService(intent);
    }

    private static void startServiceCompat(Context context, Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }
}
