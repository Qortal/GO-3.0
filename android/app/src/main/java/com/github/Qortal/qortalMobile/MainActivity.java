package com.github.Qortal.qortalMobile;

import com.github.Qortal.qortalMobile.QortalBiometricPlugin;
import com.getcapacitor.BridgeActivity;
import com.github.Qortal.qortalMobile.NativeBcrypt;
import com.github.Qortal.qortalMobile.NativePOW;
import com.github.Qortal.qortalMobile.FileWriter;
import com.github.Qortal.qortalMobile.EncryptedMediaServerPlugin;
import com.github.Qortal.qortalMobile.ChromecastPlugin;
import com.github.Qortal.qortalMobile.NetworkInfoPlugin;
import com.github.Qortal.qortalMobile.ProxyServerPlugin;
import com.github.Qortal.qortalMobile.ForegroundServicePlugin;
import com.github.Qortal.qortalMobile.ReticulumPlugin;
import com.github.Qortal.qortalMobile.AudioRoutingPlugin;
import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final int CALL_PERMISSIONS_REQUEST_CODE = 0x5101;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeBcrypt.class);
        registerPlugin(NativePOW.class);
        registerPlugin(FileWriter.class);
        registerPlugin(EncryptedMediaServerPlugin.class);
        registerPlugin(ChromecastPlugin.class);
        registerPlugin(NetworkInfoPlugin.class);
        registerPlugin(ProxyServerPlugin.class);
        registerPlugin(ForegroundServicePlugin.class);
        registerPlugin(QortalBackgroundPlugin.class);
        registerPlugin(ReticulumPlugin.class);
        registerPlugin(AudioRoutingPlugin.class);
        registerPlugin(QortalBiometricPlugin.class);
        super.onCreate(savedInstanceState);

        // ✅ Enable mixed content mode for WebView
        if (this.bridge != null) {
            WebView webView = this.bridge.getWebView();
            if (webView != null) {
                WebSettings webSettings = webView.getSettings();
                webSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
                webSettings.setMediaPlaybackRequiresUserGesture(false);
            }
        }

        // Request voice-call permissions up front so the WebView's getUserMedia()
        // is allowed during a call. Android grants the WebView mic access only when
        // the host app already holds RECORD_AUDIO at runtime.
        requestCallPermissions();
    }

    private void requestCallPermissions() {
        List<String> needed = new ArrayList<>();
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.RECORD_AUDIO);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (!needed.isEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                needed.toArray(new String[0]),
                CALL_PERMISSIONS_REQUEST_CODE
            );
        }
    }
}
