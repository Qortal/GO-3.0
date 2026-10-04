/**
 * Dev-only preview of the Q-App approval dialog with realistic requests.
 * Run `npm run dev` and open /tools/preview/approval-dialog.html. Not a build
 * input, so it never ships.
 */
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline } from '@mui/material';
import i18n from '../../src/i18n/i18n';
import '../../src/styles/index.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import { QortalRequestExtensionDialog } from '../../src/components/App/QortalRequestExtensionDialog';

const ADDRESS = 'QWfVwmsTD3jKpUEb2HUk7wgeVBgYwK5V8c';

const samples = () => {
  const t = (key: string, opts: Record<string, unknown> = {}) =>
    i18n.t(key, { postProcess: 'capitalizeFirstChar', ...opts });
  const qtube = { name: 'Q-Tube', service: 'APP' };
  const qwallets = { name: 'Q-Wallets', service: 'APP' };
  return {
    authenticate: {
      text1: t('question:permission.authenticate'),
      checkbox1: { value: false, label: t('question:always_authenticate') },
      requestingApp: qtube,
    },
    sendCoins: {
      text1: t('question:permission.send_coins'),
      text2: t('question:to_recipient', {
        recipient: `alice (${ADDRESS})`,
      }),
      highlightedText: '5 QORT',
      fee: '0.01',
      confirmCheckbox: true,
      requestingApp: qwallets,
    },
    publish: {
      text1: t('question:permission.publish_qdn'),
      text2: 'service: VIDEO',
      text3: 'identifier: qtube_vid_hello-world_abc123',
      text4: 'name: alice',
      fee: '0.01',
      requestingApp: qtube,
    },
    balance: {
      text1: t('question:permission.fetch_balance', { coin: 'LTC' }),
      checkbox1: { value: false, label: t('question:always_retrieve_balance') },
      requestingApp: qwallets,
    },
    unknownApp: {
      text1: t('question:permission.get_wallet_info'),
      requestingApp: null,
    },
    goInternal: {
      text1: t('question:permission.publish_qdn'),
      text2: 'service: IMAGE',
      text3: 'identifier: qchat_img_1727850000',
      text4: 'name: alice',
      fee: '0.01',
      requestingApp: { name: 'Qortal GO', service: null, internal: true },
    },
    withJson: {
      text1: t('question:permission.sign_transaction'),
      highlightedText: t('question:message.generic.read_transaction_carefully'),
      text2: 'Tx type: PAYMENT',
      json: {
        type: 'PAYMENT',
        recipient: ADDRESS,
        amount: '12.5',
        fee: '0.01',
        timestamp: 1727850000000,
      },
      confirmCheckbox: true,
      requestingApp: qwallets,
    },
  } as Record<string, Record<string, unknown>>;
};

function Preview() {
  const { themeMode, toggleTheme } = useThemeContext();
  const all = useMemo(samples, []);
  const [key, setKey] = useState('authenticate');
  const [pending, setPending] = useState(0);
  const [nonce, setNonce] = useState(1);
  const message = {
    ...all[key],
    expiresAt: Date.now() + 60_000,
  };

  return (
    <>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          left: 0,
          padding: 4,
          position: 'fixed',
          right: 0,
          top: 0,
          zIndex: 20000,
        }}
      >
        {Object.keys(all).map((k) => (
          <button
            key={k}
            onClick={() => {
              setKey(k);
              setNonce((n) => n + 1);
            }}
            style={{ fontWeight: k === key ? 700 : 400 }}
          >
            {k}
          </button>
        ))}
        <button onClick={toggleTheme}>{themeMode}</button>
        <button onClick={() => setPending((p) => (p + 1) % 4)}>
          pending {pending}
        </button>
      </div>
      <QortalRequestExtensionDialog
        open
        requestId={nonce}
        pendingCount={pending}
        sameAppPendingCount={pending ? pending - 1 : 0}
        message={message}
        sendPaymentError=""
        onAccept={() => setNonce((n) => n + 1)}
        onCancel={() => setNonce((n) => n + 1)}
        onDeclineAll={() => setPending(0)}
        onCountdownComplete={() => {}}
      />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Preview />
  </ThemeProvider>
);
