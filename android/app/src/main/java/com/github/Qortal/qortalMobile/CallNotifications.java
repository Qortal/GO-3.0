package com.github.Qortal.qortalMobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.media.AudioAttributes;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import androidx.core.graphics.drawable.IconCompat;

import java.util.Map;

/**
 * The two call notifications: the ringing one (incoming call, ringtone,
 * full-screen on the lock screen) and the ongoing one (the call's foreground
 * service notification with Mute and Hang up). Built with
 * NotificationCompat.CallStyle, which is the system call layout on Android
 * 12+ and a plain notification with the same buttons before.
 *
 * Accept and the notification body open GO (Activity PendingIntents, no
 * service trampoline: Android 12+ blocks those). Decline, Hang up and Mute
 * go to {@link CallActionReceiver} and leave GO where it is.
 */
public final class CallNotifications {
    private static final String TAG = "QortalCallNotify";

    /** Ringing: ringtone + vibration, looping (FLAG_INSISTENT) until answered. New id: channels never change after creation. */
    public static final String CHANNEL_RING_ID = "qortal_calls_v2";
    /** The call in progress: silent, shows the call chip in the status bar. */
    public static final String CHANNEL_ONGOING_ID = "qortal_call_ongoing";

    public static final int NOTIFICATION_ID_RING = QortalForegroundService.NOTIFICATION_ID_INCOMING_CALL;
    public static final int NOTIFICATION_ID_ONGOING = 2004;

    public static final String EXTRA_CALL_SOURCE = "call_source";
    /** Wall clock when the notification carrying the intent was built (replays from recents are old). */
    public static final String EXTRA_CALL_POSTED_AT = "call_posted_at";
    public static final String SOURCE_NOTIFICATION = "notification";

    /** Translations the page may hand over (QortalCall.setStrings); else the app's resources. */
    private static final String PREFS_STRINGS = "qortal_call_strings";
    public static final String[] STRING_KEYS = {
        "call_incoming_title",
        "call_incoming_text",
        "call_action_accept",
        "call_action_decline",
        "call_action_hang_up",
        "call_action_leave",
        "call_action_mute",
        "call_action_unmute",
        "call_status_calling",
        "call_status_connecting",
        "call_status_ongoing",
        "call_status_group",
        "call_status_muted",
        "call_unknown_caller",
    };

    /** Longest data: URL accepted for an avatar (a small thumbnail is a few KB). */
    private static final int MAX_AVATAR_DATA_URL_CHARS = 700_000;
    private static final int AVATAR_SIZE_PX = 256;

    private CallNotifications() {}

    /** Everything the ringing notification shows. */
    public static final class RingSpec {
        public String callId;
        public String fromAddress;
        public String name;
        public String avatarDataUrl;
        public boolean group;
        /** Post without sound or vibration (the user pressed power to silence it). */
        public boolean silent;
        /** Re-post of a ring already shown: never alert again. */
        public boolean update;
    }

    /** Everything the ongoing notification shows. */
    public static final class OngoingSpec {
        public String callId;
        public String kind;
        /** calling | connecting | connected (page phases; anything else = connected). */
        public String phase;
        public String peerName;
        public String avatarDataUrl;
        public boolean muted;
        /** Wall-clock start of the connected call for the chronometer, 0 = none. */
        public long connectedAtMs;
    }

    public static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        try {
            if (manager.getNotificationChannel(CHANNEL_RING_ID) == null) {
                NotificationChannel ring = new NotificationChannel(
                    CHANNEL_RING_ID,
                    context.getString(R.string.call_channel_ringing_name),
                    NotificationManager.IMPORTANCE_HIGH
                );
                ring.setDescription(context.getString(R.string.call_channel_ringing_description));
                AudioAttributes attributes = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
                // The user's own ringtone, whatever it is when the call comes.
                ring.setSound(Settings.System.DEFAULT_RINGTONE_URI, attributes);
                ring.enableVibration(true);
                ring.setVibrationPattern(new long[] {0L, 1000L, 1000L});
                ring.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                ring.setShowBadge(false);
                manager.createNotificationChannel(ring);
            }
            if (manager.getNotificationChannel(CHANNEL_ONGOING_ID) == null) {
                NotificationChannel ongoing = new NotificationChannel(
                    CHANNEL_ONGOING_ID,
                    context.getString(R.string.call_channel_ongoing_name),
                    NotificationManager.IMPORTANCE_DEFAULT
                );
                ongoing.setDescription(context.getString(R.string.call_channel_ongoing_description));
                ongoing.setSound(null, null);
                ongoing.enableVibration(false);
                ongoing.setShowBadge(false);
                ongoing.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                manager.createNotificationChannel(ongoing);
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Call notification channels not created", error);
        }
    }

    // ── Strings ─────────────────────────────────────────────────────────────

    public static boolean isStringKey(String key) {
        if (key == null) return false;
        for (String known : STRING_KEYS) {
            if (known.equals(key)) return true;
        }
        return false;
    }

    /** Stores the page's translations (replaces the previous set). Returns how many were kept. */
    public static int setStrings(Context context, Map<String, String> strings) {
        SharedPreferences.Editor editor = context
            .getSharedPreferences(PREFS_STRINGS, Context.MODE_PRIVATE)
            .edit()
            .clear();
        int kept = 0;
        if (strings != null) {
            for (Map.Entry<String, String> entry : strings.entrySet()) {
                if (!isStringKey(entry.getKey())) continue;
                String value = StatusHonesty.sanitize(entry.getValue());
                if (value == null) continue;
                editor.putString(entry.getKey(), value);
                kept++;
            }
        }
        editor.apply();
        return kept;
    }

    /** The page's translation for a call string, else the resource (system language). */
    public static String text(Context context, String key, int resId) {
        try {
            String value = context
                .getSharedPreferences(PREFS_STRINGS, Context.MODE_PRIVATE)
                .getString(key, null);
            if (value != null && !value.isEmpty()) return value;
        } catch (RuntimeException ignored) {
            // Fall back to the resource.
        }
        return context.getString(resId);
    }

    // ── Intents ─────────────────────────────────────────────────────────────

    /**
     * The PendingIntent for a call action: Accept and open bring GO up
     * (Activity), the rest are handled in the background (broadcast).
     */
    public static PendingIntent actionIntent(Context context, String action, String callId) {
        return CallSessionPolicy.opensActivity(action)
            ? activityIntent(context, action, callId)
            : broadcastIntent(context, action, callId);
    }

    /** Accept / open: brings GO up (over the lock screen while a call rings or runs). */
    public static PendingIntent activityIntent(Context context, String action, String callId) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(
            Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_NEW_TASK
        );
        intent.putExtra(QortalForegroundService.EXTRA_CALL_ID, callId != null ? callId : "");
        intent.putExtra(QortalForegroundService.EXTRA_CALL_ACTION, action);
        intent.putExtra(EXTRA_CALL_SOURCE, SOURCE_NOTIFICATION);
        intent.putExtra(EXTRA_CALL_POSTED_AT, System.currentTimeMillis());
        return PendingIntent.getActivity(
            context,
            CallSessionPolicy.requestCode(action),
            intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
    }

    /** Decline / hang up / mute: handled in the background, GO stays where it is. */
    public static PendingIntent broadcastIntent(Context context, String action, String callId) {
        Intent intent = new Intent(context, CallActionReceiver.class);
        intent.setAction(CallActionReceiver.ACTION_CALL_NOTIFICATION + "." + action);
        intent.putExtra(QortalForegroundService.EXTRA_CALL_ID, callId != null ? callId : "");
        intent.putExtra(QortalForegroundService.EXTRA_CALL_ACTION, action);
        intent.putExtra(EXTRA_CALL_SOURCE, SOURCE_NOTIFICATION);
        return PendingIntent.getBroadcast(
            context,
            CallSessionPolicy.requestCode(action),
            intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
    }

    // ── Ringing ─────────────────────────────────────────────────────────────

    public static Notification buildIncoming(Context context, RingSpec spec) {
        ensureChannels(context);
        String unknown = text(context, "call_unknown_caller", R.string.call_unknown_caller);
        String name = spec.name != null && !spec.name.trim().isEmpty()
            ? spec.name.trim()
            : (spec.fromAddress != null && !spec.fromAddress.isEmpty()
                ? CallSessionPolicy.shortAddress(spec.fromAddress)
                : unknown);
        String title = text(context, "call_incoming_title", R.string.call_incoming_title);
        String subtitle = text(context, "call_incoming_text", R.string.call_incoming_text);

        Bitmap avatar = decodeAvatar(spec.avatarDataUrl);
        Person caller = person(name, avatar);

        PendingIntent open = actionIntent(context, CallSessionPolicy.ACTION_OPEN, spec.callId);
        PendingIntent accept = actionIntent(context, CallSessionPolicy.ACTION_ACCEPT, spec.callId);
        PendingIntent decline = actionIntent(context, CallSessionPolicy.ACTION_DECLINE, spec.callId);

        NotificationCompat.Builder builder = baseBuilder(context, CHANNEL_RING_ID)
            .setContentTitle(name)
            .setContentText(title)
            .setSubText(subtitle)
            .setContentIntent(open)
            .setOngoing(true)
            .setAutoCancel(false)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setTimeoutAfter(CallSessionPolicy.RING_TIMEOUT_MS)
            .setOnlyAlertOnce(spec.update)
            .addPerson(caller);
        if (avatar != null) builder.setLargeIcon(avatar);
        if (spec.silent) builder.setSilent(true);
        // Full screen on a locked or dark phone (Android 14+ may refuse it:
        // then it is a heads-up, see QortalCall.canUseFullScreenIntent).
        builder.setFullScreenIntent(open, true);
        try {
            builder.setStyle(
                NotificationCompat.CallStyle.forIncomingCall(caller, decline, accept)
            );
        } catch (RuntimeException error) {
            // A style the system refuses must not lose the call: plain buttons.
            Log.w(TAG, "CallStyle (incoming) refused; plain actions", error);
            builder.addAction(
                R.drawable.ic_call_decline,
                text(context, "call_action_decline", R.string.call_action_decline),
                decline
            );
            builder.addAction(
                R.drawable.ic_call_accept,
                text(context, "call_action_accept", R.string.call_action_accept),
                accept
            );
        }
        Notification notification = builder.build();
        if (!spec.silent) notification.flags |= Notification.FLAG_INSISTENT;
        return notification;
    }

    /** Posts (or replaces) the ringing notification. Returns false when Android refused it. */
    public static boolean postIncoming(Context context, RingSpec spec) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return false;
        try {
            manager.notify(NOTIFICATION_ID_RING, buildIncoming(context, spec));
            return true;
        } catch (RuntimeException error) {
            Log.w(TAG, "Ringing notification not posted", error);
            return false;
        }
    }

    public static void cancelIncoming(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        try {
            manager.cancel(NOTIFICATION_ID_RING);
        } catch (RuntimeException error) {
            Log.w(TAG, "Ringing notification not cancelled", error);
        }
    }

    // ── Ongoing ─────────────────────────────────────────────────────────────

    /**
     * The call's notification. {@code asForeground}: it is the foreground
     * service's notification (CallStyle allowed). A plain notification
     * posted outside the service must not use CallStyle on Android 12+ (the
     * system rejects it without a full-screen intent).
     */
    public static Notification buildOngoing(Context context, OngoingSpec spec, boolean asForeground) {
        ensureChannels(context);
        boolean group = CallRoutePolicy.KIND_GROUP.equals(spec.kind);
        String unknown = text(context, "call_unknown_caller", R.string.call_unknown_caller);
        String name = spec.peerName != null && !spec.peerName.trim().isEmpty()
            ? spec.peerName.trim()
            : unknown;
        String status;
        if ("calling".equals(spec.phase)) {
            status = text(context, "call_status_calling", R.string.call_status_calling);
        } else if ("connecting".equals(spec.phase) || "joining".equals(spec.phase)) {
            status = text(context, "call_status_connecting", R.string.call_status_connecting);
        } else if (group) {
            status = text(context, "call_status_group", R.string.call_status_group);
        } else {
            status = text(context, "call_status_ongoing", R.string.call_status_ongoing);
        }
        if (spec.muted) {
            status = status + " · " + text(context, "call_status_muted", R.string.call_status_muted);
        }

        Bitmap avatar = decodeAvatar(spec.avatarDataUrl);
        Person peer = person(name, avatar);
        PendingIntent open = actionIntent(context, CallSessionPolicy.ACTION_OPEN, spec.callId);
        PendingIntent hangUp = actionIntent(context, CallSessionPolicy.ACTION_HANGUP, spec.callId);
        String muteAction = spec.muted ? CallSessionPolicy.ACTION_UNMUTE : CallSessionPolicy.ACTION_MUTE;
        PendingIntent mute = actionIntent(context, muteAction, spec.callId);
        String muteLabel = spec.muted
            ? text(context, "call_action_unmute", R.string.call_action_unmute)
            : text(context, "call_action_mute", R.string.call_action_mute);
        String hangUpLabel = group
            ? text(context, "call_action_leave", R.string.call_action_leave)
            : text(context, "call_action_hang_up", R.string.call_action_hang_up);

        NotificationCompat.Builder builder = baseBuilder(context, CHANNEL_ONGOING_ID)
            .setContentTitle(name)
            .setContentText(status)
            .setContentIntent(open)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addPerson(peer);
        if (avatar != null) builder.setLargeIcon(avatar);
        if (spec.connectedAtMs > 0) {
            builder.setWhen(spec.connectedAtMs).setShowWhen(true).setUsesChronometer(true);
        } else {
            builder.setShowWhen(false);
        }
        NotificationCompat.Action muteButton = new NotificationCompat.Action.Builder(
            spec.muted ? R.drawable.ic_call_mic : R.drawable.ic_call_mic_off,
            muteLabel,
            mute
        ).build();
        boolean styled = false;
        if (asForeground) {
            try {
                builder.setStyle(NotificationCompat.CallStyle.forOngoingCall(peer, hangUp));
                builder.addAction(muteButton);
                styled = true;
            } catch (RuntimeException error) {
                Log.w(TAG, "CallStyle (ongoing) refused; plain actions", error);
            }
        }
        if (!styled) {
            builder.addAction(muteButton);
            builder.addAction(R.drawable.ic_call_decline, hangUpLabel, hangUp);
        }
        return builder.build();
    }

    /** Fallback when the service could not show the call: a plain tray entry. */
    public static void postOngoingPlain(Context context, OngoingSpec spec) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        try {
            manager.notify(NOTIFICATION_ID_ONGOING, buildOngoing(context, spec, false));
        } catch (RuntimeException error) {
            Log.w(TAG, "Ongoing call notification not posted", error);
        }
    }

    public static void cancelOngoing(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        try {
            manager.cancel(NOTIFICATION_ID_ONGOING);
        } catch (RuntimeException error) {
            Log.w(TAG, "Ongoing call notification not cancelled", error);
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private static NotificationCompat.Builder baseBuilder(Context context, String channelId) {
        int brandColor = context.getResources().getColor(R.color.qortal_brand, context.getTheme());
        return new NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_stat_qortal)
            .setColor(brandColor);
    }

    private static Person person(String name, Bitmap avatar) {
        Person.Builder builder = new Person.Builder()
            .setName(name != null && !name.isEmpty() ? name : "?")
            .setImportant(true);
        if (avatar != null) builder.setIcon(IconCompat.createWithBitmap(avatar));
        return builder.build();
    }

    /** A data: URL (or bare base64) image from the page, as a round bitmap; null when unusable. */
    static Bitmap decodeAvatar(String dataUrl) {
        if (dataUrl == null || dataUrl.isEmpty() || dataUrl.length() > MAX_AVATAR_DATA_URL_CHARS) {
            return null;
        }
        try {
            String payload = dataUrl.trim();
            if (payload.startsWith("data:")) {
                if (!payload.startsWith("data:image/")) return null;
                int comma = payload.indexOf(',');
                if (comma < 0) return null;
                payload = payload.substring(comma + 1);
            }
            byte[] bytes = Base64.decode(payload, Base64.DEFAULT);
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
            BitmapFactory.Options options = new BitmapFactory.Options();
            int sample = 1;
            while (bounds.outWidth / (sample * 2) >= AVATAR_SIZE_PX
                && bounds.outHeight / (sample * 2) >= AVATAR_SIZE_PX) {
                sample *= 2;
            }
            options.inSampleSize = sample;
            Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
            return bitmap != null ? toCircle(bitmap) : null;
        } catch (RuntimeException error) {
            Log.w(TAG, "Call avatar not decoded: " + error.getClass().getSimpleName());
            return null;
        }
    }

    private static Bitmap toCircle(Bitmap source) {
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
}
