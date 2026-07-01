import {
  RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Box, SxProps, Theme } from '@mui/material';

/**
 * Renders text on a single line, automatically shrinking the font size so the
 * whole string fits the available width (no truncation, no scrolling). Used to
 * always show a full Qortal address regardless of screen width.
 */
export function AutoFitText({
  text,
  maxFontPx = 14,
  minFontPx = 6,
  sx,
}: {
  text: string;
  maxFontPx?: number;
  minFontPx?: number;
  sx?: SxProps<Theme>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const spanRef = useRef<HTMLSpanElement | null>(null);
  const [fontPx, setFontPx] = useState(maxFontPx);

  useLayoutEffect(() => {
    let raf = 0;
    const fit = () => {
      const c = containerRef.current;
      const s = spanRef.current;
      if (!c || !s) return;
      const avail = c.clientWidth;
      if (avail <= 0) {
        // Layout not ready yet (e.g. off-screen / first paint): retry next frame.
        raf = requestAnimationFrame(fit);
        return;
      }
      // Measure the natural width at the max font size.
      s.style.fontSize = `${maxFontPx}px`;
      const natural = s.scrollWidth;
      if (natural <= 0) return;
      let size = maxFontPx * (avail / natural);
      size = Math.max(minFontPx, Math.min(maxFontPx, size));
      // Small safety margin so it never clips at the edge.
      setFontPx(Math.floor(size * 0.985 * 100) / 100);
    };
    fit();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      ro = new ResizeObserver(fit);
      ro.observe(containerRef.current);
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [text, maxFontPx, minFontPx]);

  return (
    <Box
      ref={containerRef}
      sx={{
        // minWidth:0 is essential: without it a flex parent gives this box its
        // content's natural width, so avail === natural and the font never
        // shrinks. With it the box shrinks to the available space and we scale.
        minWidth: 0,
        overflow: 'hidden',
        width: '100%',
        ...sx,
      }}
    >
      <span
        ref={spanRef}
        style={{
          display: 'inline-block',
          whiteSpace: 'nowrap',
          fontSize: `${fontPx}px`,
          letterSpacing: '-0.02em',
          lineHeight: 1.25,
        }}
      >
        {text}
      </span>
    </Box>
  );
}

let fitCanvas: HTMLCanvasElement | null = null;

/**
 * Returns a px font size that makes `text` fit on one line within the referenced
 * container's current width. Unlike AutoFitText this doesn't render anything —
 * useful when the text is drawn by another component (e.g. the animated
 * DecryptedText address reveal) that just needs a fontSize to apply.
 */
export function useAutoFitFontPx(
  containerRef: RefObject<HTMLElement | null>,
  text: string,
  opts?: { maxFontPx?: number; minFontPx?: number }
): number {
  const max = opts?.maxFontPx ?? 14;
  const min = opts?.minFontPx ?? 6;
  const [fontPx, setFontPx] = useState(max);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let raf = 0;
    const fit = () => {
      const c = containerRef.current;
      if (!c) return;
      const avail = c.clientWidth;
      if (avail <= 0) {
        raf = requestAnimationFrame(fit);
        return;
      }
      if (!text) {
        setFontPx(max);
        return;
      }
      const cs = getComputedStyle(c);
      const canvas = fitCanvas ?? (fitCanvas = document.createElement('canvas'));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.font = `${cs.fontWeight} ${max}px ${cs.fontFamily}`;
      const natural = ctx.measureText(text).width;
      let size = natural > 0 ? max * (avail / natural) : max;
      size = Math.max(min, Math.min(max, size));
      setFontPx(Math.floor(size * 0.985 * 100) / 100);
    };
    fit();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(fit);
      ro.observe(el);
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [text, max, min, containerRef]);

  return fontPx;
}

/**
 * Auto-shrinks the font size of a text input/textarea so its full value fits on
 * one line. Keeps the field fully editable (unlike AutoFitText which is static).
 */
export function useAutoFitInputFont(
  inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  value: string,
  opts?: { maxFontPx?: number; minFontPx?: number }
): void {
  const max = opts?.maxFontPx ?? 14;
  const min = opts?.minFontPx ?? 8;

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;

    const fit = () => {
      const input = inputRef.current;
      if (!input) return;
      const cs = getComputedStyle(input);
      const avail =
        input.clientWidth -
        (parseFloat(cs.paddingLeft) || 0) -
        (parseFloat(cs.paddingRight) || 0);
      if (avail <= 0) return;
      const text = input.value || input.placeholder || '';
      if (!text) {
        input.style.fontSize = `${max}px`;
        return;
      }
      const canvas = fitCanvas ?? (fitCanvas = document.createElement('canvas'));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.font = `${cs.fontWeight} ${max}px ${cs.fontFamily}`;
      const natural = ctx.measureText(text).width;
      let size = natural > 0 ? max * (avail / natural) : max;
      size = Math.max(min, Math.min(max, size));
      input.style.fontSize = `${Math.floor(size * 0.985 * 100) / 100}px`;
    };

    fit();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(fit);
      ro.observe(el);
    }
    return () => ro?.disconnect();
  }, [value, max, min, inputRef]);
}
