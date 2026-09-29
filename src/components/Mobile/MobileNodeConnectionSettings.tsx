import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  ButtonBase,
  IconButton,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CloudRoundedIcon from '@mui/icons-material/CloudRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DnsRoundedIcon from '@mui/icons-material/DnsRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
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
import type { ApiKey } from '../../types/auth';
import {
  loadPrivateNodeDraft,
  savePrivateNodeDraft,
} from '../../utils/privateNodeDraft';
import { preferHttpForLocalPrivateUrl } from '../../utils/helpers';
import { AuthButton } from '../Auth/AuthShell';

type NodeMode = 'public' | 'private';
type EditorState =
  | { mode: 'hidden' }
  | { mode: 'add' }
  | { mode: 'edit'; originalUrl: string };

function normalizeNodeUrl(url: string) {
  const trimmed = url.trim().replace(/\/+$/, '');
  return preferHttpForLocalPrivateUrl(trimmed) || trimmed;
}

function normalizeCustomNodes(nodes: unknown): ApiKey[] {
  if (!Array.isArray(nodes)) return [];
  return nodes
    .map((node) => ({
      url: typeof node?.url === 'string' ? normalizeNodeUrl(node.url) : '',
      apikey: typeof node?.apikey === 'string' ? node.apikey : '',
      name: typeof node?.name === 'string' ? node.name.trim() : '',
    }))
    .filter((node) => Boolean(node.url));
}

function resolveNodeMode(url?: string | null): NodeMode {
  return isPublicGatewayNodeUrl(url) ? 'public' : 'private';
}

function nodeHostLabel(url: string) {
  try {
    const parsed = new URL(url.includes('://') ? url : `http://${url}`);
    return parsed.host || url;
  } catch {
    return url;
  }
}

function nodeTitle(node: ApiKey) {
  return node.name?.trim() || nodeHostLabel(node.url);
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
  const [savedNodes, setSavedNodes] = useState<ApiKey[]>([]);
  const [editor, setEditor] = useState<EditorState>({ mode: 'hidden' });
  const [draftName, setDraftName] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [draftApiKey, setDraftApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedHint, setSavedHint] = useState('');

  const persistSavedNodes = useCallback(async (nodes: ApiKey[]) => {
    const normalized = normalizeCustomNodes(nodes);
    await window.sendMessage('setCustomNodes', normalized);
    setSavedNodes(normalized);
    return normalized;
  }, []);

  const loadSavedNodes = useCallback(async () => {
    let nodes = normalizeCustomNodes(
      await window.sendMessage('getCustomNodesFromStorage').catch(() => [])
    );
    const selectedUrl = selectedNode?.url
      ? normalizeNodeUrl(selectedNode.url)
      : '';
    if (selectedUrl && !isPublicGatewayNodeUrl(selectedUrl)) {
      const selected: ApiKey = {
        url: selectedUrl,
        apikey: selectedNode?.apikey || '',
        name: selectedNode?.name || '',
      };
      if (!nodes.some((node) => node.url === selectedUrl)) {
        nodes = [...nodes, selected];
        await persistSavedNodes(nodes);
      }
    } else if (nodes.length === 0) {
      const draft = await loadPrivateNodeDraft();
      if (draft) {
        nodes = [
          {
            url: normalizeNodeUrl(draft.url),
            apikey: draft.apikey,
            name: '',
          },
        ];
        await persistSavedNodes(nodes);
      }
    }
    setSavedNodes(nodes);
  }, [
    persistSavedNodes,
    selectedNode?.apikey,
    selectedNode?.name,
    selectedNode?.url,
  ]);

  useEffect(() => {
    setMode(resolveNodeMode(selectedNode?.url));
    void loadSavedNodes();
  }, [loadSavedNodes, selectedNode?.url]);

  const selectedUrl = selectedNode?.url
    ? normalizeNodeUrl(selectedNode.url)
    : '';

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

  const closeEditor = () => {
    setEditor({ mode: 'hidden' });
    setDraftName('');
    setDraftUrl('');
    setDraftApiKey('');
  };

  const openAdd = () => {
    setError('');
    setSavedHint('');
    setDraftName('');
    setDraftUrl('');
    setDraftApiKey('');
    setEditor({ mode: 'add' });
    setMode('private');
  };

  const openEdit = (node: ApiKey) => {
    setError('');
    setSavedHint('');
    setDraftName(node.name || '');
    setDraftUrl(node.url);
    setDraftApiKey(node.apikey || '');
    setEditor({ mode: 'edit', originalUrl: node.url });
    setMode('private');
  };

  const applyNode = useCallback(
    async (node: ApiKey, hint: string) => {
      setBusy(true);
      setError('');
      setSavedHint('');
      try {
        const payload: ApiKey = {
          url: normalizeNodeUrl(node.url),
          apikey: node.apikey || '',
          name: node.name || '',
        };
        await savePrivateNodeDraft({
          url: payload.url,
          apikey: payload.apikey,
        });
        await handleSaveNodeInfo(payload);
        setMode('private');
        setSavedHint(hint);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : t('auth:mobile_node_settings.save_failed')
        );
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [handleSaveNodeInfo, t]
  );

  const savePublic = useCallback(async () => {
    setBusy(true);
    setError('');
    setSavedHint('');
    try {
      await handleSaveNodeInfo({
        url: HTTPS_EXT_NODE_QORTAL_LINK,
        apikey: '',
      });
      setMode('public');
      closeEditor();
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
  }, [handleSaveNodeInfo, t]);

  const saveEditor = useCallback(async () => {
    const url = normalizeNodeUrl(draftUrl);
    if (!url) {
      setError(t('auth:mobile_node_settings.private_url_required'));
      return;
    }
    if (isPublicGatewayNodeUrl(url)) {
      setError(t('auth:mobile_node_settings.private_url_required'));
      return;
    }

    const payload: ApiKey = {
      url,
      apikey: draftApiKey.trim(),
      name: draftName.trim(),
    };

    setBusy(true);
    setError('');
    setSavedHint('');
    try {
      const replaceUrl =
        editor.mode === 'edit' ? editor.originalUrl : url;
      const without = savedNodes.filter(
        (node) => node.url !== replaceUrl && node.url !== url
      );
      const next = [...without, payload];
      await persistSavedNodes(next);
      await applyNode(
        payload,
        t('auth:mobile_node_settings.using_node', {
          name: nodeTitle(payload),
        })
      );
      closeEditor();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('auth:mobile_node_settings.save_failed')
      );
    } finally {
      setBusy(false);
    }
  }, [
    applyNode,
    draftApiKey,
    draftName,
    draftUrl,
    editor,
    persistSavedNodes,
    savedNodes,
    t,
  ]);

  const removeNode = useCallback(
    async (nodeToRemove: ApiKey) => {
      setBusy(true);
      setError('');
      setSavedHint('');
      try {
        const next = savedNodes.filter((node) => node.url !== nodeToRemove.url);
        await persistSavedNodes(next);
        if (selectedUrl === nodeToRemove.url) {
          await handleSaveNodeInfo({
            url: HTTPS_EXT_NODE_QORTAL_LINK,
            apikey: '',
          });
          setMode('public');
          setSavedHint(t('auth:mobile_node_settings.saved_public'));
        }
        if (editor.mode === 'edit' && editor.originalUrl === nodeToRemove.url) {
          closeEditor();
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : t('auth:mobile_node_settings.save_failed')
        );
      } finally {
        setBusy(false);
      }
    },
    [
      editor,
      handleSaveNodeInfo,
      persistSavedNodes,
      savedNodes,
      selectedUrl,
      t,
    ]
  );

  const editorOpen = editor.mode !== 'hidden';

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

      <ButtonBase
        disabled={busy}
        onClick={() => void savePublic()}
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

      <Box sx={{ px: 0.5, pt: compact ? 0.25 : 0.5 }}>
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 700 }}>
          {t('auth:mobile_node_settings.saved_nodes_title')}
        </Typography>
        <Typography
          sx={{
            color: theme.palette.text.secondary,
            fontSize: '0.72rem',
            lineHeight: 1.35,
            mt: 0.25,
          }}
        >
          {t('auth:mobile_node_settings.saved_nodes_hint')}
        </Typography>
      </Box>

      {savedNodes.length === 0 && !editorOpen && (
        <Box
          sx={{
            border: `1px dashed ${alpha(theme.palette.text.secondary, 0.28)}`,
            borderRadius: '12px',
            color: theme.palette.text.secondary,
            fontSize: '0.78rem',
            px: 1.35,
            py: 1.2,
          }}
        >
          {t('auth:connection_mode.empty_custom_nodes')}
        </Box>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {savedNodes.map((node) => {
          const active = mode === 'private' && selectedUrl === node.url;
          return (
            <Box
              key={node.url}
              sx={{
                ...cardSx,
                background: active
                  ? alpha(theme.palette.primary.main, 0.12)
                  : cardSx.background,
                border: active
                  ? `1px solid ${alpha(theme.palette.primary.main, 0.35)}`
                  : cardSx.border,
                pr: 0.5,
              }}
            >
              <ButtonBase
                disabled={busy}
                onClick={() =>
                  void applyNode(
                    node,
                    t('auth:mobile_node_settings.using_node', {
                      name: nodeTitle(node),
                    })
                  ).catch(() => undefined)
                }
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  flex: 1,
                  gap: 1.1,
                  minWidth: 0,
                  py: 0.25,
                  textAlign: 'left',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                {active ? (
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
                    flexShrink: 0,
                    height: 36,
                    justifyContent: 'center',
                    width: 36,
                  }}
                >
                  <DnsRoundedIcon sx={{ fontSize: 20 }} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <Typography
                    sx={{
                      fontSize: '0.88rem',
                      fontWeight: 700,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {nodeTitle(node)}
                  </Typography>
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '0.72rem',
                      mt: 0.15,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {active
                      ? t('auth:mobile_node_settings.using_now')
                      : nodeHostLabel(node.url)}
                  </Typography>
                </Box>
              </ButtonBase>
              <IconButton
                aria-label={t('auth:connection_mode.manual_edit_title')}
                disabled={busy}
                onClick={() => openEdit(node)}
                size="small"
              >
                <EditRoundedIcon sx={{ fontSize: 18 }} />
              </IconButton>
              <IconButton
                aria-label={t('auth:mobile_node_settings.delete_node')}
                disabled={busy}
                onClick={() => void removeNode(node)}
                size="small"
              >
                <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>
          );
        })}
      </Box>

      {!editorOpen && (
        <ButtonBase
          disabled={busy}
          onClick={openAdd}
          sx={{
            ...cardSx,
            border: `1px dashed ${alpha(theme.palette.primary.main, 0.4)}`,
            color: theme.palette.primary.main,
            justifyContent: 'center',
            py: compact ? 1 : 1.1,
          }}
        >
          <AddRoundedIcon sx={{ fontSize: 20 }} />
          <Typography sx={{ fontSize: '0.86rem', fontWeight: 700 }}>
            {t('auth:mobile_node_settings.add_node')}
          </Typography>
        </ButtonBase>
      )}

      {editorOpen && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, px: 0.25 }}>
            {editor.mode === 'edit'
              ? t('auth:connection_mode.manual_edit_title')
              : t('auth:mobile_node_settings.add_node')}
          </Typography>
          <TextField
            label={t('auth:connection_mode.field_name')}
            placeholder={t('auth:connection_mode.placeholder_node_name')}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            fullWidth
            size="small"
          />
          <TextField
            label={t('auth:connection_mode.field_node_url')}
            placeholder={t('auth:connection_mode.placeholder_node_url')}
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            fullWidth
            size="small"
          />
          <TextField
            label={t('auth:connection_mode.field_api_key_optional')}
            placeholder={t('auth:connection_mode.placeholder_api_key')}
            value={draftApiKey}
            onChange={(e) => setDraftApiKey(e.target.value)}
            fullWidth
            size="small"
          />
          <AuthButton
            onClick={() => void saveEditor()}
            disabled={busy || !draftUrl.trim()}
            primary
            fullWidth
          >
            {busy
              ? t('auth:mobile_node_settings.saving')
              : t('auth:mobile_node_settings.save_and_use')}
          </AuthButton>
          <AuthButton onClick={closeEditor} disabled={busy} fullWidth>
            {t('auth:mobile_node_settings.cancel')}
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
