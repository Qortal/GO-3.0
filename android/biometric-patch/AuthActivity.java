package ee.forgr.biometric;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import ee.forgr.biometric.capacitornativebiometric.R;
import java.util.concurrent.Executor;

public class AuthActivity extends AppCompatActivity {

  private Executor executor;
  private int maxAttempts;
  private int counter = 0;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_auth_acitivy);

    maxAttempts = getIntent().getIntExtra("maxAttempts", 5);

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      executor = this.getMainExecutor();
    } else {
      executor = new Executor() {
        @Override
        public void execute(Runnable command) {
          new Handler().post(command);
        }
      };
    }

    BiometricPrompt.PromptInfo.Builder builder =
      new BiometricPrompt.PromptInfo.Builder()
        .setTitle(
          getIntent().hasExtra("title")
            ? getIntent().getStringExtra("title")
            : "Authenticate"
        )
        .setSubtitle(
          getIntent().hasExtra("subtitle")
            ? getIntent().getStringExtra("subtitle")
            : null
        )
        .setDescription(
          getIntent().hasExtra("description")
            ? getIntent().getStringExtra("description")
            : null
        );

    boolean useFallback = getIntent().getBooleanExtra("useFallback", false);

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      int authenticators = BiometricManager.Authenticators.BIOMETRIC_STRONG
        | BiometricManager.Authenticators.BIOMETRIC_WEAK;
      if (useFallback) {
        authenticators |= BiometricManager.Authenticators.DEVICE_CREDENTIAL;
      }
      builder.setAllowedAuthenticators(authenticators);
    } else if (useFallback) {
      builder.setDeviceCredentialAllowed(true);
    } else {
      builder.setNegativeButtonText(
        getIntent().hasExtra("negativeButtonText")
          ? getIntent().getStringExtra("negativeButtonText")
          : "Cancel"
      );
    }

    BiometricPrompt.PromptInfo promptInfo = builder.build();

    BiometricPrompt biometricPrompt = new BiometricPrompt(
      this,
      executor,
      new BiometricPrompt.AuthenticationCallback() {
        @Override
        public void onAuthenticationError(
          int errorCode,
          @NonNull CharSequence errString
        ) {
          super.onAuthenticationError(errorCode, errString);
          int pluginErrorCode = AuthActivity.convertToPluginErrorCode(
            errorCode
          );
          finishActivity("error", pluginErrorCode, errString.toString());
        }

        @Override
        public void onAuthenticationSucceeded(
          @NonNull BiometricPrompt.AuthenticationResult result
        ) {
          super.onAuthenticationSucceeded(result);
          finishActivity("success");
        }

        @Override
        public void onAuthenticationFailed() {
          super.onAuthenticationFailed();
          counter++;
          if (counter == maxAttempts) finishActivity(
            "failed",
            10,
            "Authentication failed."
          );
        }
      }
    );

    biometricPrompt.authenticate(promptInfo);
  }

  void finishActivity(String result) {
    finishActivity(result, null, null);
  }

  void finishActivity(String result, Integer errorCode, String errorDetails) {
    Intent intent = new Intent();
    intent.putExtra("result", result);
    if (errorCode != null) {
      intent.putExtra("errorCode", String.valueOf(errorCode));
    }
    if (errorDetails != null) {
      intent.putExtra("errorDetails", errorDetails);
    }
    setResult(RESULT_OK, intent);
    finish();
  }

  public static int convertToPluginErrorCode(int errorCode) {
    switch (errorCode) {
      case BiometricPrompt.ERROR_HW_UNAVAILABLE:
      case BiometricPrompt.ERROR_HW_NOT_PRESENT:
        return 1;
      case BiometricPrompt.ERROR_LOCKOUT_PERMANENT:
        return 2;
      case BiometricPrompt.ERROR_NO_BIOMETRICS:
        return 3;
      case BiometricPrompt.ERROR_LOCKOUT:
        return 4;
      case BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL:
        return 14;
      case BiometricPrompt.ERROR_TIMEOUT:
      case BiometricPrompt.ERROR_CANCELED:
        return 15;
      case BiometricPrompt.ERROR_USER_CANCELED:
      case BiometricPrompt.ERROR_NEGATIVE_BUTTON:
        return 16;
      default:
        return 0;
    }
  }
}
