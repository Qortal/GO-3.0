import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ContactlessRoundedIcon from '@mui/icons-material/ContactlessRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import SaveAltRoundedIcon from '@mui/icons-material/SaveAltRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import {
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  Slider,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useTheme, type Theme } from '@mui/material/styles';
import { useAtomValue } from 'jotai';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { selectedNodeInfoAtom } from '../../atoms/global';
import ImageUploader from '../../common/ImageUploader';
import {
  EXT_NODE_QORTAL_LINK,
  MAX_SIZE_AVATAR,
} from '../../constants/constants';
import { useSecureScreen } from '../../hooks/useSecureScreen';
import { fetchUnitFee, isNameFree } from '../../qortalCard/cardNode';
import {
  formatQortUnits,
  MAX_NAME_BYTES,
  MIN_NAME_BYTES,
  nameByteLength,
  parseQortAmount,
} from '../../qortalCard/cardTx';
import { noteSx } from './cardStyles';

export const hintSx = (theme: Theme) => ({
  color: theme.palette.text.secondary,
  fontSize: '0.8rem',
  lineHeight: 1.45,
});

const titleSx = { fontSize: '0.92rem', fontWeight: 750 };

function useSentence() {
  const { t } = useTranslation(['core']);
  return (key: string) => t(key, { postProcess: 'capitalizeFirstChar' });
}

/** The node's fee for one kind of transaction, or null until it answers. */
function useUnitFee(kind: 'register-name' | 'publish'): bigint | null {
  const [fee, setFee] = useState<bigint | null>(null);
  useEffect(() => {
    let live = true;
    fetchUnitFee(kind)
      .then((value) => live && setFee(value))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [kind]);
  return fee;
}

function FormButtons({
  children,
  onCancel,
  disabled,
}: {
  children: ReactNode;
  onCancel: () => void;
  disabled?: boolean;
}) {
  const sentence = useSentence();
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
      {children}
      <Button disabled={disabled} onClick={onCancel}>
        {sentence('core:action.cancel')}
      </Button>
    </Box>
  );
}

type MoveMode = 'all' | 'amount' | 'percent';
const QUICK_PERCENTS = [10, 25, 50, 75];

/**
 * How much to move back: all of it, a typed amount, or a share. The fee
 * comes off the card on top, so "all" is the balance less the fee.
 */
export function MoveBackForm({
  balance,
  fee,
  walletKey,
  nfcReady,
  busy,
  onConfirm,
  onCancel,
}: {
  balance: bigint;
  fee: bigint;
  walletKey: boolean;
  nfcReady: boolean;
  busy: boolean;
  onConfirm: (amount: bigint) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [mode, setMode] = useState<MoveMode>('all');
  const [amountText, setAmountText] = useState('');
  const [percent, setPercent] = useState(50);
  const available = balance - fee;
  const typed = parseQortAmount(amountText);
  const amount =
    mode === 'all'
      ? available
      : mode === 'amount'
        ? typed
        : (available * BigInt(percent)) / 100n;
  const tooMuch = mode === 'amount' && typed !== null && typed > available;
  const valid = amount !== null && amount > 0n && amount <= available;
  const max = formatQortUnits(available);

  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Typography sx={titleSx}>
        {t('core:qortal_card.move_back.title')}
      </Typography>
      <ToggleButtonGroup
        exclusive
        fullWidth
        onChange={(_, next: MoveMode | null) => next && setMode(next)}
        size="small"
        value={mode}
      >
        <ToggleButton value="all">
          {t('core:qortal_card.move_back.mode_all')}
        </ToggleButton>
        <ToggleButton value="amount">
          {t('core:qortal_card.move_back.mode_amount')}
        </ToggleButton>
        <ToggleButton value="percent">
          {t('core:qortal_card.move_back.mode_percent')}
        </ToggleButton>
      </ToggleButtonGroup>

      {mode === 'amount' && (
        <TextField
          autoComplete="off"
          autoFocus
          error={tooMuch || (amountText !== '' && typed === null)}
          helperText={
            tooMuch
              ? t('core:qortal_card.move_back.too_much', { max })
              : amountText !== '' && typed === null
                ? t('core:qortal_card.pay.amount_invalid')
                : t('core:qortal_card.move_back.max', { max })
          }
          InputProps={{
            endAdornment: <InputAdornment position="end">QORT</InputAdornment>,
          }}
          inputProps={{
            'aria-label': t('core:qortal_card.pay.amount_label'),
            inputMode: 'decimal',
          }}
          onChange={(event) => setAmountText(event.target.value)}
          size="small"
          value={amountText}
        />
      )}

      {mode === 'percent' && (
        <Box sx={{ display: 'grid', gap: 0.5 }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {QUICK_PERCENTS.map((value) => (
              <Chip
                clickable
                color={value === percent ? 'primary' : 'default'}
                key={value}
                label={t('core:qortal_card.move_back.percent', { value })}
                onClick={() => setPercent(value)}
                size="small"
                variant={value === percent ? 'filled' : 'outlined'}
              />
            ))}
          </Box>
          <Slider
            aria-label={t('core:qortal_card.move_back.mode_percent')}
            max={100}
            min={1}
            onChange={(_, value) => setPercent(value as number)}
            size="small"
            value={percent}
            valueLabelDisplay="auto"
            valueLabelFormat={(value) =>
              t('core:qortal_card.move_back.percent', { value })
            }
          />
        </Box>
      )}

      {valid && (
        <Box sx={{ display: 'grid', gap: 0.25 }}>
          <Typography sx={{ fontSize: '1.35rem', fontWeight: 800 }}>
            {t('core:qortal_card.card.balance', {
              amount: formatQortUnits(amount),
            })}
          </Typography>
          <Typography sx={hintSx(theme)}>
            {t('core:qortal_card.move_back.summary', {
              fee: formatQortUnits(fee),
              left: formatQortUnits(balance - amount - fee),
            })}
          </Typography>
        </Box>
      )}
      {!walletKey && (
        <Typography sx={hintSx(theme)}>
          {t('core:qortal_card.move_back.needs_card')}
        </Typography>
      )}
      <FormButtons disabled={busy} onCancel={onCancel}>
        <Button
          disabled={!valid || busy || (!walletKey && !nfcReady)}
          onClick={() => valid && onConfirm(amount)}
          startIcon={walletKey ? undefined : <ContactlessRoundedIcon />}
          variant="contained"
        >
          {valid
            ? t('core:qortal_card.move_back.button', {
                amount: formatQortUnits(amount),
              })
            : t('core:qortal_card.card.move_back')}
        </Button>
      </FormButtons>
    </Box>
  );
}

type Availability = 'idle' | 'checking' | 'free' | 'taken' | 'unknown';

/**
 * A name on chain for the card's account (REGISTER_NAME, paid from the
 * card). With a name, payments show it instead of the address, and the card
 * can have an avatar.
 */
export function RegisterNameForm({
  balance,
  walletKey,
  nfcReady,
  busy,
  onRegister,
  onTopUp,
  onCancel,
}: {
  balance: bigint | null | undefined;
  walletKey: boolean;
  nfcReady: boolean;
  busy: boolean;
  onRegister: (name: string, fee: bigint) => void;
  onTopUp: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const fee = useUnitFee('register-name');
  const [text, setText] = useState('');
  const [availability, setAvailability] = useState<Availability>('idle');
  const name = text.trim();
  const bytes = nameByteLength(name);
  const lengthOk = bytes >= MIN_NAME_BYTES && bytes <= MAX_NAME_BYTES;

  useEffect(() => {
    if (!lengthOk) {
      setAvailability('idle');
      return;
    }
    let live = true;
    setAvailability('checking');
    const timer = setTimeout(() => {
      isNameFree(name)
        .then((free) => live && setAvailability(free ? 'free' : 'taken'))
        .catch(() => live && setAvailability('unknown'));
    }, 500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [name, lengthOk]);

  const enough = fee !== null && balance != null && balance >= fee;
  const canRegister =
    lengthOk &&
    (availability === 'free' || availability === 'unknown') &&
    enough &&
    !busy &&
    (walletKey || nfcReady);

  const status: Record<Availability, ReactNode> = {
    idle: null,
    checking: <CircularProgress size={16} />,
    free: (
      <CheckCircleRoundedIcon
        fontSize="small"
        sx={{ color: theme.palette.success.main }}
      />
    ),
    taken: (
      <ErrorOutlineRoundedIcon
        fontSize="small"
        sx={{ color: theme.palette.error.main }}
      />
    ),
    unknown: null,
  };

  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Typography sx={titleSx}>{t('core:qortal_card.name.title')}</Typography>
      <Typography sx={hintSx(theme)}>
        {t('core:qortal_card.name.what')}
      </Typography>
      <TextField
        autoComplete="off"
        autoFocus
        error={availability === 'taken' || (name !== '' && !lengthOk)}
        helperText={
          name !== '' && !lengthOk
            ? t('core:qortal_card.name.length', {
                min: MIN_NAME_BYTES,
                max: MAX_NAME_BYTES,
              })
            : availability === 'taken'
              ? t('core:qortal_card.name.taken')
              : availability === 'free'
                ? t('core:qortal_card.name.free')
                : ' '
        }
        InputProps={{
          endAdornment: status[availability] ? (
            <InputAdornment position="end">
              {status[availability]}
            </InputAdornment>
          ) : undefined,
        }}
        inputProps={{ maxLength: MAX_NAME_BYTES }}
        label={t('core:qortal_card.name.label')}
        onChange={(event) => setText(event.target.value)}
        size="small"
        value={text}
      />
      {fee !== null && (
        <Typography sx={hintSx(theme)}>
          {t('core:qortal_card.name.fee', { fee: formatQortUnits(fee) })}
        </Typography>
      )}
      {fee !== null && balance != null && !enough && (
        <Box sx={{ ...noteSx(theme, 'warning'), alignItems: 'center' }}>
          <Typography sx={{ flex: 1, fontSize: '0.8rem' }}>
            {t('core:qortal_card.name.top_up_first', {
              fee: formatQortUnits(fee),
              balance: formatQortUnits(balance),
            })}
          </Typography>
          <Button onClick={onTopUp} size="small" variant="outlined">
            {t('core:qortal_card.card.top_up')}
          </Button>
        </Box>
      )}
      {!walletKey && (
        <Typography sx={hintSx(theme)}>
          {t('core:qortal_card.name.needs_card')}
        </Typography>
      )}
      <FormButtons disabled={busy} onCancel={onCancel}>
        <Button
          disabled={!canRegister}
          onClick={() => fee !== null && onRegister(name, fee)}
          startIcon={walletKey ? undefined : <ContactlessRoundedIcon />}
          variant="contained"
        >
          {t('core:qortal_card.name.button')}
        </Button>
      </FormButtons>
    </Box>
  );
}

/** A picture for the card's name (THUMBNAIL / qortal_avatar, paid from the card). */
export function AvatarForm({
  name,
  balance,
  busy,
  onPublish,
  onTopUp,
  onCancel,
}: {
  name: string;
  balance: bigint | null | undefined;
  busy: boolean;
  onPublish: (file: File, fee: bigint) => void;
  onTopUp: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const fee = useUnitFee('publish');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');

  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const tooBig = file !== null && file.size > MAX_SIZE_AVATAR * 1024;
  const enough = fee !== null && balance != null && balance >= fee;
  // Same rule as Settings: no own node, or the public one. Public nodes take
  // no uploads without their API key, so nothing can be published there.
  const node = useAtomValue(selectedNodeInfoAtom);
  const onPublicNode = !node?.url || node.url.includes(EXT_NODE_QORTAL_LINK);

  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Typography sx={titleSx}>{t('core:qortal_card.avatar.title')}</Typography>
      <Typography sx={hintSx(theme)}>
        {t('core:qortal_card.avatar.what', { name })}
      </Typography>
      <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.5 }}>
        <Avatar src={preview || undefined} sx={{ height: 64, width: 64 }}>
          <ImageRoundedIcon />
        </Avatar>
        <ImageUploader onPick={(picked) => setFile(picked)}>
          <Button
            disabled={busy}
            startIcon={<ImageRoundedIcon />}
            variant="outlined"
          >
            {file
              ? t('core:qortal_card.avatar.change')
              : t('core:qortal_card.avatar.pick')}
          </Button>
        </ImageUploader>
      </Box>
      {onPublicNode && (
        <Box sx={noteSx(theme, 'warning')}>
          {t('core:qortal_card.avatar.public_node')}
        </Box>
      )}
      {tooBig && (
        <Box sx={noteSx(theme, 'error')}>
          {t('core:qortal_card.avatar.too_big', { size: MAX_SIZE_AVATAR })}
        </Box>
      )}
      {fee !== null && (
        <Typography sx={hintSx(theme)}>
          {t('core:qortal_card.avatar.fee', { fee: formatQortUnits(fee) })}
        </Typography>
      )}
      {fee !== null && balance != null && !enough && (
        <Box sx={{ ...noteSx(theme, 'warning'), alignItems: 'center' }}>
          <Typography sx={{ flex: 1, fontSize: '0.8rem' }}>
            {t('core:qortal_card.avatar.top_up_first', {
              fee: formatQortUnits(fee),
            })}
          </Typography>
          <Button onClick={onTopUp} size="small" variant="outlined">
            {t('core:qortal_card.card.top_up')}
          </Button>
        </Box>
      )}
      <FormButtons disabled={busy} onCancel={onCancel}>
        <Button
          disabled={!file || tooBig || !enough || busy || onPublicNode}
          onClick={() => file && fee !== null && onPublish(file, fee)}
          variant="contained"
        >
          {busy
            ? t('core:qortal_card.avatar.publishing')
            : t('core:qortal_card.avatar.button')}
        </Button>
      </FormButtons>
    </Box>
  );
}

/**
 * A card that made its own key has no backup file: the key never leaves the
 * card, by design (a key that could be read out over NFC could be copied by
 * anyone with a phone). A lab card can switch to a key from the wallet.
 */
export function KeyOnCardInfo({
  canSwitch,
  chainName,
  busy,
  onSwitch,
  onCancel,
}: {
  /** The card can take a key from GO (the lab applet). */
  canSwitch: boolean;
  chainName: string | null;
  busy: boolean;
  onSwitch: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Typography sx={titleSx}>{t('core:qortal_card.card.backup')}</Typography>
      <Typography sx={hintSx(theme)}>
        {t('core:qortal_card.backup.card_key')}
      </Typography>
      <Typography sx={hintSx(theme)}>
        {!canSwitch
          ? t('core:qortal_card.error.no_import')
          : chainName
            ? t('core:qortal_card.switch.has_name', { name: chainName })
            : t('core:qortal_card.switch.how')}
      </Typography>
      <FormButtons disabled={busy} onCancel={onCancel}>
        {canSwitch && !chainName && (
          <Button
            disabled={busy}
            onClick={onSwitch}
            startIcon={<KeyRoundedIcon />}
            variant="contained"
          >
            {t('core:qortal_card.switch.title')}
          </Button>
        )}
      </FormButtons>
    </Box>
  );
}

export type SwitchStage = 'confirm' | 'waiting' | 'ready';

/**
 * Switching a card with its own key to a key from the wallet: its QORT goes
 * back first (the old key is about to be overwritten), and only an empty old
 * address gets the new key.
 */
export function SwitchKeyForm({
  stage,
  balance,
  fee,
  busy,
  nfcReady,
  onMove,
  onLoad,
  onCancel,
}: {
  stage: SwitchStage;
  balance: bigint;
  fee: bigint;
  busy: boolean;
  nfcReady: boolean;
  onMove: () => void;
  onLoad: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const movable = balance - fee;
  const tap = <ContactlessRoundedIcon />;

  let content: ReactNode;
  if (stage === 'waiting') {
    content = (
      <Box sx={{ alignItems: 'center', display: 'flex', gap: 1 }}>
        <CircularProgress size={16} />
        <Typography sx={hintSx(theme)}>
          {t('core:qortal_card.switch.waiting')}
        </Typography>
      </Box>
    );
  } else if (stage === 'confirm' && movable > 0n) {
    content = (
      <>
        <Typography sx={{ fontSize: '0.85rem' }}>
          {t('core:qortal_card.switch.move_first', {
            amount: formatQortUnits(movable),
            fee: formatQortUnits(fee),
          })}
        </Typography>
        <Box>
          <Button
            disabled={busy || !nfcReady}
            onClick={onMove}
            startIcon={tap}
            variant="contained"
          >
            {t('core:qortal_card.switch.move_button')}
          </Button>
        </Box>
      </>
    );
  } else {
    content = (
      <>
        {balance > 0n && (
          <Box sx={noteSx(theme, 'warning')}>
            {t('core:qortal_card.switch.dust', {
              amount: formatQortUnits(balance),
            })}
          </Box>
        )}
        <Typography sx={{ fontSize: '0.85rem' }}>
          {balance > 0n
            ? t('core:qortal_card.prompt.switch')
            : t('core:qortal_card.switch.ready')}
        </Typography>
        <Box>
          <Button
            disabled={busy || !nfcReady}
            onClick={onLoad}
            startIcon={tap}
            variant="contained"
          >
            {t('core:qortal_card.switch.load_button')}
          </Button>
        </Box>
      </>
    );
  }

  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Typography sx={titleSx}>{t('core:qortal_card.switch.title')}</Typography>
      {content}
      <FormButtons disabled={busy} onCancel={onCancel}>
        {null}
      </FormButtons>
    </Box>
  );
}

/** Password for the card's backup file. Screenshots are blocked meanwhile. */
export function BackupForm({
  onSave,
  onCancel,
}: {
  onSave: (password: string) => Promise<void>;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const sentence = useSentence();
  useSecureScreen({ secure: true });
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const mismatch = repeat !== '' && repeat !== password;

  const save = async () => {
    setSaving(true);
    try {
      await onSave(password);
    } finally {
      setSaving(false);
    }
  };

  const toggle = (
    <InputAdornment position="end">
      <IconButton
        aria-label={sentence(visible ? 'core:action.hide' : 'core:action.show')}
        edge="end"
        onClick={() => setVisible((value) => !value)}
        size="small"
      >
        {visible ? (
          <VisibilityOffRoundedIcon fontSize="small" />
        ) : (
          <VisibilityRoundedIcon fontSize="small" />
        )}
      </IconButton>
    </InputAdornment>
  );

  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Typography sx={titleSx}>{t('core:qortal_card.card.backup')}</Typography>
      <Typography sx={hintSx(theme)}>
        {t('core:qortal_card.backup.what')}
      </Typography>
      <TextField
        autoComplete="new-password"
        autoFocus
        InputProps={{ endAdornment: toggle }}
        label={t('core:qortal_card.backup.password')}
        onChange={(event) => setPassword(event.target.value)}
        size="small"
        type={visible ? 'text' : 'password'}
        value={password}
      />
      <TextField
        autoComplete="new-password"
        error={mismatch}
        helperText={mismatch ? t('core:qortal_card.backup.mismatch') : ' '}
        label={t('core:qortal_card.backup.repeat')}
        onChange={(event) => setRepeat(event.target.value)}
        size="small"
        type={visible ? 'text' : 'password'}
        value={repeat}
      />
      <FormButtons disabled={saving} onCancel={onCancel}>
        <Button
          disabled={saving || !password || repeat !== password}
          onClick={() => void save()}
          startIcon={<SaveAltRoundedIcon />}
          variant="contained"
        >
          {saving
            ? t('core:qortal_card.backup.saving')
            : t('core:qortal_card.backup.button')}
        </Button>
      </FormButtons>
    </Box>
  );
}
