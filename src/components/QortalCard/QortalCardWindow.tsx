import ContactlessRoundedIcon from '@mui/icons-material/ContactlessRounded';
import ScienceRoundedIcon from '@mui/icons-material/ScienceRounded';
import {
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogContent,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { getDefaultStore, useAtomValue } from 'jotai';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  closeQortalCardWindow,
  NO_TOP_UP,
  openQortalCardWindow,
  pendingTopUpAtom,
  qortalCardWindowAtom,
  type QortalCardTab,
} from '../../atoms/qortalCard';
import { useSheetFullScreen } from '../../layout/goLayout';
import {
  openNfcSettings,
  readNfcCapabilities,
  type NfcCapabilities,
} from '../../qortalCard/qortalNfc';
import { BACK_PRIORITY, useAndroidBack } from '../../utils/androidBack';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { SAFE_AREA_BOTTOM, SAFE_AREA_TOP } from '../../utils/mobileSafeArea';
import { getDialogPaperSx } from '../App/dialogSurface';
import { MobilePanelHeader } from '../Mobile/MobilePanelHeader';
import { CardTapPrompt } from './CardTapPrompt';
import { noteSx } from './cardStyles';
import { MyCardsPanel } from './MyCardsPanel';
import { SendByTapPanel } from './SendByTapPanel';
import { TakePaymentPanel } from './TakePaymentPanel';
import { useCardTap } from './useCardTap';

/** NFC on or off, read when the window opens and when GO comes back. */
function useNfcCapabilities(open: boolean): NfcCapabilities | null {
  const [state, setState] = useState<NfcCapabilities | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    const refresh = () => {
      void readNfcCapabilities().then((next) => live && setState(next));
    };
    refresh();
    // Back from Android's NFC switch.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [open]);
  return state;
}

/**
 * A top up from My card goes through GO's own Send QORT. When Send closes,
 * the window comes back; after a sent payment My card watches the balance.
 */
function useReturnAfterTopUp(): void {
  useEffect(() => {
    const onFinished = (event: Event) => {
      const store = getDefaultStore();
      const pending = store.get(pendingTopUpAtom);
      if (!pending.address) return;
      const sent = (event as CustomEvent<{ sent?: boolean }>).detail?.sent;
      store.set(
        pendingTopUpAtom,
        sent ? { ...pending, sent: true } : NO_TOP_UP
      );
      openQortalCardWindow('card');
    };
    subscribeToEvent('sendQortFinished', onFinished);
    return () => unsubscribeFromEvent('sendQortFinished', onFinished);
  }, []);
}

const TABS: Array<{ key: QortalCardTab; label: string }> = [
  { key: 'card', label: 'core:qortal_card.tab.card' },
  { key: 'pay', label: 'core:qortal_card.tab.pay' },
  { key: 'send', label: 'core:qortal_card.tab.send' },
];

/**
 * Qortal Card (testing): connect a card to this account, take a payment from
 * someone's card or GO phone, or send QORT to another GO phone by tapping.
 * Opened from the avatar menu when switched on in Settings → System.
 */
export function QortalCardWindow({ address }: { address: string }) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const fullScreen = useSheetFullScreen();
  const { open, tab } = useAtomValue(qortalCardWindowAtom);
  const capabilities = useNfcCapabilities(open);
  const nfc = capabilities?.state ?? null;
  const { tap, run, cancel } = useCardTap();
  const nfcReady = nfc === 'on';
  useReturnAfterTopUp();

  useAndroidBack(
    () => {
      if (tap) cancel();
      else closeQortalCardWindow();
      return true;
    },
    { enabled: open, priority: BACK_PRIORITY.dialog }
  );

  const close = () => {
    cancel();
    closeQortalCardWindow();
  };

  return (
    <Dialog
      fullScreen={fullScreen}
      fullWidth
      maxWidth="sm"
      onClose={close}
      open={open}
      PaperProps={{
        sx: {
          ...getDialogPaperSx(theme, { maxWidth: 560 }),
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          ...(fullScreen
            ? {
                border: 'none',
                borderRadius: 0,
                boxShadow: 'none',
                maxWidth: 'none',
                paddingBottom: SAFE_AREA_BOTTOM,
                paddingTop: SAFE_AREA_TOP,
                width: '100%',
              }
            : { maxHeight: '86vh' }),
        },
      }}
    >
      <MobilePanelHeader
        icon={<ContactlessRoundedIcon />}
        onClose={close}
        title={t('core:qortal_card.title')}
      />
      <DialogContent
        sx={{
          alignContent: 'start',
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: 'minmax(0, 1fr)',
          px: 1.75,
          py: 1.75,
        }}
      >
        <Box sx={noteSx(theme, 'warning')}>
          <ScienceRoundedIcon fontSize="small" sx={{ mt: '1px' }} />
          <span>{t('core:qortal_card.testing_note')}</span>
        </Box>

        {nfc === 'off' && (
          <Box sx={{ ...noteSx(theme, 'info'), alignItems: 'center' }}>
            <Typography sx={{ flex: 1, fontSize: '0.85rem' }}>
              {t('core:qortal_card.nfc.off')}
            </Typography>
            <Button onClick={openNfcSettings} size="small" variant="contained">
              {t('core:qortal_card.nfc.turn_on')}
            </Button>
          </Box>
        )}
        {nfc === 'unsupported' && (
          <Box sx={noteSx(theme, 'info')}>
            {t('core:qortal_card.nfc.unsupported')}
          </Box>
        )}

        <Box
          aria-label={t('core:qortal_card.title')}
          role="tablist"
          sx={{
            backgroundColor:
              theme.palette.mode === 'dark'
                ? alpha(theme.palette.common.white, 0.05)
                : alpha(theme.palette.common.black, 0.05),
            border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
            borderRadius: '12px',
            display: 'grid',
            gap: 0.4,
            gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))`,
            p: 0.4,
          }}
        >
          {TABS.map((item) => {
            const selected = item.key === tab;
            return (
              <ButtonBase
                aria-selected={selected}
                key={item.key}
                onClick={() => openQortalCardWindow(item.key)}
                role="tab"
                sx={{
                  backgroundColor: selected
                    ? theme.palette.mode === 'dark'
                      ? alpha(theme.palette.primary.main, 0.22)
                      : theme.palette.background.paper
                    : 'transparent',
                  borderRadius: '9px',
                  color: selected
                    ? theme.palette.text.primary
                    : theme.palette.text.secondary,
                  fontSize: '0.88rem',
                  fontWeight: selected ? 750 : 600,
                  minHeight: 40,
                }}
              >
                {t(item.label)}
              </ButtonBase>
            );
          })}
        </Box>

        {tab === 'card' && (
          <MyCardsPanel address={address} nfcReady={nfcReady} run={run} />
        )}
        {tab === 'pay' && (
          <TakePaymentPanel
            address={address}
            canRequest={capabilities?.canRequest === true}
            nfcReady={nfcReady}
            run={run}
          />
        )}
        {tab === 'send' && <SendByTapPanel nfcReady={nfcReady} run={run} />}
      </DialogContent>
      {tap && <CardTapPrompt onCancel={cancel} tap={tap} />}
    </Dialog>
  );
}
