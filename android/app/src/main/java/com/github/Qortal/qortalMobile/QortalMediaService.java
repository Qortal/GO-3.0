package com.github.Qortal.qortalMobile;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

/**
 * The background player's foreground service (type mediaPlayback), with the
 * player notification as its notification. It runs only while something
 * plays: on pause it leaves the foreground and stops, and the notification
 * stays as a plain one the user can swipe away (like Android's own players).
 * {@link GoMediaHub} owns the notification and starts this again on Play.
 */
public class QortalMediaService extends Service {
    private static final String TAG = "QortalMedia";

    private static volatile QortalMediaService running;
    private static volatile boolean foreground;

    static boolean isForeground() {
        return running != null && foreground;
    }

    /** Leave the foreground but keep the notification (paused). */
    static void detach() {
        QortalMediaService service = running;
        if (service == null) return;
        service.leaveForeground(false);
    }

    /** Stop and take the notification away (nothing to show any more). */
    static void stop(Context context) {
        QortalMediaService service = running;
        if (service != null) service.leaveForeground(true);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = this;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        GoMediaHub hub = GoMediaHub.get(this);
        // startForegroundService requires startForeground within seconds,
        // even when playback paused in between: always take it, then leave.
        Notification notification = hub.serviceNotification();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(GoMediaHub.NOTIFICATION_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(GoMediaHub.NOTIFICATION_ID, notification);
            }
            foreground = true;
        } catch (RuntimeException e) {
            Log.w(TAG, "Media foreground service refused: " + e);
            foreground = false;
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!hub.shouldStayForeground()) leaveForeground(false);
        return START_NOT_STICKY;
    }

    private void leaveForeground(boolean removeNotification) {
        try {
            stopForeground(removeNotification ? STOP_FOREGROUND_REMOVE : STOP_FOREGROUND_DETACH);
        } catch (RuntimeException ignored) {
            /* not in the foreground */
        }
        foreground = false;
        stopSelf();
    }

    /** GO was swiped away from recents: its page and media are gone. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        GoMediaHub.get(this).onPageGone();
    }

    @Override
    public void onDestroy() {
        if (running == this) running = null;
        foreground = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
