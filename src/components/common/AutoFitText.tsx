import {
  RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Box, SxProps, Theme } from '@mui/material';

/**
 * Single-line text that first shrinks its font to fit the available width (down
 * to `minFontPx`) and, if it still doesn't fit at that floor, truncates with an
 * ellipsis. Good for titles/names where you want them as large as possible but
 * never overflowing.
 */
export function AutoFitEllipsisText({
  text,
  maxFontPx = 16,
  minFontPx = 11,
  fontWeight = 600,
  sx,
}: {
  text: string;
  maxFontPx?: number;
  minFontPx?: number;
  fontWeight?: number | string;
  sx?: SxProps<Theme>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fontPx = useAutoFitFontPx(containerRef, text, { maxFontPx, minFontPx });

  return (
    <Box
      ref={containerRef}
      sx={{
        minWidth: 0,
        overflow: 'hidden',
        width: '100%',
        fontWeight,
        ...sx,
      }}
    >
      <Box
        component="span"
        sx={{
          display: 'block',
          fontSize: `${fontPx}px`,
          fontWeight,
          lineHeight: 1.25,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </Box>
    </Box>
  );
}

let fitCanvas: HTMLCanvasElement | null = null;

/**
 * Returns a px font size that makes `text` fit on one line within the referenced
 * container's current width. It renders nothing itself —
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
 * one line. Keeps the field fully editable.
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
