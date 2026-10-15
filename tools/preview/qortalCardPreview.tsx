/**
 * Dev-only preview of Qortal Card's My card list: a card in each state (plain,
 * move back form, name on chain with the avatar suggestion, name being
 * registered, name form, backup form, card with its own key). No node: fees
 * and name checks fail quietly. Run `npm run dev` and open
 * /tools/preview/qortal-card.html. Not a build input, so it never ships.
 */
import { createRoot } from 'react-dom/client';
import { Box, CssBaseline, Typography } from '@mui/material';
import { useState } from 'react';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import { ThemeProvider } from '../../src/components/Theme/ThemeContext';
import type { LinkedCard } from '../../src/atoms/qortalCard';
import {
  CardItem,
  type CardFormMode,
  type CardNotice,
  type OpenCardForm,
} from '../../src/components/QortalCard/CardItem';

const QORT = 100_000_000n;

const card = (
  address: string,
  walletKeyIndex: number | null,
  name?: string
): LinkedCard => ({
  address,
  publicKey: '',
  applet: 'qortal-lab',
  walletKeyIndex,
  linkedAt: 1,
  name,
});

interface Sample {
  label: string;
  card: LinkedCard;
  state: { balance: bigint | null; name: string | null };
  form?: OpenCardForm | null;
  notice?: CardNotice | null;
  registering?: string | null;
  updating?: boolean;
}

const SAMPLES: Sample[] = [
  {
    label: 'Plain, updating',
    card: card('QQGkcpWeH5yDXbLPYzZGZa3B4L7hYXwQnU', 0),
    state: { balance: 149000000n, name: null },
    updating: true,
    notice: {
      tone: 'success',
      text: 'Top up sent. The balance updates in about a minute.',
    },
  },
  {
    label: 'Move back form',
    card: card('QQGkcpWeH5yDXbLPYzZGZa3B4L7hYXwQnU', 0, 'Blue card'),
    state: { balance: 5n * QORT, name: null },
    form: { address: 'x', mode: 'move', balance: 5n * QORT, fee: 1000000n },
  },
  {
    label: 'Name on chain + avatar suggestion',
    card: card('QbAgyU6RH1aymc94c9YUeBn1u3ZKPpfvv6', 1),
    state: { balance: 372000000n, name: 'qortal' },
    notice: {
      tone: 'success',
      text: 'qortal is on chain now.',
      action: { label: 'Add avatar', run: () => undefined },
    },
  },
  {
    label: 'Registering',
    card: card('QbAgyU6RH1aymc94c9YUeBn1u3ZKPpfvv6', 2),
    state: { balance: 250000000n, name: null },
    registering: 'Simon Card',
    updating: true,
  },
  {
    label: 'Name form',
    card: card('QbAgyU6RH1aymc94c9YUeBn1u3ZKPpfvv6', 3),
    state: { balance: 50000000n, name: null },
    form: { address: 'x', mode: 'register' },
  },
  {
    label: 'Backup form',
    card: card('QbAgyU6RH1aymc94c9YUeBn1u3ZKPpfvv6', 4),
    state: { balance: 0n, name: null },
    form: { address: 'x', mode: 'backup' },
  },
  {
    label: 'Own key: backup info + switch',
    card: card('QQGkcpWeH5yDXbLPYzZGZa3B4L7hYXwQnU', null, 'Card 2 test card'),
    state: { balance: 49000000n, name: null },
    form: { address: 'x', mode: 'backup' },
  },
  {
    label: 'Switch: move back first',
    card: card('QQGkcpWeH5yDXbLPYzZGZa3B4L7hYXwQnU', null, 'Card 2 test card'),
    state: { balance: 49000000n, name: null },
    form: {
      address: 'x',
      mode: 'switch',
      stage: 'confirm',
      balance: 49000000n,
      fee: 1000000n,
    },
  },
  {
    label: 'Switch: waiting',
    card: card('QQGkcpWeH5yDXbLPYzZGZa3B4L7hYXwQnU', null, 'Card 2 test card'),
    state: { balance: 49000000n, name: null },
    updating: true,
    form: {
      address: 'x',
      mode: 'switch',
      stage: 'waiting',
      balance: 49000000n,
      fee: 1000000n,
    },
  },
  {
    label: 'Own key with a name (menu: avatar greyed)',
    card: card('QbAgyU6RH1aymc94c9YUeBn1u3ZKPpfvv6', null),
    state: { balance: 120000000n, name: 'qortal' },
  },
  {
    label: 'Own key on the card, move back',
    card: card('QNxMnsZt2Y8yRk2rM6cs7aqh3G6pHrsQZ7', null),
    state: { balance: 49000000n, name: null },
    form: { address: 'x', mode: 'move', balance: 49000000n, fee: 1000000n },
  },
];

function Item({ sample, position }: { sample: Sample; position: number }) {
  const [form, setForm] = useState<OpenCardForm | null>(sample.form ?? null);
  const [notice, setNotice] = useState(sample.notice ?? null);
  return (
    <CardItem
      busy={false}
      card={sample.card}
      form={form}
      nfcReady
      notice={notice}
      onBackup={async () => undefined}
      onConfirmMove={() => undefined}
      onDismissNotice={() => setNotice(null)}
      onForm={(mode: CardFormMode | null) =>
        setForm(mode ? { address: sample.card.address, mode } : null)
      }
      onPrepareMove={() =>
        setForm({
          address: 'x',
          mode: 'move',
          balance: sample.state.balance ?? 0n,
          fee: 1000000n,
        })
      }
      onPrepareSwitch={() =>
        setForm({
          address: 'x',
          mode: 'switch',
          stage: 'confirm',
          balance: sample.state.balance ?? 0n,
          fee: 1000000n,
        })
      }
      onPublishAvatar={() => undefined}
      onSwitchLoad={() => undefined}
      onSwitchMove={() => undefined}
      onRegisterName={() => undefined}
      onRemove={() => undefined}
      onRename={() => undefined}
      onTopUp={() => undefined}
      position={position}
      registering={sample.registering ?? null}
      state={sample.state}
      updating={sample.updating ?? false}
    />
  );
}

const Preview = () => (
  <Box sx={{ bgcolor: 'background.default', minHeight: '100vh', p: 2 }}>
    <Box sx={{ display: 'grid', gap: 2, maxWidth: 420, mx: 'auto' }}>
      {SAMPLES.map((sample, index) => (
        <Box key={sample.label} sx={{ display: 'grid', gap: 0.5 }}>
          <Typography sx={{ fontSize: 12, opacity: 0.6 }}>
            {sample.label}
          </Typography>
          <Item position={index} sample={sample} />
        </Box>
      ))}
    </Box>
  </Box>
);

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Preview />
  </ThemeProvider>
);
