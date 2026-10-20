package com.github.Qortal.qortalMobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Decline, Hang up, Mute and Unmute from the call notifications. These stay
 * in the background (no activity start, so no notification trampoline) and
 * reach the page through {@link CallSession} (QortalCall 'callAction').
 * Not exported: only GO's own PendingIntents (explicit component) reach it.
 */
public class CallActionReceiver extends BroadcastReceiver {
    private static final String TAG = "QortalCallAction";
    /** Prefix of the intent action; the call action is appended so each PendingIntent is distinct. */
    public static final String ACTION_CALL_NOTIFICATION =
        "com.github.Qortal.qortalMobile.CALL_NOTIFICATION_ACTION";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;
        String action = CallSessionPolicy.parseAction(
            intent.getStringExtra(QortalForegroundService.EXTRA_CALL_ACTION)
        );
        if (action == null) {
            Log.w(TAG, "Unknown call action ignored");
            return;
        }
        String callId = intent.getStringExtra(QortalForegroundService.EXTRA_CALL_ID);
        String source = intent.getStringExtra(CallNotifications.EXTRA_CALL_SOURCE);
        CallSession.get(context).onAction(
            action,
            callId,
            source != null ? source : CallNotifications.SOURCE_NOTIFICATION
        );
    }
}
