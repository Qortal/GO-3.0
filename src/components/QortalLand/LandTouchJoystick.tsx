import { Box } from '@mui/material';
import { useCallback, useRef, useState, type MutableRefObject } from 'react';

const PAD_SIZE = 128;
const KNOB_SIZE = 52;
const DEAD_ZONE = 0.28;

/**
 * Thumb pad that drives QortalLand movement on touch devices.
 *
 * The game loop reads a set of pressed key names every frame, so instead of
 * introducing a second movement path this pad writes the same WASD entries the
 * keyboard handler would. Eight-way output matches what the loop can express.
 */
export function LandTouchJoystick({
  keysRef,
}: {
  keysRef: MutableRefObject<Set<string>>;
}) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);

  const clearKeys = useCallback(() => {
    const keys = keysRef.current;
    keys.delete('w');
    keys.delete('a');
    keys.delete('s');
    keys.delete('d');
  }, [keysRef]);

  const applyVector = useCallback(
    (clientX: number, clientY: number) => {
      const pad = padRef.current;
      if (!pad) return;
      const rect = pad.getBoundingClientRect();
      const radius = rect.width / 2;
      if (radius <= 0) return;
      const rawX = (clientX - (rect.left + radius)) / radius;
      const rawY = (clientY - (rect.top + radius)) / radius;
      const magnitude = Math.hypot(rawX, rawY);
      const scale = magnitude > 1 ? 1 / magnitude : 1;
      const x = rawX * scale;
      const y = rawY * scale;

      const keys = keysRef.current;
      if (x < -DEAD_ZONE) {
        keys.add('a');
        keys.delete('d');
      } else if (x > DEAD_ZONE) {
        keys.add('d');
        keys.delete('a');
      } else {
        keys.delete('a');
        keys.delete('d');
      }
      if (y < -DEAD_ZONE) {
        keys.add('w');
        keys.delete('s');
      } else if (y > DEAD_ZONE) {
        keys.add('s');
        keys.delete('w');
      } else {
        keys.delete('w');
        keys.delete('s');
      }

      setKnob({ x: x * (radius - KNOB_SIZE / 2), y: y * (radius - KNOB_SIZE / 2) });
    },
    [keysRef]
  );

  const endDrag = useCallback(() => {
    clearKeys();
    setActive(false);
    setKnob({ x: 0, y: 0 });
  }, [clearKeys]);

  return (
    <Box
      aria-label="Move"
      ref={padRef}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        setActive(true);
        applyVector(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        if (!active) return;
        event.preventDefault();
        applyVector(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        event.preventDefault();
        endDrag();
      }}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      role="application"
      sx={{
        alignItems: 'center',
        backgroundColor: active
          ? 'rgba(7, 12, 20, 0.72)'
          : 'rgba(7, 12, 20, 0.44)',
        border: '1px solid rgba(44, 248, 255, 0.42)',
        borderRadius: '50%',
        bottom: 'max(18px, env(safe-area-inset-bottom, 0px))',
        boxShadow: '0 10px 26px rgba(0, 0, 0, 0.45)',
        display: 'flex',
        height: PAD_SIZE,
        justifyContent: 'center',
        position: 'absolute',
        right: 16,
        touchAction: 'none',
        transition: 'background-color 140ms ease, opacity 140ms ease',
        opacity: active ? 1 : 0.72,
        userSelect: 'none',
        width: PAD_SIZE,
        zIndex: 6,
      }}
    >
      <Box
        sx={{
          backgroundColor: 'rgba(44, 248, 255, 0.22)',
          border: '1px solid rgba(44, 248, 255, 0.7)',
          borderRadius: '50%',
          height: KNOB_SIZE,
          pointerEvents: 'none',
          transform: `translate(${knob.x}px, ${knob.y}px)`,
          transition: active ? 'none' : 'transform 140ms ease',
          width: KNOB_SIZE,
        }}
      />
    </Box>
  );
}
