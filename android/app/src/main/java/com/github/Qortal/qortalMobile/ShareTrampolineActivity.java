package com.github.Qortal.qortalMobile;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import java.util.ArrayList;

/**
 * Target of the share-sheet aliases ("Quitter" / "Torq" for the Home
 * composer, "GO Groups" / "GO DMs" / "GO Self-DM" for chats). It hands the
 * share on to MainActivity and closes at once.
 *
 * Why not point the aliases at MainActivity: a share that cold-starts GO
 * would make the alias the root of GO's task, and switching the composer
 * between Quitter and Torq disables that alias — Android then finishes every
 * activity started through it, closing GO in the user's hands. Started from
 * here, MainActivity's task always belongs to MainActivity itself.
 *
 * Only the share itself is passed on (action, type, the shared streams, and
 * for chats the shared text), never the rest of another app's intent. Which
 * entry was used comes from the alias that started this activity, never from
 * the sender's extras.
 */
public class ShareTrampolineActivity extends Activity {
    /** Longest shared text passed on (a chat message holds far less). */
    private static final int MAX_TEXT_CHARS = 64 * 1024;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            Intent forward = buildForward(getIntent());
            if (forward != null) startActivity(forward);
        } catch (Exception ignored) {
            // A malformed share: nothing to hand over.
        }
        finish();
    }

    /** "composer", "rev" or one of the chat targets, after the alias. */
    private String entryTarget(Intent share) {
        ComponentName component = share.getComponent();
        String alias = component != null ? component.getClassName() : "";
        if (alias.endsWith(".GroupsShareActivity")) return ShareReceiverPlugin.TARGET_CHATS_GROUPS;
        if (alias.endsWith(".DirectsShareActivity")) return ShareReceiverPlugin.TARGET_CHATS_DIRECTS;
        if (alias.endsWith(".SelfShareActivity")) return ShareReceiverPlugin.TARGET_CHATS_SELF;
        if (alias.endsWith(".TorqRevShareActivity")) return ShareReceiverPlugin.TARGET_REV;
        return ShareReceiverPlugin.TARGET_COMPOSER;
    }

    private Intent buildForward(Intent share) {
        if (share == null) return null;
        String action = share.getAction();
        String target = entryTarget(share);
        boolean chat = ShareReceiverPlugin.isChatTarget(target);
        Intent forward = new Intent(action);
        forward.setComponent(new ComponentName(this, MainActivity.class));
        forward.setType(share.getType());
        boolean hasStream = false;
        if (Intent.ACTION_SEND.equals(action)) {
            Uri stream = share.getParcelableExtra(Intent.EXTRA_STREAM);
            if (stream != null) {
                forward.putExtra(Intent.EXTRA_STREAM, stream);
                hasStream = true;
            }
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> streams =
                share.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (streams != null && !streams.isEmpty()) {
                forward.putParcelableArrayListExtra(Intent.EXTRA_STREAM, streams);
                hasStream = true;
            }
        } else {
            return null;
        }
        boolean hasText = false;
        if (chat) {
            // Links and text from browsers and other apps.
            String text = boundedText(share.getCharSequenceExtra(Intent.EXTRA_TEXT));
            String subject = boundedText(share.getCharSequenceExtra(Intent.EXTRA_SUBJECT));
            if (text != null) forward.putExtra(Intent.EXTRA_TEXT, text);
            if (subject != null) forward.putExtra(Intent.EXTRA_SUBJECT, subject);
            hasText = text != null || subject != null;
        }
        if (!hasStream && !hasText) return null;
        forward.putExtra(ShareReceiverPlugin.EXTRA_SHARE_TARGET, target);
        // startActivity copies the streams into ClipData; this flag passes on
        // the read grant this activity received for them.
        forward.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION
        );
        return forward;
    }

    private static String boundedText(CharSequence value) {
        if (value == null) return null;
        String text = value.toString();
        if (text.trim().isEmpty()) return null;
        return text.length() > MAX_TEXT_CHARS ? text.substring(0, MAX_TEXT_CHARS) : text;
    }
}
