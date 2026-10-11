/**
 * How big the PDF reader draws a page. Pure, so the sizes can be tested
 * without pdf.js or a canvas.
 */

/** Room left beside the page at fit, across both sides. */
const PAGE_MARGIN_X = 24;
/** The page area's vertical padding (py 0.75 on top and bottom). */
const PAGE_MARGIN_Y = 12;
/** A page is never drawn smaller than this when fitted to the width. */
const MIN_WIDTH_FIT = 0.75;
/** Drawn sharper than fit so pinch zoom stays crisp up to ~2.5×. */
export const PDF_RENDER_OVERSAMPLE = 1.75;

export type PdfFitInput = {
  /** Width of the box the page is centred in (CSS px). */
  W: number;
  /** Height of the page area, padding included (CSS px). */
  H: number;
  /** The page at scale 1 (PDF points). */
  pageW: number;
  pageH: number;
  /** GO layout. The Hub always fits the width. */
  go: boolean;
  /**
   * The GO window is landscape (keyboard-proof). Only then does the height
   * limit the page; portrait keeps fit-to-width as before.
   */
  landscape: boolean;
};

/** The reader's original rule: fill the width, never below 0.75. */
export function pdfWidthFit(W: number, pageW: number): number {
  return Math.max(MIN_WIDTH_FIT, (W - PAGE_MARGIN_X) / pageW);
}

/**
 * The scale the page is shown at. In a landscape GO window the page also
 * has to fit the height, so all of it shows. Portrait keeps the width fit
 * even for tall pages: there the bars sliding away would otherwise resize
 * the page on every tap.
 */
export function computePdfFit({
  W,
  H,
  pageW,
  pageH,
  go,
  landscape,
}: PdfFitInput): number {
  const fitW = pdfWidthFit(W, pageW);
  // Not laid out yet (or no page height): the width rule alone.
  if (!go || !landscape || !(H > PAGE_MARGIN_Y) || !(pageH > 0)) return fitW;
  return Math.min(fitW, (H - PAGE_MARGIN_Y) / pageH);
}

/**
 * The bitmap scale. It follows the width fit even when the height decides
 * the shown size, so a page fitted to a short landscape window is as sharp,
 * and zooms as far, as before (and costs no more to draw than before).
 */
export function computePdfRenderScale(input: PdfFitInput): number {
  return pdfWidthFit(input.W, input.pageW) * PDF_RENDER_OVERSAMPLE;
}

export type ZoomLimits = { maxZoom: number; doubleTapScale: number };

/**
 * How many times smaller than its width fit the page is shown: 1 when the
 * width decides.
 */
export function pdfFitBoost(fit: number, widthFit: number): number {
  return fit > 0 && widthFit > fit ? widthFit / fit : 1;
}

/**
 * Zoom limits for a page shown `boost` times smaller than its width fit.
 * A double tap goes at least to the width fit, and pinch zoom reaches as
 * far as it did when the width decided. `base` is the zoom box's own.
 */
export function pdfZoomLimits(boost: number, base: ZoomLimits): ZoomLimits {
  const b = boost > 1 ? boost : 1;
  return {
    maxZoom: base.maxZoom * b,
    doubleTapScale: Math.max(base.doubleTapScale, b),
  };
}

/** True when a new fit would move the page's edges by a pixel or more. */
export function pdfFitChanged(
  prevFit: number,
  nextFit: number,
  pageW: number,
  pageH: number
): boolean {
  return Math.abs(nextFit - prevFit) * Math.max(pageW, pageH) >= 1;
}
