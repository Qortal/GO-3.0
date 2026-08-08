import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  ButtonBase,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloudRoundedIcon from '@mui/icons-material/CloudRounded';
import DnsRoundedIcon from '@mui/icons-material/DnsRounded';
import RadioButtonCheckedRoundedIcon from '@mui/icons-material/RadioButtonCheckedRounded';
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { selectedNodeInfoAtom } from '../../atoms/global';
import {
  HTTPS_EXT_NODE_QORTAL_LINK,
  isPublicGatewayNodeUrl,
} from '../../constants/constants';
import { useAuth } from '../../hooks/useAuth';
import {
  loadPrivateNodeDraft,
  savePrivateNodeDraft,
} from '../../utils/privateNodeDraft';
import { AuthButton } from '../Auth/AuthShell';

type NodeMode = 'public' | 'private';

function normalizeNodeUrl(url: string) {
  return url.trim().replace(/\/+$/, '');
}

function resolveNodeMode(url?: string | null): NodeMode {
  return isPublicGatewayNodeUrl(url) ? 'public' : 'private';
}

type MobileNodeConnectionSettingsProps = {
  compact?: boolean;
};

export function MobileNodeConnectionSettings({
  compact = false,
}: MobileNodeConnectionSettingsProps) {
  const theme = useTheme();
  const isLight = theme.palette.mode === 'light';
  const { t } = useTranslation(['auth']);
  const selectedNode = useAtomValue(selectedNodeInfoAtom);
  const { handleSaveNodeInfo } = useAuth();

  const [mode, setMode] = useState<NodeMode>(() =>
    resolveNodeMode(selectedNode?.url)
  );
  const [privateUrl, setPrivateUrl] = useState('');
  const [privateApiKey, setPrivateApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedHint, setSavedHint] = useState('');

  // Keep the last private node draft even while public is active, so switching
  // back (and pre-login → post-login Settings) restores the saved fields.
  useEffect(() => {
    let cancelled = false;
    const nextMode = resolveNodeMode(selectedNode?.url);
    setMode(nextMode);

    const hydrate = async () => {
      if (nextMode === 'private' && selectedNode?.url) {
        const url = normalizeNodeUrl(selectedNode.url);
        const apikey = selectedNode.apikey || '';
        if (!cancelled) {
          setPrivateUrl(url);
          setPrivateApiKey(apikey);
        }
        await savePrivateNodeDraft({ url, apikey });
        return;
      }

      const draft = await loadPrivateNodeDraft();
      if (!cancelled && draft) {
        setPrivateUrl(draft.url);
        setPrivateApiKey(draft.apikey);
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [selectedNode?.apikey, selectedNode?.url]);

  const cardSx = useMemo(
    () => ({
      alignItems: 'center',
      background: isLight
        ? 'rgba(255,255,255,0.72)'
        : 'rgba(255,255,255,0.04)',
      border: isLight
        ? `1px solid ${theme.palette.divider}`
        : '1px solid rgba(255,255,255,0.08)',
      borderRadius: compact ? '14px' : '12px',
      display: 'flex',
      gap: 1.1,
      px: compact ? 1.35 : 2,
      py: compact ? 1.15 : 1.25,
      textAlign: 'left' as const,
      touchAction: 'manipulation' as const,
      width: '100%',
      WebkitTapHighlightColor: 'transparent',
    }),
    [compact, isLight, theme.palette.divider]
  );

  const savePublic = useCallback(async () => {
    setBusy(true);
    setError('');
    setSavedHint('');
    try {
      // Persist any typed private fields before overwriting the active node.
      if (privateUrl.trim()) {
        await savePrivateNodeDraft({
          url: normalizeNodeUrl(privateUrl),
          apikey: privateApiKey.trim(),
        });
      }
      await handleSaveNodeInfo({
        url: HTTPS_EXT_NODE_QORTAL_LINK,
        apikey: '',
      });
      setMode('public');
      setSavedHint(t('auth:mobile_node_settings.saved_public'));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('auth:mobile_node_settings.save_failed')
      );
    } finally {
      setBusy(false);
    }
  }, [handleSaveNodeInfo, privateApiKey, privateUrl, t]);

  const savePrivate = useCallback(async () => {
    const url = normalizeNodeUrl(privateUrl);
    if (!url) {
      setError(t('auth:mobile_node_settings.private_url_required'));
      return;
    }

    setBusy(true);
    setError('');
    setSavedHint('');
    try {
      const apikey = privateApiKey.trim();
      await savePrivateNodeDraft({ url, apikey });
      await handleSaveNodeInfo({
        url,
        apikey,
        name: t('auth:mobile_node_settings.private_title'),
      });
      setMode('private');
      setSavedHint(t('auth:mobile_node_settings.saved_private'));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('auth:mobile_node_settings.save_failed')
      );
    } finally {
      setBusy(false);
    }
  }, [handleSaveNodeInfo, privateApiKey, privateUrl, t]);

  const selectMode = async (nextMode: NodeMode) => {
    setError('');
    setSavedHint('');
    setMode(nextMode);
    if (nextMode === 'public') {
      await savePublic();
      return;
    }
    // Switching back to private: restore staged draft fields into the form.
    const draft = await loadPrivateNodeDraft();
    if (draft) {
      setPrivateUrl(draft.url);
      setPrivateApiKey(draft.apikey);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: compact ? 1 : 1.5 }}>
      {!compact && (
        <Box sx={{ px: 0.5 }}>
          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>
            {t('auth:mobile_node_settings.section_title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {t('auth:mobile_node_settings.section_hint')}
          </Typography>
        </Box>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <ButtonBase
          disabled={busy}
          onClick={() => void selectMode('public')}
          sx={{
            ...cardSx,
            background:
              mode === 'public'
                ? alpha(theme.palette.primary.main, 0.12)
                : cardSx.background,
            border:
              mode === 'public'
                ? `1px solid ${alpha(theme.palette.primary.main, 0.35)}`
                : cardSx.border,
            justifyContent: 'flex-start',
          }}
        >
          {mode === 'public' ? (
            <RadioButtonCheckedRoundedIcon
              sx={{ color: theme.palette.primary.main, fontSize: 20 }}
            />
          ) : (
            <RadioButtonUncheckedRoundedIcon
              sx={{ color: theme.palette.text.secondary, fontSize: 20 }}
            />
          )}
          <Box
            sx={{
              alignItems: 'center',
              background: alpha(theme.palette.primary.main, 0.12),
              borderRadius: '10px',
              color: theme.palette.primary.main,
              display: 'flex',
              height: 36,
              justifyContent: 'center',
              width: 36,
              flexShrink: 0,
            }}
          >
            <CloudRoundedIcon sx={{ fontSize: 20 }} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
            <Typography sx={{ fontSize: '0.88rem', fontWeight: 700 }}>
              {t('auth:mobile_node_settings.public_title')}
            </Typography>
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.74rem',
                lineHeight: 1.35,
                mt: 0.2,
              }}
            >
              {t('auth:mobile_node_settings.public_hint')}
            </Typography>
          </Box>
        </ButtonBase>

        <ButtonBase
          disabled={busy}
          onClick={() => setMode('private')}
          sx={{
            ...cardSx,
            background:
              mode === 'private'
                ? alpha(theme.palette.primary.main, 0.12)
                : cardSx.background,
            border:
              mode === 'private'
                ? `1px solid ${alpha(theme.palette.primary.main, 0.35)}`
                : cardSx.border,
            justifyContent: 'flex-start',
          }}
        >
          {mode === 'private' ? (
            <RadioButtonCheckedRoundedIcon
              sx={{ color: theme.palette.primary.main, fontSize: 20 }}
            />
          ) : (
            <RadioButtonUncheckedRoundedIcon
              sx={{ color: theme.palette.text.secondary, fontSize: 20 }}
            />
          )}
          <Box
            sx={{
              alignItems: 'center',
              background: alpha(theme.palette.warning.main, 0.12),
              borderRadius: '10px',
              color: theme.palette.warning.main,
              display: 'flex',
              height: 36,
              justifyContent: 'center',
              width: 36,
              flexShrink: 0,
            }}
          >
            <DnsRoundedIcon sx={{ fontSize: 20 }} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
            <Typography sx={{ fontSize: '0.88rem', fontWeight: 700 }}>
              {t('auth:mobile_node_settings.private_title')}
            </Typography>
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.74rem',
                lineHeight: 1.35,
                mt: 0.2,
              }}
            >
              {t('auth:mobile_node_settings.private_hint')}
            </Typography>
          </Box>
        </ButtonBase>
      </Box>

      {mode === 'private' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <TextField
            label={t('auth:connection_mode.field_node_url')}
            placeholder={t('auth:connection_mode.placeholder_node_url')}
            value={privateUrl}
            onChange={(e) => setPrivateUrl(e.target.value)}
            fullWidth
            size="small"
          />
          <TextField
            label={t('auth:connection_mode.field_api_key_optional')}
            placeholder={t('auth:connection_mode.placeholder_api_key')}
            value={privateApiKey}
            onChange={(e) => setPrivateApiKey(e.target.value)}
            fullWidth
            size="small"
          />
          <AuthButton
            onClick={() => void savePrivate()}
            disabled={busy || !privateUrl.trim()}
            primary
            fullWidth
          >
            {busy
              ? t('auth:mobile_node_settings.saving')
              : t('auth:mobile_node_settings.save_private')}
          </AuthButton>
        </Box>
      )}

      {savedHint && (
        <Typography sx={{ color: theme.palette.success.main, fontSize: '0.76rem' }}>
          {savedHint}
        </Typography>
      )}
      {error && (
        <Typography sx={{ color: theme.palette.error.main, fontSize: '0.76rem' }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}
