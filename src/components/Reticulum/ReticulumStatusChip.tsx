import { useState } from 'react';
import { isMobileViewport } from '../../utils/platform';
import { reticulumPhaseColor, useReticulumStatus } from './reticulumStatus';

/**
 * Diagnostic overlay for the native Reticulum transport (desktop/web only).
 *
 * On mobile the status lives in the top bar (see ReticulumTopBadge); this chip
 * still mounts there so the shared transport lifecycle starts, but renders
 * nothing. On web (no native plugin) it stays hidden.
 */
export const ReticulumStatusChip = () => {
  const { phase, status, error } = useReticulumStatus();
  const [expanded, setExpanded] = useState(false);
  const mobile = isMobileViewport();

  // Hide entirely on web / when the native plugin isn't present, and on mobile
  // (the badge in the top bar takes over). The hook above still keeps the
  // shared transport alive.
  if (mobile) return null;
  if (phase === 'error' && !status) return null;

  const color = reticulumPhaseColor(phase);

  return (
    <div
      onClick={() => setExpanded((v) => !v)}
      style={{
        position: 'fixed',
        left: 8,
        bottom: 8,
        zIndex: 2147483647,
        background: 'rgba(20,20,24,0.92)',
        color: '#fff',
        borderRadius: 10,
        padding: expanded ? '10px 12px' : '6px 10px',
        font: '11px/1.35 "Inter", system-ui, sans-serif',
        boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
        maxWidth: 240,
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: color,
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
        <strong style={{ fontSize: 11 }}>Reticulum</strong>
        <span style={{ opacity: 0.7 }}>
          {phase === 'online'
            ? 'online'
            : phase === 'connecting'
              ? 'connecting…'
              : phase === 'starting'
                ? 'starting…'
                : phase}
        </span>
      </div>
      {expanded && status && (
        <div style={{ marginTop: 6, opacity: 0.85 }}>
          <div>net: {status.networkName}</div>
          <div>
            IFAC: {status.ifacSize}B · ifaces: {status.interfaces}
          </div>
          <div>announces: {status.announces}</div>
          <div>
            rx: {status.rxBytes}B · tx: {status.txBytes}B
          </div>
        </div>
      )}
      {expanded && error && (
        <div style={{ marginTop: 6, color: '#ff6b6b' }}>{error}</div>
      )}
    </div>
  );
};

export default ReticulumStatusChip;
