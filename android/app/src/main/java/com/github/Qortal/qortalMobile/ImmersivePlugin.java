package com.github.Qortal.qortalMobile;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.view.MotionEvent;
import android.view.PixelCopy;
import android.view.View;
import android.view.Window;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Immersive mode, native half.
 *
 * <ul>
 *   <li>Hides the status bar while the page asks for it. A swipe from the top
 *   shows it for a moment (the usual full-screen behaviour); the navigation
 *   bar is left alone so the home gesture keeps working on the first swipe.
 *   Re-applied on resume and after full-screen video, which shows every
 *   system bar on its way out.</li>
 *   <li>Reports which way a finger drags across the WebView. Q-Apps and
 *   websites run in frames, and their scrolling never reaches GO's page, so
 *   this is the only way to tell "scrolling down" there. Reports flow only
 *   while the page has asked for them.</li>
 *   <li>Reads the colour the Q-App or website shows right under the camera
 *   strip, or its page background (twice a second, only while asked), so
 *   the page can paint the strip to run on into it. Nothing leaves the
 *   phone; only that one colour reaches the page.</li>
 * </ul>
 */
@CapacitorPlugin(name = "Immersive")
public class ImmersivePlugin extends Plugin {

  static volatile ImmersivePlugin instance;
  private static volatile boolean statusBarHidden = false;
  private static volatile boolean touchReports = false;

  /** A drag has to travel this far (dp), mostly vertically, to count. */
  private static final float DRAG_SLOP_DP = 24f;
  /** How much more vertical than sideways a first move must be. */
  private static final float VERTICAL_BIAS = 1.4f;

  // Touch state; only touched on the UI thread.
  private float startX;
  private float startY;
  private float anchorY;
  private int lastDirection;
  private boolean multiTouch;

  /** Edge colour: how often it is read. */
  private static final long EDGE_SAMPLE_MS = 500L;
  /** Width (px) of the column read at each side of the screen. */
  private static final int EDGE_COLUMN_PX = 6;
  /** Rows are read at this step; plenty to find the background. */
  private static final int EDGE_ROW_STEP_PX = 6;
  /**
   * Reading starts this far (dp) below the strip, past its soft fade (14 dp
   * in ImmersiveEdges.tsx), so it never reads its own colour.
   */
  private static final float EDGE_SAMPLE_OFFSET_DP = 16f;
  /** The bottom of the screen (app nav bars) is left out. */
  private static final float EDGE_BOTTOM_SKIP = 0.1f;
  /** Points read across the screen in the band just below the strip... */
  private static final int TOP_BAND_SAMPLES = 48;
  /** ...on this many rows, TOP_BAND_ROW_STEP_DP apart. */
  private static final int TOP_BAND_ROWS = 4;
  private static final float TOP_BAND_ROW_STEP_DP = 4f;
  /**
   * Channel difference still counted as a painted (flat) colour: a page's
   * own colours are exact, give or take gradient dithering. Photos and video
   * are never this even across the screen.
   */
  static final int FLAT_TOLERANCE = 4;
  /** Share of the band under the strip in one flat colour that the strip continues. */
  static final float BAND_FLAT = 0.75f;
  /** Channel difference for the page background at the sides (gentle gradients). */
  static final int SIDES_TOLERANCE = 8;
  /** Share of the sides in one colour that makes it the page background. */
  static final float SIDES_UNIFORM = 0.4f;
  /** Channel difference for "the sides still show the colour on show". */
  static final int KEEP_TOLERANCE = 20;
  /** Share of the sides that keeps the colour on show, so scrolling does not flicker. */
  static final float SIDES_KEEP = 0.3f;
  /** Photos or video out to the edges and under the strip: black, as in any viewer. */
  static final int MEDIA_BACKGROUND = 0x000000;
  /** A new colour under the strip is looked at again this soon (ms) before it is taken. */
  private static final long EDGE_CONFIRM_MS = 150L;
  private final Handler edgeHandler = new Handler(Looper.getMainLooper());
  private boolean edgeSampling = false;
  private boolean edgePaused = false;
  private boolean edgeCopyInFlight = false;
  /** The colour the strips show (-1 before the first reading). */
  private int lastEdgeColor = -1;
  /** A new flat colour seen once under the strip, waiting for a second look. */
  private int pendingBandColor = -1;
  /** Report the next reading even if the colour did not change (a fresh listener). */
  private boolean edgeReportDue = false;
  /** Page-asked start of the read (CSS px from the top), e.g. below the bar. */
  private float edgeFromCssPx = 0f;
  /** Page-asked end of the read (CSS px from the top), e.g. above the tab bar. */
  private float edgeToCssPx = 0f;
  private final Runnable edgeTick = this::sampleEdge;

  @Override
  public void load() {
    instance = this;
  }

  @PluginMethod
  public void setStatusBarHidden(PluginCall call) {
    statusBarHidden = Boolean.TRUE.equals(call.getBoolean("hidden", false));
    Activity activity = getActivity();
    if (activity != null) {
      activity.runOnUiThread(() -> applyStatusBar(activity));
    }
    call.resolve();
  }

  @PluginMethod
  public void setTouchReports(PluginCall call) {
    touchReports = Boolean.TRUE.equals(call.getBoolean("enabled", false));
    call.resolve();
  }

  @PluginMethod
  public void setEdgeSampling(PluginCall call) {
    boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
    Double fromCssPx = call.getDouble("fromCssPx");
    Double toCssPx = call.getDouble("toCssPx");
    edgeHandler.post(() -> {
      edgeHandler.removeCallbacks(edgeTick);
      edgeSampling = enabled;
      edgeFromCssPx = fromCssPx == null ? 0f : fromCssPx.floatValue();
      edgeToCssPx = toCssPx == null ? 0f : toCssPx.floatValue();
      if (enabled) {
        // A fresh start always reports, even if the colour did not change.
        // The colour on show is kept: restarts come with every slide of the
        // bars, often mid-scroll, and must not take whatever passes by.
        edgeReportDue = true;
        pendingBandColor = -1;
        edgeHandler.post(edgeTick);
      }
    });
    call.resolve();
  }

  @Override
  protected void handleOnPause() {
    super.handleOnPause();
    // Nothing to match while GO is not on screen.
    edgePaused = true;
    edgeHandler.removeCallbacks(edgeTick);
  }

  @Override
  protected void handleOnDestroy() {
    edgeHandler.removeCallbacks(edgeTick);
    edgeSampling = false;
    super.handleOnDestroy();
  }

  /**
   * Reads a band right below the strip (what the strip has to run on into)
   * and the left and right screen edges, from there to near the bottom.
   * Cards, posts and pictures usually stop short of the edges, so the
   * colour covering most of them is the Q-App's or website's own background,
   * for when a picture is under the strip: see pickEdgeColor.
   */
  private void sampleEdge() {
    if (!edgeSampling || edgePaused) return;
    Activity activity = getActivity();
    Window window = activity == null ? null : activity.getWindow();
    View decor = window == null ? null : window.getDecorView();
    if (decor == null || decor.getWidth() <= EDGE_COLUMN_PX * 2 || edgeCopyInFlight) {
      edgeHandler.postDelayed(edgeTick, EDGE_SAMPLE_MS);
      return;
    }
    WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(decor);
    int top = insets == null
      ? 0
      : Math.max(
          insets.getInsets(WindowInsetsCompat.Type.statusBars()).top,
          insets.getInsets(WindowInsetsCompat.Type.displayCutout()).top
        );
    int width = decor.getWidth();
    int height = decor.getHeight();
    float density = decor.getResources().getDisplayMetrics().density;
    // Below the strip's fade, and below the top bar while it is out (the
    // strip sits behind it there, so reading it would read the strip).
    int from = Math.max(
      top + Math.round(EDGE_SAMPLE_OFFSET_DP * density),
      Math.round(edgeFromCssPx * density)
    );
    final int to = edgeToCssPx > 0f
      ? Math.min(Math.round(height * (1f - EDGE_BOTTOM_SKIP)), Math.round(edgeToCssPx * density))
      : Math.round(height * (1f - EDGE_BOTTOM_SKIP));
    int rows = (to - from) / EDGE_ROW_STEP_PX;
    if (top <= 0 || rows < 4) {
      edgeHandler.postDelayed(edgeTick, EDGE_SAMPLE_MS);
      return;
    }
    edgeCopyInFlight = true;
    final int[] pixels = new int[rows * 2];
    final int[] band = new int[TOP_BAND_SAMPLES * TOP_BAND_ROWS];
    final Rect bandRect = new Rect(
      0,
      from,
      width,
      Math.min(height, from + Math.max(TOP_BAND_ROWS, Math.round(TOP_BAND_ROWS * TOP_BAND_ROW_STEP_DP * density)))
    );
    copyArea(window, new Rect(0, from, EDGE_COLUMN_PX, to), 1, rows, pixels, 0, (leftOk) ->
      copyArea(window, new Rect(width - EDGE_COLUMN_PX, from, width, to), 1, rows, pixels, rows, (rightOk) ->
        copyArea(window, bandRect, TOP_BAND_SAMPLES, TOP_BAND_ROWS, band, 0, (bandOk) -> {
          edgeCopyInFlight = false;
          if (leftOk && rightOk) reportEdge(pixels, bandOk ? band : new int[0]);
          if (edgeSampling && !edgePaused) {
            edgeHandler.postDelayed(
              edgeTick,
              pendingBandColor >= 0 ? EDGE_CONFIRM_MS : EDGE_SAMPLE_MS
            );
          }
        })
      )
    );
  }

  private interface CopyDone {
    void done(boolean ok);
  }

  /** Copies a screen area, squeezed to columns x rows, into pixels[offset..]. */
  private void copyArea(Window window, Rect source, int columns, int rows, int[] pixels, int offset, CopyDone then) {
    final Bitmap bitmap = Bitmap.createBitmap(columns, rows, Bitmap.Config.ARGB_8888);
    try {
      PixelCopy.request(
        window,
        source,
        bitmap,
        (result) -> {
          boolean ok = result == PixelCopy.SUCCESS;
          if (ok) bitmap.getPixels(pixels, offset, columns, 0, 0, columns, rows);
          bitmap.recycle();
          then.done(ok);
        },
        edgeHandler
      );
    } catch (RuntimeException error) {
      // Window not ready or being torn down: try again next time.
      bitmap.recycle();
      then.done(false);
    }
  }

  /** Reports the strip's colour (see pickEdgeColor), when it changes. */
  private void reportEdge(int[] sides, int[] band) {
    EdgePick pick = pickEdgeColor(sides, band, lastEdgeColor, pendingBandColor);
    pendingBandColor = pick.pending;
    int color = pick.color >= 0 ? pick.color : lastEdgeColor;
    if (color < 0) return;
    if (!edgeReportDue && !edgeColorChanged(color)) return;
    edgeReportDue = false;
    lastEdgeColor = color;
    JSObject event = new JSObject();
    event.put("color", String.format(java.util.Locale.ROOT, "#%06x", color));
    notifyListeners("edge", event);
  }

  /** One reading's outcome: the colour to paint (-1: keep the one on show). */
  static final class EdgePick {
    final int color;
    /** A new flat colour under the strip to look at again (-1: none). */
    final int pending;

    EdgePick(int color, int pending) {
      this.color = color;
      this.pending = pending;
    }
  }

  /**
   * The strips' colour, so the top always runs on into what the app shows
   * right there:
   * 1. the band right under the top strip, when it is one flat colour from
   *    edge to edge: a header, a viewer's black, the page itself. Painted
   *    colours are flat; photos and video are not, and cards stop short of
   *    the edges. A colour new there is taken on a second look (pending),
   *    so a card or section scrolling past does not flicker the strips;
   * 2. else (a photo, video or post under the strip) the colour on show,
   *    while the screen sides still show it;
   * 3. else the page background: the colour covering most of the sides
   *    (cards and posts stop short of them);
   * 4. else black: a photo or video out to the edges, as in any viewer.
   */
  static EdgePick pickEdgeColor(int[] sides, int[] band, int current, int pending) {
    int under = flatBandColor(band);
    if (under >= 0) {
      if (current < 0 || sameColor(under, current) || (pending >= 0 && sameColor(under, pending))) {
        return new EdgePick(under, -1);
      }
      return new EdgePick(-1, under);
    }
    if (current >= 0 && shareNear(sides, current, KEEP_TOLERANCE) >= SIDES_KEEP) {
      return new EdgePick(-1, -1);
    }
    int side = dominantColor(sides);
    if (side >= 0 && shareNear(sides, side, SIDES_TOLERANCE) >= SIDES_UNIFORM) {
      return new EdgePick(side, -1);
    }
    // Without the band (its copy failed) nothing says it is a picture.
    if (band == null || band.length == 0) return new EdgePick(current >= 0 ? -1 : side, -1);
    return new EdgePick(MEDIA_BACKGROUND, -1);
  }

  /**
   * The band's colour when it is painted flat across the whole width (most
   * points, and the outermost point of nearly every row), else -1.
   */
  static int flatBandColor(int[] band) {
    if (band == null || band.length < TOP_BAND_SAMPLES) return -1;
    int color = dominantColor(band);
    if (color < 0 || shareNear(band, color, FLAT_TOLERANCE) < BAND_FLAT) return -1;
    int rows = band.length / TOP_BAND_SAMPLES;
    int edges = 0;
    for (int row = 0; row < rows; row++) {
      int start = row * TOP_BAND_SAMPLES;
      if (near(band[start], color, FLAT_TOLERANCE)) edges++;
      if (near(band[start + TOP_BAND_SAMPLES - 1], color, FLAT_TOLERANCE)) edges++;
    }
    // A back arrow or avatar may touch one edge point; a card's margin shows on all.
    return edges >= rows * 2 - Math.max(1, rows / 2) ? color : -1;
  }

  private static boolean sameColor(int a, int b) {
    return near(a, b, FLAT_TOLERANCE);
  }

  /** Every channel of pixel within tolerance of color. */
  static boolean near(int pixel, int color, int tolerance) {
    return Math.abs(((pixel >> 16) & 0xff) - ((color >> 16) & 0xff)) <= tolerance
      && Math.abs(((pixel >> 8) & 0xff) - ((color >> 8) & 0xff)) <= tolerance
      && Math.abs((pixel & 0xff) - (color & 0xff)) <= tolerance;
  }

  /** Share of the pixels within tolerance of color in every channel. */
  static float shareNear(int[] pixels, int color, int tolerance) {
    if (pixels.length == 0) return 0f;
    int count = 0;
    for (int p : pixels) {
      if (near(p, color, tolerance)) count++;
    }
    return count / (float) pixels.length;
  }

  /** Most common colour (4 bits a channel), averaged within its group. */
  static int dominantColor(int[] pixels) {
    if (pixels.length == 0) return -1;
    int[] counts = new int[4096];
    for (int p : pixels) {
      counts[((p >> 12) & 0xf00) | ((p >> 8) & 0xf0) | ((p >> 4) & 0xf)]++;
    }
    int best = 0;
    for (int i = 1; i < counts.length; i++) {
      if (counts[i] > counts[best]) best = i;
    }
    long r = 0, g = 0, b = 0, n = 0;
    for (int p : pixels) {
      int bucket = ((p >> 12) & 0xf00) | ((p >> 8) & 0xf0) | ((p >> 4) & 0xf);
      if (bucket != best) continue;
      r += (p >> 16) & 0xff;
      g += (p >> 8) & 0xff;
      b += p & 0xff;
      n++;
    }
    if (n == 0) return -1;
    return (int) ((r / n) << 16 | (g / n) << 8 | (b / n));
  }

  private boolean edgeColorChanged(int color) {
    int last = lastEdgeColor;
    if (last < 0) return true;
    return Math.abs(((last >> 16) & 0xff) - ((color >> 16) & 0xff)) > 3
      || Math.abs(((last >> 8) & 0xff) - ((color >> 8) & 0xff)) > 3
      || Math.abs((last & 0xff) - (color & 0xff)) > 3;
  }

  @Override
  protected void handleOnResume() {
    super.handleOnResume();
    Activity activity = getActivity();
    if (activity != null && statusBarHidden) {
      activity.runOnUiThread(() -> applyStatusBar(activity));
    }
    edgePaused = false;
    if (edgeSampling) {
      edgeHandler.removeCallbacks(edgeTick);
      edgeHandler.post(edgeTick);
    }
  }

  /** Puts the status bar where the page last asked for it. */
  static void applyStatusBar(Activity activity) {
    if (activity == null) return;
    Window window = activity.getWindow();
    if (window == null) return;
    WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
      window,
      window.getDecorView()
    );
    if (controller == null) return;
    if (statusBarHidden) {
      controller.setSystemBarsBehavior(
        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      );
      controller.hide(WindowInsetsCompat.Type.statusBars());
    } else {
      controller.show(WindowInsetsCompat.Type.statusBars());
    }
  }

  /** Called by {@link GoWebView} for every touch, before the page sees it. */
  static void onWebViewTouch(View view, MotionEvent event) {
    ImmersivePlugin plugin = instance;
    if (plugin == null || !touchReports) return;
    try {
      plugin.track(view, event);
    } catch (RuntimeException ignored) {
      // Never let this cost a touch.
    }
  }

  private void track(View view, MotionEvent event) {
    float density = view.getResources().getDisplayMetrics().density;
    if (density <= 0) density = 1f;
    float slop = DRAG_SLOP_DP * density;
    switch (event.getActionMasked()) {
      case MotionEvent.ACTION_DOWN: {
        startX = event.getX();
        startY = event.getY();
        anchorY = startY;
        lastDirection = 0;
        multiTouch = false;
        JSObject down = new JSObject();
        down.put("phase", "down");
        down.put("x", Math.round(startX / density));
        down.put("y", Math.round(startY / density));
        notifyListeners("touch", down);
        break;
      }
      case MotionEvent.ACTION_POINTER_DOWN:
        multiTouch = true;
        break;
      case MotionEvent.ACTION_MOVE: {
        // Pinch and two-finger gestures are not scrolling.
        if (multiTouch || event.getPointerCount() > 1) {
          multiTouch = true;
          return;
        }
        float x = event.getX();
        float y = event.getY();
        if (lastDirection == 0) {
          float dy = y - startY;
          float dx = x - startX;
          if (Math.abs(dy) >= slop && Math.abs(dy) > VERTICAL_BIAS * Math.abs(dx)) {
            lastDirection = dy < 0 ? -1 : 1;
            anchorY = y;
            sendDrag(lastDirection);
          }
          return;
        }
        float fromAnchor = y - anchorY;
        if (fromAnchor * lastDirection > 0) {
          // Still going the same way: remember the furthest point.
          anchorY = y;
        } else if (Math.abs(fromAnchor) >= slop) {
          lastDirection = -lastDirection;
          anchorY = y;
          sendDrag(lastDirection);
        }
        break;
      }
      default:
        break;
    }
  }

  private void sendDrag(int direction) {
    JSObject drag = new JSObject();
    drag.put("phase", "drag");
    drag.put("direction", direction < 0 ? "up" : "down");
    notifyListeners("touch", drag);
  }
}
