import { describe, expect, it } from 'vitest';
import {
  computePdfFit,
  computePdfRenderScale,
  pdfFitBoost,
  pdfFitChanged,
  pdfWidthFit,
  pdfZoomLimits,
} from './pdfFit';

// Page sizes in PDF points.
const A4 = { pageW: 595, pageH: 842 };
const LEGAL = { pageW: 612, pageH: 1008 };
// A long single page: a receipt or a captured web page.
const RECEIPT = { pageW: 612, pageH: 5000 };

/** The reader's rule before GO fitted the height, kept as the reference. */
const todaysFit = (W: number, pageW: number) =>
  Math.max(0.75, (W - 24) / pageW);

// W: the box the page is centred in; H: the page area, padding included.
// Rough sizes for each window with the reader's bars showing.
const portrait = [
  { name: 'phone portrait 393x873', W: 385, H: 683 },
  { name: 'phone portrait, bars hidden', W: 385, H: 809 },
  { name: 'small phone portrait 360x740', W: 352, H: 566 },
  { name: 'tablet portrait 800x1280', W: 792, H: 1080 },
  { name: 'fold 673x841', W: 665, H: 667 },
];
const landscape = [
  { name: 'phone landscape 873x393', W: 865, H: 245 },
  { name: 'phone landscape, bars hidden', W: 865, H: 369 },
  { name: 'tablet landscape 1280x800', W: 1272, H: 640 },
  { name: 'split 1280x400', W: 1272, H: 250 },
];
const cases = [
  ...portrait.map((c) => ({ ...c, landscape: false })),
  ...landscape.map((c) => ({ ...c, landscape: true })),
];

describe('computePdfFit', () => {
  it.each(portrait)(
    'GO in portrait keeps the width fit, even for tall pages: $name',
    ({ W, H }) => {
      for (const page of [A4, LEGAL, RECEIPT]) {
        expect(
          computePdfFit({ W, H, ...page, go: true, landscape: false })
        ).toBe(todaysFit(W, page.pageW));
      }
    }
  );

  it('keeps the 0.75 floor in phone portrait, bars shown or hidden', () => {
    for (const H of [683, 809]) {
      for (const page of [A4, LEGAL, RECEIPT]) {
        expect(
          computePdfFit({ W: 385, H, ...page, go: true, landscape: false })
        ).toBe(0.75);
      }
    }
  });

  it.each(cases)('the Hub always fits the width: $name', ({ W, H }) => {
    for (const isLandscape of [false, true]) {
      expect(
        computePdfFit({ W, H, ...A4, go: false, landscape: isLandscape })
      ).toBe(todaysFit(W, 595));
    }
  });

  it.each(landscape)('GO landscape shows the whole page: $name', ({ W, H }) => {
    for (const page of [A4, LEGAL, RECEIPT]) {
      const fit = computePdfFit({ W, H, ...page, go: true, landscape: true });
      expect(fit).toBeLessThanOrEqual(todaysFit(W, page.pageW));
      expect(page.pageW * fit).toBeLessThanOrEqual(W - 24);
      expect(page.pageH * fit).toBeLessThanOrEqual(H - 12 + 1e-9);
    }
  });

  it('lets the height decide in landscape, even below the 0.75 floor', () => {
    expect(
      computePdfFit({ W: 865, H: 245, ...A4, go: true, landscape: true })
    ).toBeCloseTo(233 / 842, 6);
    expect(
      computePdfFit({ W: 1272, H: 640, ...A4, go: true, landscape: true })
    ).toBeCloseTo(628 / 842, 6);
  });

  it('falls back to the width fit before the page area is laid out', () => {
    const fit = (H: number, pageH = 842) =>
      computePdfFit({
        W: 865,
        H,
        pageW: 595,
        pageH,
        go: true,
        landscape: true,
      });
    expect(fit(0)).toBe(todaysFit(865, 595));
    expect(fit(12)).toBe(todaysFit(865, 595));
    expect(fit(NaN)).toBe(todaysFit(865, 595));
    expect(fit(245, 0)).toBe(todaysFit(865, 595));
  });

  it('a wide page in a landscape window still fills the width', () => {
    // A 1000x400 banner page: the width decides at 1280x800.
    const fit = computePdfFit({
      W: 1272,
      H: 640,
      pageW: 1000,
      pageH: 400,
      go: true,
      landscape: true,
    });
    expect(fit).toBe(todaysFit(1272, 1000));
  });
});

describe('computePdfRenderScale', () => {
  it.each(cases)(
    'draws as sharp as the width fit on GO and the Hub: $name',
    ({ W, H, landscape: isLandscape }) => {
      const expected = todaysFit(W, 595) * 1.75;
      for (const go of [true, false]) {
        expect(
          computePdfRenderScale({ W, H, ...A4, go, landscape: isLandscape })
        ).toBe(expected);
      }
    }
  );

  it('uses the width rule pdfWidthFit', () => {
    expect(pdfWidthFit(385, 595)).toBe(0.75);
    expect(pdfWidthFit(865, 595)).toBe((865 - 24) / 595);
  });
});

describe('pdfFitBoost', () => {
  it('is 1 when the width decides', () => {
    expect(pdfFitBoost(0.75, 0.75)).toBe(1);
    expect(pdfFitBoost(1.41, 1.41)).toBe(1);
  });

  it('is how many times smaller than the width fit the page shows', () => {
    const widthFit = pdfWidthFit(865, 595);
    const fit = computePdfFit({
      W: 865,
      H: 245,
      ...A4,
      go: true,
      landscape: true,
    });
    expect(pdfFitBoost(fit, widthFit)).toBeCloseTo(widthFit / fit, 9);
    expect(pdfFitBoost(fit, widthFit)).toBeGreaterThan(5);
  });

  it('is 1 for a page not drawn yet', () => {
    expect(pdfFitBoost(0, 1.41)).toBe(1);
    expect(pdfFitBoost(NaN, 1.41)).toBe(1);
  });
});

describe('pdfZoomLimits', () => {
  const base = { maxZoom: 5, doubleTapScale: 2.5 };

  it('keeps the zoom box limits when the width decides (Hub, portrait)', () => {
    expect(pdfZoomLimits(1, base)).toEqual(base);
    expect(pdfZoomLimits(0.5, base)).toEqual(base);
    expect(pdfZoomLimits(NaN, base)).toEqual(base);
  });

  it('a double tap reaches the width fit, pinch zoom as far as before', () => {
    // Phone landscape 873x393 with the bars shown.
    const widthFit = pdfWidthFit(865, 595);
    const fit = 233 / 842;
    const limits = pdfZoomLimits(pdfFitBoost(fit, widthFit), base);
    expect(fit * limits.doubleTapScale).toBeCloseTo(widthFit, 9);
    expect(fit * limits.maxZoom).toBeCloseTo(widthFit * 5, 9);
  });

  it('never double taps to less than the zoom box would', () => {
    // A page just a little smaller than its width fit.
    expect(pdfZoomLimits(1.2, base).doubleTapScale).toBe(2.5);
    expect(pdfZoomLimits(1.2, base).maxZoom).toBeCloseTo(6, 9);
  });
});

describe('pdfFitChanged', () => {
  it('ignores changes under a pixel at the page edge', () => {
    expect(pdfFitChanged(0.5, 0.5, 595, 842)).toBe(false);
    expect(pdfFitChanged(0.5, 0.5 + 0.5 / 842, 595, 842)).toBe(false);
  });

  it('reports a change of a pixel or more', () => {
    expect(pdfFitChanged(0.5, 0.5 + 1.5 / 842, 595, 842)).toBe(true);
    expect(pdfFitChanged(0.277, 0.438, 595, 842)).toBe(true);
  });
});
