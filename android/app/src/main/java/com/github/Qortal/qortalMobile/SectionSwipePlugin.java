package com.github.Qortal.qortalMobile;

import android.os.Handler;
import android.os.Looper;
import android.view.MotionEvent;
import android.view.View;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Sideways swipes over GO widgets switch sections (see
 * {@link SectionSwipeClaim}). The page sets the zone (the widgets screen,
 * while it shows and is not being arranged), answers each touch's probe, and
 * gets the claimed swipe as "swipe" events to drive its own section swipe.
 * Nothing is read or sent while no zone is set.
 */
@CapacitorPlugin(name = "SectionSwipe")
public class SectionSwipePlugin extends Plugin {

  static volatile SectionSwipePlugin instance;

  private final Handler main = new Handler(Looper.getMainLooper());
  /** The WebView the touches come from (for the long press's cancel). */
  private java.lang.ref.WeakReference<GoWebView> webView =
    new java.lang.ref.WeakReference<>(null);
  // Only used on the UI thread.
  private final SectionSwipeClaim claim = new SectionSwipeClaim(
    new SectionSwipeClaim.Sink() {
      @Override
      public void emit(String phase, float x, float y, long time) {
        JSObject event = new JSObject();
        event.put("phase", phase);
        event.put("x", x);
        event.put("y", y);
        event.put("t", time);
        // The page maps event times onto its own clock with this.
        event.put("now", android.os.SystemClock.uptimeMillis());
        notifyListeners("swipe", event);
      }

      @Override
      public void probe(long touchId, float x, float y) {
        JSObject event = new JSObject();
        event.put("id", touchId);
        event.put("x", x);
        event.put("y", y);
        notifyListeners("probe", event);
      }
    }
  );

  @Override
  public void load() {
    instance = this;
  }

  @Override
  protected void handleOnDestroy() {
    if (instance == this) instance = null;
  }

  @PluginMethod
  public void setZone(PluginCall call) {
    Boolean enabled = call.getBoolean("enabled", false);
    final float[] zone = Boolean.TRUE.equals(enabled)
      ? new float[] {
        call.getFloat("left", 0f),
        call.getFloat("top", 0f),
        call.getFloat("right", 0f),
        call.getFloat("bottom", 0f),
      }
      : null;
    main.post(() -> claim.setZone(zone));
    call.resolve();
  }

  @PluginMethod
  public void confirm(PluginCall call) {
    // Any JSON number: getLong only takes values parsed as Long, and a small
    // id arrives as an Integer (every answer then went to touch -1).
    Object raw = call.getData().opt("id");
    final long id = raw instanceof Number ? ((Number) raw).longValue() : -1L;
    final boolean ok = Boolean.TRUE.equals(call.getBoolean("ok", false));
    main.post(() -> claim.confirm(id, ok));
    call.resolve();
  }

  /** A finger that stays down, still, past HOLD_MS: a long press (see
   * SectionSwipeClaim#hold), even if no move event comes meanwhile. */
  private void scheduleHold(long downTime) {
    final long id = claim.currentTouchId();
    if (id < 0) return;
    main.postDelayed(
      () -> {
        long now = android.os.SystemClock.uptimeMillis();
        if (!claim.hold(id, now)) return;
        GoWebView view = webView.get();
        if (view != null) view.cancelPageTouch(downTime);
      },
      SectionSwipeClaim.HOLD_MS
    );
  }

  /**
   * Called by {@link GoWebView} for every touch, before the page sees it.
   * Never throws: a failure here must not cost a touch.
   */
  static SectionSwipeClaim.Decision onWebViewTouch(View view, MotionEvent event) {
    SectionSwipePlugin plugin = instance;
    if (plugin == null) return SectionSwipeClaim.Decision.PASS;
    try {
      SectionSwipeClaim claim = plugin.claim;
      int action = event.getActionMasked();
      if (view instanceof GoWebView) plugin.webView = new java.lang.ref.WeakReference<>((GoWebView) view);
      if (!claim.hasZone() && action == MotionEvent.ACTION_DOWN) {
        return claim.onTouch(SectionSwipeClaim.DOWN, -1f, -1f, 0L, 1, 0f);
      }
      float density = view.getResources().getDisplayMetrics().density;
      if (density <= 0) density = 1f;
      int mapped;
      switch (action) {
        case MotionEvent.ACTION_DOWN:
          mapped = SectionSwipeClaim.DOWN;
          break;
        case MotionEvent.ACTION_UP:
          mapped = SectionSwipeClaim.UP;
          break;
        case MotionEvent.ACTION_MOVE:
          mapped = SectionSwipeClaim.MOVE;
          break;
        case MotionEvent.ACTION_CANCEL:
          mapped = SectionSwipeClaim.CANCEL;
          break;
        case MotionEvent.ACTION_POINTER_DOWN:
          mapped = SectionSwipeClaim.POINTER_DOWN;
          break;
        default:
          mapped = -1;
      }
      if (mapped < 0) return SectionSwipeClaim.Decision.PASS;
      SectionSwipeClaim.Decision decision = claim.onTouch(
        mapped,
        event.getX() / density,
        event.getY() / density,
        event.getEventTime(),
        event.getPointerCount(),
        view.getWidth() / density
      );
      if (mapped == SectionSwipeClaim.DOWN) plugin.scheduleHold(event.getDownTime());
      return decision;
    } catch (RuntimeException ignored) {
      return SectionSwipeClaim.Decision.PASS;
    }
  }
}
