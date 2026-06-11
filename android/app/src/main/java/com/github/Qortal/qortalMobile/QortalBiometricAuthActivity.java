package com.github.Qortal.qortalMobile;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.hardware.fingerprint.FingerprintManager;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import java.util.Locale;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Full-screen biometric host (not WebView). Floating/translucent themes break
 * Vivo/OPPO under-display sensors; bank apps use a dedicated activity like this.
 */
public class QortalBiometricAuthActivity extends AppCompatActivity {

  public static final String EXTRA_MODE = "mode";
  public static final String EXTRA_MODE_VERIFY = "verify";
  public static final String EXTRA_MODE_UNLOCK = "unlock";
  public static final String EXTRA_ADDRESS = "address";
  public static final String EXTRA_TITLE = "title";
  public static final String EXTRA_SUBTITLE = "subtitle";
  public static final String EXTRA_DESCRIPTION = "description";
  public static final String EXTRA_NEGATIVE_BUTTON = "negativeButtonText";

  public static final String RESULT_STATUS = "result";
  public static final String RESULT_SUCCESS = "success";
  public static final String RESULT_CANCELLED = "cancelled";
  public static final String RESULT_ERROR = "error";
  public static final String RESULT_SECRET = "secret";
  public static final String RESULT_ERROR_MESSAGE = "errorMessage";

  private CancellationSignal fingerprintCancellation;
  private final AtomicBoolean settled = new AtomicBoolean(false);

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_qortal_biometric_auth);

    String mode = getIntent().getStringExtra(EXTRA_MODE);
    if (EXTRA_MODE_UNLOCK.equals(mode)) {
      startUnlockFlow();
    } else {
      startVerifyFlow();
    }
  }

  private void startUnlockFlow() {
    String address = getIntent().getStringExtra(EXTRA_ADDRESS);
    if (address == null || address.trim().isEmpty()) {
      finishWithError("No wallet address");
      return;
    }

    if (!BiometricSecretStore.hasSecret(this, address)) {
      finishWithError("No stored secret");
      return;
    }

    try {
      BiometricSecretStore.DecryptPayload payload =
        BiometricSecretStore.prepareDecrypt(this, address);
      showBiometricPromptWithCrypto(payload);
    } catch (Exception e) {
      finishWithError(e.getMessage() != null ? e.getMessage() : "Unlock failed");
    }
  }

  private void startVerifyFlow() {
    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
      useUnderDisplayFastPath() &&
      tryLegacyFingerprintVerify()
    ) {
      return;
    }
    showBiometricPrompt(null);
  }

  private void showBiometricPromptWithCrypto(
    BiometricSecretStore.DecryptPayload payload
  ) {
    Executor executor = ContextCompat.getMainExecutor(this);
    BiometricPrompt.PromptInfo promptInfo = buildPromptInfo();
    BiometricPrompt biometricPrompt = new BiometricPrompt(
      this,
      executor,
      new BiometricPrompt.AuthenticationCallback() {
        @Override
        public void onAuthenticationError(
          int errorCode,
          @NonNull CharSequence errString
        ) {
          if (isUserCancel(errorCode)) {
            finishCancelled();
          } else {
            finishWithError(errString.toString());
          }
        }

        @Override
        public void onAuthenticationSucceeded(
          @NonNull BiometricPrompt.AuthenticationResult result
        ) {
          try {
            String secret = BiometricSecretStore.finishDecrypt(payload);
            finishWithSecret(secret);
          } catch (Exception e) {
            finishWithError(
              e.getMessage() != null ? e.getMessage() : "Decrypt failed"
            );
          }
        }

        @Override
        public void onAuthenticationFailed() {
          /* keep listening */
        }
      }
    );

    biometricPrompt.authenticate(
      promptInfo,
      new BiometricPrompt.CryptoObject(payload.cipher)
    );
  }

  private void showBiometricPrompt(BiometricPrompt.CryptoObject cryptoObject) {
    Executor executor = ContextCompat.getMainExecutor(this);
    BiometricPrompt.PromptInfo promptInfo = buildPromptInfo();
    BiometricPrompt biometricPrompt = new BiometricPrompt(
      this,
      executor,
      new BiometricPrompt.AuthenticationCallback() {
        @Override
        public void onAuthenticationError(
          int errorCode,
          @NonNull CharSequence errString
        ) {
          if (isUserCancel(errorCode)) {
            finishCancelled();
          } else {
            finishWithError(errString.toString());
          }
        }

        @Override
        public void onAuthenticationSucceeded(
          @NonNull BiometricPrompt.AuthenticationResult result
        ) {
          finishSuccess();
        }

        @Override
        public void onAuthenticationFailed() {
          /* keep listening */
        }
      }
    );

    if (cryptoObject != null) {
      biometricPrompt.authenticate(promptInfo, cryptoObject);
    } else {
      biometricPrompt.authenticate(promptInfo);
    }
  }

  private BiometricPrompt.PromptInfo buildPromptInfo() {
    String title = getIntent().getStringExtra(EXTRA_TITLE);
    String subtitle = getIntent().getStringExtra(EXTRA_SUBTITLE);
    String description = getIntent().getStringExtra(EXTRA_DESCRIPTION);
    String negative = getIntent().getStringExtra(EXTRA_NEGATIVE_BUTTON);

    if (title == null || title.isEmpty()) {
      title = "Biometric unlock";
    }
    if (negative == null || negative.isEmpty()) {
      negative = "Cancel";
    }

    BiometricPrompt.PromptInfo.Builder builder =
      new BiometricPrompt.PromptInfo.Builder()
        .setTitle(title)
        .setNegativeButtonText(negative);

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      builder.setAllowedAuthenticators(
        BiometricManager.Authenticators.BIOMETRIC_STRONG
          | BiometricManager.Authenticators.BIOMETRIC_WEAK
      );
      builder.setConfirmationRequired(false);
    }

    if (subtitle != null && !subtitle.isEmpty()) {
      builder.setSubtitle(subtitle);
    }
    if (description != null && !description.isEmpty()) {
      builder.setDescription(description);
    }

    return builder.build();
  }

  private boolean useUnderDisplayFastPath() {
    String manufacturer = Build.MANUFACTURER == null
      ? ""
      : Build.MANUFACTURER.toLowerCase(Locale.US);
    return (
      manufacturer.contains("vivo") ||
      manufacturer.contains("iqoo") ||
      manufacturer.contains("oppo") ||
      manufacturer.contains("realme") ||
      manufacturer.contains("oneplus")
    );
  }

  @SuppressLint("MissingPermission")
  private boolean tryLegacyFingerprintVerify() {
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
        return false;
      }

      FingerprintManager fingerprintManager = getSystemService(
        FingerprintManager.class
      );
      if (
        fingerprintManager == null ||
        !fingerprintManager.isHardwareDetected() ||
        !fingerprintManager.hasEnrolledFingerprints()
      ) {
        return false;
      }

      cancelFingerprintScan();
      fingerprintCancellation = new CancellationSignal();

      fingerprintManager.authenticate(
        null,
        fingerprintCancellation,
        0,
        new FingerprintManager.AuthenticationCallback() {
          @Override
          public void onAuthenticationError(
            int errorCode,
            @NonNull CharSequence errString
          ) {
            if (
              errorCode == FingerprintManager.FINGERPRINT_ERROR_USER_CANCELED
                || errorCode == FingerprintManager.FINGERPRINT_ERROR_CANCELED
            ) {
              finishCancelled();
            } else {
              finishWithError(errString.toString());
            }
          }

          @Override
          public void onAuthenticationSucceeded(
            @NonNull FingerprintManager.AuthenticationResult result
          ) {
            finishSuccess();
          }

          @Override
          public void onAuthenticationFailed() {
            /* keep listening */
          }
        },
        null
      );

      return true;
    } catch (Exception e) {
      cancelFingerprintScan();
      return false;
    }
  }

  private static boolean isUserCancel(int errorCode) {
    return (
      errorCode == BiometricPrompt.ERROR_USER_CANCELED
        || errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON
        || errorCode == BiometricPrompt.ERROR_CANCELED
    );
  }

  private void cancelFingerprintScan() {
    if (fingerprintCancellation != null) {
      fingerprintCancellation.cancel();
      fingerprintCancellation = null;
    }
  }

  @Override
  protected void onDestroy() {
    cancelFingerprintScan();
    super.onDestroy();
  }

  private void finishSuccess() {
    if (!settled.compareAndSet(false, true)) {
      return;
    }
    cancelFingerprintScan();
    Intent intent = new Intent();
    intent.putExtra(RESULT_STATUS, RESULT_SUCCESS);
    setResult(Activity.RESULT_OK, intent);
    finish();
  }

  private void finishWithSecret(String secret) {
    if (!settled.compareAndSet(false, true)) {
      return;
    }
    cancelFingerprintScan();
    Intent intent = new Intent();
    intent.putExtra(RESULT_STATUS, RESULT_SUCCESS);
    intent.putExtra(RESULT_SECRET, secret);
    setResult(Activity.RESULT_OK, intent);
    finish();
  }

  private void finishCancelled() {
    if (!settled.compareAndSet(false, true)) {
      return;
    }
    cancelFingerprintScan();
    Intent intent = new Intent();
    intent.putExtra(RESULT_STATUS, RESULT_CANCELLED);
    setResult(Activity.RESULT_CANCELED, intent);
    finish();
  }

  private void finishWithError(String message) {
    if (!settled.compareAndSet(false, true)) {
      return;
    }
    cancelFingerprintScan();
    Intent intent = new Intent();
    intent.putExtra(RESULT_STATUS, RESULT_ERROR);
    intent.putExtra(RESULT_ERROR_MESSAGE, message);
    setResult(Activity.RESULT_CANCELED, intent);
    finish();
  }
}
