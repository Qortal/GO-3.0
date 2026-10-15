import AddPhotoAlternateRoundedIcon from '@mui/icons-material/AddPhotoAlternateRounded';
import BadgeRoundedIcon from '@mui/icons-material/BadgeRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import CreditCardRoundedIcon from '@mui/icons-material/CreditCardRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import SaveAltRoundedIcon from '@mui/icons-material/SaveAltRounded';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_CARD_NAME_LENGTH, type LinkedCard } from '../../atoms/qortalCard';
import { formatQortUnits } from '../../qortalCard/cardTx';
import { QdnNameAvatar } from '../common/QdnNameAvatar';
import { CARD_APPLETS } from '../../qortalCard/cardProtocol';
import {
  AvatarForm,
  BackupForm,
  hintSx,
  KeyOnCardInfo,
  MoveBackForm,
  RegisterNameForm,
  SwitchKeyForm,
  type SwitchStage,
} from './CardForms';
import { noteSx, surfaceSx, type NoteTone } from './cardStyles';
import type { CardState } from './useCardStates';

export type CardFormMode =
  | 'rename'
  | 'register'
  | 'avatar'
  | 'backup'
  | 'remove';

/** The one form open in the card list, if any. */
export type OpenCardForm =
  | { address: string; mode: CardFormMode }
  | { address: string; mode: 'move'; balance: bigint; fee: bigint }
  | {
      address: string;
      mode: 'switch';
      stage: SwitchStage;
      balance: bigint;
      fee: bigint;
    };

export interface CardNotice {
  tone: NoteTone;
  text: string;
  action?: { label: string; run: () => void };
}

/**
 * One linked card: its avatar and name, balance, address and key, and what
 * can be done with it. Wallet-key cards can do everything without the card;
 * a card with its own key is held to the phone to sign.
 */
export function CardItem({
  card,
  position,
  state,
  updating,
  registering,
  busy,
  nfcReady,
  notice,
  form,
  onForm,
  onDismissNotice,
  onTopUp,
  onPrepareMove,
  onConfirmMove,
  onRename,
  onRemove,
  onBackup,
  onRegisterName,
  onPublishAvatar,
  onPrepareSwitch,
  onSwitchMove,
  onSwitchLoad,
}: {
  card: LinkedCard;
  position: number;
  /** undefined while loading. */
  state: CardState | undefined;
  updating: boolean;
  /** A name sent to the chain and not confirmed yet. */
  registering: string | null;
  busy: boolean;
  nfcReady: boolean;
  notice: CardNotice | null;
  /** This card's open form. */
  form: OpenCardForm | null;
  onForm: (mode: CardFormMode | null) => void;
  onDismissNotice: () => void;
  onTopUp: () => void;
  onPrepareMove: () => void;
  onConfirmMove: (amount: bigint) => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  onBackup: (password: string) => Promise<void>;
  onRegisterName: (name: string, fee: bigint) => void;
  onPublishAvatar: (file: File, fee: bigint) => void;
  /** A card with its own key: start switching it to a wallet key. */
  onPrepareSwitch: () => void;
  onSwitchMove: () => void;
  onSwitchLoad: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [draftName, setDraftName] = useState('');
  const [copied, setCopied] = useState(false);
  const walletKey = card.walletKeyIndex !== null;
  const chainName = state?.name ?? null;
  const balance = state?.balance;
  const title =
    chainName ||
    card.name?.trim() ||
    t('core:qortal_card.card.name', { number: position + 1 });
  const sentence = (key: string) =>
    t(key, { postProcess: 'capitalizeFirstChar' });

  const pick = (mode: CardFormMode) => {
    setMenuAnchor(null);
    if (mode === 'rename') setDraftName(card.name ?? '');
    onForm(mode);
  };

  const copyAddress = () => {
    void navigator.clipboard?.writeText(card.address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const saveName = () => {
    onRename(draftName.trim());
    onForm(null);
  };

  const menuItem = (
    mode: CardFormMode,
    icon: ReactNode,
    label: string,
    disabledReason?: string | null
  ) => (
    <MenuItem
      disabled={Boolean(disabledReason)}
      key={mode}
      onClick={() => pick(mode)}
      sx={{ whiteSpace: 'normal' }}
    >
      <ListItemIcon>{icon}</ListItemIcon>
      <ListItemText primary={label} secondary={disabledReason || undefined} />
    </MenuItem>
  );
  const walletOnly = walletKey
    ? null
    : t('core:qortal_card.card.wallet_key_only');
  const canTakeKey =
    CARD_APPLETS.find((applet) => applet.kind === card.applet)?.canImportKey ===
    true;

  let body: ReactNode;
  if (form?.mode === 'move') {
    body = (
      <MoveBackForm
        balance={form.balance}
        busy={busy}
        fee={form.fee}
        nfcReady={nfcReady}
        onCancel={() => onForm(null)}
        onConfirm={onConfirmMove}
        walletKey={walletKey}
      />
    );
  } else if (form?.mode === 'rename') {
    body = (
      <Box sx={{ display: 'grid', gap: 0.75 }}>
        <TextField
          autoFocus
          helperText={t('core:qortal_card.card.rename_hint')}
          inputProps={{ maxLength: MAX_CARD_NAME_LENGTH }}
          label={t('core:qortal_card.card.rename_label')}
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') saveName();
          }}
          size="small"
          value={draftName}
        />
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={saveName} variant="contained">
            {sentence('core:action.save')}
          </Button>
          <Button onClick={() => onForm(null)}>
            {sentence('core:action.cancel')}
          </Button>
        </Box>
      </Box>
    );
  } else if (form?.mode === 'register') {
    body = (
      <RegisterNameForm
        balance={balance}
        busy={busy}
        nfcReady={nfcReady}
        onCancel={() => onForm(null)}
        onRegister={onRegisterName}
        onTopUp={onTopUp}
        walletKey={walletKey}
      />
    );
  } else if (form?.mode === 'avatar' && chainName) {
    body = (
      <AvatarForm
        balance={balance}
        busy={busy}
        name={chainName}
        onCancel={() => onForm(null)}
        onPublish={onPublishAvatar}
        onTopUp={onTopUp}
      />
    );
  } else if (form?.mode === 'backup') {
    body = walletKey ? (
      <BackupForm onCancel={() => onForm(null)} onSave={onBackup} />
    ) : (
      <KeyOnCardInfo
        busy={busy}
        canSwitch={canTakeKey}
        chainName={chainName}
        onCancel={() => onForm(null)}
        onSwitch={onPrepareSwitch}
      />
    );
  } else if (form?.mode === 'switch') {
    body = (
      <SwitchKeyForm
        balance={form.balance}
        busy={busy}
        fee={form.fee}
        nfcReady={nfcReady}
        onCancel={() => onForm(null)}
        onLoad={onSwitchLoad}
        onMove={onSwitchMove}
        stage={form.stage}
      />
    );
  } else if (form?.mode === 'remove') {
    body = (
      <Box sx={{ display: 'grid', gap: 0.75 }}>
        <Typography sx={{ fontSize: '0.85rem' }}>
          {walletKey
            ? t('core:qortal_card.forget.confirm_wallet_key')
            : t('core:qortal_card.forget.confirm_card_key')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button color="error" onClick={onRemove} variant="contained">
            {sentence('core:action.remove')}
          </Button>
          <Button onClick={() => onForm(null)}>
            {sentence('core:action.cancel')}
          </Button>
        </Box>
      </Box>
    );
  } else {
    body = (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 0.25 }}>
        <Button
          disabled={busy}
          onClick={onTopUp}
          size="small"
          variant="contained"
        >
          {t('core:qortal_card.card.top_up')}
        </Button>
        <Button
          disabled={busy}
          onClick={onPrepareMove}
          size="small"
          startIcon={<UndoRoundedIcon />}
          variant="outlined"
        >
          {t('core:qortal_card.card.move_back')}
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ ...surfaceSx(theme), display: 'grid', gap: 0.9 }}>
      <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.25 }}>
        <QdnNameAvatar
          alt={title}
          avatarEnabled={Boolean(chainName)}
          avatarName={chainName}
          sx={{
            backgroundColor: alpha(theme.palette.primary.main, 0.14),
            color: theme.palette.primary.main,
            height: 44,
            width: 44,
          }}
        >
          <CreditCardRoundedIcon />
        </QdnNameAvatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            sx={{
              fontWeight: 750,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </Typography>
          {registering && !chainName ? (
            <Box
              sx={{
                alignItems: 'center',
                color: theme.palette.text.secondary,
                display: 'flex',
                fontSize: '0.75rem',
                gap: 0.5,
              }}
            >
              <CircularProgress size={10} thickness={6} />
              {t('core:qortal_card.name.registering', { name: registering })}
            </Box>
          ) : (
            <Typography
              sx={{ color: theme.palette.text.secondary, fontSize: '0.75rem' }}
            >
              {chainName
                ? t('core:qortal_card.card.name_on_chain')
                : walletKey
                  ? t('core:qortal_card.card.key_wallet')
                  : t('core:qortal_card.card.key_card')}
            </Typography>
          )}
        </Box>
        <IconButton
          aria-label={t('core:qortal_card.card.more')}
          disabled={busy}
          onClick={(event) => setMenuAnchor(event.currentTarget)}
          size="small"
        >
          <MoreVertRoundedIcon fontSize="small" />
        </IconButton>
        <Menu
          anchorEl={menuAnchor}
          onClose={() => setMenuAnchor(null)}
          open={Boolean(menuAnchor)}
          slotProps={{ paper: { sx: { maxWidth: 320 } } }}
        >
          {!chainName &&
            menuItem(
              'rename',
              <EditRoundedIcon fontSize="small" />,
              t('core:qortal_card.card.rename')
            )}
          {!chainName &&
            !registering &&
            menuItem(
              'register',
              <BadgeRoundedIcon fontSize="small" />,
              t('core:qortal_card.name.title')
            )}
          {chainName &&
            menuItem(
              'avatar',
              <AddPhotoAlternateRoundedIcon fontSize="small" />,
              t('core:qortal_card.avatar.title'),
              walletOnly
            )}
          {menuItem(
            'backup',
            <SaveAltRoundedIcon fontSize="small" />,
            t('core:qortal_card.card.backup')
          )}
          {menuItem(
            'remove',
            <DeleteOutlineRoundedIcon fontSize="small" />,
            sentence('core:action.remove')
          )}
        </Menu>
      </Box>

      {notice && (
        <Box
          role={notice.tone === 'error' ? 'alert' : 'status'}
          sx={{ ...noteSx(theme, notice.tone), alignItems: 'center' }}
        >
          <Box sx={{ flex: 1 }}>{notice.text}</Box>
          {notice.action && (
            <Button
              onClick={notice.action.run}
              size="small"
              sx={{ flexShrink: 0 }}
              variant="outlined"
            >
              {notice.action.label}
            </Button>
          )}
          <IconButton
            aria-label={sentence('core:action.close')}
            onClick={onDismissNotice}
            size="small"
            sx={{ m: -0.5 }}
          >
            <CloseRoundedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      )}

      <Box sx={{ alignItems: 'baseline', display: 'flex', gap: 1 }}>
        <Typography sx={{ fontSize: '1.45rem', fontWeight: 800 }}>
          {balance === undefined
            ? '…'
            : balance === null
              ? t('core:qortal_card.card.balance_unknown')
              : t('core:qortal_card.card.balance', {
                  amount: formatQortUnits(balance),
                })}
        </Typography>
        {updating && (
          <Box
            sx={{
              alignItems: 'center',
              color: theme.palette.text.secondary,
              display: 'flex',
              fontSize: '0.78rem',
              gap: 0.5,
            }}
          >
            <CircularProgress size={12} thickness={5} />
            {t('core:qortal_card.card.updating')}
          </Box>
        )}
      </Box>

      <Box sx={{ alignItems: 'center', display: 'flex', gap: 0.5 }}>
        <Typography
          sx={{
            color: theme.palette.text.secondary,
            flex: 1,
            fontFamily: 'monospace',
            fontSize: '0.78rem',
            wordBreak: 'break-all',
          }}
        >
          {card.address}
        </Typography>
        {copied ? (
          <Typography
            sx={{ color: theme.palette.success.main, fontSize: '0.75rem' }}
          >
            {sentence('core:action.copied')}
          </Typography>
        ) : (
          <IconButton
            aria-label={t('core:qortal_card.card.copy_address')}
            onClick={copyAddress}
            size="small"
          >
            <ContentCopyRoundedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        )}
      </Box>
      <Typography sx={hintSx(theme)}>
        {(chainName || registering) &&
          `${
            walletKey
              ? t('core:qortal_card.card.key_wallet')
              : t('core:qortal_card.card.key_card')
          } · `}
        {card.applet === 'qortal-lab'
          ? t('core:qortal_card.card.applet_lab')
          : t('core:qortal_card.card.applet_futako')}
      </Typography>

      {body}
    </Box>
  );
}
