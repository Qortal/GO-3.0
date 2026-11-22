package com.github.Qortal.qortalMobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * The background player notification's buttons on Android 12 and older
 * (13+ sends them through the media session) and its swipe-away. Not
 * exported: only GO's own PendingIntents reach it.
 */
public class QortalMediaActionReceiver extends BroadcastReceiver {
    static final String ACTION_PLAY = "com.github.Qortal.qortalMobile.media.PLAY";
    static final String ACTION_PAUSE = "com.github.Qortal.qortalMobile.media.PAUSE";
    static final String ACTION_TOGGLE = "com.github.Qortal.qortalMobile.media.TOGGLE";
    static final String ACTION_NEXT = "com.github.Qortal.qortalMobile.media.NEXT";
    static final String ACTION_PREVIOUS = "com.github.Qortal.qortalMobile.media.PREVIOUS";
    static final String ACTION_DISMISS = "com.github.Qortal.qortalMobile.media.DISMISS";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        GoMediaHub.get(context).onButton(intent.getAction());
    }
}
