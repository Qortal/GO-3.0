import { prepareCrashReload } from '../lib/appLock';

/**
 * Last-resort screen for an error that escaped every feature-level boundary.
 * Deliberately plain DOM with inline styles: the theme provider sits inside
 * this boundary, so anything that fails there must not take the fallback with
 * it.
 */
const containerStyle: React.CSSProperties = {
  alignItems: 'center',
  backgroundColor: '#101114',
  color: '#e7e7ea',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  gap: 16,
  inset: 0,
  justifyContent: 'center',
  padding: 24,
  position: 'fixed',
  textAlign: 'center',
  zIndex: 2147483647,
};

const buttonStyle: React.CSSProperties = {
  backgroundColor: '#2d7ff9',
  border: 'none',
  borderRadius: 8,
  color: '#fff',
  cursor: 'pointer',
  fontSize: 16,
  fontWeight: 600,
  padding: '12px 28px',
};

const detailStyle: React.CSSProperties = {
  color: '#9a9aa4',
  fontSize: 12,
  lineHeight: 1.5,
  maxHeight: 160,
  maxWidth: '100%',
  overflow: 'auto',
  textAlign: 'left',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

/**
 * A Q-App can crash GO on purpose, including while it is locked, so the reload
 * must never resume the wallet: it goes back through the fingerprint or
 * password unlock, which the account picker opens straight away.
 */
const reloadAfterCrash = () => {
  prepareCrashReload();
  window.location.reload();
};

const RootCrashFallback = ({ error }: { error: Error | null }) => (
  <div style={containerStyle}>
    <div style={{ fontSize: 20, fontWeight: 600 }}>Qortal Go hit a problem</div>
    <div style={{ color: '#b6b6bf', fontSize: 14, maxWidth: 420 }}>
      The app stopped unexpectedly. Reloading usually fixes it — your account
      and messages are stored on the device and are not affected.
    </div>
    <button onClick={reloadAfterCrash} style={buttonStyle} type="button">
      Reload
    </button>
    {error ? (
      <div style={detailStyle}>
        {error.message}
        {error.stack ? `\n\n${error.stack.slice(0, 600)}` : ''}
      </div>
    ) : null}
  </div>
);

export default RootCrashFallback;
