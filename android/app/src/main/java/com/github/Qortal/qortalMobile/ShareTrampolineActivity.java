package com.github.Qortal.qortalMobile;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import java.util.ArrayList;

/**
 * Target of the "Quitter" / "Torq" share-sheet aliases. It hands the share
 * on to MainActivity and closes at once.
 *
 * Why not point the aliases at MainActivity: a share that cold-starts GO
 * would make the alias the root of GO's task, and switching the composer
 * between Quitter and Torq disables that alias — Android then finishes every
 * activity started through it, closing GO in the user's hands. Started from
 * here, MainActivity's task always belongs to MainActivity itself.
 *
 * Only the share itself is passed on (action, type, the shared streams), never
 * the rest of another app's intent.
 */
public class ShareTrampolineActivity extends Activity {
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

    private Intent buildForward(Intent share) {
        if (share == null) return null;
        String action = share.getAction();
        Intent forward = new Intent(action);
        forward.setComponent(new ComponentName(this, MainActivity.class));
        forward.setType(share.getType());
        if (Intent.ACTION_SEND.equals(action)) {
            Uri stream = share.getParcelableExtra(Intent.EXTRA_STREAM);
            if (stream == null) return null;
            forward.putExtra(Intent.EXTRA_STREAM, stream);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> streams =
                share.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (streams == null || streams.isEmpty()) return null;
            forward.putParcelableArrayListExtra(Intent.EXTRA_STREAM, streams);
        } else {
            return null;
        }
        // startActivity copies the streams into ClipData; this flag passes on
        // the read grant this activity received for them.
        forward.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION
        );
        return forward;
    }
}
