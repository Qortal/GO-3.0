package com.github.Qortal.qortalMobile;

/**
 * Decides, touch by touch, when a sideways swipe inside a zone of the page
 * (the widgets screen) belongs to GO's swipe between sections rather than to
 * what is under the finger. Widgets are Q-Apps in frames, and a frame takes
 * every touch on it, so the page itself never sees a swipe that starts on a
 * widget.
 *
 * <p>Same rules as the page's own swipe (horizontalPagerSwipe.ts): the first
 * 10 px decide, sideways wins only when wider than tall, a finger held
 * 400 ms first is a long press, and the 24 px screen edges stay the system's
 * back gesture. Taps, vertical scrolling and long presses are never claimed,
 * so they reach the widget as before.
 *
 * <p>The page confirms each touch first: on touch down it is asked whether
 * the zone is what is on top under the finger (a panel or dialog opened over
 * the widgets screen is not), and a swipe is only claimed once it said yes.
 * The answer crosses the bridge, so it often comes after the first 10 px: a
 * sideways swipe then waits for it (up to CONFIRM_WAIT_MS from touch down)
 * and is claimed on the next move once it is in. A no, or no answer in
 * time, leaves the touch with the page.
 *
 * <p>A finger held still on the zone for HOLD_MS (a long press, on a widget
 * or between them) is GO's too: the plugin's timer calls {@link #hold}, the
 * page gets a cancel, and the press and its moves go to the page as
 * "hold", "move" and "end", which pick the widget up to move it (or start
 * arranging). Widgets never get long presses.
 *
 * <p>Pure: no Android types, so the JVM tests run it. Coordinates are CSS px
 * (view px / density), the page's own unit.
 */
final class SectionSwipeClaim {

  static final float AXIS_LOCK_PX = 10f;
  static final long HOLD_MS = 400L;
  static final float EDGE_ZONE_PX = 24f;
  /** How long a sideways swipe waits for the page's yes. */
  static final long CONFIRM_WAIT_MS = 250L;

  /** What the WebView should do with the touch. */
  enum Decision {
    /** Let the page have it, as always. */
    PASS,
    /** From now on GO's: cancel it for the page (and swallow this one). */
    CLAIM,
    /** Already GO's: swallow. */
    SWALLOW,
  }

  /** Where claimed touches go (the plugin forwards them to the page). */
  interface Sink {
    void emit(String phase, float x, float y, long time);

    /** Asks the page whether (x, y) is the zone, on top (see confirm). */
    void probe(long touchId, float x, float y);
  }

  static final int DOWN = 0;
  static final int UP = 1;
  static final int MOVE = 2;
  static final int CANCEL = 3;
  static final int POINTER_DOWN = 5;

  private final Sink sink;

  // The zone, in CSS px; null while off.
  private float[] zone;

  private boolean tracking;
  private boolean claimed;
  /** Moved before HOLD_MS: never a long press. */
  private boolean moved;
  private float lastX;
  private float lastY;
  /** After a second finger ended a claimed swipe: the rest of the gesture
   * stays away from the page too (it was cancelled there). */
  private boolean ignoreRest;
  private float startX;
  private float startY;
  private long startTime;
  private long touchId;
  private boolean confirmed;
  private boolean denied;
  /** Sideways already, waiting for the page's yes. */
  private boolean waiting;

  SectionSwipeClaim(Sink sink) {
    this.sink = sink;
  }

  /** left, top, right, bottom in CSS px, or null to stop. */
  void setZone(float[] zone) {
    this.zone = zone == null ? null : zone.clone();
    if (this.zone == null && !claimed) tracking = false;
  }

  boolean hasZone() {
    return zone != null;
  }

  /** The touch the plugin's long press timer is for (after a DOWN). */
  long currentTouchId() {
    return tracking ? touchId : -1L;
  }

  /**
   * The long press timer for `id` went off at `time`: a finger still down,
   * unmoved, on the zone (confirmed) becomes GO's. True: cancel the touch
   * for the page; the press was sent as "hold".
   */
  boolean hold(long id, long time) {
    if (id != touchId || !tracking || claimed || moved || waiting) return false;
    if (!confirmed) return false;
    tracking = false;
    claimed = true;
    sink.emit("hold", lastX, lastY, time);
    return true;
  }

  /** The page's answer to a probe; only the current touch's counts. */
  void confirm(long id, boolean ok) {
    if (id != touchId) return;
    confirmed = ok;
    denied = !ok;
  }

  private boolean inZone(float x, float y, float viewWidth) {
    if (zone == null) return false;
    if (x < EDGE_ZONE_PX || x > viewWidth - EDGE_ZONE_PX) return false;
    return x >= zone[0] && x <= zone[2] && y >= zone[1] && y <= zone[3];
  }

  /**
   * One touch event: action (DOWN, MOVE, UP, CANCEL, POINTER_DOWN), the first
   * finger's position in CSS px, the event time (ms) and the view's width in
   * CSS px.
   */
  Decision onTouch(int action, float x, float y, long time, int pointers, float viewWidth) {
    if (action == DOWN) {
      claimed = false;
      moved = false;
      ignoreRest = false;
      tracking = pointers == 1 && inZone(x, y, viewWidth);
      startX = x;
      startY = y;
      lastX = x;
      lastY = y;
      startTime = time;
      touchId += 1;
      confirmed = false;
      denied = false;
      waiting = false;
      if (tracking) sink.probe(touchId, x, y);
      return Decision.PASS;
    }
    if (claimed) {
      switch (action) {
        case MOVE:
          if (pointers > 1) return Decision.SWALLOW;
          sink.emit("move", x, y, time);
          return Decision.SWALLOW;
        case POINTER_DOWN:
          // A second finger: not a swipe any more.
          sink.emit("cancel", x, y, time);
          claimed = false;
          tracking = false;
          ignoreRest = true;
          return Decision.SWALLOW;
        case UP:
          sink.emit("end", x, y, time);
          claimed = false;
          return Decision.SWALLOW;
        case CANCEL:
          sink.emit("cancel", x, y, time);
          claimed = false;
          return Decision.SWALLOW;
        default:
          return Decision.SWALLOW;
      }
    }
    if (ignoreRest) {
      if (action == UP || action == CANCEL) ignoreRest = false;
      return Decision.SWALLOW;
    }
    if (!tracking) return Decision.PASS;
    if (action == POINTER_DOWN || pointers > 1) {
      tracking = false;
      return Decision.PASS;
    }
    if (action == UP || action == CANCEL) {
      tracking = false;
      return Decision.PASS;
    }
    if (action != MOVE) return Decision.PASS;
    lastX = x;
    lastY = y;
    if (denied) {
      tracking = false;
      return Decision.PASS;
    }
    if (waiting) {
      if (confirmed) return claim(x, y, time);
      if (time - startTime >= CONFIRM_WAIT_MS) {
        tracking = false;
        waiting = false;
      }
      return Decision.PASS;
    }
    if (time - startTime >= HOLD_MS) {
      // Still where it came down: a long press, GO's (the timer may not have
      // gone off yet). Moved, or not confirmed: the page's.
      if (!moved && hold(touchId, time)) return Decision.CLAIM;
      tracking = false;
      return Decision.PASS;
    }
    float dx = Math.abs(x - startX);
    float dy = Math.abs(y - startY);
    if (dx < AXIS_LOCK_PX && dy < AXIS_LOCK_PX) return Decision.PASS;
    moved = true;
    if (dx <= dy) {
      tracking = false;
      return Decision.PASS;
    }
    if (confirmed) return claim(x, y, time);
    waiting = true;
    return Decision.PASS;
  }

  private Decision claim(float x, float y, long time) {
    tracking = false;
    waiting = false;
    claimed = true;
    sink.emit("start", startX, startY, startTime);
    sink.emit("move", x, y, time);
    return Decision.CLAIM;
  }
}
