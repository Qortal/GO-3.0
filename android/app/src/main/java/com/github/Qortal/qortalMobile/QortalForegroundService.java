package com.github.Qortal.qortalMobile;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.widget.RemoteViews;
import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;
import android.webkit.MimeTypeMap;
import androidx.core.app.NotificationCompat;
import androidx.core.content.FileProvider;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;

import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

public class QortalForegroundService extends Service {
    private static final String TAG = "QortalForegroundService";

    public static final String CHANNEL_STATUS_ID = "qortal_status";
    public static final String CHANNEL_ALERTS_ID = "qortal_alerts";
    // Separate alert channels so users can tune sound/vibration independently
    // for private messages vs group chat (and mute one without the other).
    public static final String CHANNEL_ALERTS_PM_ID = "qortal_alerts_pm";
    public static final String CHANNEL_ALERTS_GROUP_ID = "qortal_alerts_group";
    /** Old "Incoming calls" channel: no longer used, removed on start (calls use CallNotifications' channels). */
    public static final String CHANNEL_CALLS_ID = "qortal_calls";
    public static final String CHANNEL_TRANSFERS_ID = "qortal_transfers";
    // Progress stays quiet on the transfers channel; a file that lands while
    // GO is in the background is worth a heads-up, on its own channel.
    public static final String CHANNEL_FILES_SAVED_ID = "qortal_files_saved";

    private static final String CHANNEL_STATUS_NAME = "Qortal status";
    private static final String CHANNEL_ALERTS_NAME = "Qortal alerts";
    private static final String CHANNEL_ALERTS_PM_NAME = "Private messages";
    private static final String CHANNEL_ALERTS_GROUP_NAME = "Group messages";
    private static final String CHANNEL_TRANSFERS_NAME = "File transfers";
    private static final String CHANNEL_FILES_SAVED_NAME = "Saved files";

    public static final int NOTIFICATION_ID_STATUS = 2001;
    public static final int NOTIFICATION_ID_INCOMING_CALL = 2002;
    /** Plain "GO paused" notice posted when the service pauses until GO is opened. */
    private static final int NOTIFICATION_ID_PAUSED = 2003;
    private static final int NOTIFICATION_ID_ALERT_BASE = 3000;
    // Alerts occupy 3000..12999 (base + id % 10000); keep transfers clear of that.
    private static final int NOTIFICATION_ID_TRANSFER_BASE = 20000;

    public static final String ACTION_START = "com.github.Qortal.qortalMobile.QORTAL_FGS_START";
    public static final String ACTION_UPDATE = "com.github.Qortal.qortalMobile.QORTAL_FGS_UPDATE";
    public static final String ACTION_STOP = "com.github.Qortal.qortalMobile.QORTAL_FGS_STOP";
    public static final String ACTION_SHOW_ALERT = "com.github.Qortal.qortalMobile.QORTAL_FGS_SHOW_ALERT";
    public static final String ACTION_SHOW_INCOMING_CALL =
        "com.github.Qortal.qortalMobile.QORTAL_FGS_SHOW_INCOMING_CALL";
    public static final String ACTION_DISMISS_INCOMING_CALL =
        "com.github.Qortal.qortalMobile.QORTAL_FGS_DISMISS_INCOMING_CALL";
    public static final String ACTION_DISMISS_CHAT_ALERTS =
        "com.github.Qortal.qortalMobile.QORTAL_FGS_DISMISS_CHAT_ALERTS";

    public static final String ACTION_INCOMING_CALL_ACCEPT =
        "com.github.Qortal.qortalMobile.QORTAL_INCOMING_CALL_ACCEPT";
    public static final String ACTION_INCOMING_CALL_DECLINE =
        "com.github.Qortal.qortalMobile.QORTAL_INCOMING_CALL_DECLINE";
    public static final String ACTION_UPDATE_TRANSFER =
        "com.github.Qortal.qortalMobile.QORTAL_FGS_UPDATE_TRANSFER";
    public static final String ACTION_DISMISS_TRANSFER =
        "com.github.Qortal.qortalMobile.QORTAL_FGS_DISMISS_TRANSFER";
    /**
     * A call started, changed or ended (CallSession) while the service was
     * not running: start it and show the call (see syncCallForegroundOnMain).
     */
    public static final String ACTION_CALL_SYNC =
        "com.github.Qortal.qortalMobile.QORTAL_FGS_CALL_SYNC";
    /** syncCallForegroundOnMain: the service is being started; the result comes later. */
    public static final int CALL_FOREGROUND_PENDING = -2;

    public static final String BROADCAST_INCOMING_CALL_ACTION =
        "com.github.Qortal.qortalMobile.BROADCAST_INCOMING_CALL_ACTION";
    /**
     * Periodic tick relayed to the WebView so presence heartbeats keep firing
     * while Android throttles JS timers in the background. Native Handler
     * callbacks are not throttled, and delivering a Capacitor event executes
     * JS immediately even when setInterval is suspended.
     */
    public static final String BROADCAST_PRESENCE_TICK =
        "com.github.Qortal.qortalMobile.BROADCAST_PRESENCE_TICK";
    private static final long PRESENCE_TICK_INTERVAL_MS = 25_000L;

    /**
     * Set when the service is paused until GO is opened (pauseUntilOpened):
     * Android stopped a dataSync service at its daily time limit (Android
     * 15+, about 6 h in 24 h), or GO's own battery limit was reached. After
     * Android's limit a foreground start is refused ("Time limit already
     * exhausted") and would crash the app, so until GO is back on screen
     * nothing may call startForegroundService. Cleared on the next
     * foreground edge (see onAppForeground). Process-wide: a new process
     * starts clear, and only the user opening GO starts JS again.
     */
    private static volatile boolean fgsTimedOut = false;
    /** Last status the page asked for, to restart the service after a pause (pauseUntilOpened). */
    private static volatile Intent lastStatusIntent;

    /**
     * The WebView was destroyed (QortalBackgroundPlugin.handleOnDestroy) and
     * no new page has loaded: nothing runs the chat engine, whatever the last
     * pushed text says. Cleared when a page loads or pushes its status.
     */
    private static volatile boolean pageGone = false;
    /** Own messages waiting to send, as the page last reported (setOutboxCount). */
    private static volatile int outboxCount = 0;
    /** The service while it runs in the foreground, for in-process redraws. */
    private static volatile QortalForegroundService runningInstance;
    private static final Handler mainHandler = new Handler(Looper.getMainLooper());

    /** Page-provided translations for the texts native code draws itself. */
    private static final String PREFS_LOCALIZED = "qortal_notification_strings";

    public static final String EXTRA_STATUS_TITLE = "status_title";
    public static final String EXTRA_STATUS_DETAIL = "status_detail";
    public static final String EXTRA_STATUS_NODE = "status_node";
    public static final String EXTRA_STATUS_SYNC = "status_sync";
    public static final String EXTRA_STATUS_PEERS = "status_peers";
    /** starting | online | offline — JS hint; native network state can override. */
    public static final String EXTRA_STATUS_KIND = "status_kind";
    public static final String EXTRA_ALERT_ID = "alert_id";
    public static final String EXTRA_ALERT_TITLE = "alert_title";
    public static final String EXTRA_ALERT_BODY = "alert_body";
    public static final String EXTRA_ALERT_ICON_URL = "alert_icon_url";
    public static final String EXTRA_ALERT_FROM_ADDRESS = "alert_from_address";
    public static final String EXTRA_ALERT_TYPE = "alert_type";
    /** Stable per-conversation tag; tray identity becomes (tag, id) when present. */
    public static final String EXTRA_ALERT_TAG = "alert_tag";
    public static final String EXTRA_CALL_ID = "call_id";
    public static final String EXTRA_CALL_FROM = "call_from";
    public static final String EXTRA_CALL_FROM_NAME = "call_from_name";
    public static final String EXTRA_CALL_ACTION = "call_action";
    public static final String EXTRA_TRANSFER_ID = "transfer_id";
    public static final String EXTRA_TRANSFER_TITLE = "transfer_title";
    public static final String EXTRA_TRANSFER_TEXT = "transfer_text";
    /** 0-100 for a determinate bar, -1 for indeterminate, -2 for no bar. */
    public static final String EXTRA_TRANSFER_PROGRESS = "transfer_progress";
    public static final String EXTRA_TRANSFER_ONGOING = "transfer_ongoing";
    /** Saved file a tap on the notification should open (content:// or a path). */
    public static final String EXTRA_TRANSFER_OPEN_URI = "transfer_open_uri";
    public static final String EXTRA_TRANSFER_OPEN_MIME = "transfer_open_mime";
    /** Pop up (heads-up) once instead of updating quietly. */
    public static final String EXTRA_TRANSFER_ALERT = "transfer_alert";
    /** Label of the button that opens the saved file ("Install", "Open"). */
    public static final String EXTRA_TRANSFER_ACTION_LABEL = "transfer_action_label";

    private static final String GROUP_STATUS = "qortal_connection_status";
    private static final String GROUP_ALERTS = "qortal_message_alerts";
    private String statusTitle = "GO 3.0";
    private String statusDetail = "Connecting…";
    private String statusNodeLabel = "Public node";
    private String statusSyncLabel = "Sync status unknown";
    private String statusPeersLabel = "0 connected peers";
    private String statusKind = "starting";
    private boolean isRunning = false;
    /**
     * The call notification is the foreground notification right now (a call
     * runs): the status notification stays down until the call ends.
     */
    private boolean callForegroundShown = false;
    /** Service type flags held with the call notification (valid while callForegroundShown). */
    private int callForegroundTypes = 0;
    private boolean connectivityWatchersRegistered = false;
    /** Last StatusHonesty state drawn, to log only its flips. */
    private String lastHonestState = StatusHonesty.LIVE;

    /**
     * Screen on / unlock: re-check whether the page is still running, so a
     * "paused" state reached while the CPU slept shows when the user looks.
     */
    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (isRunning) updateStatusNotification();
        }
    };

    private final BroadcastReceiver airplaneModeReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (isRunning) updateStatusNotification();
        }
    };

    private final ConnectivityManager.NetworkCallback networkCallback =
        new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                if (isRunning) updateStatusNotification();
            }

            @Override
            public void onLost(Network network) {
                if (isRunning) updateStatusNotification();
            }

            @Override
            public void onCapabilitiesChanged(
                Network network,
                NetworkCapabilities networkCapabilities
            ) {
                if (isRunning) updateStatusNotification();
            }
        };

    private final Handler presenceTickHandler = new Handler(Looper.getMainLooper());
    private final Runnable presenceTickRunnable = new Runnable() {
        @Override
        public void run() {
            LocalBroadcastManager.getInstance(QortalForegroundService.this)
                .sendBroadcast(new Intent(BROADCAST_PRESENCE_TICK));
            // Background sync: renew the wake lock, watch for vendor freezes,
            // and check GO's 6 h battery limit (pauseOnBattery).
            BackgroundKeepAlive.get(QortalForegroundService.this).onServiceTick();
            // A stopped service ticks no more.
            if (!isRunning) return;
            // Local check only: has Chromium frozen the page by now?
            updateStatusNotification();
            presenceTickHandler.postDelayed(this, PRESENCE_TICK_INTERVAL_MS);
        }
    };

    private void startPresenceTicker() {
        presenceTickHandler.removeCallbacks(presenceTickRunnable);
        presenceTickHandler.postDelayed(presenceTickRunnable, PRESENCE_TICK_INTERVAL_MS);
    }

    private void stopPresenceTicker() {
        presenceTickHandler.removeCallbacks(presenceTickRunnable);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannels();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) {
            // Only a sticky restart delivers no intent. Nothing is attached
            // then (no WebView, no engine), and starting in the foreground
            // again is what crash-looped after the dataSync time-out.
            if (!isRunning) {
                stopSelf(startId);
            }
            return START_NOT_STICKY;
        }

        switch (intent.getAction()) {
            case ACTION_START:
            case ACTION_UPDATE:
                statusTitle = safeString(intent.getStringExtra(EXTRA_STATUS_TITLE), statusTitle);
                statusDetail = safeString(intent.getStringExtra(EXTRA_STATUS_DETAIL), statusDetail);
                statusNodeLabel = safeString(intent.getStringExtra(EXTRA_STATUS_NODE), statusNodeLabel);
                statusSyncLabel = safeString(intent.getStringExtra(EXTRA_STATUS_SYNC), statusSyncLabel);
                statusPeersLabel = safeString(intent.getStringExtra(EXTRA_STATUS_PEERS), statusPeersLabel);
                statusKind = normalizeStatusKind(intent.getStringExtra(EXTRA_STATUS_KIND));
                if (!isRunning) {
                    if (startStatusForegroundOrStop(startId)
                        && BackgroundKeepAlive.get(this).isSessionActive()) {
                        // The page is signed in and GO runs again: bring the
                        // hubs back if a time-out, swipe or logout closed them.
                        // A start replayed for a signed-out page must not.
                        ReticulumPlugin.resumeNetwork("status_service_started");
                    }
                } else {
                    updateStatusNotification();
                }
                break;
            case ACTION_STOP:
                stopPresenceTicker();
                stopForeground(true);
                stopSelf();
                isRunning = false;
                clearRunningInstance();
                BackgroundKeepAlive.get(this).setServiceRunning(false);
                dropCallForeground();
                break;
            case ACTION_SHOW_ALERT:
                showAlertNotification(
                    intent.getIntExtra(EXTRA_ALERT_ID, (int) (System.currentTimeMillis() % 100000)),
                    safeString(intent.getStringExtra(EXTRA_ALERT_TITLE), "GO 3.0"),
                    safeString(intent.getStringExtra(EXTRA_ALERT_BODY), ""),
                    safeString(intent.getStringExtra(EXTRA_ALERT_ICON_URL), ""),
                    safeString(intent.getStringExtra(EXTRA_ALERT_FROM_ADDRESS), ""),
                    safeString(intent.getStringExtra(EXTRA_ALERT_TYPE), ""),
                    safeString(intent.getStringExtra(EXTRA_ALERT_TAG), "")
                );
                if (!isRunning) {
                    startStatusForegroundOrStop(startId);
                }
                break;
            case ACTION_SHOW_INCOMING_CALL:
                // Older callers (an intent queued before an update): the ring
                // is CallSession's now; it needs no running service.
                CallSession.get(this).showIncomingFromPage(
                    safeString(intent.getStringExtra(EXTRA_CALL_ID), ""),
                    safeString(intent.getStringExtra(EXTRA_CALL_FROM), ""),
                    intent.getStringExtra(EXTRA_CALL_FROM_NAME),
                    null,
                    false,
                    CallSession.SOURCE_LEGACY
                );
                if (!isRunning) {
                    startStatusForegroundOrStop(startId);
                }
                break;
            case ACTION_DISMISS_INCOMING_CALL:
                CallSession.get(this).cancelIncomingFromPage(null, "legacy-dismiss");
                break;
            case ACTION_CALL_SYNC:
                if (!isRunning) {
                    startStatusForegroundOrStop(startId);
                }
                if (isRunning) {
                    CallSession.get(this).onCallForegroundApplied(applyCallForeground());
                }
                break;
            case ACTION_DISMISS_CHAT_ALERTS:
                dismissChatAlertNotifications();
                break;
            case ACTION_UPDATE_TRANSFER:
                showTransferNotification(
                    safeString(intent.getStringExtra(EXTRA_TRANSFER_ID), ""),
                    safeString(intent.getStringExtra(EXTRA_TRANSFER_TITLE), "File transfer"),
                    safeString(intent.getStringExtra(EXTRA_TRANSFER_TEXT), ""),
                    intent.getIntExtra(EXTRA_TRANSFER_PROGRESS, -2),
                    intent.getBooleanExtra(EXTRA_TRANSFER_ONGOING, false),
                    intent.getStringExtra(EXTRA_TRANSFER_OPEN_URI),
                    intent.getStringExtra(EXTRA_TRANSFER_OPEN_MIME),
                    intent.getBooleanExtra(EXTRA_TRANSFER_ALERT, false),
                    intent.getStringExtra(EXTRA_TRANSFER_ACTION_LABEL)
                );
                if (!isRunning) {
                    startStatusForegroundOrStop(startId);
                }
                break;
            case ACTION_DISMISS_TRANSFER:
                dismissTransferNotification(
                    safeString(intent.getStringExtra(EXTRA_TRANSFER_ID), "")
                );
                break;
            case ACTION_INCOMING_CALL_ACCEPT:
            case ACTION_INCOMING_CALL_DECLINE:
                handleIncomingCallAction(intent);
                break;
            default:
                break;
        }

        // Not sticky: a restarted service has no page behind it (see the
        // null-intent path above). The page starts it again when it runs.
        return START_NOT_STICKY;
    }

    /**
     * Android 15+ calls this when the dataSync type reaches its daily limit.
     * The service must leave the foreground within seconds or Android kills
     * the app (ForegroundServiceDidNotStopInTimeException). Since Android 14
     * the service runs as remoteMessaging, which has no such limit, so this
     * remains only for a phone that refused remoteMessaging (dataSync
     * fallback in startForegroundTyped).
     */
    @Override
    public void onTimeout(int startId, int fgsType) {
        pauseUntilOpened(PAUSE_REASON_FGS_TIMEOUT);
    }

    /** API 34 short-service time-out; same handling should the type change. */
    @Override
    public void onTimeout(int startId) {
        pauseUntilOpened(PAUSE_REASON_FGS_TIMEOUT);
    }

    /** Android stopped the service at its time limit (onTimeout). */
    private static final String PAUSE_REASON_FGS_TIMEOUT = "fgs_timeout";
    /**
     * GO's own limit (Android 15+): 6 h off screen on battery
     * (KeepAlivePolicy.shouldPauseOnBattery).
     */
    private static final String PAUSE_REASON_BATTERY = "battery_pause";

    /**
     * GO's own battery limit was reached (BackgroundKeepAlive
     * .checkBatteryPause). Runs at once, in the same main-thread message as
     * that check, so GO coming on screen cannot slip in between. Same pause
     * as at Android's time limit; opening GO undoes it (onAppForeground).
     * Never posted: a pause run later could land after GO came on screen.
     */
    public static void pauseOnBattery() {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            Log.w(TAG, "Battery pause ignored: not called on the main thread");
            return;
        }
        QortalForegroundService service = runningInstance;
        if (service != null && service.isRunning && !fgsTimedOut) {
            service.pauseUntilOpened(PAUSE_REASON_BATTERY);
        }
    }

    /**
     * Leave the foreground, stop, pause the hubs and post the "GO paused"
     * notice until GO is opened again. Main thread. {@code reason} is
     * PAUSE_REASON_FGS_TIMEOUT or PAUSE_REASON_BATTERY.
     */
    private void pauseUntilOpened(String reason) {
        Log.w(TAG, "Background connection paused (" + reason + ") until GO is opened");
        fgsTimedOut = true;
        // No keep-alive or wake lock until GO is on screen again.
        BackgroundKeepAlive.get(this).onForegroundServiceTimeout();
        leaveForeground();
        stopSelf();
        // No page is using the mesh now (it froze long ago), so the hub
        // sockets go too instead of draining the battery with no listener.
        ReticulumPlugin.pauseNetwork(reason, 0L);
        postPausedNotification(reason);
    }

    /**
     * GO was swiped away from recents. The WebView and the chat engine are
     * gone, and with RNS transport off the Python layer relays nothing on its
     * own, so keeping the hubs connected would only burn battery.
     */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        Log.i(TAG, "Task removed; stopping the status service and the network layer");
        // The page and any call in it are gone: no ring, no call
        // notification, no lock-screen flags, audio mode back to normal.
        CallSession.get(this).onTaskRemoved();
        ReticulumPlugin.pauseNetwork("task_removed", 0L);
        leaveForeground();
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    private void leaveForeground() {
        stopPresenceTicker();
        unregisterConnectivityWatchers();
        try {
            stopForeground(Service.STOP_FOREGROUND_REMOVE);
        } catch (RuntimeException error) {
            Log.w(TAG, "stopForeground failed", error);
        }
        isRunning = false;
        clearRunningInstance();
        BackgroundKeepAlive.get(this).setServiceRunning(false);
        dropCallForeground();
    }

    /** The call notification left with the foreground (stopForeground removed it). */
    private void dropCallForeground() {
        if (!callForegroundShown) return;
        callForegroundShown = false;
        callForegroundTypes = 0;
        CallSession.get(this).onCallForegroundApplied(-1);
    }

    /** One quiet notice that GO stopped; a tap opens GO, which reconnects. */
    private void postPausedNotification(String reason) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(
            Intent.FLAG_ACTIVITY_SINGLE_TOP |
            Intent.FLAG_ACTIVITY_CLEAR_TOP |
            Intent.FLAG_ACTIVITY_NEW_TASK
        );
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            NOTIFICATION_ID_PAUSED,
            openIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        String title = localizedString(
            this,
            StatusHonesty.KEY_FGS_TIMEOUT_TITLE,
            getString(R.string.go_paused_title)
        );
        // Say who paused it: GO's own battery limit, or Android's.
        String text = PAUSE_REASON_BATTERY.equals(reason)
            ? localizedString(
                this,
                StatusHonesty.KEY_BATTERY_PAUSE_TEXT,
                getString(R.string.go_battery_pause_text)
            )
            : localizedString(
                this,
                StatusHonesty.KEY_FGS_TIMEOUT_TEXT,
                getString(R.string.go_paused_text)
            );
        Notification notification = baseNotificationBuilder(CHANNEL_STATUS_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .build();
        try {
            manager.notify(NOTIFICATION_ID_PAUSED, notification);
        } catch (RuntimeException error) {
            Log.w(TAG, "Failed to post the paused notification", error);
        }
    }

    private static void cancelPausedNotification(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.cancel(NOTIFICATION_ID_PAUSED);
        }
    }

    @Override
    public void onDestroy() {
        stopPresenceTicker();
        unregisterConnectivityWatchers();
        isRunning = false;
        clearRunningInstance();
        BackgroundKeepAlive.get(this).setServiceRunning(false);
        dropCallForeground();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /**
     * Enter the foreground with the status notification, or stop when that is
     * not possible: after a time-out (the service was started with a plain
     * startService, see startServiceCompat) or when Android refuses it
     * (ForegroundServiceStartNotAllowedException, API 31+). Returns true when
     * the service now runs in the foreground.
     */
    private boolean startStatusForegroundOrStop(int startId) {
        if (fgsTimedOut) {
            // This start may still come from a startForegroundService issued
            // just before the time-out. Stopping without startForeground would
            // then crash ("did not then call startForeground"); the call
            // settles that even when Android refuses it.
            try {
                startForegroundTyped(buildStatusNotification(), resolveForegroundTypeFlag());
            } catch (IllegalStateException | SecurityException error) {
                Log.w(TAG, "Foreground start after time-out refused: " + error.getMessage());
            }
            leaveForeground();
            stopSelf(startId);
            return false;
        }
        try {
            startStatusForeground();
            cancelPausedNotification(this);
            return true;
        } catch (IllegalStateException | SecurityException error) {
            Log.w(TAG, "Foreground start refused: " + error.getMessage());
            isRunning = false;
            stopSelf(startId);
            return false;
        }
    }

    /**
     * remoteMessaging from Android 14 on, dataSync before
     * (KeepAlivePolicy.foregroundServiceType, the one place that decides).
     * 0 before Android 10, where startForeground takes no type.
     */
    private static int resolveForegroundTypeFlag() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return 0;
        String type = KeepAlivePolicy.foregroundServiceType(Build.VERSION.SDK_INT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
            && KeepAlivePolicy.SERVICE_TYPE_REMOTE_MESSAGING.equals(type)) {
            return ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING;
        }
        return ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
    }

    /**
     * startForeground with an explicit type; the manifest declares two. A
     * refused remoteMessaging falls back to dataSync, so a phone that rejects
     * it keeps the service, with Android's daily limit (onTimeout) as the
     * safety net there. Returns the type flag actually used.
     */
    private int startForegroundTyped(Notification notification, int typeFlag) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && typeFlag != 0) {
            try {
                startForeground(NOTIFICATION_ID_STATUS, notification, typeFlag);
            } catch (IllegalStateException | SecurityException error) {
                if (typeFlag == ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) throw error;
                Log.w(TAG, "remoteMessaging refused, using dataSync: " + error.getMessage());
                typeFlag = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
                startForeground(NOTIFICATION_ID_STATUS, notification, typeFlag);
            }
        } else {
            startForeground(NOTIFICATION_ID_STATUS, notification);
        }
        return typeFlag;
    }

    private static String foregroundTypeName(int typeFlag) {
        if (typeFlag == 0) return "untyped";
        return typeFlag == ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            ? KeepAlivePolicy.SERVICE_TYPE_DATA_SYNC
            : KeepAlivePolicy.SERVICE_TYPE_REMOTE_MESSAGING;
    }

    private void startStatusForeground() {
        Notification notification = buildStatusNotification();
        int typeFlag = startForegroundTyped(notification, resolveForegroundTypeFlag());
        isRunning = true;
        runningInstance = this;
        startPresenceTicker();
        registerConnectivityWatchers();
        BackgroundKeepAlive.get(this).setServiceRunning(true);
        Log.i(TAG, "Status foreground service started as " + foregroundTypeName(typeFlag));
    }

    private String lastPostedStatusKey = "";

    /**
     * Show, update or remove the call notification as the foreground
     * notification. During a call the service is a microphone foreground
     * service (Android 11+ silences the mic of an app off screen otherwise)
     * with the call notification; after it, the status notification and the
     * base type come back. Main thread. Returns the type flags in use with
     * the call notification (0 before Android 10), or -1 when no call
     * notification is the foreground one (no call, or Android refused it).
     */
    private int applyCallForeground() {
        CallNotifications.OngoingSpec call = CallSession.get(this).activeSnapshotOnMain();
        int base = resolveForegroundTypeFlag();
        if (call == null) {
            if (callForegroundShown) {
                callForegroundShown = false;
                callForegroundTypes = 0;
                // Status notification back as the foreground one, base type only.
                lastPostedStatusKey = "";
                try {
                    startForegroundTyped(buildStatusNotification(), base);
                } catch (IllegalStateException | SecurityException error) {
                    Log.w(TAG, "Status foreground after the call refused: " + error.getMessage());
                }
                Log.i(TAG, "Call over; status notification is the foreground one again");
            }
            // Also a plain call entry posted when the foreground was refused.
            CallNotifications.cancelOngoing(this);
            return -1;
        }
        boolean micGranted = androidx.core.content.ContextCompat.checkSelfPermission(
            this,
            android.Manifest.permission.RECORD_AUDIO
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED;
        int wanted = CallSessionPolicy.foregroundTypeFlags(base, true, micGranted, Build.VERSION.SDK_INT);
        Notification notification = CallNotifications.buildOngoing(this, call, true);
        if (callForegroundShown) {
            // Already the foreground notification: phase, mute, name or
            // avatar changed. startForeground again only to add a type the
            // service lacks (the microphone after a refusal off screen), and
            // never with fewer types than it holds.
            int held = callForegroundTypes;
            int next = CallSessionPolicy.callForegroundUpdateTypes(held, wanted, Build.VERSION.SDK_INT);
            if (next != held && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    startForeground(CallNotifications.NOTIFICATION_ID_ONGOING, notification, next);
                    callForegroundTypes = next;
                    Log.i(TAG, "Call foreground types now " + next);
                    return next;
                } catch (IllegalStateException | SecurityException error) {
                    Log.w(TAG, "Microphone foreground type still refused: " + error.getMessage());
                }
            }
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                try {
                    manager.notify(CallNotifications.NOTIFICATION_ID_ONGOING, notification);
                } catch (RuntimeException error) {
                    Log.w(TAG, "Call notification not updated", error);
                }
            }
            return held;
        }
        int used = -1;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && wanted != 0) {
            try {
                startForeground(CallNotifications.NOTIFICATION_ID_ONGOING, notification, wanted);
                used = wanted;
            } catch (IllegalStateException | SecurityException error) {
                // Android 14+ refuses the microphone type off screen; the call
                // still shows, and GO retries when it comes on screen.
                Log.w(TAG, "Microphone foreground type refused: " + error.getMessage());
                if (wanted != base) {
                    try {
                        startForeground(CallNotifications.NOTIFICATION_ID_ONGOING, notification, base);
                        used = base;
                    } catch (IllegalStateException | SecurityException again) {
                        Log.w(TAG, "Call foreground refused: " + again.getMessage());
                    }
                }
            }
        } else {
            try {
                startForeground(CallNotifications.NOTIFICATION_ID_ONGOING, notification);
                used = 0;
            } catch (IllegalStateException | SecurityException error) {
                Log.w(TAG, "Call foreground refused: " + error.getMessage());
            }
        }
        if (used < 0) {
            // Not the foreground notification: a plain tray entry instead.
            callForegroundShown = false;
            callForegroundTypes = 0;
            CallNotifications.postOngoingPlain(this, call);
            return -1;
        }
        Log.i(TAG, "Call notification is the foreground one (types " + used + ")");
        callForegroundShown = true;
        callForegroundTypes = used;
        return used;
    }

    /**
     * CallSession's call state changed. Main thread. Returns the type flags
     * now used with the call notification, -1 when it is not the foreground
     * notification, or {@link #CALL_FOREGROUND_PENDING} when the service had
     * to be started (CallSession hears the result from onStartCommand).
     */
    public static int syncCallForegroundOnMain(Context context) {
        QortalForegroundService service = runningInstance;
        if (service != null && service.isRunning) {
            return service.applyCallForeground();
        }
        if (!CallSession.get(context).hasActiveCall()) {
            CallNotifications.cancelOngoing(context);
            return -1;
        }
        Intent intent = new Intent(context, QortalForegroundService.class);
        intent.setAction(ACTION_CALL_SYNC);
        startServiceCompat(context, intent);
        return CALL_FOREGROUND_PENDING;
    }

    private void updateStatusNotification() {
        if (callForegroundShown) {
            // The call notification stands in for it until the call ends
            // (applyCallForeground then posts the status again).
            lastPostedStatusKey = "";
            return;
        }
        StatusDisplay display = resolveStatusDisplay();
        // Paused hides the page's last Node/Sync/Peers rows, so their text
        // changing then does not need a redraw.
        String rows = StatusHonesty.PAUSED.equals(display.state)
            ? ""
            : statusNodeLabel + "|" + statusSyncLabel + "|" + statusPeersLabel;
        String key = display.state + "|" + display.kind + "|" + display.detail
            + "|" + display.title + "|" + rows;
        if (key.equals(lastPostedStatusKey)) return;
        lastPostedStatusKey = key;
        if (!display.state.equals(lastHonestState)) {
            Log.i(TAG, "status_redraw " + lastHonestState + " -> " + display.state);
            lastHonestState = display.state;
        }
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

    /** Blank status-bar icon; the shade shows only the big logo from custom content. */
    private NotificationCompat.Builder statusNotificationBuilder() {
        int brandColor = getResources().getColor(R.color.qortal_brand, getTheme());
        return new NotificationCompat.Builder(this, CHANNEL_STATUS_ID)
            .setSmallIcon(R.drawable.ic_notification_blank)
            .setColor(brandColor);
    }

    private static Boolean skinInjectsAppIconCached;

    /**
     * MIUI, Vivo (OriginOS/Funtouch) and other Chinese OEM skins inject the
     * app icon at the left of every notification card, so drawing our own
     * logo there duplicates it. Other skins (AOSP/Pixel, One UI, ...) leave
     * the custom content alone, where we want the big Qortal logo on the
     * left ourselves.
     */
    private static boolean skinInjectsAppIcon() {
        if (skinInjectsAppIconCached != null) return skinInjectsAppIconCached;

        String manufacturer = Build.MANUFACTURER == null
            ? ""
            : Build.MANUFACTURER.toLowerCase(java.util.Locale.ROOT);
        if (
            manufacturer.contains("vivo")
                || manufacturer.contains("oppo")
                || manufacturer.contains("realme")
                || manufacturer.contains("iqoo")
        ) {
            skinInjectsAppIconCached = true;
            return true;
        }

        try {
            @SuppressWarnings("PrivateApi")
            Class<?> systemProperties = Class.forName("android.os.SystemProperties");
            String version = (String) systemProperties
                .getMethod("get", String.class)
                .invoke(null, "ro.miui.ui.version.name");
            skinInjectsAppIconCached = version != null && !version.trim().isEmpty();
        } catch (Throwable t) {
            skinInjectsAppIconCached = false;
        }
        return skinInjectsAppIconCached;
    }

    private static String normalizeStatusKind(String kind) {
        if ("online".equals(kind) || "offline".equals(kind) || "starting".equals(kind)) {
            return kind;
        }
        return "starting";
    }

    private boolean deviceHasNetwork() {
        return DeviceNetwork.isAvailable(this);
    }

    /** What the status notification shows right now. */
    private static final class StatusDisplay {
        /** StatusHonesty.LIVE, BACKGROUND or PAUSED. */
        String state;
        /** starting | online | offline, for the dot colour. */
        String kind;
        String title;
        /** Status, then the full waiting text on a second line (expanded view). */
        String detail;
        /** First line of {@link #detail}; the collapsed view has room for one. */
        String primary;
        /** Short waiting count for the collapsed line, or null. */
        String waitingShort;
    }

    /**
     * The page's own text while it runs; native text when Chromium has frozen
     * the page or the WebView is gone (the page cannot push then), or while
     * the keep-alive controller keeps it running off screen.
     */
    private StatusDisplay resolveStatusDisplay() {
        BackgroundKeepAlive.PageState page = BackgroundKeepAlive.get(this).getPageState();
        boolean gone = pageGone;
        StatusDisplay display = new StatusDisplay();
        display.state = StatusHonesty.resolve(
            gone,
            page.activityStopped,
            page.keepAliveActive,
            page.hiddenSinceMs,
            SystemClock.elapsedRealtime()
        );
        String primary;
        if (StatusHonesty.PAUSED.equals(display.state)) {
            display.kind = "starting";
            display.title = localizedString(
                this,
                StatusHonesty.KEY_PAUSED_TITLE,
                getString(R.string.status_paused_title)
            );
            primary = localizedString(
                this,
                StatusHonesty.KEY_PAUSED_TEXT,
                getString(R.string.status_paused_text)
            );
        } else if (!deviceHasNetwork()) {
            display.kind = "offline";
            display.title = statusTitle;
            primary = "Reticulum offline";
        } else if (StatusHonesty.BACKGROUND.equals(display.state)) {
            display.kind = statusKind;
            display.title = statusTitle;
            primary = localizedString(
                this,
                StatusHonesty.KEY_SYNCING_BACKGROUND,
                getString(R.string.status_syncing_background)
            );
        } else {
            display.kind = statusKind;
            display.title = statusTitle;
            primary = statusDetail;
        }
        int count = outboxCount;
        boolean showWaiting = StatusHonesty.showWaiting(gone, page.activityStopped, count);
        String waiting = showWaiting ? waitingText(count) : null;
        display.primary = primary;
        display.waitingShort = showWaiting ? waitingShortText(count) : null;
        display.detail = StatusHonesty.joinLines(primary, waiting);
        return display;
    }

    private String waitingShortText(int count) {
        String template = localizedString(this, StatusHonesty.KEY_WAITING_SHORT, null);
        if (template != null) {
            return StatusHonesty.fillCount(template, count);
        }
        return getString(R.string.status_waiting_short, count);
    }

    private String waitingText(int count) {
        String template = null;
        if (count == 1) {
            template = localizedString(this, StatusHonesty.KEY_WAITING_TEXT_ONE, null);
        }
        if (template == null) {
            template = localizedString(this, StatusHonesty.KEY_WAITING_TEXT, null);
        }
        if (template != null) {
            return StatusHonesty.fillCount(template, count);
        }
        return getResources().getQuantityString(R.plurals.status_waiting_text, count, count);
    }

    private String resolveDisplayKind() {
        return resolveStatusDisplay().kind;
    }

    private int statusDotColor() {
        String kind = resolveDisplayKind();
        if ("online".equals(kind)) {
            return getResources().getColor(R.color.reticulum_status_online, getTheme());
        }
        if ("offline".equals(kind)) {
            return getResources().getColor(R.color.reticulum_status_offline, getTheme());
        }
        return getResources().getColor(R.color.reticulum_status_starting, getTheme());
    }

    private void applyStatusDot(RemoteViews views) {
        views.setInt(R.id.notification_status_dot, "setColorFilter", statusDotColor());
    }

    private void registerConnectivityWatchers() {
        if (connectivityWatchersRegistered) return;
        IntentFilter airplaneFilter = new IntentFilter(Intent.ACTION_AIRPLANE_MODE_CHANGED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(airplaneModeReceiver, airplaneFilter, Context.RECEIVER_EXPORTED);
        } else {
            registerReceiver(airplaneModeReceiver, airplaneFilter);
        }
        IntentFilter screenFilter = new IntentFilter(Intent.ACTION_SCREEN_ON);
        screenFilter.addAction(Intent.ACTION_USER_PRESENT);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(screenReceiver, screenFilter, Context.RECEIVER_EXPORTED);
            } else {
                registerReceiver(screenReceiver, screenFilter);
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Screen receiver not registered", error);
        }
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        if (cm != null) {
            try {
                cm.registerDefaultNetworkCallback(networkCallback);
            } catch (RuntimeException ignored) {
            }
        }
        connectivityWatchersRegistered = true;
    }

    private void unregisterConnectivityWatchers() {
        if (!connectivityWatchersRegistered) return;
        try {
            unregisterReceiver(airplaneModeReceiver);
        } catch (RuntimeException ignored) {
        }
        try {
            unregisterReceiver(screenReceiver);
        } catch (RuntimeException ignored) {
        }
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        if (cm != null) {
            try {
                cm.unregisterNetworkCallback(networkCallback);
            } catch (RuntimeException ignored) {
            }
        }
        connectivityWatchersRegistered = false;
    }

    /** Hide the in-layout logo on skins that already inject the app icon. */
    private void applyLogoVisibility(RemoteViews views) {
        views.setViewVisibility(
            R.id.notification_logo,
            skinInjectsAppIcon() ? android.view.View.GONE : android.view.View.VISIBLE
        );
    }

    private RemoteViews buildBrandedContentView(String title, String text) {
        return buildBrandedContentView(title, text, null);
    }

    /** Collapsed layout: one detail line, with the waiting count kept visible. */
    private RemoteViews buildBrandedContentView(String title, String text, String waiting) {
        RemoteViews views = new RemoteViews(getPackageName(), R.layout.notification_qortal_status);
        views.setTextViewText(R.id.notification_title, title);
        views.setTextViewText(R.id.notification_text, text);
        String suffix = StatusHonesty.inlineSuffix(waiting);
        views.setViewVisibility(
            R.id.notification_waiting,
            suffix == null ? android.view.View.GONE : android.view.View.VISIBLE
        );
        if (suffix != null) {
            views.setTextViewText(R.id.notification_waiting, suffix);
        }
        applyStatusDot(views);
        applyLogoVisibility(views);
        return views;
    }

    private RemoteViews buildExpandedStatusContentView(
        String state,
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
        applyStatusDot(views);
        // Paused: the engine is not running, so the page's last Node/Sync/Peers
        // text (e.g. "12 online") is stale. RemoteViews are rebuilt on every
        // redraw, so the rows are set VISIBLE again explicitly.
        int rowVisibility = StatusHonesty.PAUSED.equals(state)
            ? android.view.View.GONE
            : android.view.View.VISIBLE;
        views.setViewVisibility(R.id.notification_node, rowVisibility);
        views.setViewVisibility(R.id.notification_sync, rowVisibility);
        views.setViewVisibility(R.id.notification_peers, rowVisibility);
        if (rowVisibility == android.view.View.VISIBLE) {
            views.setTextViewText(R.id.notification_node, "Node: " + nodeLabel);
            views.setTextViewText(R.id.notification_sync, "Sync: " + syncLabel);
            views.setTextViewText(R.id.notification_peers, "Peers: " + peersLabel);
        }
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

        StatusDisplay display = resolveStatusDisplay();
        String displayDetail = display.detail;
        RemoteViews collapsedView = buildBrandedContentView(
            display.title,
            display.primary,
            display.waitingShort
        );
        RemoteViews expandedView = buildExpandedStatusContentView(
            display.state,
            display.title,
            displayDetail,
            statusNodeLabel,
            statusSyncLabel,
            statusPeersLabel
        );

        // No DecoratedCustomViewStyle: the decoration draws the small app icon
        // header row; the fully-custom view shows only the big logo on the left.
        NotificationCompat.Builder builder = statusNotificationBuilder()
            .setContentTitle(display.title)
            .setContentText(displayDetail)
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
            // Redirects are followed hop by hop, each routed by LocalHttp
            // (direct for the phone's own addresses).
            connection = LocalHttp.openFollowingRedirects(url, LocalHttp.MAX_REDIRECTS, (hop, hopUrl) -> {
                hop.setConnectTimeout(8000);
                hop.setReadTimeout(8000);
                hop.setDoInput(true);
                hop.setRequestProperty("User-Agent", "QortalGO/2.0 Android");
            });
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
            // The URL can carry the node API key (?apiKey=), and so can the
            // exception text (FileNotFoundException names the URL): neither
            // goes to logcat as is.
            Log.w(
                TAG,
                "Failed to load notification avatar from "
                    + SecretRedaction.stripQuery(urlString)
                    + ": "
                    + error.getClass().getSimpleName()
                    + " "
                    + SecretRedaction.redactText(error.getMessage())
            );
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

    /**
     * Tray id for an alert. Shared with the plugin's single-alert cancel so
     * both sides always agree on (tag, id).
     */
    public static int alertNotificationId(int alertId) {
        return NOTIFICATION_ID_ALERT_BASE + Math.abs(alertId % 10000);
    }

    private void showAlertNotification(
        int alertId,
        String title,
        String body,
        String iconUrl,
        String fromAddress,
        String alertType,
        String alertTag
    ) {
        Runnable publishWithoutAvatar =
            () ->
                publishAlertNotification(
                    alertId,
                    title,
                    body,
                    null,
                    fromAddress,
                    alertType,
                    alertTag
                );

        if (iconUrl != null && iconUrl.startsWith("data:")) {
            // Avatar bytes were already fetched by the WebView (which holds the
            // node connection / apiKey); just decode them.
            Bitmap avatar = decodeBase64Image(iconUrl);
            publishAlertNotification(
                alertId,
                title,
                body,
                avatar,
                fromAddress,
                alertType,
                alertTag
            );
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
                            alertType,
                            alertTag
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
        String alertType,
        String alertTag
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

        // Route to the per-kind channel so PM and group alerts can be tuned
        // independently. Falls back to the general alerts channel.
        String channelId = CHANNEL_ALERTS_ID;
        if ("direct".equalsIgnoreCase(alertType)) {
            channelId = CHANNEL_ALERTS_PM_ID;
        } else if ("group".equalsIgnoreCase(alertType)) {
            channelId = CHANNEL_ALERTS_GROUP_ID;
        }

        NotificationCompat.Builder builder = baseNotificationBuilder(channelId)
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

        int notificationId = alertNotificationId(alertId);
        if (alertTag != null && !alertTag.isEmpty()) {
            // (tag, id) identity: re-showing the same conversation updates one
            // tray entry and the JS side can cancel it by key later. The
            // all-clear already cancels by (sbn.getTag(), sbn.getId()).
            manager.notify(alertTag, notificationId, builder.build());
        } else {
            manager.notify(notificationId, builder.build());
        }
    }

    // The ringing notification is CallSession / CallNotifications' now:
    // Accept is an Activity PendingIntent (Android 12+ blocks the old service
    // trampoline) and Decline a broadcast that leaves GO where it is.

    /** Clear tray notifications for Groups / DMs (not the persistent status or transfers). */
    private void dismissChatAlertNotifications() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        try {
            for (android.service.notification.StatusBarNotification sbn :
                    manager.getActiveNotifications()) {
                String channelId = sbn.getNotification().getChannelId();
                if (CHANNEL_ALERTS_PM_ID.equals(channelId)
                        || CHANNEL_ALERTS_GROUP_ID.equals(channelId)
                        || CHANNEL_ALERTS_ID.equals(channelId)) {
                    manager.cancel(sbn.getTag(), sbn.getId());
                }
            }
        } catch (Exception ignored) {
            /* older devices / race — best effort */
        }
    }

    /**
     * Stable per-transfer notification id derived from the transfer id, so
     * progress updates replace in place and the mapping survives process
     * restarts (transfers are hydrated and re-announced after a relaunch).
     */
    private static int notificationIdForTransfer(String transferId) {
        return NOTIFICATION_ID_TRANSFER_BASE + Math.abs(transferId.hashCode() % 900);
    }

    private void showTransferNotification(
        String transferId,
        String title,
        String text,
        int progress,
        boolean ongoing,
        String openUri,
        String openMimeType,
        boolean alert,
        String actionLabel
    ) {
        if (transferId == null || transferId.isEmpty()) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        int notificationId = notificationIdForTransfer(transferId);
        PendingIntent pendingIntent = null;
        Intent viewIntent = buildOpenSavedFileIntent(openUri, openMimeType);
        if (viewIntent != null) {
            pendingIntent = PendingIntent.getActivity(
                this,
                notificationId,
                viewIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
            );
        }
        if (pendingIntent == null) {
            Intent openIntent = new Intent(this, MainActivity.class);
            openIntent.setFlags(
                Intent.FLAG_ACTIVITY_SINGLE_TOP |
                Intent.FLAG_ACTIVITY_CLEAR_TOP |
                Intent.FLAG_ACTIVITY_NEW_TASK
            );
            pendingIntent = PendingIntent.getActivity(
                this,
                notificationId,
                openIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
            );
        }

        NotificationCompat.Builder builder = baseNotificationBuilder(
                alert ? CHANNEL_FILES_SAVED_ID : CHANNEL_TRANSFERS_ID
            )
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(pendingIntent)
            .setOngoing(ongoing)
            .setAutoCancel(!ongoing)
            .setShowWhen(false)
            // A group of its own: Android otherwise folds an app's loose
            // notifications into one quiet bundle, where a finished download
            // is easy to miss.
            .setGroup("qortal_transfer:" + transferId);

        if (viewIntent != null && actionLabel != null && !actionLabel.trim().isEmpty()) {
            builder.addAction(0, actionLabel.trim(), pendingIntent);
        }

        if (alert) {
            // An update to a notification that is already showing never peeks.
            // Take it down first so this one arrives as new and pops up.
            manager.cancel(notificationId);
            builder
                .setOnlyAlertOnce(false)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_STATUS);
        } else {
            builder
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS);
        }

        if (progress >= 0) {
            builder.setProgress(100, Math.min(progress, 100), false);
        } else if (progress == -1) {
            builder.setProgress(0, 0, true);
        }

        manager.notify(notificationId, builder.build());
    }

    /**
     * ACTION_VIEW for a file GO saved, or null when there is nothing to open or
     * nothing on the phone that opens it (the tap then just brings GO up).
     *
     * An app package (.apk and friends) is never opened from here: GO may hold
     * the install-unknown-apps grant for its updater, and a file a Q-App or a
     * peer delivered must not reach the package installer under that grant.
     * Only the updater installs, after its signer, package and version checks
     * (AppUpdatePlugin).
     */
    private Intent buildOpenSavedFileIntent(String rawUri, String mimeType) {
        if (rawUri == null || rawUri.trim().isEmpty()) return null;
        try {
            String value = rawUri.trim();
            Uri uri;
            if (value.startsWith("content://")) {
                uri = Uri.parse(value);
            } else {
                File file = new File(
                    value.startsWith("file://") ? Uri.parse(value).getPath() : value
                );
                if (!file.isFile()) return null;
                uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", file);
            }
            if (SavedFileOpenGuard.isPackageArchive(this, uri, value, null, mimeType)) {
                Log.i(TAG, "saved app package is not opened from the notification");
                return null;
            }
            String type = mimeType;
            if (type == null || type.trim().isEmpty() || "application/octet-stream".equals(type)) {
                String ext = SaveCategory.extensionOf(value);
                String guessed = ext.isEmpty()
                    ? null
                    : MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
                type = guessed != null ? guessed : "*/*";
            }
            type = SavedFileOpenGuard.viewType(this, uri, type);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, type);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (intent.resolveActivity(getPackageManager()) != null) return intent;
            // Nothing claims it by type: let the person pick, rather than a tap
            // that silently does nothing.
            Intent chooser = Intent.createChooser(intent, null);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            return chooser;
        } catch (Exception e) {
            Log.w(TAG, "saved file is not openable from the notification", e);
            return null;
        }
    }

    private void dismissTransferNotification(String transferId) {
        if (transferId == null || transferId.isEmpty()) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        manager.cancel(notificationIdForTransfer(transferId));
    }

    /**
     * Accept / Decline from a ringing notification posted by an older build
     * (its service PendingIntents may still be in the tray after an update).
     * Handled like the new buttons; no activity start from here (Android 12+
     * blocks that trampoline, and Decline must not open GO anyway).
     */
    private void handleIncomingCallAction(Intent intent) {
        String callId = safeString(intent.getStringExtra(EXTRA_CALL_ID), "");
        String action = ACTION_INCOMING_CALL_ACCEPT.equals(intent.getAction())
            ? CallSessionPolicy.ACTION_ACCEPT
            : CallSessionPolicy.ACTION_DECLINE;
        CallSession.get(this).onAction(action, callId, "legacy-notification");
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

        NotificationChannel alertsPmChannel = new NotificationChannel(
            CHANNEL_ALERTS_PM_ID,
            CHANNEL_ALERTS_PM_NAME,
            NotificationManager.IMPORTANCE_HIGH
        );
        alertsPmChannel.setDescription("Private (direct) chat messages");

        NotificationChannel alertsGroupChannel = new NotificationChannel(
            CHANNEL_ALERTS_GROUP_ID,
            CHANNEL_ALERTS_GROUP_NAME,
            NotificationManager.IMPORTANCE_HIGH
        );
        alertsGroupChannel.setDescription("Group chat messages and mentions");

        NotificationChannel transfersChannel = new NotificationChannel(
            CHANNEL_TRANSFERS_ID,
            CHANNEL_TRANSFERS_NAME,
            NotificationManager.IMPORTANCE_LOW
        );
        transfersChannel.setDescription("Reticulum file uploads, downloads and shared files");
        transfersChannel.setShowBadge(false);

        // High so it pops up, but quiet: a finished download is news, not an alarm.
        NotificationChannel filesSavedChannel = new NotificationChannel(
            CHANNEL_FILES_SAVED_ID,
            CHANNEL_FILES_SAVED_NAME,
            NotificationManager.IMPORTANCE_HIGH
        );
        filesSavedChannel.setDescription(
            "A download finished while GO was in the background. Tap to open the file."
        );
        filesSavedChannel.setSound(null, null);
        filesSavedChannel.enableVibration(false);
        filesSavedChannel.setShowBadge(false);

        manager.createNotificationChannel(statusChannel);
        manager.createNotificationChannel(alertsChannel);
        manager.createNotificationChannel(alertsPmChannel);
        manager.createNotificationChannel(alertsGroupChannel);
        manager.createNotificationChannel(transfersChannel);
        // Calls ring on CallNotifications' own channels now ("Calls", "Call in
        // progress"). The old "Incoming calls" category carried nothing any
        // more but still showed in GO's notification settings, where turning
        // it off silenced no call: remove it.
        try {
            if (manager.getNotificationChannel(CHANNEL_CALLS_ID) != null) {
                manager.deleteNotificationChannel(CHANNEL_CALLS_ID);
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Old calls channel not removed", error);
        }
        CallNotifications.ensureChannels(this);
        manager.createNotificationChannel(filesSavedChannel);
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
        startOrUpdate(
            context,
            statusTitle,
            statusDetail,
            statusNodeLabel,
            statusSyncLabel,
            statusPeersLabel,
            "starting"
        );
    }

    public static void startOrUpdate(
        Context context,
        String statusTitle,
        String statusDetail,
        String statusNodeLabel,
        String statusSyncLabel,
        String statusPeersLabel,
        String statusKind
    ) {
        Intent intent = new Intent(context, QortalForegroundService.class);
        intent.setAction(ACTION_UPDATE);
        intent.putExtra(EXTRA_STATUS_TITLE, statusTitle);
        intent.putExtra(EXTRA_STATUS_DETAIL, statusDetail);
        intent.putExtra(EXTRA_STATUS_NODE, statusNodeLabel);
        intent.putExtra(EXTRA_STATUS_SYNC, statusSyncLabel);
        intent.putExtra(EXTRA_STATUS_PEERS, statusPeersLabel);
        intent.putExtra(EXTRA_STATUS_KIND, statusKind);
        lastStatusIntent = new Intent(intent);
        startServiceCompat(context, intent);
    }

    /**
     * The page stops the status service. Not only on logout: the page also
     * unmounts its status setup below its width breakpoint (landscape on
     * phones, tablets), so the hubs are not paused here. A real logout pauses
     * them through ReticulumPlugin.presencePauseNetwork.
     */
    public static void stop(Context context) {
        lastStatusIntent = null;
        cancelPausedNotification(context);
        Intent intent = new Intent(context, QortalForegroundService.class);
        intent.setAction(ACTION_STOP);
        try {
            context.startService(intent);
        } catch (IllegalStateException | SecurityException error) {
            // Background start refused: the service is not running anyway
            // (a running service would make this start allowed).
            Log.w(TAG, "Status service stop not delivered: " + error.getMessage());
        }
    }

    /**
     * GO is on screen again. After a pause (Android's time-out or GO's own
     * battery limit, see pauseUntilOpened) this restarts the status service
     * with the last status the page sent and reconnects the hubs; the page
     * itself kept running (frozen) and needs no restart.
     */
    public static void onAppForeground(Context context) {
        if (!fgsTimedOut) return;
        fgsTimedOut = false;
        cancelPausedNotification(context);
        ReticulumPlugin.resumeNetwork("app_foreground");
        Intent last = lastStatusIntent;
        if (last != null) {
            startServiceCompat(context, new Intent(last));
        }
    }

    private void clearRunningInstance() {
        if (runningInstance == this) runningInstance = null;
    }

    /**
     * Redraw the status notification in-process if what it should say
     * changed (updateStatusNotification skips identical text). Never starts
     * the service; a stopped service has nothing to redraw.
     */
    public static void refreshHonestStatus() {
        mainHandler.post(() -> {
            QortalForegroundService service = runningInstance;
            if (service != null && service.isRunning) {
                service.updateStatusNotification();
            }
        });
    }

    /**
     * A new page loaded in a new WebView (QortalBackgroundPlugin.load). It
     * starts signed out with no engine, so pageGone stays set until the page
     * pushes its status (onPageStatusPushed). On a fresh process pageGone is
     * already false.
     */
    public static void onPageLoaded() {
        // The new page reports its own outbox once its engine runs.
        outboxCount = 0;
        refreshHonestStatus();
    }

    /** The WebView and its chat engine are gone (QortalBackgroundPlugin.handleOnDestroy). */
    public static void onPageGone() {
        pageGone = true;
        refreshHonestStatus();
    }

    /** The page pushed its status: it runs, so the pushed text is live again. */
    public static void onPageStatusPushed() {
        if (!pageGone) return;
        pageGone = false;
        refreshHonestStatus();
    }

    /** Own messages waiting to send; shown while GO is off screen. */
    public static void setOutboxCount(int count) {
        int next = StatusHonesty.clampCount(count);
        if (outboxCount == next) return;
        outboxCount = next;
        refreshHonestStatus();
    }

    /**
     * Stores the page's translations for native-drawn texts (see
     * StatusHonesty.LOCALIZED_KEYS). Persisted, so a frozen page or a
     * restarted process still shows them. Replaces the previous set: a key
     * left out falls back to the English resource. Returns how many were kept.
     */
    public static int setLocalizedStrings(Context context, Map<String, String> strings) {
        SharedPreferences.Editor editor = context
            .getSharedPreferences(PREFS_LOCALIZED, Context.MODE_PRIVATE)
            .edit()
            .clear();
        int kept = 0;
        if (strings != null) {
            for (Map.Entry<String, String> entry : strings.entrySet()) {
                if (!StatusHonesty.isLocalizedKey(entry.getKey())) continue;
                String value = StatusHonesty.sanitize(entry.getValue());
                if (value == null) continue;
                editor.putString(entry.getKey(), value);
                kept++;
            }
        }
        editor.apply();
        refreshHonestStatus();
        return kept;
    }

    /** The page's translation for {@code key}, or {@code fallback}. */
    private static String localizedString(Context context, String key, String fallback) {
        try {
            String value = context
                .getSharedPreferences(PREFS_LOCALIZED, Context.MODE_PRIVATE)
                .getString(key, null);
            return value != null && !value.isEmpty() ? value : fallback;
        } catch (RuntimeException error) {
            return fallback;
        }
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
        showAlert(context, alertId, title, body, iconUrl, fromAddress, alertType, "");
    }

    public static void showAlert(
        Context context,
        int alertId,
        String title,
        String body,
        String iconUrl,
        String fromAddress,
        String alertType,
        String alertTag
    ) {
        Intent intent = new Intent(context, QortalForegroundService.class);
        intent.setAction(ACTION_SHOW_ALERT);
        intent.putExtra(EXTRA_ALERT_ID, alertId);
        intent.putExtra(EXTRA_ALERT_TITLE, title);
        intent.putExtra(EXTRA_ALERT_BODY, body);
        intent.putExtra(EXTRA_ALERT_ICON_URL, iconUrl != null ? iconUrl : "");
        intent.putExtra(EXTRA_ALERT_FROM_ADDRESS, fromAddress != null ? fromAddress : "");
        intent.putExtra(EXTRA_ALERT_TYPE, alertType != null ? alertType : "");
        intent.putExtra(EXTRA_ALERT_TAG, alertTag != null ? alertTag : "");
        startServiceCompat(context, intent);
    }

    /**
     * QortalBackground.showIncomingCallNotification (the page's older call
     * bridge). The ring is CallSession's: posted directly (no service start,
     * which Android refuses from the background), only while GO is off
     * screen or locked, with the ringtone and Accept that opens GO.
     */
    public static void showIncomingCall(
        Context context,
        String callId,
        String fromAddress,
        String fromName
    ) {
        CallSession.get(context).showIncomingFromPage(
            callId,
            fromAddress,
            fromName,
            null,
            false,
            CallSession.SOURCE_LEGACY
        );
    }

    public static void dismissChatAlerts(Context context) {
        Intent intent = new Intent(context, QortalForegroundService.class);
        intent.setAction(ACTION_DISMISS_CHAT_ALERTS);
        context.startService(intent);
    }

    /** QortalBackground.dismissIncomingCallNotification: ends a ring the page confirmed (see CallSession). */
    public static void dismissIncomingCall(Context context) {
        CallSession.get(context).cancelIncomingFromPage(null, "legacy-dismiss");
    }

    public static void updateTransfer(
        Context context,
        String transferId,
        String title,
        String text,
        int progress,
        boolean ongoing
    ) {
        updateTransfer(
            context, transferId, title, text, progress, ongoing, null, null, false, null
        );
    }

    public static void updateTransfer(
        Context context,
        String transferId,
        String title,
        String text,
        int progress,
        boolean ongoing,
        String openUri,
        String openMimeType,
        boolean alert,
        String actionLabel
    ) {
        Intent intent = new Intent(context, QortalForegroundService.class);
        intent.setAction(ACTION_UPDATE_TRANSFER);
        intent.putExtra(EXTRA_TRANSFER_ID, transferId);
        intent.putExtra(EXTRA_TRANSFER_TITLE, title);
        intent.putExtra(EXTRA_TRANSFER_TEXT, text);
        intent.putExtra(EXTRA_TRANSFER_PROGRESS, progress);
        intent.putExtra(EXTRA_TRANSFER_ONGOING, ongoing);
        intent.putExtra(EXTRA_TRANSFER_OPEN_URI, openUri);
        intent.putExtra(EXTRA_TRANSFER_OPEN_MIME, openMimeType);
        intent.putExtra(EXTRA_TRANSFER_ALERT, alert);
        intent.putExtra(EXTRA_TRANSFER_ACTION_LABEL, actionLabel);
        startServiceCompat(context, intent);
    }

    public static void dismissTransfer(Context context, String transferId) {
        Intent intent = new Intent(context, QortalForegroundService.class);
        intent.setAction(ACTION_DISMISS_TRANSFER);
        intent.putExtra(EXTRA_TRANSFER_ID, transferId);
        context.startService(intent);
    }

    private static void startServiceCompat(Context context, Intent intent) {
        if (fgsTimedOut) {
            if (isAppInForeground()) {
                // Opening GO ends the pause (and resets Android's time limit).
                onAppForeground(context);
            } else {
                // A foreground start would be refused and crash the app. A
                // plain start still delivers the intent (the service then
                // posts and stops) when Android allows it; otherwise it is
                // dropped, as the page is frozen and the hubs are paused.
                try {
                    context.startService(intent);
                } catch (IllegalStateException | SecurityException error) {
                    Log.w(TAG, "Service start after time-out refused: " + error.getMessage());
                }
                return;
            }
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (IllegalStateException | SecurityException error) {
            // ForegroundServiceStartNotAllowedException (API 31+) is an
            // IllegalStateException: GO is in the background without an
            // exemption. The next update from the foreground starts it.
            Log.w(TAG, "Foreground service start refused: " + error.getMessage());
        }
    }

    private static boolean isAppInForeground() {
        ActivityManager.RunningAppProcessInfo info = new ActivityManager.RunningAppProcessInfo();
        ActivityManager.getMyMemoryState(info);
        return info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND;
    }
}
