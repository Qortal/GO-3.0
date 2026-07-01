package com.github.Qortal.qortalMobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.hardware.fingerprint.FingerprintManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.TextView;
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
 * Biometric verify runs inline on MainActivity with an opaque full-screen
 * overlay. Vivo/OPPO under-display sensors fail or delay 10–20s when triggered
 * from a translucent sub-activity or WebView-only surface.
 *
 * Bank-app cold-start path: when biometric unlock is configured (persisted
 * flag), MainActivity shows the system prompt immediately at onCreate — while
 * the WebView and JS are still booting. The scan result is cached briefly and
 * consumed by the JS verify() call once the app is up, so the user scans
 * during the boot instead of waiting for it.
 */
@CapacitorPlugin(name = "QortalBiometric")
public class QortalBiometricPlugin extends Plugin {

  private static final String CANCEL_LABEL = "Cancel";
  private static final String PREFS_NAME = "qortal_biometric";
  private static final String PREF_AUTOPROMPT = "autoprompt";
  private static final long EARLY_RESULT_TTL_MS = 120_000;

  private static volatile long earlySuccessAt = 0;
  private static volatile long earlyCancelAt = 0;
  private static volatile boolean earlyPromptPending = false;
  // True only once the early launch prompt is actually on screen. Distinguishes
  // "prompt visible, waiting on the user" from "stalled before it ever showed"
  // (some OEMs stall canAuthenticate/HAL), so verify() can recover from a stall.
  private static volatile boolean earlyPromptVisible = false;
  private static volatile Runnable earlyResultListener = null;
  private static boolean earlyPromptShown = false;
  // The BiometricPrompt currently on screen (early or verify). Cancelled before
  // a new one is shown so two system dialogs can never stack (which would look
  // like the prompt "reopening" after tapping Cancel).
  private static volatile BiometricPrompt activeBiometricPrompt = null;

  private static void cancelActiveBiometricPrompt() {
    BiometricPrompt prompt = activeBiometricPrompt;
    activeBiometricPrompt = null;
    if (prompt != null) {
      try {
        prompt.cancelAuthentication();
      } catch (Exception ignored) {
        /* already gone */
      }
    }
  }

  private static void settleEarlyPrompt() {
    earlyPromptPending = false;
    earlyPromptVisible = false;
    Runnable listener = earlyResultListener;
    earlyResultListener = null;
    if (listener != null) {
      listener.run();
    }
  }

  private View biometricOverlay;
  private final Handler mainHandler = new Handler(Looper.getMainLooper());

  /** Called from MainActivity.onCreate, before the WebView is up. */
  static void maybeShowEarlyPrompt(FragmentActivity activity) {
    if (earlyPromptShown) return;
    SharedPreferences prefs = activity.getSharedPreferences(
      PREFS_NAME,
      Context.MODE_PRIVATE
    );
    if (!prefs.getBoolean(PREF_AUTOPROMPT, false)) return;
    earlyPromptShown = true;
    earlySuccessAt = 0;
    earlyCancelAt = 0;
    earlyPromptPending = true;

    // Biometrics may have been removed/disabled in system settings since the
    // flag was persisted; check off the main thread (canAuthenticate can hit
    // a slow HAL on some OEMs), then prompt on main.
    new Thread(
      () -> {
        int canAuth;
        try {
          canAuth = BiometricManager.from(activity).canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_STRONG
              | BiometricManager.Authenticators.BIOMETRIC_WEAK
          );
        } catch (Exception e) {
          canAuth = BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE;
        }
        if (canAuth != BiometricManager.BIOMETRIC_SUCCESS) {
          settleEarlyPrompt();
          return;
        }
        new Handler(Looper.getMainLooper()).post(() ->
          showEarlyPrompt(activity)
        );
      },
      "qortal-early-biometric-check"
    ).start();
  }

  private static void showEarlyPrompt(FragmentActivity activity) {
    // verify()'s watchdog may have already abandoned the early prompt (stall
    // recovery); don't stack a second system prompt in that case.
    if (!earlyPromptPending) {
      return;
    }
    if (activity.isFinishing() || activity.isDestroyed()) {
      settleEarlyPrompt();
      return;
    }
      try {
        Executor executor = ContextCompat.getMainExecutor(activity);
        BiometricPrompt prompt = new BiometricPrompt(
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
              ) {
                earlyCancelAt = SystemClock.uptimeMillis();
              }
              settleEarlyPrompt();
            }

            @Override
            public void onAuthenticationSucceeded(
              @NonNull BiometricPrompt.AuthenticationResult result
            ) {
              earlySuccessAt = SystemClock.uptimeMillis();
              settleEarlyPrompt();
            }

            @Override
            public void onAuthenticationFailed() {
              /* keep listening */
            }
          }
        );
        cancelActiveBiometricPrompt();
        activeBiometricPrompt = prompt;
        earlyPromptVisible = true;
        prompt.authenticate(
          staticPromptInfo(
            "Biometric unlock",
            "Qortal Go",
            "Place your finger on the sensor to unlock",
            CANCEL_LABEL
          )
        );
      } catch (Exception ignored) {
        settleEarlyPrompt();
      }
  }

  private static BiometricPrompt.PromptInfo staticPromptInfo(
    String title,
    String subtitle,
    String description,
    String negativeButtonText
  ) {
    BiometricPrompt.PromptInfo.Builder builder =
      new BiometricPrompt.PromptInfo.Builder()
        .setTitle(title)
        .setNegativeButtonText(negativeButtonText);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      builder.setAllowedAuthenticators(
        BiometricManager.Authenticators.BIOMETRIC_STRONG
          | BiometricManager.Authenticators.BIOMETRIC_WEAK
      );
      builder.setConfirmationRequired(false);
    }
    if (subtitle != null && !subtitle.isEmpty()) builder.setSubtitle(subtitle);
    if (description != null && !description.isEmpty()) {
      builder.setDescription(description);
    }
    return builder.build();
  }

  /** Persist whether the early launch prompt should show on next cold start. */
  @PluginMethod
  public void setAutoPrompt(PluginCall call) {
    boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
    getContext()
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(PREF_AUTOPROMPT, enabled)
      .apply();
    call.resolve();
  }

  /** Result of the launch-time prompt, if any ('success'|'cancelled'|'none'). */
  @PluginMethod
  public void getEarlyPromptState(PluginCall call) {
    long now = SystemClock.uptimeMillis();
    String state = "none";
    if (earlySuccessAt != 0 && now - earlySuccessAt < EARLY_RESULT_TTL_MS) {
      state = "success";
    } else if (
      earlyCancelAt != 0 && now - earlyCancelAt < EARLY_RESULT_TTL_MS
    ) {
      state = "cancelled";
    }
    JSObject ret = new JSObject();
    ret.put("state", state);
    call.resolve(ret);
  }

  @PluginMethod
  public void isAvailable(PluginCall call) {
    // canAuthenticate hits the biometric HAL, which can stall on some OEMs;
    // keep it off the shared Capacitor plugin thread.
    new Thread(
      () -> {
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
      },
      "qortal-biometric-availability"
    ).start();
  }

  /**
   * Touch the HAL early so the first unlock is not cold-starting the sensor.
   * MUST resolve immediately and probe on a detached thread: these HAL calls
   * can block ~10s on some OEMs (Vivo), and Capacitor runs all plugin methods
   * on one shared thread — a synchronous warmUp queues the verify() prompt
   * behind it, which is exactly the slow-unlock it tries to prevent.
   */
  @PluginMethod
  public void warmUp(PluginCall call) {
    call.resolve();
    new Thread(
      () -> {
        try {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            FingerprintManager fingerprintManager =
              getContext().getSystemService(FingerprintManager.class);
            if (fingerprintManager != null) {
              fingerprintManager.isHardwareDetected();
              fingerprintManager.hasEnrolledFingerprints();
            }
          }
          BiometricManager.from(getContext()).canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_WEAK
          );
        } catch (Exception ignored) {
          /* warm-up is best effort */
        }
      },
      "qortal-biometric-warmup"
    ).start();
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

    // The user may already have scanned on the launch-time prompt while the
    // WebView was booting — consume that success instead of prompting twice.
    long now = SystemClock.uptimeMillis();
    if (earlySuccessAt != 0 && now - earlySuccessAt < EARLY_RESULT_TTL_MS) {
      earlySuccessAt = 0;
      android.util.Log.i("QortalBiometric", "verify satisfied by early prompt");
      call.resolve();
      return;
    }

    // The launch-time prompt is still pending: normally we wait for its result
    // instead of stacking a second prompt. But if it stalled before ever
    // becoming visible (some OEMs hang the HAL/canAuthenticate check), a plain
    // wait would hang the unlock forever with no prompt — so a watchdog takes
    // over and shows a fresh prompt for this call.
    if (earlyPromptPending) {
      call.setKeepAlive(true);
      android.util.Log.i("QortalBiometric", "verify waiting on early prompt");
      final AtomicBoolean handled = new AtomicBoolean(false);
      earlyResultListener = () -> {
        if (!handled.compareAndSet(false, true)) return;
        long settled = SystemClock.uptimeMillis();
        if (
          earlySuccessAt != 0 && settled - earlySuccessAt < EARLY_RESULT_TTL_MS
        ) {
          earlySuccessAt = 0;
          call.resolve();
        } else {
          call.reject("cancelled");
        }
      };
      // Settled between the check and listener registration? Run it now.
      if (!earlyPromptPending && earlyResultListener != null) {
        Runnable listener = earlyResultListener;
        earlyResultListener = null;
        listener.run();
        return;
      }
      mainHandler.postDelayed(
        new Runnable() {
          @Override
          public void run() {
            if (handled.get()) return;
            if (earlyPromptVisible) {
              // The early prompt is genuinely on screen; keep waiting for the
              // user to scan/cancel rather than stacking a second prompt.
              mainHandler.postDelayed(this, 1000);
              return;
            }
            if (!handled.compareAndSet(false, true)) return;
            // Stalled before showing: abandon it and prompt fresh for this call.
            earlyResultListener = null;
            earlyPromptPending = false;
            android.util.Log.i(
              "QortalBiometric",
              "early prompt stalled; showing fresh prompt"
            );
            final AtomicBoolean settled = new AtomicBoolean(false);
            if (activity.isFinishing()) {
              safeReject(call, settled, "Activity is not available");
              return;
            }
            showBiometricOverlay(activity, title, description);
            verifyWithBiometricPrompt(
              call,
              activity,
              settled,
              title,
              subtitle,
              description,
              negativeButtonText
            );
          }
        },
        1500
      );
      return;
    }

    call.setKeepAlive(true);
    final AtomicBoolean settled = new AtomicBoolean(false);

    android.util.Log.i("QortalBiometric", "verify received t=" + android.os.SystemClock.uptimeMillis());
    mainHandler.postAtFrontOfQueue(() -> {
      android.util.Log.i("QortalBiometric", "verify on main thread t=" + android.os.SystemClock.uptimeMillis());
      if (activity.isFinishing() || settled.get()) {
        safeReject(call, settled, "Activity is not available");
        return;
      }

      showBiometricOverlay(activity, title, description);

      // BiometricPrompt everywhere: it's the only API every OEM optimizes
      // (under-display, side-button, face). Legacy FingerprintManager measured
      // ~18s-to-sensor on Vivo and shows no system UI on stock Android.
      verifyWithBiometricPrompt(
        call,
        activity,
        settled,
        title,
        subtitle,
        description,
        negativeButtonText
      );
    });
  }

  @PluginMethod
  public void hasStoredSecret(PluginCall call) {
    String address = call.getString("address");
    JSObject ret = new JSObject();
    if (address == null || address.trim().isEmpty()) {
      ret.put("hasSecret", false);
      call.resolve(ret);
      return;
    }
    ret.put("hasSecret", BiometricSecretStore.hasSecret(getContext(), address.trim()));
    call.resolve(ret);
  }

  @PluginMethod
  public void storeWalletSecret(PluginCall call) {
    String address = call.getString("address");
    String secret = call.getString("secret");
    if (address == null || address.trim().isEmpty()) {
      call.reject("No wallet address provided");
      return;
    }
    if (secret == null || secret.isEmpty()) {
      call.reject("No secret provided");
      return;
    }
    try {
      BiometricSecretStore.storeSecret(getContext(), address.trim(), secret);
      call.resolve();
    } catch (Exception e) {
      call.reject(
        "Failed to store secret: " + (e.getMessage() != null ? e.getMessage() : "unknown")
      );
    }
  }

  @PluginMethod
  public void deleteStoredSecret(PluginCall call) {
    String address = call.getString("address");
    if (address == null || address.trim().isEmpty()) {
      call.reject("No wallet address provided");
      return;
    }
    BiometricSecretStore.deleteSecret(getContext(), address.trim());
    call.resolve();
  }

  private void showBiometricOverlay(
    FragmentActivity activity,
    String title,
    String description
  ) {
    hideBiometricOverlay(activity);

    // Note: do NOT toggle setShowWhenLocked/setTurnScreenOn here. The app is
    // already foreground with the screen on, and flipping keyguard-related
    // window state right before authenticate() stalls Vivo's BiometricService
    // for ~10s before it shows the system prompt.

    FrameLayout overlay = new FrameLayout(activity);
    overlay.setBackgroundColor(Color.BLACK);
    overlay.setClickable(true);
    overlay.setFocusable(true);
    overlay.setImportantForAccessibility(
      View.IMPORTANT_FOR_ACCESSIBILITY_YES
    );

    TextView hint = new TextView(activity);
    hint.setText(
      description != null && !description.isEmpty() ? description : title
    );
    hint.setTextColor(Color.WHITE);
    hint.setTextSize(16f);
    hint.setGravity(Gravity.CENTER);
    FrameLayout.LayoutParams hintParams = new FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.WRAP_CONTENT,
      Gravity.CENTER
    );
    hint.setLayoutParams(hintParams);
    overlay.addView(hint);

    ViewGroup root = activity.findViewById(android.R.id.content);
    if (root != null) {
      root.addView(
        overlay,
        new ViewGroup.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT
        )
      );
      biometricOverlay = overlay;
    }
  }

  private void hideBiometricOverlay(FragmentActivity activity) {
    if (biometricOverlay == null) {
      return;
    }
    ViewGroup root = activity.findViewById(android.R.id.content);
    if (root != null) {
      root.removeView(biometricOverlay);
    }
    biometricOverlay = null;
  }

  private void verifyWithBiometricPrompt(
    PluginCall call,
    FragmentActivity activity,
    AtomicBoolean settled,
    String title,
    String subtitle,
    String description,
    String negativeButtonText
  ) {
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
            /* keep listening */
          }
        }
      );

      cancelActiveBiometricPrompt();
      activeBiometricPrompt = biometricPrompt;
      android.util.Log.i("QortalBiometric", "calling authenticate t=" + android.os.SystemClock.uptimeMillis());
      biometricPrompt.authenticate(promptInfo);
      android.util.Log.i("QortalBiometric", "authenticate returned t=" + android.os.SystemClock.uptimeMillis());
    } catch (Exception e) {
      safeReject(call, settled, "Biometric prompt failed: " + e.getMessage());
    }
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

  @Override
  protected void handleOnDestroy() {
    FragmentActivity activity = getActivity() instanceof FragmentActivity
      ? (FragmentActivity) getActivity()
      : null;
    if (activity != null) {
      hideBiometricOverlay(activity);
    }
    super.handleOnDestroy();
  }

  private void safeResolve(PluginCall call, AtomicBoolean settled) {
    if (settled.compareAndSet(false, true)) {
      FragmentActivity activity = getActivity() instanceof FragmentActivity
        ? (FragmentActivity) getActivity()
        : null;
      if (activity != null) {
        hideBiometricOverlay(activity);
      }
      call.resolve();
    }
  }

  private void safeReject(
    PluginCall call,
    AtomicBoolean settled,
    String message
  ) {
    if (settled.compareAndSet(false, true)) {
      FragmentActivity activity = getActivity() instanceof FragmentActivity
        ? (FragmentActivity) getActivity()
        : null;
      if (activity != null) {
        hideBiometricOverlay(activity);
      }
      call.reject(message);
    }
  }
}
