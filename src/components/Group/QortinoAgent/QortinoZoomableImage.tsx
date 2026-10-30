/**
 * Pinch / double-tap / wheel zoom for Qortino image lightbox.
 * Adapted from Embeds/ImageEmbed ZoomableImage (DOM-driven transform, no per-frame React).
 */
import { useEffect, useRef } from 'react';
import { Box } from '@mui/material';

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const DOUBLE_TAP_SCALE = 2.5;
const ZOOM_EASING = 'transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1)';

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

type Props = {
  src: string;
  alt?: string;
};

export function QortinoZoomableImage({ src, alt = '' }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const tf = useRef({ scale: 1, x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  const gesture = useRef({
    startDist: 0,
    startScale: 1,
    startX: 0,
    startY: 0,
    focalX: 0,
    focalY: 0,
    panStartX: 0,
    panStartY: 0,
    isPanning: false,
    lastTapTime: 0,
  });

  const paint = (animate: boolean) => {
    const el = imgRef.current;
    if (!el) return;
    el.style.transition = animate ? ZOOM_EASING : 'none';
    el.style.transform = `translate3d(${tf.current.x}px, ${tf.current.y}px, 0) scale(${tf.current.scale})`;
  };

  const schedulePaint = () => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      paint(false);
    });
  };

  const getRect = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { cx: 0, cy: 0, width: 0, height: 0 };
    return {
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2,
      width: rect.width,
      height: rect.height,
    };
  };

  const clampTranslate = (nextScale: number, x: number, y: number) => {
    const { width, height } = getRect();
    const maxX = (width * (nextScale - 1)) / 2;
    const maxY = (height * (nextScale - 1)) / 2;
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
  };

  const reset = (animate = true) => {
    tf.current = { scale: 1, x: 0, y: 0 };
    paint(animate);
  };

  useEffect(() => {
    reset(false);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const zoomTo = (nextScale: number, focalX: number, focalY: number) => {
    const { cx, cy } = getRect();
    const fx = focalX - cx;
    const fy = focalY - cy;
    const ratio = nextScale / tf.current.scale;
    const nextX = fx - (fx - tf.current.x) * ratio;
    const nextY = fy - (fy - tf.current.y) * ratio;
    const clamped = clampTranslate(nextScale, nextX, nextY);
    tf.current = { scale: nextScale, x: clamped.x, y: clamped.y };
    paint(true);
  };

  const doubleTapZoom = (focalX: number, focalY: number) => {
    if (tf.current.scale > 1.01) reset(true);
    else zoomTo(DOUBLE_TAP_SCALE, focalX, focalY);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0]!, e.touches[1]!];
      g.startDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      g.startScale = tf.current.scale;
      g.startX = tf.current.x;
      g.startY = tf.current.y;
      g.focalX = (a.clientX + b.clientX) / 2;
      g.focalY = (a.clientY + b.clientY) / 2;
      g.isPanning = false;
      paint(false);
    } else if (e.touches.length === 1) {
      const now = Date.now();
      const t = e.touches[0]!;
      if (now - g.lastTapTime < 300) {
        doubleTapZoom(t.clientX, t.clientY);
        g.lastTapTime = 0;
        g.isPanning = false;
      } else {
        g.lastTapTime = now;
        if (tf.current.scale > 1) {
          g.isPanning = true;
          g.panStartX = t.clientX - tf.current.x;
          g.panStartY = t.clientY - tf.current.y;
          paint(false);
        }
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (e.touches.length === 2 && g.startDist > 0) {
      e.preventDefault();
      const [a, b] = [e.touches[0]!, e.touches[1]!];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const nextScale = clamp(g.startScale * (dist / g.startDist), MIN_ZOOM, MAX_ZOOM);
      const { cx, cy } = getRect();
      const fx = g.focalX - cx;
      const fy = g.focalY - cy;
      const ratio = nextScale / g.startScale;
      const nextX = fx - (fx - g.startX) * ratio;
      const nextY = fy - (fy - g.startY) * ratio;
      const clamped = clampTranslate(nextScale, nextX, nextY);
      tf.current = { scale: nextScale, x: clamped.x, y: clamped.y };
      schedulePaint();
    } else if (e.touches.length === 1 && g.isPanning && tf.current.scale > 1) {
      e.preventDefault();
      const t = e.touches[0]!;
      const clamped = clampTranslate(
        tf.current.scale,
        t.clientX - g.panStartX,
        t.clientY - g.panStartY
      );
      tf.current = { ...tf.current, x: clamped.x, y: clamped.y };
      schedulePaint();
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const g = gesture.current;
    g.startDist = 0;
    if (e.touches.length === 0) {
      g.isPanning = false;
      if (tf.current.scale <= 1.01) reset(true);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.0018;
    const nextScale = clamp(tf.current.scale * (1 + delta), MIN_ZOOM, MAX_ZOOM);
    if (nextScale <= 1.01) reset(true);
    else zoomTo(nextScale, e.clientX, e.clientY);
  };

  return (
    <Box
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onWheel={handleWheel}
      onDoubleClick={(e) => doubleTapZoom(e.clientX, e.clientY)}
      sx={{
        alignItems: 'center',
        display: 'flex',
        height: '100%',
        justifyContent: 'center',
        overflow: 'hidden',
        touchAction: 'none',
        width: '100%',
      }}
    >
      <Box
        component="img"
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        sx={{
          display: 'block',
          maxHeight: '100%',
          maxWidth: '100%',
          objectFit: 'contain',
          transform: 'translate3d(0,0,0) scale(1)',
          transformOrigin: 'center center',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          willChange: 'transform',
        }}
      />
    </Box>
  );
}
