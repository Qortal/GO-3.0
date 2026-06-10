package com.github.Qortal.qortalMobile;

import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Shows {@link BiometricPrompt} on {@link MainActivity} so under-display fingerprint
 * sensors work reliably (separate transparent AuthActivity breaks many devices).
 */
@CapacitorPlugin(name = "QortalBiometric")
public class QortalBiometricPlugin extends Plugin {

  private static final String CANCEL_LABEL = "Cancel";

  @PluginMethod
  public void isAvailable(PluginCall call) {
    try {
      BiometricManager manager = BiometricManager.from(getContext());
      int result;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        result = manager.canAuthenticate(
          BiometricManager.Authenticators.BIOMETRIC_STRONG
            | BiometricManager.Authenticators.BIOMETRIC_WEAK
        );
      } else {
        @SuppressWarnings("deprecation")
        int legacyResult = manager.canAuthenticate();
        result = legacyResult;
      }

      JSObject ret = new JSObject();
      ret.put("isAvailable", result == BiometricManager.BIOMETRIC_SUCCESS);
      ret.put("errorCode", result);
      call.resolve(ret);
    } catch (Exception e) {
      JSObject ret = new JSObject();
      ret.put("isAvailable", false);
      ret.put("errorCode", -1);
      call.resolve(ret);
    }
  }

  @PluginMethod
  public void verify(PluginCall call) {
    FragmentActivity activity = getActivity() instanceof FragmentActivity
      ? (FragmentActivity) getActivity()
      : null;

    if (activity == null || activity.isFinishing()) {
      call.reject("Activity is not available");
      return;
    }

    final String title = call.getString("title", "Biometric unlock");
    final String subtitle = call.getString("subtitle", "Qortal Go");
    final String description = call.getString(
      "description",
      "Place your finger on the sensor"
    );
    final String negativeButtonText = call.getString(
      "negativeButtonText",
      CANCEL_LABEL
    );

    call.setKeepAlive(true);
    final AtomicBoolean settled = new AtomicBoolean(false);

    activity.runOnUiThread(() -> {
      new Handler(Looper.getMainLooper()).postDelayed(() -> {
        if (activity.isFinishing() || settled.get()) {
          safeReject(call, settled, "Activity is not available");
          return;
        }

        try {
          Executor executor = ContextCompat.getMainExecutor(getContext());
          BiometricPrompt.PromptInfo promptInfo = buildPromptInfo(
            title,
            subtitle,
            description,
            negativeButtonText
          );

          BiometricPrompt biometricPrompt = new BiometricPrompt(
            activity,
            executor,
            new BiometricPrompt.AuthenticationCallback() {
              @Override
              public void onAuthenticationError(
                int errorCode,
                @NonNull CharSequence errString
              ) {
                if (
                  errorCode == BiometricPrompt.ERROR_USER_CANCELED
                    || errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                    || errorCode == BiometricPrompt.ERROR_CANCELED
                ) {
                  safeReject(call, settled, "cancelled");
                } else {
                  safeReject(call, settled, errString.toString());
                }
              }

              @Override
              public void onAuthenticationSucceeded(
                @NonNull BiometricPrompt.AuthenticationResult result
              ) {
                safeResolve(call, settled);
              }

              @Override
              public void onAuthenticationFailed() {
                // Keep the prompt open; user can retry until they cancel.
              }
            }
          );

          biometricPrompt.authenticate(promptInfo);
        } catch (Exception e) {
          safeReject(call, settled, "Biometric prompt failed: " + e.getMessage());
        }
      }, 250);
    });
  }

  private BiometricPrompt.PromptInfo buildPromptInfo(
    String title,
    String subtitle,
    String description,
    String negativeButtonText
  ) {
    final String cancelLabel =
      negativeButtonText == null || negativeButtonText.trim().isEmpty()
        ? CANCEL_LABEL
        : negativeButtonText.trim();

    BiometricPrompt.PromptInfo.Builder builder =
      new BiometricPrompt.PromptInfo.Builder()
        .setTitle(title)
        .setNegativeButtonText(cancelLabel);

    if (subtitle != null && !subtitle.isEmpty()) {
      builder.setSubtitle(subtitle);
    }
    if (description != null && !description.isEmpty()) {
      builder.setDescription(description);
    }

    return builder.build();
  }

  private void safeResolve(PluginCall call, AtomicBoolean settled) {
    if (settled.compareAndSet(false, true)) {
      call.resolve();
    }
  }

  private void safeReject(
    PluginCall call,
    AtomicBoolean settled,
    String message
  ) {
    if (settled.compareAndSet(false, true)) {
      call.reject(message);
    }
  }
}
