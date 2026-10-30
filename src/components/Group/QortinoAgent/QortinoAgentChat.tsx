import {
  Avatar,
  Box,
  CircularProgress,
  IconButton,
  Snackbar,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import type { PluginListenerHandle } from '@capacitor/core';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { userInfoAtom } from '../../../atoms/global';
import { SAFE_AREA_BOTTOM } from '../../../utils/mobileSafeArea';
import { useSoftKeyboardOpen } from '../../../hooks/useSoftKeyboardOpen';
import {
  createEmptySession,
  loadActiveSessionIds,
  loadChatSessions,
  saveActiveSessionIds,
  saveChatSessions,
  sortSessionsForDrawer,
  titleFromMessages,
  type QortinoChatSession,
  type StoredChatBubble,
} from '../../../qortinoAgent/chatHistoryStore';
import type { QdnPublishedSite } from '../../../qortinoAgent/qdnPublishedSites';
import { QortinoChatHistoryDrawer } from './QortinoChatHistoryDrawer';
import QortinoLlm, {
  isQortinoLlmInferenceAvailable,
  type QortinoChatMessage,
} from '../../../plugins/QortinoLlm';
import { isQortinoWebDebugEnabled } from '../../../qortinoAgent/webDebugLlm';
import {
  loadBuiltinKnowledge,
  loadKnowledgeFromInstall,
} from '../../../qortinoAgent/download';
import {
  buildSystemPrompt,
  isPlayingQortalKnowledgeUnit,
  QORTINO_PLAYING_QORTAL_FACTS,
  QORTINO_QORTAL_HARD_FACTS,
  wantsPlayingQortalMaterial,
} from '../../../qortinoAgent/persona';
import {
  retrieveKnowledge,
  type KnowledgePack,
} from '../../../qortinoAgent/rag';
import { matchGoldenAnswer } from '../../../qortinoAgent/goldenMatch';
import {
  openOfficialResource,
  suggestOfficialResources,
  type OfficialResourceLink,
} from '../../../qortinoAgent/officialResources';
import {
  fetchQAppPublisher,
  formatQAppAnswer,
  matchQAppCatalog,
  openQAppInNewTab,
  qAppAvatarUrl,
  type MatchedQApp,
} from '../../../qortinoAgent/qAppCatalog';
import {
  scanQdnForQuestion,
  stripStreamingCharacterSection,
  withStreamingCharacterSection,
  type QdnProfileCard,
  type QdnScanDepth,
  type QuitterPostCard,
} from '../../../qortinoAgent/qdnLookup';
import {
  buildCharacterPolishPrompt,
  CHARACTER_POLISH_SYSTEM,
  sanitizeCharacterPortrait,
} from '../../../qortinoAgent/qdnCharacterPortrait';
import { linkifyQdnReferences } from '../../../qortinoAgent/qdnLinkify';
import {
  looksIncompleteAnswer,
  shouldOfferContinueAssemble,
  trimIncompleteTail,
} from '../../../qortinoAgent/answerComplete';
import { normalizeQortCoinLanguage } from '../../../qortinoAgent/qortCoinLanguage';
import {
  isQortalNetworkDefinitionQuery,
  isQortPriceQuery,
} from '../../../qortinoAgent/queryIntent';
import {
  QDN_SEARCH_KIND_OPTIONS,
  humanLabelForSearchKind,
  isMediaSearchKind,
  type QdnSearchKind,
} from '../../../qortinoAgent/qdnSearchKind';
import {
  fetchQortLtcPrice,
  QORT_PRICE_OFFLINE_NUDGE,
  QORT_PRICE_QDN_UNAVAILABLE,
} from '../../../qortinoAgent/qdnQortPrice';
import {
  isTopicFollowUpQuery,
  resolveTopicFollowUpQuery,
} from '../../../qortinoAgent/topicFollowUp';
import {
  formatMediaDate,
  type QdnMediaItem,
} from '../../../qortinoAgent/qdnMedia';
import {
  extractDayPublishQuery,
  fetchPublishesOnDay,
} from '../../../qortinoAgent/qdnDayPublishes';
import {
  detectRosterIntent,
  extractGroupOwnerQuery,
  extractOwnedNamesQuery,
  fetchAdminRoster,
  fetchGroupOwnerInfo,
  fetchOwnedNamesDetailed,
  formatGroupOwnerAnswer,
  formatRegistered,
  isObviouslyQdnQuestion,
  type OwnedNameRow,
} from '../../../qortinoAgent/qdnRoster';
import {
  detectCreativeAboutPersonIntent,
  detectNominationIntent,
} from '../../../qortinoAgent/qdnWrittenSummary';
import { detectTopicIntent } from '../../../qortinoAgent/qdnTopicSearch';
import { isTopicMediaQuestion } from '../../../qortinoAgent/qdnTopicMedia';
import {
  needsFollowUpContext,
  resolveFollowUpQuery,
} from '../../../qortinoAgent/qdnFollowUpContext';
import {
  detectCompareIntent,
  extractCompareNames,
  fetchNameCompare,
} from '../../../qortinoAgent/qdnCompare';
import {
  detectMintingCoachIntent,
  fetchMintingCoach,
} from '../../../qortinoAgent/qdnMintingCoach';
import {
  extractGroupDigestQuery,
  fetchGroupActivityDigest,
} from '../../../qortinoAgent/qdnGroupDigest';
import {
  detectSavedShelfIntent,
  formatSavedShelvesAnswer,
  listSavedShelves,
} from '../../../qortinoAgent/qdnMediaShelf';
import type { QortinoInstallState } from '../../../qortinoAgent/store';
import { QORTINO_SAFETY_DISCLAIMER } from '../../../qortinoAgent/manifest';
import qortinoHeadUrl from '../../../assets/svgs/QortinoHead.svg';
import {
  ASSEMBLE_TIPS,
  QDN_ASSEMBLE_TIPS,
  STATUS_LINES,
} from '../../../qortinoAgent/assembleCopy';
import { QortinoMediaCards } from './QortinoMediaCards';
import { QortinoImageLightbox } from './QortinoImageLightbox';
import {
  QortinoAnswerReportDialog,
  type AnswerReportPayload,
} from './QortinoAnswerReportDialog';
import { formatAssistantBubbleForClipboard } from './formatAssistantBubbleClipboard';
import { QortinoNameAction } from './QortinoNameAction';
import { QortinoRichText } from './QortinoRichText';
import {
  fetchMintingGuideApps,
  isMintingHowToQuery,
  isNominationExplainQuery,
  mintingGoldenSeedQuery,
  mintingGuideAddonMarkdown,
  mintingOfficialLinks,
} from '../../../qortinoAgent/qdnMintingGuide';
import { openQuitterPostInNewTab } from '../../../qortinoAgent/qdnQuitterPosts';
import { openQortalDeepLink } from '../../../qortinoAgent/qdnAppLinks';
import { getProfileOverride } from '../../../qortinoAgent/qdnProfileOverrides';

type ChatBubble = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  profiles?: QdnProfileCard[];
  media?: QdnMediaItem[];
  mediaLayout?: 'grid' | 'list';
  /** Guides / official pages (especially useful in QDN mode) */
  links?: OfficialResourceLink[];
  /** Matched Q-App cards with avatar + open */
  apps?: MatchedQApp[];
  /** Published APP / WEBSITE roots for a who-is dossier */
  publishedSites?: QdnPublishedSite[];
  /** Recent Quitter posts for a who-is dossier */
  quitterPosts?: QuitterPostCard[];
  /** Owned registered names with creation dates */
  ownedNames?: OwnedNameRow[];
  /** Offline bubble suggesting switch to QDN chat */
  nudgeQdn?: boolean;
  /** Ask user quick vs full QDN person scan before fetching. */
  qdnDepthChoice?: { query: string };
  /** Depth used for the person dossier (offers full-history follow-up). */
  qdnDepth?: QdnScanDepth;
  /** Offer “Continue assembling” under an unfinished Max/Fast reply. */
  canContinueAssemble?: boolean;
  /** Original user question for continue-assemble. */
  continueQuery?: string;
};

function toStoredBubbles(messages: ChatBubble[]): StoredChatBubble[] {
  return messages
    .filter((m) => !m.streaming)
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      profiles: m.profiles,
      media: m.media,
      mediaLayout: m.mediaLayout,
      links: m.links,
      apps: m.apps,
      publishedSites: m.publishedSites,
      quitterPosts: m.quitterPosts,
      ownedNames: m.ownedNames,
      nudgeQdn: m.nudgeQdn,
      canContinueAssemble: m.canContinueAssemble,
      continueQuery: m.continueQuery,
    }));
}

function fromStoredBubbles(messages: StoredChatBubble[]): ChatBubble[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    profiles: m.profiles,
    media: m.media as ChatBubble['media'],
    mediaLayout: m.mediaLayout,
    links: m.links as ChatBubble['links'],
    apps: m.apps as ChatBubble['apps'],
    publishedSites: m.publishedSites,
    quitterPosts: m.quitterPosts,
    ownedNames: m.ownedNames as ChatBubble['ownedNames'],
    nudgeQdn: m.nudgeQdn,
    canContinueAssemble: m.canContinueAssemble,
    continueQuery: m.continueQuery,
  }));
}

/** Prefer curated FAQ over live scan for how-tos (not people/media/rosters). */
function preferGoldenFaqInQdn(
  query: string,
  searchKind: QdnSearchKind = 'all'
): boolean {
  // Search-engine chips always run a live QDN search (e.g. Videos → "Simon James").
  if (isMediaSearchKind(searchKind) || searchKind === 'users') return false;
  const t = query.trim().toLowerCase();
  if (/\bwho\s+is\b/.test(t) || /\bwhobis\b/.test(t)) return false;
  if (detectRosterIntent(t)) return false;
  if (extractGroupOwnerQuery(query)) return false;
  if (extractOwnedNamesQuery(query)) return false;
  if (extractDayPublishQuery(query)) return false;
  if (isTopicMediaQuestion(query)) return false;
  if (detectCompareIntent(query)) return false;
  if (detectMintingCoachIntent(query)) return false;
  if (extractGroupDigestQuery(query)) return false;
  if (detectSavedShelfIntent(query)) return false;
  if (needsFollowUpContext(query)) return false;
  if (/\b(show|play|watch|find|list|browse)\b/.test(t) && /\b(video|music|audio|photo|image|song|pdf|file)\b/.test(t)) {
    return false;
  }
  if (/\b(videos?|music|photos?|images?|pdfs?|files?)\s+(by|from|of|about|on)\b/.test(t)) {
    return false;
  }
  return true;
}

type AnswerMode = 'fast' | 'max';
type DataSourceMode = 'offline' | 'qdn';

type Props = {
  install: QortinoInstallState;
  onClose: () => void;
};

const FAST_MODEL_FILE = 'qwen25-1.5b-instruct-q4.gguf';

/** Small-talk / jokes don't need RAG — skips pack scan + shorter prompts. */
function wantsKnowledgeLookup(query: string): boolean {
  const t = query.trim().toLowerCase();
  if (!t) return false;
  if (
    /^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|lol|haha|yes|no|yep|nope)\b/.test(
      t
    ) &&
    t.length < 48
  ) {
    return false;
  }
  if (
    /^(tell me (a |another )?joke|another( one)?|joke|make me laugh|who are you|what are you)\b/.test(
      t
    )
  ) {
    return false;
  }
  return true;
}

/** Network definition / activity questions — inject network facts only (no book talk). */
function needsQortalDefinitionGuard(query: string): boolean {
  const t = query.trim().toLowerCase();
  // Do NOT attach this to "who is X" — that path uses live QDN dossiers.
  if (isQortalNetworkDefinitionQuery(query)) return true;
  return (
    /\bqortal\s+is\b/.test(t) ||
    /\bwhat\s+can\s+i\s+do\s+(on|with|in)\s+qortal\b/.test(t) ||
    /\bthings\s+to\s+do\s+on\s+qortal\b/.test(t) ||
    /\bhow\s+do\s+i\s+use\s+qortal\b/.test(t)
  );
}

/** Only when the user brings up Simon James / Playing Qortal / the book. */
function needsPlayingQortalContext(query: string): boolean {
  return wantsPlayingQortalMaterial(query);
}

/** Short follow-ups ("anything specific" / "what is it in depth") → prior topic. */
function knowledgeQueryForRetrieval(
  text: string,
  priorMessages: Array<{ role: string; content: string }>
): string {
  const t = text.trim();
  if (!t) return t;

  // Pronoun / depth continuations must inherit the prior subject
  // ("what is qortal" → "what is it in depth" must not RAG water filters).
  const topicFollow = resolveTopicFollowUpQuery(t, priorMessages);
  if (topicFollow.expanded) return topicFollow.text;

  // Clear new questions stand alone — never inherit the prior turn
  // (that made "what are q-apps" rematch "what can I do on qortal").
  if (
    /^(what|who|how|why|where|when|is|are|can|do|does|did|should|could|would|explain|tell|list|define|describe)\b/i.test(
      t
    ) &&
    !/^(what else|what about)\b/i.test(t) &&
    !isTopicFollowUpQuery(t)
  ) {
    return t;
  }
  const vague =
    /^(anything|more|specific|details?|examples?|and\b|also\b|like what|yes|yeah|yep|ok|okay)\b/i.test(
      t
    ) ||
    (t.length < 28 &&
      !/\bqortal\b|\bq-?apps?\b|\bqort\b|\bmint|\bnominat/i.test(t));
  if (!vague) return t;
  for (let i = priorMessages.length - 1; i >= 0; i -= 1) {
    const m = priorMessages[i];
    if (m?.role === 'user' && m.content?.trim() && m.content.trim() !== t) {
      return `${m.content.trim()}\nFollow-up: ${t}`;
    }
  }
  return t;
}

const DESC_LINK_RE =
  /(qortal:\/\/(?:APP|WEBSITE)\/[^\s)]+|https?:\/\/[^\s)]+)/gi;

function openDescriptionLink(raw: string): void {
  const href = raw.replace(/[.,;:!?]+$/, '');
  if (/^qortal:\/\//i.test(href)) {
    // Supports APP deep paths (Q-Tube/video/…, Quitter/post/…) — MA Helper style
    openQortalDeepLink(href);
    return;
  }
  if (/^https?:\/\//i.test(href)) {
    openOfficialResource({ id: 'desc-ext', label: href, href });
  }
}

/** Profile blurb with tappable qortal:// and https links. */
function ProfileDescriptionRich({
  text,
  isDark,
}: {
  text: string;
  isDark: boolean;
}) {
  const theme = useTheme();
  const parts = text.split(DESC_LINK_RE);
  return (
    <Typography
      sx={{
        color: alpha(theme.palette.text.primary, 0.88),
        fontSize: '0.86rem',
        fontStyle: 'italic',
        lineHeight: 1.4,
        pl: 0.25,
      }}
    >
      {parts.map((part, i) => {
        if (!part) return null;
        if (/^(qortal:\/\/|https?:\/\/)/i.test(part)) {
          const label = part.startsWith('qortal://')
            ? decodeURIComponent(part.replace(/^qortal:\/\/(APP|WEBSITE)\//i, ''))
            : part.replace(/^https?:\/\//i, '').replace(/\/$/, '');
          return (
            <Box
              key={`dl-${i}`}
              component="button"
              type="button"
              onClick={() => openDescriptionLink(part)}
              sx={{
                appearance: 'none',
                background: 'transparent',
                border: 'none',
                color: isDark ? '#7EB6FF' : '#1A6FD4',
                cursor: 'pointer',
                font: 'inherit',
                fontStyle: 'italic',
                fontWeight: 700,
                p: 0,
                textDecoration: 'underline',
                textUnderlineOffset: '2px',
              }}
            >
              {label}
            </Box>
          );
        }
        return <span key={`dt-${i}`}>{part}</span>;
      })}
    </Typography>
  );
}

const OWNED_NAMES_COLLAPSE_AT = 10;
const OWNED_NAMES_PREVIEW = 8;

function OwnedNamesCompact({
  names,
  isDark,
  onSearchUser,
}: {
  names: OwnedNameRow[];
  isDark: boolean;
  onSearchUser: (name: string) => void;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const needsCollapse = names.length >= OWNED_NAMES_COLLAPSE_AT;
  const shown =
    needsCollapse && !expanded ? names.slice(0, OWNED_NAMES_PREVIEW) : names;
  const hiddenCount = names.length - shown.length;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.35, mt: 1 }}>
      <Typography
        sx={{
          color: alpha(theme.palette.text.primary, 0.55),
          fontSize: '0.66rem',
          fontWeight: 800,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        Registered names · {names.length}
      </Typography>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 0.2,
        }}
      >
        {shown.map((n) => (
          <Box
            key={n.name}
            sx={{
              alignItems: 'baseline',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 0.45,
              minWidth: 0,
              py: 0.15,
            }}
          >
            <QortinoNameAction
              name={n.name}
              avatarUrl={n.avatarUrl || qAppAvatarUrl(n.name)}
              showAvatar
              avatarHideIfMissing={!n.isPrimary}
              avatarSize={22}
              fontSize="0.78rem"
              fontWeight={700}
              suffix={
                n.isPrimary ? (
                  <Box
                    component="span"
                    sx={{
                      color: alpha(theme.palette.text.primary, 0.5),
                      fontSize: '0.68rem',
                      fontWeight: 600,
                    }}
                  >
                    {' · primary'}
                  </Box>
                ) : null
              }
              onSearchUser={onSearchUser}
            />
            {n.registered != null ? (
              <Typography
                component="span"
                sx={{
                  color: alpha(theme.palette.text.primary, 0.42),
                  fontSize: '0.66rem',
                }}
              >
                {formatRegistered(n.registered)}
              </Typography>
            ) : null}
          </Box>
        ))}
      </Box>
      {needsCollapse ? (
        <Box
          component="button"
          type="button"
          onClick={() => setExpanded((v) => !v)}
          sx={{
            alignSelf: 'flex-start',
            appearance: 'none',
            background: alpha('#7EB6FF', isDark ? 0.14 : 0.1),
            border: `1px solid ${alpha('#7EB6FF', 0.35)}`,
            borderRadius: '8px',
            color: isDark ? '#D6E8FF' : '#1A4A8A',
            cursor: 'pointer',
            fontSize: '0.7rem',
            fontWeight: 800,
            mt: 0.25,
            px: 0.85,
            py: 0.35,
          }}
        >
          {expanded
            ? 'Show fewer names'
            : `Show all ${names.length} names (+${hiddenCount})`}
        </Box>
      ) : null}
    </Box>
  );
}

function AssemblingLabel({
  detail,
  mode = 'fast',
}: {
  detail: string;
  mode?: AnswerMode;
}) {
  const letters = 'Assembling'.split('');
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.55, minWidth: 0 }}>
      <Box
        aria-label="Assembling"
        sx={{
          alignItems: 'baseline',
          display: 'flex',
          flexWrap: 'wrap',
          fontSize: '0.95rem',
          fontWeight: 700,
          letterSpacing: '0.02em',
          lineHeight: 1.35,
          '@keyframes qortinoAssembleWave': {
            '0%, 100%': { transform: 'translateY(0)' },
            '40%': { transform: 'translateY(-4px)' },
            '60%': { transform: 'translateY(1px)' },
          },
          '@keyframes qortinoAssemblePulse': {
            '0%, 100%': { opacity: 0.72 },
            '50%': { opacity: 1 },
          },
          animation: 'qortinoAssemblePulse 2.8s ease-in-out infinite',
        }}
      >
        {letters.map((ch, i) => (
          <Box
            key={`${ch}-${i}`}
            component="span"
            sx={{
              animation: 'qortinoAssembleWave 1.8s ease-in-out infinite',
              animationDelay: `${i * 0.07}s`,
              display: 'inline-block',
              willChange: 'transform',
            }}
          >
            {ch}
          </Box>
        ))}
        <Box
          component="span"
          sx={{
            animation: 'qortinoAssembleWave 1.8s ease-in-out infinite',
            animationDelay: `${letters.length * 0.07}s`,
            display: 'inline-block',
            ml: 0.15,
          }}
        >
          …
        </Box>
        {mode === 'max' ? (
          <Box
            component="span"
            sx={{
              fontSize: '0.72rem',
              fontWeight: 800,
              letterSpacing: '0.06em',
              ml: 0.75,
              opacity: 0.65,
              textTransform: 'uppercase',
            }}
          >
            Max
          </Box>
        ) : null}
      </Box>
      <Typography
        sx={{
          color: 'inherit',
          fontSize: '0.74rem',
          lineHeight: 1.4,
          opacity: 0.78,
        }}
      >
        {detail}
      </Typography>
    </Box>
  );
}

/** Fast mode prefers the 1.5B model when the installed pack ships it. */
async function ensureFastModelPath(): Promise<string | null> {
  const paths = await QortinoLlm.getStoragePaths();
  const destAbs = `${paths.modelsDir.replace(/\/$/, '')}/${FAST_MODEL_FILE}`;
  const existing = await QortinoLlm.fileExists({ absolutePath: destAbs });
  if (existing.exists && existing.size > 50_000_000) {
    return destAbs;
  }
  return null;
}

/** Fast word-by-word reveal for curated / instant answers (not waiting on the LLM). */
async function revealTextWordByWord(
  fullText: string,
  onPartial: (partial: string) => void,
  options?: {
    wordsPerChunk?: number;
    msPerChunk?: number;
    isCancelled?: () => boolean;
  }
): Promise<string> {
  const cleaned = normalizeQortCoinLanguage(fullText);
  const words = cleaned.match(/\S+\s*/g) || [cleaned];
  const chunk = Math.max(1, options?.wordsPerChunk ?? 3);
  const ms = Math.max(4, options?.msPerChunk ?? 12);
  let out = '';
  for (let i = 0; i < words.length; i += chunk) {
    if (options?.isCancelled?.()) break;
    out += words.slice(i, i + chunk).join('');
    onPartial(out);
    await new Promise((r) => setTimeout(r, ms));
  }
  if (!options?.isCancelled?.()) {
    onPartial(cleaned);
  }
  return cleaned;
}

export function QortinoAgentChat({ install, onClose }: Props) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const userInfo = useAtomValue(userInfoAtom);
  /** Separate chat windows for Offline vs QDN — histories never mix. */
  const [messagesByMode, setMessagesByMode] = useState<
    Record<DataSourceMode, ChatBubble[]>
  >({ offline: [], qdn: [] });
  const [sessions, setSessions] = useState<QortinoChatSession[]>([]);
  const [activeSessionIdByMode, setActiveSessionIdByMode] = useState<
    Partial<Record<DataSourceMode, string>>
  >({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingModel, setLoadingModel] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [knowledge, setKnowledge] = useState<KnowledgePack | null>(null);
  const [assembleDetail, setAssembleDetail] = useState(ASSEMBLE_TIPS[0]);
  const [answerMode, setAnswerMode] = useState<AnswerMode>('fast');
  const [dataSourceMode, setDataSourceMode] = useState<DataSourceMode>(() =>
    isQortinoWebDebugEnabled() ? 'qdn' : 'offline'
  );
  const [qdnSearchKind, setQdnSearchKind] = useState<QdnSearchKind>('all');
  const [activeModelLabel, setActiveModelLabel] = useState('Fast');
  const [avatarLightbox, setAvatarLightbox] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const [answerReport, setAnswerReport] = useState<AnswerReportPayload | null>(
    null
  );
  const [copySnack, setCopySnack] = useState('');
  const keyboardOpen = useSoftKeyboardOpen(120);
  const qdnMode = dataSourceMode === 'qdn';
  const messages = messagesByMode[dataSourceMode];
  const activeSessionId = activeSessionIdByMode[dataSourceMode] || null;
  const drawerSessions = useMemo(
    () => sortSessionsForDrawer(sessions, dataSourceMode),
    [sessions, dataSourceMode]
  );
  const setMessages = useCallback(
    (updater: ChatBubble[] | ((prev: ChatBubble[]) => ChatBubble[])) => {
      setMessagesByMode((prev) => {
        const current = prev[dataSourceMode];
        const next = typeof updater === 'function' ? updater(current) : updater;
        if (next === current) return prev;
        return { ...prev, [dataSourceMode]: next };
      });
    },
    [dataSourceMode]
  );
  const switchDataSource = useCallback(
    (mode: DataSourceMode) => {
      if (mode === dataSourceMode || busy) return;
      setStatusError(null);
      setDataSourceMode(mode);
    },
    [busy, dataSourceMode]
  );

  // Restore persisted chat history once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [loaded, activeIds] = await Promise.all([
        loadChatSessions(),
        loadActiveSessionIds(),
      ]);
      if (cancelled) return;
      const nextSessions = [...loaded];
      const nextActive: Partial<Record<DataSourceMode, string>> = {
        ...activeIds,
      };
      const nextMessages: Record<DataSourceMode, ChatBubble[]> = {
        offline: [],
        qdn: [],
      };
      for (const mode of ['offline', 'qdn'] as const) {
        let sid = nextActive[mode];
        let session = sid ? nextSessions.find((s) => s.id === sid) : undefined;
        if (!session || session.mode !== mode) {
          session = createEmptySession(mode);
          nextSessions.push(session);
          sid = session.id;
          nextActive[mode] = sid;
        }
        nextMessages[mode] = fromStoredBubbles(session.messages);
      }
      setSessions(nextSessions);
      setActiveSessionIdByMode(nextActive);
      setMessagesByMode(nextMessages);
      setHistoryReady(true);
      void saveChatSessions(nextSessions);
      void saveActiveSessionIds(nextActive);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist current mode's messages into the active session (debounced).
  useEffect(() => {
    if (!historyReady || !activeSessionId) return;
    if (messages.some((m) => m.streaming)) return;
    const stored = toStoredBubbles(messages);
    const autoTitle = titleFromMessages(stored);
    const t = window.setTimeout(() => {
      setSessions((prev) => {
        const next = prev.map((s) =>
          s.id === activeSessionId
            ? {
                ...s,
                messages: stored,
                title: s.titleCustom ? s.title : autoTitle,
                updatedAt: Date.now(),
                mode: dataSourceMode,
              }
            : s
        );
        void saveChatSessions(next);
        return next;
      });
    }, 350);
    return () => window.clearTimeout(t);
  }, [messages, activeSessionId, dataSourceMode, historyReady]);

  const handleNewChat = useCallback(() => {
    if (busy) return;
    const session = createEmptySession(dataSourceMode);
    setSessions((prev) => {
      const next = [session, ...prev];
      void saveChatSessions(next);
      return next;
    });
    setActiveSessionIdByMode((prev) => {
      const next = { ...prev, [dataSourceMode]: session.id };
      void saveActiveSessionIds(next);
      return next;
    });
    setMessages([]);
    setStatusError(null);
  }, [busy, dataSourceMode, setMessages]);

  const handleSelectSession = useCallback(
    (id: string) => {
      if (busy) return;
      const session = sessions.find((s) => s.id === id);
      if (!session || session.mode !== dataSourceMode) return;
      setActiveSessionIdByMode((prev) => {
        const next = { ...prev, [dataSourceMode]: id };
        void saveActiveSessionIds(next);
        return next;
      });
      setMessages(fromStoredBubbles(session.messages));
      setStatusError(null);
    },
    [busy, dataSourceMode, sessions, setMessages]
  );

  const handleRenameSession = useCallback((id: string, title: string) => {
    setSessions((prev) => {
      const next = prev.map((s) =>
        s.id === id
          ? { ...s, title, titleCustom: true, updatedAt: Date.now() }
          : s
      );
      void saveChatSessions(next);
      return next;
    });
  }, []);

  const handleTogglePin = useCallback((id: string) => {
    setSessions((prev) => {
      const next = prev.map((s) =>
        s.id === id ? { ...s, pinned: !s.pinned, updatedAt: Date.now() } : s
      );
      void saveChatSessions(next);
      return next;
    });
  }, []);

  const handleDeleteSession = useCallback(
    (id: string) => {
      setSessions((prev) => {
        let next = prev.filter((s) => s.id !== id);
        if (activeSessionId === id) {
          let replacement = sortSessionsForDrawer(next, dataSourceMode)[0];
          if (!replacement) {
            replacement = createEmptySession(dataSourceMode);
            next = [replacement, ...next];
          }
          setActiveSessionIdByMode((a) => {
            const map = { ...a, [dataSourceMode]: replacement!.id };
            void saveActiveSessionIds(map);
            return map;
          });
          setMessages(fromStoredBubbles(replacement.messages));
        }
        void saveChatSessions(next);
        return next;
      });
    },
    [activeSessionId, dataSourceMode, setMessages]
  );
  const listRef = useRef<HTMLDivElement | null>(null);
  const revealCancelRef = useRef(false);
  const listenerRef = useRef<PluginListenerHandle | null>(null);
  const progressListenerRef = useRef<PluginListenerHandle | null>(null);
  const assistantIdRef = useRef<string | null>(null);
  const tipIndexRef = useRef(0);
  const loadedKeyRef = useRef<string>('');
  /** Only auto-stick to bottom when the user hasn't scrolled up to read. */
  const stickToBottomRef = useRef(true);
  /** After switching Offline → QDN, run this as the next send. */
  const pendingSendRef = useRef<string | null>(null);

  const hazeAccent = '#7EB6FF';
  const hazeWarm = '#C9E8D4';

  const headDecor = useMemo(
    () => [
      { top: '10%', left: '68%', size: 72, anim: 0, dur: '12s', opacity: isDark ? 0.16 : 0.13 },
      { top: '48%', left: '78%', size: 48, anim: 1, dur: '16s', opacity: isDark ? 0.12 : 0.1 },
      { top: '22%', left: '8%', size: 40, anim: 2, dur: '14s', opacity: isDark ? 0.1 : 0.09 },
      { top: '70%', left: '14%', size: 56, anim: 3, dur: '18s', opacity: isDark ? 0.13 : 0.11 },
      { top: '58%', left: '52%', size: 36, anim: 1, dur: '13s', opacity: isDark ? 0.08 : 0.07 },
    ],
    [isDark]
  );

  const loadForMode = useCallback(
    async (mode: AnswerMode) => {
      if (!isQortinoLlmInferenceAvailable()) {
        throw new Error('Qortino Agent needs the Android app for on-device inference.');
      }
      if (!install.llmPath) {
        throw new Error('Model path missing — reinstall the agent.');
      }

      // PC phone-frame debug: skip GGUF paths; web LLM / Ollama handles answers.
      if (isQortinoWebDebugEnabled()) {
        await QortinoLlm.loadModel({ path: 'web-debug', nCtx: 512 });
        loadedKeyRef.current = 'web-debug';
        setActiveModelLabel(mode === 'fast' ? 'PC · Fast' : 'PC · Max');
        return;
      }

      let path = install.llmPath;
      // Fast keeps a small context for snappy prefill. Max gets real headroom:
      // the JNI drops overflowing prompt tokens from the FRONT (system persona
      // first), so a too-small nCtx silently strips Qortino's instructions.
      // Qwen2.5 uses GQA — KV cache at 1152 ctx is only ~30-40 MB.
      // Prefill is batched in the JNI, so longer prompts no longer trigger
      // the old llama_decode failures.
      let nCtx = mode === 'fast' ? 640 : 1152;
      let label = mode === 'fast' ? 'Fast' : 'Max';

      if (mode === 'fast') {
        const fastPath = await ensureFastModelPath();
        if (fastPath) {
          path = fastPath;
          label = 'Fast · 1.5B';
        } else {
          // Same GGUF, tiny context — still better than Max when Lite isn't staged.
          label = 'Fast · compact';
        }
      } else {
        label = path.includes('1.5b') ? 'Max · 1.5B' : 'Max · 3B';
      }

      const key = `${path}|${nCtx}`;
      if (loadedKeyRef.current !== key) {
        await QortinoLlm.unload().catch(() => undefined);
        await QortinoLlm.loadModel({ path, nCtx });
        loadedKeyRef.current = key;
      }
      setActiveModelLabel(label);
    },
    [install.llmPath]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pack =
          (await loadKnowledgeFromInstall(install)) ||
          (await loadBuiltinKnowledge());
        if (!cancelled) setKnowledge(pack);
      } catch {
        const pack = await loadBuiltinKnowledge().catch(() => null);
        if (!cancelled && pack) setKnowledge(pack);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [install]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingModel(true);
      setStatusError(null);
      try {
        await loadForMode(answerMode);
      } catch (e) {
        if (!cancelled) {
          setStatusError(e instanceof Error ? e.message : 'Failed to load model');
        }
      } finally {
        if (!cancelled) setLoadingModel(false);
      }
    })();

    return () => {
      cancelled = true;
      void QortinoLlm.cancel().catch(() => undefined);
      void listenerRef.current?.remove();
      void progressListenerRef.current?.remove();
      listenerRef.current = null;
      progressListenerRef.current = null;
    };
  }, [answerMode, loadForMode]);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, assembleDetail]);

  useEffect(() => {
    if (!busy) return;
    const tips = qdnMode ? QDN_ASSEMBLE_TIPS : ASSEMBLE_TIPS;
    const id = window.setInterval(() => {
      tipIndexRef.current = (tipIndexRef.current + 1) % tips.length;
      setAssembleDetail((prev) => {
        // Keep live native / QDN progress if it's more specific than a tip rotation.
        if (
          prev.includes('tokens') ||
          prev.includes('Writing offline') ||
          prev.includes('Warming local') ||
          prev.includes('Weaving your notes') ||
          prev.includes('Reading your question') ||
          prev.includes('QDN scan ready') ||
          prev.includes('Scanning QDN') ||
          prev.includes('Fetching their QDN') ||
          prev.includes('Reading their publishes') ||
          prev.includes('QDN notes in hand') ||
          prev.includes('Max path') ||
          prev.includes('Assembling Max') ||
          prev.includes('Retrying with a lighter') ||
          prev.includes('Picking up where') ||
          prev.includes('Full scan') ||
          prev.includes('Full history') ||
          prev.includes('Quick look') ||
          prev.includes('Quick QDN') ||
          prev.includes('transactions') ||
          prev.includes('verifying live')
        ) {
          return prev;
        }
        return tips[tipIndexRef.current];
      });
    }, 3200);
    return () => window.clearInterval(id);
  }, [busy, qdnMode]);

  const stop = useCallback(async () => {
    revealCancelRef.current = true;
    await QortinoLlm.cancel().catch(() => undefined);
    setBusy(false);
    setMessages((prev) =>
      prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
    );
  }, [setMessages]);

  const continueAssemble = useCallback(
    async (assistantId: string, query: string, priorAnswer: string) => {
      if (busy || loadingModel || !query.trim() || !priorAnswer.trim()) return;
      setBusy(true);
      setStatusError(null);
      tipIndexRef.current = 0;
      setAssembleDetail(STATUS_LINES.maxWriting);
      assistantIdRef.current = assistantId;
      stickToBottomRef.current = true;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                streaming: true,
                canContinueAssemble: false,
                content: priorAnswer.replace(/\s+$/g, '') + '\n',
              }
            : m
        )
      );

      const isFast = answerMode === 'fast';
      let streamed = priorAnswer.replace(/\s+$/g, '') + '\n';
      let settleDone!: (value: { error?: string }) => void;
      const donePromise = new Promise<{ error?: string }>((resolve) => {
        settleDone = resolve;
      });

      try {
        await progressListenerRef.current?.remove();
        await listenerRef.current?.remove();
        progressListenerRef.current = await QortinoLlm.addListener(
          'progress',
          (event) => {
            if (assistantIdRef.current !== assistantId) return;
            if (event.detail) setAssembleDetail(event.detail);
          }
        );
        listenerRef.current = await QortinoLlm.addListener('token', (event) => {
          if (assistantIdRef.current !== assistantId) return;
          if (event.error && event.error !== 'cancelled') {
            setStatusError(event.error);
          }
          if (event.token) {
            streamed += event.token;
            const snap = streamed;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: snap } : m
              )
            );
          }
          if (event.done) settleDone({ error: event.error });
        });

        const systemPrompt = buildSystemPrompt({
          safetyDisclaimer: isFast ? undefined : QORTINO_SAFETY_DISCLAIMER,
          compact: true,
          fast: isFast,
          max: !isFast,
          qdnMode,
          offlineBadge: false,
        });
        const cont = await QortinoLlm.complete({
          system: systemPrompt,
          messages: [
            { role: 'user', content: query },
            { role: 'assistant', content: priorAnswer },
            {
              role: 'user',
              content:
                'Continue exactly from where you stopped. Finish incomplete sections only. Do not restart the answer. End cleanly when done.',
            },
          ],
          contextChunks: [],
          maxTokens: isFast ? 140 : 220,
          temperature: 0.55,
        });
        const more = typeof cont?.text === 'string' ? cont.text.trim() : '';
        const merged = more
          ? `${priorAnswer.replace(/\s+$/g, '')}\n${more}`.trim()
          : streamed.trim();
        const finalText = normalizeQortCoinLanguage(
          looksIncompleteAnswer(merged)
            ? trimIncompleteTail(merged)
            : merged
        );
        const contMaxTokens = isFast ? 140 : 220;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: finalText,
                  streaming: false,
                  canContinueAssemble: shouldOfferContinueAssemble(finalText, {
                    maxTokens: contMaxTokens,
                    mode: isFast ? 'fast' : 'max',
                  }),
                  continueQuery: query,
                }
              : m
          )
        );
        await Promise.race([
          donePromise,
          new Promise<{ error?: string }>((resolve) =>
            setTimeout(() => resolve({}), 1500)
          ),
        ]);
      } catch (e) {
        setStatusError(e instanceof Error ? e.message : 'Continue failed');
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  streaming: false,
                  canContinueAssemble: true,
                  continueQuery: query,
                }
              : m
          )
        );
      } finally {
        setBusy(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m
          )
        );
      }
    },
    [answerMode, busy, loadingModel, qdnMode, setMessages]
  );

  const send = useCallback(async (
    overrideText?: string,
    options?: { depth?: QdnScanDepth; resumeAssistantId?: string }
  ) => {
    const text = (overrideText ?? input).trim();
    if (!text || busy || loadingModel) return;
    if (!overrideText && !options?.resumeAssistantId) setInput('');
    setStatusError(null);
    revealCancelRef.current = false;
    tipIndexRef.current = 0;
    setAssembleDetail(
      options?.depth === 'full'
        ? STATUS_LINES.qdnFull
        : qdnMode
          ? STATUS_LINES.qdnScan
          : STATUS_LINES.searchPack
    );

    let assistantId = options?.resumeAssistantId || '';
    if (assistantId) {
      assistantIdRef.current = assistantId;
      stickToBottomRef.current = true;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: '',
                streaming: true,
                qdnDepthChoice: undefined,
                qdnDepth: options?.depth,
                profiles: undefined,
                media: undefined,
                publishedSites: undefined,
                quitterPosts: undefined,
                ownedNames: undefined,
                links: undefined,
                apps: undefined,
              }
            : m
        )
      );
      setBusy(true);
    } else {
      const userMsg: ChatBubble = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: text,
      };
      assistantId = `a-${Date.now()}`;
      assistantIdRef.current = assistantId;
      stickToBottomRef.current = true;
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: 'assistant', content: '', streaming: true },
      ]);
      setBusy(true);
    }

    const isFast = answerMode === 'fast';
    const scanDepth: QdnScanDepth | undefined = options?.depth;

    try {
      if (loadingModel) {
        setAssembleDetail(isFast ? STATUS_LINES.loadFast : STATUS_LINES.loadMax);
      }

      let history: QortinoChatMessage[] = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: text },
      ]
        .filter((m) => m.content.trim())
        // Keep recent turns so follow-ups like "another" still make sense.
        // Cap Max harder — long history slows prefill and can break decode.
        .slice(isFast ? -3 : -2);

      let contextChunks: Array<{ text: string }> = [];
      let qdnProfiles: QdnProfileCard[] = [];
      let softGolden: ReturnType<typeof matchGoldenAnswer> = null;
      // QDN mode = offline knowledge + live QDN search. Always offer guide/app
      // chips when the topic matches; avatars need the node (QDN path).
      const qdnLinks = wantsKnowledgeLookup(text)
        ? suggestOfficialResources(text)
        : [];
      const matchedApp = wantsKnowledgeLookup(text)
        ? matchQAppCatalog(text)
        : null;
      const isNetworkDefinitionAsk = isQortalNetworkDefinitionQuery(text);
      // Live QDN / minting intents must beat app-catalog cards.
      const prefersLiveQdnIntent =
        isObviouslyQdnQuestion(text) ||
        !!extractGroupOwnerQuery(text) ||
        !!extractGroupDigestQuery(text) ||
        detectCompareIntent(text);
      const prefersMintingFaq = isMintingHowToQuery(text);

      // Offline chat: QDN-only questions → nudge (never suppressed by a fuzzy app hit).
      if (!qdnMode && prefersLiveQdnIntent) {
        setAssembleDetail(STATUS_LINES.quickScan);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content:
                    'That question needs live QDN / on-chain data (people, admins, groups, names, or media). Switch to the QDN chat window for a precise answer with avatars — Offline keeps general knowledge only.',
                  streaming: false,
                  nudgeQdn: true,
                }
              : m
          )
        );
        return;
      }

      const presentInstantAnswer = async (
        answer: string,
        extras: Partial<ChatBubble> = {}
      ) => {
        setAssembleDetail(STATUS_LINES.quickScan);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: '', streaming: true, ...extras }
              : m
          )
        );
        const cleaned = await revealTextWordByWord(
          answer,
          (partial) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: partial, streaming: true }
                  : m
              )
            );
          },
          {
            wordsPerChunk: isFast ? 3 : 2,
            msPerChunk: isFast ? 10 : 14,
            isCancelled: () =>
              revealCancelRef.current || assistantIdRef.current !== assistantId,
          }
        );
        if (
          !revealCancelRef.current &&
          assistantIdRef.current === assistantId
        ) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: cleaned,
                    streaming: false,
                    ...extras,
                  }
                : m
            )
            );
        }
      };

      // QORT market price: Offline → switch to QDN; QDN → live LTC peer quote.
      if (isQortPriceQuery(text)) {
        if (!qdnMode) {
          setAssembleDetail(STATUS_LINES.quickScan);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: QORT_PRICE_OFFLINE_NUDGE,
                    streaming: false,
                    nudgeQdn: true,
                  }
                : m
            )
          );
          return;
        }
        setAssembleDetail('Fetching live QORT/LTC peer price…');
        const quote = await fetchQortLtcPrice().catch(() => null);
        await presentInstantAnswer(
          quote?.answer || QORT_PRICE_QDN_UNAVAILABLE
        );
        return;
      }

      // Specific Q-App questions ("what is Q-Assets") — precise catalog answer.
      // Never steal network definition, minting FAQ, or live QDN intents.
      if (
        !isNetworkDefinitionAsk &&
        !prefersMintingFaq &&
        !prefersLiveQdnIntent &&
        matchedApp &&
        matchedApp.score >= 0.8
      ) {
        const publisher = await fetchQAppPublisher(matchedApp.entry.name).catch(
          () => null
        );
        const enrichedApp: MatchedQApp = { ...matchedApp, publisher };
        const answer = formatQAppAnswer(enrichedApp.entry, publisher);
        const appLinks: OfficialResourceLink[] = [
          {
            id: `app-${matchedApp.entry.id}`,
            label: `Open ${matchedApp.entry.title}`,
            service: matchedApp.entry.service,
            name: matchedApp.entry.name,
            blurb: matchedApp.entry.summary.slice(0, 80),
          },
          ...qdnLinks.filter((l) => l.name !== matchedApp.entry.name),
        ];
        // Publisher name stays in the prose answer. Only show a person chip when
        // the user asked who published it — otherwise follow-ups steal the dossier.
        const wantsPublisherCard =
          /\b(who\s+(published|made|built|created)|publisher|author)\b/i.test(
            text
          );
        const publisherProfile: QdnProfileCard | undefined =
          publisher && wantsPublisherCard
            ? {
                name: publisher.primaryName,
                address: publisher.ownerAddress,
                level: publisher.level,
                tags: ['Publisher'],
                avatarUrl: publisher.avatarUrl,
              }
            : undefined;
        await presentInstantAnswer(answer, {
          apps: [enrichedApp],
          links: appLinks,
          profiles: publisherProfile ? [publisherProfile] : undefined,
        });
        return;
      }

      // Qortal minting / nomination — always keep Qortal context (not herb "mint"
      // or generic crypto). Prefer curated FAQ + guide cards; skip topic noise.
      if (isMintingHowToQuery(text)) {
        setAssembleDetail(STATUS_LINES.quickScan);
        const nominationAsk = isNominationExplainQuery(text);
        const seed = mintingGoldenSeedQuery(text);
        // Prefer the seeded process FAQ for "what is nomination" so we don't
        // land on the Q-Mintership app blurb via a weak single-token match.
        const golden = nominationAsk
          ? matchGoldenAnswer(seed, { minScore: 0.48 }) ||
            matchGoldenAnswer(text, { minScore: 0.55 })
          : matchGoldenAnswer(text, { minScore: isFast ? 0.5 : 0.55 }) ||
            matchGoldenAnswer(seed, { minScore: 0.5 });
        const mintApps = qdnMode
          ? await fetchMintingGuideApps()
          : matchedApp
            ? [matchedApp]
            : [];
        const mintLinks = [
          ...mintingOfficialLinks(),
          ...qdnLinks.filter(
            (l) => !mintingOfficialLinks().some((m) => m.id === l.id)
          ),
        ].slice(0, 6);
        const base =
          golden?.entry.a ||
          (nominationAsk
            ? 'On Qortal, a nomination is how someone becomes a minter: a Level 5+ minter publishes your card on Q-Mintership, Minter Admins vote, then you accept a MINTER group invite and keep a full node online.'
            : 'On Qortal, minting is how you earn QORT by keeping a full node online with minting rights — not proof-of-work mining.');
        const addon = mintingGuideAddonMarkdown(
          nominationAsk ? 'nomination' : 'mint'
        );
        const answer = qdnMode
          ? `${base}\n\n${addon}`
          : `${base}\n\nFor the live nomination board and full walkthrough, switch to QDN chat and open Q-Mintership / Q-Minter Guide.`;
        await presentInstantAnswer(answer, {
          links: mintLinks.length ? mintLinks : undefined,
          apps: mintApps.length ? mintApps : undefined,
        });
        return;
      }

      // Topic follow-ups ("what is it in depth") resolve against the prior ask.
      const topicFollow = resolveTopicFollowUpQuery(text, messages);
      const retrievalQuery = knowledgeQueryForRetrieval(text, messages);
      const effectiveAsk =
        topicFollow.expanded ? topicFollow.text : retrievalQuery;
      // Keep the model on the resolved topic for pronoun/depth continuations.
      if (topicFollow.expanded && history.length) {
        history = history.map((m, i) =>
          i === history.length - 1 && m.role === 'user'
            ? { ...m, content: effectiveAsk }
            : m
        );
      }

      // Curated FAQ short-circuit (offline always; QDN for how-tos, not people/media).
      // Use effectiveAsk so "what is it in depth" after "what is qortal" stays on Qortal.
      // Videos/Images/Audio/Documents/Users chips never dump FAQ for a bare name.
      if (
        wantsKnowledgeLookup(text) &&
        (!qdnMode || preferGoldenFaqInQdn(effectiveAsk, qdnSearchKind))
      ) {
        // Depth follow-ups should expand via LLM+notes, not the short FAQ dump.
        const wantsDeeper =
          topicFollow.expanded &&
          /\b(in (more )?depth|more detail|go deeper|elaborate|expand|tell me more)\b/i.test(
            text
          );
        // With stemming in matchGoldenAnswer, near-paraphrases score higher —
        // curated FAQs beat the tiny GGUF whenever a decent match exists.
        const golden = wantsDeeper
          ? null
          : matchGoldenAnswer(effectiveAsk, {
              minScore: isFast ? 0.55 : 0.6,
            });
        if (
          golden &&
          (needsPlayingQortalContext(effectiveAsk) ||
            !isPlayingQortalKnowledgeUnit(golden.entry))
        ) {
          await presentInstantAnswer(golden.entry.a, {
            links: qdnLinks.length ? qdnLinks : undefined,
            apps: matchedApp ? [matchedApp] : undefined,
          });
          return;
        }
        if (!qdnMode) {
          softGolden =
            matchGoldenAnswer(effectiveAsk, { minScore: 0.42 }) ||
            matchGoldenAnswer(text, { minScore: 0.42 });
          if (
            softGolden &&
            !needsPlayingQortalContext(effectiveAsk) &&
            isPlayingQortalKnowledgeUnit(softGolden.entry)
          ) {
            softGolden = null;
          }
        }
      }

      if (qdnMode) {
        // Follow-ups: "that user", "what about last week" → prior profile name
        const followUp = resolveFollowUpQuery(text, messages);
        const qText = followUp.text;
        if (qText !== text) {
          history = history.map((m, i) =>
            i === history.length - 1 && m.role === 'user'
              ? { ...m, content: qText }
              : m
          );
        }

        // Saved media shelves (local)
        if (detectSavedShelfIntent(qText)) {
          const shelves = listSavedShelves();
          const newest = shelves[0];
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: formatSavedShelvesAnswer(shelves),
                    streaming: false,
                    media: newest?.items,
                    mediaLayout: newest?.items?.length ? 'grid' : undefined,
                  }
                : m
            )
          );
          return;
        }

        // Minting coach for the logged-in viewer
        if (detectMintingCoachIntent(qText)) {
          setAssembleDetail(STATUS_LINES.qdnScan);
          const coach = await fetchMintingCoach({
            address: userInfo?.address,
            name: userInfo?.name,
          });
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: coach?.answer || 'Could not load minting status.',
                    streaming: false,
                    profiles: coach?.profile ? [coach.profile] : undefined,
                  }
                : m
            )
          );
          return;
        }

        // Compare two names
        const compareNames = extractCompareNames(qText);
        if (compareNames) {
          setAssembleDetail(STATUS_LINES.qdnScan);
          const cmp = await fetchNameCompare(compareNames[0], compareNames[1], {
            viewerAddress: userInfo?.address || null,
          });
          if (cmp) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: cmp.answer,
                      streaming: false,
                      profiles: cmp.profiles,
                    }
                  : m
              )
            );
            return;
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: `I could not resolve both “${compareNames[0]}” and “${compareNames[1]}” on this node.`,
                    streaming: false,
                  }
                : m
            )
          );
          return;
        }

        // Group activity digest
        const digestQ = extractGroupDigestQuery(qText);
        if (digestQ) {
          setAssembleDetail(STATUS_LINES.qdnScan);
          const digest = await fetchGroupActivityDigest(digestQ.groupName, {
            afterMs: digestQ.afterMs,
            beforeMs: digestQ.beforeMs,
            rangeLabel: digestQ.rangeLabel,
          });
          if (digest) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: digest.answer,
                      streaming: false,
                      profiles: digest.profile ? [digest.profile] : undefined,
                    }
                  : m
              )
            );
            return;
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: `I could not find a group matching “${digestQ.groupName}” on this node.`,
                    streaming: false,
                  }
                : m
            )
          );
          return;
        }

        // Rosters: Minter / Dev / QM admins
        const rosterKind = detectRosterIntent(qText);
        if (rosterKind) {
          setAssembleDetail(STATUS_LINES.qdnScan);
          const roster = await fetchAdminRoster(rosterKind);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: `${roster.label}: ${roster.profiles.length} on-chain admin(s). Avatars below — tap a name’s chip row for identity.`,
                    streaming: false,
                    profiles: roster.profiles,
                  }
                : m
            )
          );
          return;
        }

        // Group owner
        const groupQ = extractGroupOwnerQuery(qText);
        if (groupQ) {
          setAssembleDetail(STATUS_LINES.qdnScan);
          const ownerInfo = await fetchGroupOwnerInfo(groupQ);
          if (ownerInfo) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: formatGroupOwnerAnswer(ownerInfo),
                      streaming: false,
                      profiles: [ownerInfo.profile],
                    }
                  : m
              )
            );
            return;
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: `I could not find a group named “${groupQ}” on this node yet. Check the exact group name spelling, or ask again when more groups have synced.`,
                    streaming: false,
                  }
                : m
            )
          );
          return;
        }

        // “What did X publish on March 1st 2025?” / last week
        const dayPub = extractDayPublishQuery(qText);
        if (dayPub) {
          setAssembleDetail(STATUS_LINES.qdnScan);
          const dayResult = await fetchPublishesOnDay(dayPub.name, dayPub.day);
          if (dayResult) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: dayResult.answer,
                      streaming: false,
                      profiles: [dayResult.profile],
                      media: dayResult.media.length ? dayResult.media : undefined,
                    }
                  : m
              )
            );
            return;
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: `I could not resolve “${dayPub.name}” to a registered Qortal name on this node.`,
                    streaming: false,
                  }
                : m
            )
          );
          return;
        }

        // List of names owned by a user (with registration dates + avatars)
        const namesQ = extractOwnedNamesQuery(qText);
        if (namesQ) {
          setAssembleDetail(STATUS_LINES.qdnScan);
          const owned = await fetchOwnedNamesDetailed(namesQ);
          if (owned) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: `${owned.primaryName} owns ${owned.names.length} registered name(s). Primary first; each shows registration date and avatar.`,
                      streaming: false,
                      ownedNames: owned.names,
                      profiles: owned.primaryName
                        ? [
                            {
                              name: owned.primaryName,
                              address: owned.address,
                              level: 0,
                              tags: ['Primary name'],
                              avatarUrl: owned.names.find((n) => n.isPrimary)?.avatarUrl ||
                                owned.names[0]?.avatarUrl ||
                                '',
                            },
                          ]
                        : undefined,
                    }
                  : m
              )
            );
            return;
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: `I could not resolve “${namesQ}” to a Qortal account/name on this node.`,
                    streaming: false,
                  }
                : m
            )
          );
          return;
        }

        // Fast = recent txs / light QDN sample. Max = full history scan.
        // Explicit depth override (follow-up buttons) still wins when present.
        const personDepth: QdnScanDepth =
          scanDepth || (isFast ? 'quick' : 'full');

        setAssembleDetail(
          personDepth === 'full' ? STATUS_LINES.qdnFull : STATUS_LINES.qdnQuick
        );
        const qdn = await scanQdnForQuestion(qText, {
          viewerAddress: userInfo?.address || null,
          depth: personDepth,
          searchKind: qdnSearchKind,
          onProgress: (detail) => setAssembleDetail(detail),
        });
        if (detectNominationIntent(qText)) {
          setAssembleDetail(STATUS_LINES.qdnNomination);
        } else if (isTopicMediaQuestion(qText)) {
          setAssembleDetail(STATUS_LINES.qdnMedia);
        } else if (detectTopicIntent(qText)) {
          setAssembleDetail(STATUS_LINES.qdnTopic);
        } else if (qdn.media.length) {
          setAssembleDetail(STATUS_LINES.qdnMedia);
        } else {
          setAssembleDetail(qdn.detail || STATUS_LINES.qdnReady);
        }
        contextChunks = qdn.chunks;
        qdnProfiles = qdn.profiles;

        // Topic media / who-is dossiers: ready-made answer, skip free-form LLM.
        // For who-is: optional constrained character polish from their publishes.
        if (qdn.directAnswer) {
          const isWhoIs =
            /\bwho\s+is\b/i.test(qText) ||
            /\bwhobis\b/i.test(qText) ||
            qdnProfiles.length > 0;
          // Curated who-is blurbs live on the profile chip — don't also dump
          // an outdated offline FAQ above the live QDN dossier.
          const hasCuratedProfile = qdnProfiles.some((p) =>
            Boolean(getProfileOverride(p.name))
          );
          const offlineWho =
            isWhoIs && !hasCuratedProfile
              ? matchGoldenAnswer(qText, { minScore: 0.5 })
              : null;
          // Also try matching by resolved name (query may be a bare name tap).
          const offlineByName =
            !offlineWho && !hasCuratedProfile && qdnProfiles[0]?.name
              ? matchGoldenAnswer(`who is ${qdnProfiles[0].name}`, {
                  minScore: 0.5,
                })
              : null;
          const offline = offlineWho || offlineByName;
          // Offline knowledge first; strip "look up in QDN mode" nudges (already in QDN).
          const offlineText = offline
            ? offline.entry.a
                .replace(
                  /\s*For (his|her|their|a specific person's) live Level[\s\S]*$/i,
                  ''
                )
                .replace(/\s*look up \S+ in QDN mode\.?/gi, '')
                .replace(
                  /\s*For a specific person's Level and publishes, use QDN mode name lookup\.?/gi,
                  ''
                )
                .trim()
            : '';

          // Body has portfolio/activity only — character + Quitter live in UI chips.
          const baseAnswer = stripStreamingCharacterSection(qdn.directAnswer || '');
          let profilesOut = qdnProfiles.map((p) => ({
            ...p,
            // Hide card portrait while we stream it in the answer (avoids doubles).
            characterSummary: undefined as string | undefined,
          }));
          const publishedSites = qdn.publishedSites?.length
            ? qdn.publishedSites
            : undefined;
          const quitterPosts = qdn.quitterPosts?.length
            ? qdn.quitterPosts
            : undefined;
          const ownedFromScan = qdn.ownedNames?.length
            ? qdn.ownedNames
            : undefined;
          const whoLinks = (() => {
            if (!isWhoIs) return qdnLinks;
            const fromQuery = suggestOfficialResources(qText);
            const fromName = qdnProfiles[0]?.name
              ? suggestOfficialResources(`who is ${qdnProfiles[0].name}`)
              : [];
            const fromExtra = qdn.extraLinks || [];
            const merged = [
              ...fromExtra,
              ...[...fromQuery, ...fromName].filter((l) => !!l.href),
            ];
            const seen = new Set<string>();
            return merged.filter((l) => {
              if (seen.has(l.id)) return false;
              seen.add(l.id);
              return true;
            });
          })();

          const withOffline = (body: string) =>
            offlineText
              ? `### Offline knowledge\n\n${offlineText}\n\n${body}`
              : body;

          // Paint dossier immediately (Quitter shelf + activity), then stream portrait.
          const draft0 = (qdn.characterDrafts || [])[0];
          const seedPortrait = (draft0?.seedPortrait || '').trim();
          let liveAnswer = seedPortrait
            ? withStreamingCharacterSection(
                baseAnswer,
                linkifyQdnReferences(seedPortrait)
              )
            : baseAnswer;

          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: withOffline(liveAnswer),
                    streaming: true,
                    profiles: profilesOut.length ? profilesOut : undefined,
                    publishedSites,
                    quitterPosts,
                    ownedNames: ownedFromScan,
                    media: qdn.media.length ? qdn.media : undefined,
                    mediaLayout:
                      qdn.mediaLayout ||
                      (qdn.media.length && !qdnProfiles.length
                        ? 'grid'
                        : undefined),
                    links: whoLinks.length ? whoLinks : undefined,
                    qdnDepth: qdn.depth || personDepth,
                    // After a Fast (quick) look, offer Max-style full history.
                    qdnDepthChoice:
                      isWhoIs && (qdn.depth || personDepth) === 'quick'
                        ? { query: qText }
                        : undefined,
                  }
                : m
            )
          );

          const drafts = qdn.characterDrafts || [];
          if (
            isWhoIs &&
            drafts.length > 0 &&
            isQortinoLlmInferenceAvailable() &&
            !hasCuratedProfile
          ) {
            for (const draft of drafts.slice(0, 1)) {
              if (
                !draft.publishes.length &&
                !draft.themes.length &&
                draft.seedPortrait.length < 60
              ) {
                continue;
              }
              setAssembleDetail(STATUS_LINES.qdnCharacter);
              try {
                await listenerRef.current?.remove();
                await progressListenerRef.current?.remove();

                let streamed = '';
                let tokenCount = 0;
                let pending = '';
                let rafId = 0;
                let settleDone!: (v: { error?: string }) => void;
                const donePromise = new Promise<{ error?: string }>((resolve) => {
                  settleDone = resolve;
                });

                const flush = () => {
                  rafId = 0;
                  if (!pending) return;
                  streamed += pending;
                  pending = '';
                  const snap = streamed;
                  liveAnswer = withStreamingCharacterSection(baseAnswer, snap);
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId
                        ? { ...m, content: withOffline(liveAnswer), streaming: true }
                        : m
                    )
                  );
                  setAssembleDetail(
                    `${STATUS_LINES.qdnCharacter} · ${tokenCount} token${tokenCount === 1 ? '' : 's'}`
                  );
                };

                progressListenerRef.current = await QortinoLlm.addListener(
                  'progress',
                  (event) => {
                    if (assistantIdRef.current !== assistantId) return;
                    if (event.detail) {
                      setAssembleDetail(
                        `${event.detail} · ${tokenCount} token${tokenCount === 1 ? '' : 's'}`
                      );
                    }
                  }
                );

                listenerRef.current = await QortinoLlm.addListener(
                  'token',
                  (event) => {
                    if (assistantIdRef.current !== assistantId) return;
                    if (event.token) {
                      tokenCount += 1;
                      pending += event.token;
                      if (!rafId) {
                        rafId = window.requestAnimationFrame(flush);
                      }
                    }
                    if (event.done) {
                      if (rafId) {
                        window.cancelAnimationFrame(rafId);
                        rafId = 0;
                      }
                      flush();
                      settleDone({ error: event.error });
                    }
                  }
                );

                const polished = await QortinoLlm.complete({
                  system: CHARACTER_POLISH_SYSTEM,
                  messages: [
                    {
                      role: 'user',
                      content: buildCharacterPolishPrompt(draft),
                    },
                  ],
                  contextChunks: [],
                  maxTokens: isFast ? 160 : 220,
                  temperature: 0.55,
                });
                // Tokens usually finish with complete(); don't hang if done is late.
                await Promise.race([
                  donePromise,
                  new Promise<{ error?: string }>((r) =>
                    window.setTimeout(() => r({}), 800)
                  ),
                ]).catch(() => undefined);

                const finalRaw =
                  sanitizeCharacterPortrait(
                    typeof polished?.text === 'string' && polished.text.trim()
                      ? polished.text
                      : streamed,
                    draft.name
                  ) || seedPortrait;
                const finalText = linkifyQdnReferences(finalRaw);
                // Move portrait onto the profile card; strip from answer body.
                liveAnswer = baseAnswer;
                profilesOut = qdnProfiles.map((p) =>
                  p.name.toLowerCase() === draft.name.toLowerCase()
                    ? { ...p, characterSummary: finalText }
                    : { ...p, characterSummary: p.characterSummary }
                );
              } catch {
                // Keep seed on the card if polish fails.
                if (seedPortrait) {
                  profilesOut = qdnProfiles.map((p) =>
                    p.name.toLowerCase() === draft.name.toLowerCase()
                      ? {
                          ...p,
                          characterSummary: linkifyQdnReferences(seedPortrait),
                        }
                      : p
                  );
                  liveAnswer = baseAnswer;
                }
              } finally {
                await listenerRef.current?.remove().catch(() => undefined);
                await progressListenerRef.current
                  ?.remove()
                  .catch(() => undefined);
              }
            }
          } else if (seedPortrait) {
            // No LLM polish — show seed once on the profile card only.
            profilesOut = qdnProfiles.map((p) => ({
              ...p,
              characterSummary: linkifyQdnReferences(
                (p.characterSummary || seedPortrait).trim()
              ),
            }));
            liveAnswer = baseAnswer;
          }

          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: withOffline(liveAnswer),
                    streaming: false,
                    profiles: profilesOut.length ? profilesOut : undefined,
                    publishedSites,
                    quitterPosts,
                    ownedNames: ownedFromScan,
                    media: qdn.media.length ? qdn.media : undefined,
                    mediaLayout:
                      qdn.mediaLayout ||
                      (qdn.media.length && !qdnProfiles.length
                        ? 'grid'
                        : undefined),
                    links: whoLinks.length ? whoLinks : undefined,
                    qdnDepth: qdn.depth || personDepth,
                    qdnDepthChoice:
                      isWhoIs && (qdn.depth || personDepth) === 'quick'
                        ? { query: qText }
                        : undefined,
                  }
                : m
            )
          );
          return;
        }

        // Who-is with no live match → curated FAQ (e.g. Crowetic) before LLM invents.
        if (
          !qdnProfiles.length &&
          (/\bwho\s+is\b/i.test(qText) || /\bwhobis\b/i.test(qText))
        ) {
          const golden = matchGoldenAnswer(qText, { minScore: 0.55 });
          if (golden) {
            const whoLinks = suggestOfficialResources(qText);
            await presentInstantAnswer(golden.entry.a, {
              links: whoLinks.length ? whoLinks : undefined,
            });
            return;
          }
        }

        const creativeAbout = detectCreativeAboutPersonIntent(qText);

        // Users chip must never free-form invent from unrelated VIDEO hits.
        // Creative "poem about X" is an exception — continue to the LLM with QDN facts.
        if (qdnSearchKind === 'users' && !creativeAbout) {
          const fallback =
            qdn.directAnswer ||
            (qdnProfiles[0]
              ? `Found **${qdnProfiles[0].name}** on the name registry. Open the profile card for address and Level; try Max if the dossier looks thin.`
              : `No registered Qortal name matched “${qText.trim()}”. Try another spelling, or switch to All for a general QDN search.`);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: fallback,
                    streaming: false,
                    profiles: qdnProfiles.length ? qdnProfiles : undefined,
                    // Only the resolved user's media — never topic/video keyword hits.
                    media: qdn.media.length ? qdn.media : undefined,
                    mediaLayout: qdn.mediaLayout,
                    publishedSites: qdn.publishedSites,
                    quitterPosts: qdn.quitterPosts,
                    ownedNames: qdn.ownedNames,
                    qdnDepth: qdn.depth || personDepth,
                  }
                : m
            )
          );
          return;
        }

        if (qdnProfiles.length || qdn.media.length) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    profiles: qdnProfiles,
                    media: qdn.media.length ? qdn.media : undefined,
                    mediaLayout: qdn.mediaLayout,
                  }
                : m
            )
          );
        }
        // Knowledge-pack backup ONLY for topical how-tos — never for person lookups
        // (pack chunks about earth-changes / "quantum" were polluting who-is answers).
        // Creative writing about a person still uses QDN chunks, not the pack.
        const personLookup =
          !!creativeAbout ||
          qdnSearchKind === 'users' ||
          qdnProfiles.length > 0 ||
          /\bwho\s+is\b/i.test(qText) ||
          /\bwhobis\b/i.test(qText);
        const wantsPack =
          !personLookup &&
          (detectTopicIntent(qText) || !contextChunks.length);
        if (wantsPack && knowledge) {
          const packQuery = needsPlayingQortalContext(qText)
            ? qText
            : knowledgeQueryForRetrieval(qText, messages);
          const retrieved = await retrieveKnowledge(knowledge, packQuery, 2);
          const packChunks = retrieved.slice(0, 2).map((c) => ({
            text: `[Qortino notes · ${c.title || c.source}] ${c.text.slice(0, isFast ? 450 : 700)}`,
          }));
          contextChunks = [...contextChunks, ...packChunks];
        }
      } else if (wantsKnowledgeLookup(text)) {
        const ragQuery = effectiveAsk;
        const stayOnQortal =
          isQortalNetworkDefinitionQuery(ragQuery) ||
          (topicFollow.expanded && /\bqortal\b/i.test(ragQuery));
        if (isFast) {
          setAssembleDetail(STATUS_LINES.quickScan);
        } else {
          setAssembleDetail(STATUS_LINES.deepSearch);
        }
        let retrieved = await retrieveKnowledge(
          knowledge,
          ragQuery,
          stayOnQortal ? 4 : 2
        );
        // Depth follow-ups on Qortal must not pull survival/gardening noise.
        if (stayOnQortal) {
          retrieved = retrieved.filter(
            (c) =>
              (c.source || '').includes('qortal') ||
              /qortal|qdn|qort|mint/i.test(
                `${c.title || ''} ${c.text.slice(0, 160)}`
              )
          );
        }
        contextChunks = retrieved.slice(0, 2).map((c) => ({
          text: `[${c.title || c.source}] ${c.text.slice(
            0,
            isFast ? 450 : 700
          )}`,
        }));
        if (softGolden) {
          contextChunks = [
            {
              text: `[Curated FAQ · ${softGolden.entry.category}] Q: ${softGolden.entry.q}\nA: ${softGolden.entry.a}`,
            },
            ...contextChunks,
          ].slice(0, 2);
        }
      }

      let streamed = '';
      let settleDone!: (value: { error?: string }) => void;
      const donePromise = new Promise<{ error?: string }>((resolve) => {
        settleDone = resolve;
      });

      await listenerRef.current?.remove();
      await progressListenerRef.current?.remove();

      // Buffer tokens and flush each animation frame so Max streams live
      // without flooding React with a setState per token.
      let pendingTokens = '';
      let rafId = 0;
      const flushStream = () => {
        rafId = 0;
        if (!pendingTokens) return;
        const chunk = pendingTokens;
        pendingTokens = '';
        streamed += chunk;
        const snap = streamed;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: snap } : m
          )
        );
      };

      progressListenerRef.current = await QortinoLlm.addListener(
        'progress',
        (event) => {
          if (assistantIdRef.current !== assistantId) return;
          if (event.detail) setAssembleDetail(event.detail);
        }
      );

      listenerRef.current = await QortinoLlm.addListener('token', (event) => {
        if (assistantIdRef.current !== assistantId) return;
        if (event.error && event.error !== 'cancelled') {
          setStatusError(event.error);
        }
        if (event.token) {
          pendingTokens += event.token;
          if (!rafId) {
            rafId = window.requestAnimationFrame(flushStream);
          }
        }
        if (event.done) {
          if (rafId) {
            window.cancelAnimationFrame(rafId);
            rafId = 0;
          }
          flushStream();
          settleDone({ error: event.error });
        }
      });

      const creativeAsk = detectCreativeAboutPersonIntent(text);
      setAssembleDetail(
        creativeAsk
          ? `Composing your ${creativeAsk.formLabel} (QDN as background)…`
          : isFast
            ? STATUS_LINES.fastPath
            : STATUS_LINES.maxPath
      );
      // Fast: short complete replies inside nCtx 640. Max: fuller answers
      // inside nCtx 1152. Poems/nominations need more room than a who-is.
      const maxTokens = isFast
        ? qdnMode
          ? detectNominationIntent(text) || creativeAsk
            ? 220
            : 176
          : 150
        : qdnMode
          ? detectNominationIntent(text) || creativeAsk
            ? 320
            : 272
          : 288;
      let completeText = '';
      try {
        const groundedChunks = (() => {
          const extras: Array<{ text: string }> = [];
          if (
            needsQortalDefinitionGuard(effectiveAsk) ||
            needsQortalDefinitionGuard(text) ||
            needsPlayingQortalContext(text)
          ) {
            extras.push({
              text: `[Hard facts — Qortal network]\n${QORTINO_QORTAL_HARD_FACTS}`,
            });
          }
          // Playing Qortal / Simon James notes ONLY when the user asked for them.
          if (
            needsPlayingQortalContext(text) ||
            needsPlayingQortalContext(effectiveAsk)
          ) {
            extras.push({
              text: `[Hard facts — Playing Qortal / Simon James]\n${QORTINO_PLAYING_QORTAL_FACTS}`,
            });
          }
          const combined = extras.length
            ? [...extras, ...contextChunks]
            : contextChunks;
          // The JNI truncates overflowing prompts from the FRONT — the system
          // persona goes first. Clamp total chunk volume here instead so the
          // persona + hard facts always survive (leading chunks are kept).
          const chunkCharBudget = isFast ? 1100 : 2200;
          let usedChars = 0;
          const fitted: Array<{ text: string }> = [];
          for (const chunk of combined) {
            if (usedChars >= chunkCharBudget) break;
            const remaining = chunkCharBudget - usedChars;
            const textFit =
              chunk.text.length > remaining
                ? `${chunk.text.slice(0, remaining)}…`
                : chunk.text;
            fitted.push({ text: textFit });
            usedChars += textFit.length;
          }
          return fitted;
        })();
        if (!isFast) {
          setAssembleDetail(STATUS_LINES.maxWriting);
        }
        const systemPrompt = buildSystemPrompt({
          safetyDisclaimer: isFast ? undefined : QORTINO_SAFETY_DISCLAIMER,
          compact: true,
          fast: isFast,
          max: !isFast,
          qdnMode,
          // Offline line is already in the compact persona — don't duplicate tokens.
          offlineBadge: false,
        });
        const result = await QortinoLlm.complete({
          system: systemPrompt,
          messages: history,
          contextChunks: groundedChunks,
          maxTokens,
          // Fast: crisper, less rambling on short caps. Max: room for prose.
          temperature: isFast ? 0.55 : 0.65,
        });
        completeText = typeof result?.text === 'string' ? result.text : '';
        if (rafId) {
          window.cancelAnimationFrame(rafId);
          rafId = 0;
        }
        flushStream();
      } finally {
        await Promise.race([
          donePromise,
          new Promise<{ error?: string }>((resolve) =>
            setTimeout(() => resolve({}), 2500)
          ),
        ]);
      }

      let finalText = normalizeQortCoinLanguage(
        (streamed || completeText).trim()
      );
      // Prefer the longer of streamed vs returned text (bridge may drop some tokens).
      if (completeText.trim().length > finalText.length) {
        finalText = normalizeQortCoinLanguage(completeText.trim());
      }
      if (isFast && looksIncompleteAnswer(finalText)) {
        finalText = trimIncompleteTail(finalText);
      }
      finalText = normalizeQortCoinLanguage(finalText);
      const offerContinue = shouldOfferContinueAssemble(finalText, {
        maxTokens,
        mode: isFast ? 'fast' : 'max',
      });
      let outLinks = qdnLinks;
      let outApps = matchedApp ? [matchedApp] : undefined;
      let outAddon = '';
      if (qdnMode && isMintingHowToQuery(text)) {
        const mintApps = await fetchMintingGuideApps();
        if (mintApps.length) outApps = mintApps;
        outLinks = [
          ...mintingOfficialLinks(),
          ...qdnLinks.filter(
            (l) => !mintingOfficialLinks().some((m) => m.id === l.id)
          ),
        ].slice(0, 6);
        outAddon = mintingGuideAddonMarkdown(
          isNominationExplainQuery(text) ? 'nomination' : 'mint'
        );
      }
      if (finalText) {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantId) return m;
            const content = normalizeQortCoinLanguage(
              outAddon && !/Q-Minter Guide/i.test(finalText)
                ? `${finalText}\n\n${outAddon}`
                : finalText
            );
            const canContinue =
              offerContinue ||
              shouldOfferContinueAssemble(content, {
                maxTokens,
                mode: isFast ? 'fast' : 'max',
              });
            return {
              ...m,
              content,
              links: outLinks.length ? outLinks : m.links,
              apps: outApps?.length ? outApps : m.apps,
              // Always keep the user query so Continue can re-detect after reload.
              canContinueAssemble: canContinue,
              continueQuery: text,
            };
          })
        );
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content:
                    m.content ||
                    'No reply came back — try Fast mode, a shorter question, or reopen the agent.',
                  links: outLinks.length ? outLinks : m.links,
                  apps: outApps?.length ? outApps : m.apps,
                }
              : m
          )
        );
      }
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : 'Generation failed');
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: m.content || 'Sorry — I could not generate a reply.',
              }
            : m
        )
      );
    } finally {
      setBusy(false);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, streaming: false } : m
        )
      );
    }
  }, [
    answerMode,
    busy,
    input,
    knowledge,
    loadingModel,
    messages,
    qdnMode,
    qdnSearchKind,
    setMessages,
    userInfo?.address,
  ]);

  const searchUser = useCallback(
    (name: string) => {
      const q = `who is ${name}`;
      if (busy || loadingModel) return;
      if (!qdnMode) {
        pendingSendRef.current = q;
        switchDataSource('qdn');
        return;
      }
      void send(q);
    },
    [busy, loadingModel, qdnMode, send, switchDataSource]
  );

  useEffect(() => {
    if (!qdnMode || busy || loadingModel) return;
    const pending = pendingSendRef.current;
    if (!pending) return;
    pendingSendRef.current = null;
    void send(pending);
  }, [busy, loadingModel, qdnMode, send]);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        isolation: 'isolate',
        minHeight: 0,
        overflow: 'hidden',
        position: 'relative',
        backgroundImage: isDark
          ? `radial-gradient(90% 120% at 12% 30%, ${alpha(hazeAccent, 0.14)} 0%, transparent 55%), radial-gradient(80% 100% at 88% 70%, ${alpha(hazeWarm, 0.1)} 0%, transparent 50%), linear-gradient(180deg, #12151c 0%, #0c0e13 100%)`
          : `radial-gradient(90% 120% at 12% 30%, ${alpha(hazeAccent, 0.12)} 0%, transparent 55%), radial-gradient(80% 100% at 88% 70%, ${alpha(hazeWarm, 0.16)} 0%, transparent 50%), linear-gradient(180deg, #f4f7fb 0%, #e8eef6 100%)`,
        '@keyframes qortinoHeadFloat0': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) rotate(-6deg)' },
          '50%': { transform: 'translate3d(10px, -8px, 0) rotate(4deg)' },
        },
        '@keyframes qortinoHeadFloat1': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) rotate(8deg)' },
          '50%': { transform: 'translate3d(-12px, 10px, 0) rotate(-4deg)' },
        },
        '@keyframes qortinoHeadFloat2': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(1) rotate(-3deg)' },
          '50%': { transform: 'translate3d(8px, 12px, 0) scale(1.06) rotate(6deg)' },
        },
        '@keyframes qortinoHeadFloat3': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) rotate(5deg)' },
          '50%': { transform: 'translate3d(-8px, -10px, 0) rotate(-8deg)' },
        },
      }}
    >
      <Box
        aria-hidden
        sx={{
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
          position: 'absolute',
          zIndex: 0,
        }}
      >
        {headDecor.map((logo, idx) => (
          <Box
            key={`${logo.anim}-${idx}`}
            component="img"
            alt=""
            src={qortinoHeadUrl}
            sx={{
              animation: `qortinoHeadFloat${logo.anim} ${logo.dur} ease-in-out infinite`,
              filter: isDark
                ? 'saturate(0.85) brightness(1.08)'
                : 'saturate(0.9)',
              height: logo.size,
              left: logo.left,
              objectFit: 'contain',
              opacity: logo.opacity,
              position: 'absolute',
              top: logo.top,
              width: logo.size,
              willChange: 'transform',
            }}
          />
        ))}
      </Box>

      <Box
        sx={{
          alignItems: 'center',
          borderBottom: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
          display: 'flex',
          gap: 1,
          position: 'relative',
          px: 1,
          pt: 1,
          pb: 1,
          zIndex: 1,
        }}
      >
        <IconButton aria-label="Close Qortino chat" onClick={onClose} size="small">
          <ArrowBackRoundedIcon />
        </IconButton>
        <IconButton
          aria-label="Chat history"
          size="small"
          onClick={() => setHistoryOpen(true)}
        >
          <HistoryRoundedIcon />
        </IconButton>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700, lineHeight: 1.2 }}>Qortino</Typography>
          <Typography
            sx={{
              color: alpha(theme.palette.text.primary, 0.65),
              fontSize: '0.75rem',
            }}
          >
            {qdnMode ? 'QDN agent' : 'Offline agent'}
            {install.packId ? ` · ${install.packId}` : ''}
            {activeModelLabel ? ` · ${activeModelLabel}` : ''}
          </Typography>
        </Box>
        <Box
          role="group"
          aria-label="Data source"
          sx={{
            display: 'flex',
            flexShrink: 0,
            gap: 0.35,
            p: 0.25,
            borderRadius: '8px',
            background: alpha(theme.palette.common.black, isDark ? 0.28 : 0.06),
            border: `1px solid ${alpha(theme.palette.divider, 0.55)}`,
          }}
        >
          {(
            [
              { id: 'offline' as const, label: 'Offline', color: '#3DDC97' },
              { id: 'qdn' as const, label: 'QDN', color: '#7EB6FF' },
            ] as const
          ).map((opt) => {
            const active = dataSourceMode === opt.id;
            return (
              <Box
                key={opt.id}
                component="button"
                type="button"
                disabled={busy}
                onClick={() => switchDataSource(opt.id)}
                sx={{
                  appearance: 'none',
                  background: active
                    ? alpha(opt.color, isDark ? 0.28 : 0.22)
                    : 'transparent',
                  border: active
                    ? `1px solid ${alpha(opt.color, 0.55)}`
                    : '1px solid transparent',
                  borderRadius: '6px',
                  color: active
                    ? isDark
                      ? opt.id === 'offline'
                        ? '#B8F5D8'
                        : '#D6E8FF'
                      : opt.id === 'offline'
                        ? '#146C43'
                        : '#1A4A8A'
                    : alpha(theme.palette.text.primary, 0.55),
                  cursor: busy ? 'default' : 'pointer',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  px: 0.75,
                  py: 0.35,
                  textTransform: 'uppercase',
                }}
              >
                {opt.label}
              </Box>
            );
          })}
        </Box>
      </Box>

      <Box
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const distanceFromBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight;
          stickToBottomRef.current = distanceFromBottom < 96;
        }}
        sx={{
          WebkitOverflowScrolling: 'touch',
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          position: 'relative',
          px: 1.5,
          py: 1.5,
          touchAction: 'pan-y',
          zIndex: 1,
        }}
      >
        {loadingModel && (
          <Box sx={{ alignItems: 'center', display: 'flex', gap: 1, py: 2 }}>
            <CircularProgress size={18} />
            <Typography sx={{ fontSize: '0.9rem' }}>Loading on-device model…</Typography>
          </Box>
        )}
        {!loadingModel && messages.length === 0 && (
          <Typography
            sx={{
              color: alpha(theme.palette.text.primary, 0.7),
              fontSize: '0.92rem',
              lineHeight: 1.45,
              maxWidth: 420,
            }}
          >
            {qdnMode
              ? 'QDN chat (separate from Offline): who is someone, minter/dev admins, group owners, names with dates, “what did X publish on March 1st 2025”, media shelves — plus Qortino’s on-device knowledge as backup. Avatars load from your node.'
              : 'Offline chat (separate from QDN): Qortal how-tos, Q-Apps directory, and general know-how from Qortino’s on-device knowledge. For live people/admins/groups/names/day publishes, switch to the QDN window.'}
          </Typography>
        )}
        {messages.map((m, msgIndex) => (
          <Box
            key={m.id}
            sx={{
              display: 'flex',
              justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              mb: 1.1,
            }}
          >
            <Box
              sx={{
                background:
                  m.role === 'user'
                    ? alpha('#4A7FD4', isDark ? 0.35 : 0.18)
                    : alpha(theme.palette.background.paper, isDark ? 0.62 : 0.92),
                border: `1px solid ${alpha(theme.palette.common.white, isDark ? 0.08 : 0.35)}`,
                borderRadius: '14px',
                boxShadow: m.streaming
                  ? `0 8px 28px ${alpha('#7EB6FF', isDark ? 0.12 : 0.1)}`
                  : 'none',
                maxWidth: '92%',
                px: 1.2,
                py: 0.9,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {m.nudgeQdn ? (
                <Box
                  component="button"
                  type="button"
                  onClick={() => switchDataSource('qdn')}
                  sx={{
                    appearance: 'none',
                    background: alpha('#7EB6FF', isDark ? 0.28 : 0.18),
                    border: `1px solid ${alpha('#7EB6FF', 0.5)}`,
                    borderRadius: '12px',
                    color: isDark ? '#D6E8FF' : '#1A4A8A',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                    fontWeight: 800,
                    mb: 1,
                    px: 1.25,
                    py: 0.75,
                    width: '100%',
                  }}
                >
                  Open QDN chat window →
                </Box>
              ) : null}
              {m.profiles?.map((p) => {
                const primaryName = (p.primaryName || p.name).trim();
                const isSecondary =
                  p.nameRole === 'secondary' &&
                  primaryName.toLowerCase() !== p.name.toLowerCase();
                const avatarSrc = p.avatarUrl || qAppAvatarUrl(primaryName);
                return (
                  <Box
                    key={`${p.address}-${p.name}`}
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 0.55,
                      mb: m.content || m.streaming || m.ownedNames?.length ? 1 : 0,
                    }}
                  >
                    <Box sx={{ alignItems: 'flex-start', display: 'flex', gap: 1 }}>
                      <Box sx={{ minWidth: 0, width: '100%' }}>
                        <QortinoNameAction
                          name={primaryName}
                          avatarUrl={avatarSrc}
                          showAvatar
                          avatarSize={56}
                          fontSize="0.98rem"
                          fontWeight={700}
                          onSearchUser={searchUser}
                          onAvatarClick={(src) =>
                            setAvatarLightbox({
                              src,
                              alt: `${primaryName} avatar`,
                            })
                          }
                        />
                        <Typography
                          component="button"
                          type="button"
                          onClick={() => {
                            void navigator.clipboard
                              ?.writeText(p.address)
                              .catch(() => undefined);
                          }}
                          title="Copy address"
                          sx={{
                            appearance: 'none',
                            background: 'transparent',
                            border: 'none',
                            color: alpha(theme.palette.text.primary, 0.55),
                            cursor: 'pointer',
                            display: 'block',
                            fontFamily:
                              'ui-monospace, SFMono-Regular, Menlo, monospace',
                            fontSize: '0.68rem',
                            fontWeight: 600,
                            letterSpacing: '0.01em',
                            lineHeight: 1.35,
                            mt: 0.35,
                            p: 0,
                            textAlign: 'left',
                            wordBreak: 'break-all',
                            '&:hover': {
                              color: isDark ? '#7EB6FF' : '#1A6FD4',
                            },
                          }}
                        >
                          {p.address}
                        </Typography>
                        {isSecondary ? (
                          <Typography
                            sx={{
                              color: alpha(theme.palette.text.primary, 0.62),
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              mt: 0.2,
                            }}
                          >
                            Also as{' '}
                            <Box
                              component="span"
                              sx={{ color: isDark ? '#7EB6FF' : '#1A6FD4' }}
                            >
                              {p.name}
                            </Box>{' '}
                            (secondary)
                          </Typography>
                        ) : null}
                        <Box
                          sx={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 0.45,
                            mt: 0.45,
                          }}
                        >
                          <Box
                            component="span"
                            sx={{
                              background: alpha('#7EB6FF', isDark ? 0.22 : 0.18),
                              borderRadius: '999px',
                              color: isDark ? '#D6E8FF' : '#1A4A8A',
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              px: 0.7,
                              py: 0.15,
                            }}
                          >
                            Level {p.level}
                          </Box>
                          <Box
                            component="span"
                            sx={{
                              background: alpha(
                                '#3DDC97',
                                isDark ? 0.22 : 0.18
                              ),
                              borderRadius: '999px',
                              color: isDark ? '#F4F0FF' : '#2A2040',
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              px: 0.7,
                              py: 0.15,
                            }}
                          >
                            Primary name
                          </Box>
                          {p.tags.map((tag) => (
                            <Box
                              key={tag}
                              component="span"
                              sx={{
                                background: alpha(
                                  tag === 'Founder'
                                    ? '#F0C14B'
                                    : tag.includes('Minter')
                                      ? '#3DDC97'
                                      : '#B388FF',
                                  isDark ? 0.22 : 0.18
                                ),
                                borderRadius: '999px',
                                color: isDark ? '#F4F0FF' : '#2A2040',
                                fontSize: '0.68rem',
                                fontWeight: 700,
                                px: 0.7,
                                py: 0.15,
                              }}
                            >
                              {tag}
                            </Box>
                          ))}
                        </Box>
                      </Box>
                    </Box>
                    {p.characterSummary?.trim() ? (
                      <Box sx={{ mt: 0.15 }}>
                        <QortinoRichText
                          text={p.characterSummary.trim()}
                          fontSize="0.86rem"
                        />
                      </Box>
                    ) : null}
                    {p.description?.trim() ? (
                      <ProfileDescriptionRich
                        text={p.description.trim()}
                        isDark={isDark}
                      />
                    ) : null}
                  </Box>
                );
              })}
              {m.publishedSites?.length ? (
                <Box
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 0.55,
                    mb: 0.75,
                    mt: 0.25,
                  }}
                >
                  {m.publishedSites.map((site) => (
                    <Box
                      key={`${site.service}:${site.name}`}
                      component="button"
                      type="button"
                      onClick={() =>
                        openQAppInNewTab({
                          service: site.service,
                          name: site.name,
                        })
                      }
                      sx={{
                        alignItems: 'center',
                        appearance: 'none',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: '8px',
                        color: isDark ? '#7EB6FF' : '#1A6FD4',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        gap: 0.4,
                        px: 0.15,
                        py: 0.15,
                        textDecoration: 'underline',
                        textUnderlineOffset: '2px',
                        '&:hover': {
                          background: alpha('#7EB6FF', isDark ? 0.12 : 0.08),
                        },
                      }}
                    >
                      <Avatar
                        alt=""
                        src={site.avatarUrl || qAppAvatarUrl(site.name)}
                        imgProps={{
                          referrerPolicy: 'no-referrer',
                          loading: 'lazy',
                        }}
                        sx={{ height: 18, width: 18 }}
                      >
                        {site.name.slice(0, 1)}
                      </Avatar>
                      {site.name}
                      <Box
                        component="span"
                        sx={{
                          color: alpha(theme.palette.text.primary, 0.45),
                          fontSize: '0.62rem',
                          fontWeight: 700,
                          textDecoration: 'none',
                        }}
                      >
                        · {site.service === 'APP' ? 'Q-App' : 'Website'}
                      </Box>
                    </Box>
                  ))}
                </Box>
              ) : null}
              {m.quitterPosts?.length ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 0.75 }}>
                  <Typography
                    sx={{
                      color: alpha(theme.palette.text.primary, 0.55),
                      fontSize: '0.66rem',
                      fontWeight: 800,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    }}
                  >
                    Recent Quitter
                  </Typography>
                  {m.quitterPosts.map((post) => (
                    <Box
                      key={post.identifier}
                      component="button"
                      type="button"
                      onClick={() => openQuitterPostInNewTab(post)}
                      sx={{
                        appearance: 'none',
                        background: 'transparent',
                        border: 'none',
                        borderLeft: `3px solid ${alpha('#7EB6FF', 0.55)}`,
                        color: 'inherit',
                        cursor: 'pointer',
                        display: 'block',
                        pl: 0.85,
                        py: 0.25,
                        textAlign: 'left',
                        width: '100%',
                        '&:hover': {
                          background: alpha('#7EB6FF', isDark ? 0.1 : 0.06),
                        },
                      }}
                    >
                      <Typography
                        sx={{
                          fontSize: '0.8rem',
                          lineHeight: 1.4,
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {post.text}
                      </Typography>
                      <Typography
                        sx={{
                          color: isDark ? '#7EB6FF' : '#1A6FD4',
                          fontSize: '0.66rem',
                          fontWeight: 700,
                          mt: 0.25,
                        }}
                      >
                        Open in Quitter →
                        {post.created
                          ? ` · ${formatMediaDate(post.created)}`
                          : ''}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              ) : null}
              {m.streaming ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  <AssemblingLabel detail={assembleDetail} mode={answerMode} />
                  {m.content ? (
                    <Box
                      sx={{
                        borderLeft: `2px solid ${alpha('#7EB6FF', 0.45)}`,
                        pl: 1,
                      }}
                    >
                      <QortinoRichText text={m.content} />
                    </Box>
                  ) : null}
                </Box>
              ) : m.content ? (
                <QortinoRichText text={m.content} />
              ) : null}
              {(() => {
                if (m.streaming || m.role !== 'assistant' || !m.content) {
                  return null;
                }
                let pairedQuestion = m.continueQuery?.trim() || '';
                if (!pairedQuestion) {
                  for (let i = msgIndex - 1; i >= 0; i -= 1) {
                    const prev = messages[i];
                    if (prev?.role === 'user' && prev.content?.trim()) {
                      pairedQuestion = prev.content.trim();
                      break;
                    }
                  }
                }
                const mode = answerMode === 'fast' ? 'fast' : 'max';
                // Live re-check only — ignore stale canContinueAssemble from history.
                // Complete answers (ending cleanly) must not get Continue.
                const showContinue =
                  !!pairedQuestion &&
                  shouldOfferContinueAssemble(m.content, {
                    mode,
                    maxTokens: mode === 'fast' ? 140 : 256,
                  });
                return (
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: 0.5,
                      justifyContent: showContinue
                        ? 'space-between'
                        : 'flex-end',
                      mt: 0.85,
                      width: '100%',
                    }}
                  >
                    {showContinue ? (
                      <Box
                        component="button"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void continueAssemble(
                            m.id,
                            pairedQuestion,
                            m.content
                          )
                        }
                        sx={{
                          appearance: 'none',
                          background: alpha('#7EB6FF', isDark ? 0.14 : 0.1),
                          border: `1px solid ${alpha('#7EB6FF', 0.45)}`,
                          borderRadius: '10px',
                          color: isDark ? '#D6E8FF' : '#1A4A8A',
                          cursor: busy ? 'default' : 'pointer',
                          fontSize: '0.74rem',
                          fontWeight: 800,
                          opacity: busy ? 0.55 : 1,
                          px: 1,
                          py: 0.6,
                        }}
                      >
                        Continue assembling →
                      </Box>
                    ) : (
                      <Box />
                    )}
                    <Box
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        gap: 0.15,
                        ml: 'auto',
                      }}
                    >
                      <IconButton
                        aria-label="Copy answer"
                        size="small"
                        title="Copy full answer"
                        onClick={() => {
                          const full = formatAssistantBubbleForClipboard(m);
                          void navigator.clipboard
                            ?.writeText(full || m.content)
                            .then(() => setCopySnack('Full answer copied'))
                            .catch(() => setCopySnack('Could not copy'));
                        }}
                        sx={{
                          color: alpha(theme.palette.text.primary, 0.42),
                          p: 0.35,
                          '&:hover': {
                            background: alpha('#7EB6FF', isDark ? 0.16 : 0.1),
                            color: isDark ? '#D6E8FF' : '#1A6FD4',
                          },
                        }}
                      >
                        <ContentCopyRoundedIcon sx={{ fontSize: '1.05rem' }} />
                      </IconButton>
                      <IconButton
                        aria-label="Report answer to teach Qortino"
                        size="small"
                        title="Report / teach Qortino"
                        onClick={() =>
                          setAnswerReport({
                            question: pairedQuestion || '(no question found)',
                            answer:
                              formatAssistantBubbleForClipboard(m) ||
                              m.content,
                            dataSource: dataSourceMode,
                            answerMode,
                            qdnSearchKind: qdnMode ? qdnSearchKind : undefined,
                          })
                        }
                        sx={{
                          color: alpha(theme.palette.text.primary, 0.42),
                          p: 0.35,
                          '&:hover': {
                            background: alpha('#E57373', isDark ? 0.16 : 0.1),
                            color: isDark ? '#FFB4B4' : '#C62828',
                          },
                        }}
                      >
                        <FlagOutlinedIcon sx={{ fontSize: '1.05rem' }} />
                      </IconButton>
                    </Box>
                  </Box>
                );
              })()}
              {m.qdnDepthChoice?.query ? (
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.65,
                    mt: 1,
                  }}
                >
                  {!m.profiles?.length && !m.qdnDepth ? (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.65 }}>
                      <Box
                        component="button"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void send(m.qdnDepthChoice!.query, {
                            depth: 'quick',
                            resumeAssistantId: m.id,
                          })
                        }
                        sx={{
                          appearance: 'none',
                          background: alpha('#3DDC97', isDark ? 0.18 : 0.14),
                          border: `1px solid ${alpha('#3DDC97', 0.45)}`,
                          borderRadius: '12px',
                          color: isDark ? '#E8FFF4' : '#0F3D2A',
                          cursor: busy ? 'default' : 'pointer',
                          fontSize: '0.78rem',
                          fontWeight: 800,
                          opacity: busy ? 0.55 : 1,
                          px: 1.1,
                          py: 0.7,
                          textAlign: 'left',
                        }}
                      >
                        Quick look
                        <Box
                          component="span"
                          sx={{
                            display: 'block',
                            fontSize: '0.66rem',
                            fontWeight: 600,
                            opacity: 0.75,
                          }}
                        >
                          Recent activity · live publishes
                        </Box>
                      </Box>
                      <Box
                        component="button"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void send(m.qdnDepthChoice!.query, {
                            depth: 'full',
                            resumeAssistantId: m.id,
                          })
                        }
                        sx={{
                          appearance: 'none',
                          background: alpha('#7EB6FF', isDark ? 0.16 : 0.12),
                          border: `1px solid ${alpha('#7EB6FF', 0.45)}`,
                          borderRadius: '12px',
                          color: isDark ? '#EAF3FF' : '#163A6B',
                          cursor: busy ? 'default' : 'pointer',
                          fontSize: '0.78rem',
                          fontWeight: 800,
                          opacity: busy ? 0.55 : 1,
                          px: 1.1,
                          py: 0.7,
                          textAlign: 'left',
                        }}
                      >
                        Full history
                        <Box
                          component="span"
                          sx={{
                            display: 'block',
                            fontSize: '0.66rem',
                            fontWeight: 600,
                            opacity: 0.75,
                          }}
                        >
                          Pages older txs · slower on big accounts
                        </Box>
                      </Box>
                    </Box>
                  ) : null}
                  {m.qdnDepth === 'quick' && m.profiles?.length ? (
                    <Box
                      component="button"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void send(m.qdnDepthChoice!.query, {
                          depth: 'full',
                          resumeAssistantId: m.id,
                        })
                      }
                      sx={{
                        appearance: 'none',
                        alignSelf: 'flex-start',
                        background: 'transparent',
                        border: `1px dashed ${alpha('#7EB6FF', 0.5)}`,
                        borderRadius: '10px',
                        color: isDark ? '#7EB6FF' : '#1A6FD4',
                        cursor: busy ? 'default' : 'pointer',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        opacity: busy ? 0.55 : 1,
                        px: 0.9,
                        py: 0.55,
                      }}
                    >
                      Max · scan full QDN history →
                    </Box>
                  ) : null}
                  {m.qdnDepth === 'full' && m.profiles?.length ? (
                    <Typography
                      sx={{
                        color: alpha(theme.palette.text.primary, 0.5),
                        fontSize: '0.66rem',
                        fontWeight: 700,
                      }}
                    >
                      Max · full history
                    </Typography>
                  ) : null}
                  {m.qdnDepth === 'quick' && m.profiles?.length ? (
                    <Typography
                      sx={{
                        color: alpha(theme.palette.text.primary, 0.5),
                        fontSize: '0.66rem',
                        fontWeight: 700,
                      }}
                    >
                      Fast · recent txs
                    </Typography>
                  ) : null}
                </Box>
              ) : null}
              {m.ownedNames?.length ? (
                <OwnedNamesCompact
                  names={m.ownedNames}
                  isDark={isDark}
                  onSearchUser={searchUser}
                />
              ) : null}
              {m.apps?.length ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mt: 1 }}>
                  {m.apps.map((app) => (
                    <Box
                      key={app.entry.id}
                      sx={{
                        background: alpha('#7EB6FF', isDark ? 0.12 : 0.08),
                        border: `1px solid ${alpha('#7EB6FF', 0.35)}`,
                        borderRadius: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.65,
                        p: 0.85,
                      }}
                    >
                      <Box
                        sx={{
                          alignItems: 'center',
                          cursor: 'pointer',
                          display: 'flex',
                          gap: 1,
                        }}
                        onClick={() => openQAppInNewTab(app.entry)}
                      >
                        <Avatar
                          alt={app.entry.title}
                          src={qAppAvatarUrl(app.entry.name)}
                          imgProps={{
                            referrerPolicy: 'no-referrer',
                            loading: 'lazy',
                            decoding: 'async',
                          }}
                          sx={{
                            border: `2px solid ${alpha('#7EB6FF', 0.4)}`,
                            height: 48,
                            width: 48,
                          }}
                        >
                          {app.entry.title.slice(0, 1)}
                        </Avatar>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography sx={{ fontSize: '0.9rem', fontWeight: 800 }}>
                            {app.entry.title}
                          </Typography>
                          <Box
                            sx={{
                              alignItems: 'baseline',
                              color: alpha(theme.palette.text.primary, 0.6),
                              display: 'flex',
                              flexWrap: 'wrap',
                              fontSize: '0.68rem',
                              gap: 0.35,
                            }}
                          >
                            <Box component="span">
                              {app.entry.service} · published as
                            </Box>
                            <Box
                              component="span"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <QortinoNameAction
                                name={app.entry.name}
                                fontSize="0.68rem"
                                fontWeight={700}
                                onSearchUser={searchUser}
                              />
                            </Box>
                          </Box>
                        </Box>
                        <Box
                          component="button"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openQAppInNewTab(app.entry);
                          }}
                          sx={{
                            appearance: 'none',
                            background: alpha('#7EB6FF', 0.9),
                            border: 'none',
                            borderRadius: '10px',
                            color: '#061018',
                            cursor: 'pointer',
                            flexShrink: 0,
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            px: 1,
                            py: 0.55,
                          }}
                        >
                          Open tab
                        </Box>
                      </Box>
                      {app.publisher ? (
                        <Box
                          sx={{
                            borderTop: `1px solid ${alpha('#7EB6FF', 0.22)}`,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 0.25,
                            pt: 0.65,
                          }}
                        >
                          <Typography
                            sx={{
                              color: alpha(theme.palette.text.primary, 0.55),
                              fontSize: '0.66rem',
                              fontWeight: 700,
                              letterSpacing: '0.04em',
                              textTransform: 'uppercase',
                            }}
                          >
                            Publisher
                          </Typography>
                          <Box sx={{ alignItems: 'center', display: 'flex', gap: 0.75 }}>
                            <QortinoNameAction
                              name={app.publisher.primaryName}
                              avatarUrl={app.publisher.avatarUrl}
                              showAvatar
                              avatarSize={32}
                              fontSize="0.8rem"
                              fontWeight={700}
                              onSearchUser={searchUser}
                            />
                            <Typography
                              sx={{
                                color: alpha(theme.palette.text.primary, 0.5),
                                fontSize: '0.68rem',
                              }}
                            >
                              Level {app.publisher.level}
                              {app.publisher.primaryName.toLowerCase() !==
                              app.publisher.publishName.toLowerCase()
                                ? ` · via ${app.publisher.publishName}`
                                : ' · primary name'}
                            </Typography>
                          </Box>
                        </Box>
                      ) : null}
                    </Box>
                  ))}
                </Box>
              ) : null}
              {m.links?.length ? (
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.65,
                    mt: m.content || m.apps?.length ? 1 : 0,
                  }}
                >
                  {m.links.map((link) => (
                    <Box
                      key={link.id}
                      component="button"
                      type="button"
                      onClick={() => openOfficialResource(link)}
                      sx={{
                        alignItems: 'center',
                        appearance: 'none',
                        background: alpha('#7EB6FF', isDark ? 0.16 : 0.1),
                        border: `1px solid ${alpha('#7EB6FF', 0.4)}`,
                        borderRadius: '12px',
                        color: isDark ? '#D6E8FF' : '#1A4A8A',
                        cursor: 'pointer',
                        display: 'flex',
                        gap: 0.85,
                        px: 0.85,
                        py: 0.65,
                        textAlign: 'left',
                        width: '100%',
                        '&:hover': {
                          background: alpha('#7EB6FF', isDark ? 0.26 : 0.18),
                        },
                      }}
                    >
                      {link.service && link.name ? (
                        <Avatar
                          alt={link.label}
                          src={qAppAvatarUrl(link.name)}
                          imgProps={{
                            referrerPolicy: 'no-referrer',
                            loading: 'lazy',
                          }}
                          sx={{
                            border: `2px solid ${alpha('#7EB6FF', 0.4)}`,
                            height: 40,
                            width: 40,
                          }}
                        >
                          {link.label.slice(0, 1)}
                        </Avatar>
                      ) : null}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: '0.82rem', fontWeight: 800 }}>
                          {link.label}
                          {link.href ? ' ↗' : ' →'}
                        </Typography>
                        {link.blurb ? (
                          <Typography
                            sx={{
                              color: alpha(theme.palette.text.primary, 0.55),
                              fontSize: '0.68rem',
                            }}
                          >
                            {link.service
                              ? `${link.service} · ${link.blurb}`
                              : link.blurb}
                          </Typography>
                        ) : link.service ? (
                          <Typography
                            sx={{
                              color: alpha(theme.palette.text.primary, 0.55),
                              fontSize: '0.68rem',
                            }}
                          >
                            {link.service}
                            {link.name ? ` · ${link.name}` : ''}
                          </Typography>
                        ) : null}
                      </Box>
                    </Box>
                  ))}
                </Box>
              ) : null}
              {m.media?.length ? (
                <QortinoMediaCards
                  items={m.media}
                  layout={m.mediaLayout}
                  onSearchUser={searchUser}
                />
              ) : null}
            </Box>
          </Box>
        ))}
        {statusError && (
          <Typography sx={{ color: theme.palette.error.main, fontSize: '0.85rem', mt: 1 }}>
            {statusError}
          </Typography>
        )}
      </Box>

      <Box
        sx={{
          borderTop: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          gap: 0.75,
          p: 1,
          // Keep chips above the soft keyboard — less bottom padding while typing.
          pb: keyboardOpen
            ? '8px'
            : `max(28px, calc(${SAFE_AREA_BOTTOM} + 18px))`,
          position: 'relative',
          zIndex: 5,
        }}
      >
        {loadingModel ? (
          <Box
            sx={{
              alignItems: 'center',
              backdropFilter: 'blur(8px)',
              background: alpha(
                isDark ? '#0c0e13' : '#f4f7fb',
                isDark ? 0.88 : 0.92
              ),
              borderRadius: '18px',
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              justifyContent: 'center',
              left: 8,
              minHeight: 96,
              p: 1.5,
              pointerEvents: 'none',
              position: 'absolute',
              right: 8,
              top: 8,
              zIndex: 3,
            }}
          >
            <CircularProgress size={26} thickness={4} />
            <Typography
              sx={{
                color: alpha(theme.palette.text.primary, 0.75),
                fontSize: '0.82rem',
                fontWeight: 700,
                textAlign: 'center',
              }}
            >
              {answerMode === 'fast'
                ? 'Loading Fast agent…'
                : 'Loading Max agent…'}
            </Typography>
            <Typography
              sx={{
                color: alpha(theme.palette.text.primary, 0.5),
                fontSize: '0.7rem',
                textAlign: 'center',
              }}
            >
              {assembleDetail || activeModelLabel}
            </Typography>
          </Box>
        ) : null}

        {/* Kind chips ABOVE the text field so they stay tappable with keyboard up. */}
        {qdnMode ? (
          <Box
            role="group"
            aria-label="QDN search type"
            sx={{
              display: 'flex',
              flexWrap: 'nowrap',
              gap: 0.5,
              overflowX: 'auto',
              pb: 0.15,
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {QDN_SEARCH_KIND_OPTIONS.map((opt) => {
              const selected = qdnSearchKind === opt.id;
              return (
                <Box
                  key={opt.id}
                  component="button"
                  type="button"
                  disabled={busy || loadingModel}
                  title={opt.hint}
                  onMouseDown={(e) => {
                    // Prevent TextField blur so the keyboard stays up while switching chips.
                    e.preventDefault();
                  }}
                  onClick={() => setQdnSearchKind(opt.id)}
                  sx={{
                    background: selected
                      ? alpha('#7EB6FF', isDark ? 0.28 : 0.22)
                      : alpha(theme.palette.text.primary, isDark ? 0.06 : 0.04),
                    border: selected
                      ? `1px solid ${alpha('#7EB6FF', 0.55)}`
                      : `1px solid ${alpha(theme.palette.divider, 0.45)}`,
                    borderRadius: '8px',
                    color: theme.palette.text.primary,
                    cursor: busy || loadingModel ? 'default' : 'pointer',
                    flex: '0 0 auto',
                    fontSize: '0.72rem',
                    fontWeight: selected ? 800 : 600,
                    letterSpacing: '0.02em',
                    opacity: busy || loadingModel ? 0.55 : 1,
                    px: 1.1,
                    py: 0.45,
                  }}
                >
                  {opt.label}
                </Box>
              );
            })}
          </Box>
        ) : null}

        <Box
          sx={{
            alignItems: 'flex-end',
            display: 'flex',
            gap: 0.75,
            opacity: loadingModel ? 0.35 : 1,
            pointerEvents: loadingModel ? 'none' : 'auto',
          }}
        >
          <TextField
            fullWidth
            multiline
            maxRows={keyboardOpen ? 3 : 4}
            placeholder="Message Qortino…"
            size="small"
            value={input}
            disabled={loadingModel}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                background: alpha(
                  theme.palette.background.paper,
                  isDark ? 0.55 : 0.9
                ),
                borderRadius: '18px',
                px: 0.5,
                py: 0.15,
                '& fieldset': {
                  borderColor: alpha('#7EB6FF', isDark ? 0.28 : 0.35),
                  borderRadius: '18px',
                },
                '&:hover fieldset': {
                  borderColor: alpha('#7EB6FF', 0.55),
                },
                '&.Mui-focused fieldset': {
                  borderColor: '#7EB6FF',
                  borderWidth: '1.5px',
                },
              },
              '& .MuiInputBase-input': {
                fontSize: '0.92rem',
                lineHeight: 1.4,
                px: 1.1,
                py: 1,
              },
            }}
          />
          {busy ? (
            <IconButton aria-label="Stop" color="primary" onClick={() => void stop()}>
              <StopRoundedIcon />
            </IconButton>
          ) : (
            <IconButton
              aria-label="Send"
              color="primary"
              disabled={loadingModel || !input.trim()}
              onClick={() => void send()}
              sx={{
                background: alpha('#7EB6FF', isDark ? 0.22 : 0.16),
                borderRadius: '14px',
              }}
            >
              <SendRoundedIcon />
            </IconButton>
          )}
        </Box>

        <Box
          sx={{
            alignItems: 'center',
            display: keyboardOpen ? 'none' : 'flex',
            gap: 0.75,
            justifyContent: 'space-between',
          }}
        >
          <Box
            role="group"
            aria-label="Answer mode"
            sx={{
              background: alpha(theme.palette.text.primary, isDark ? 0.08 : 0.06),
              border: `1px solid ${alpha(theme.palette.divider, 0.55)}`,
              borderRadius: '10px',
              display: 'flex',
              p: 0.3,
            }}
          >
            {(
              [
                { id: 'fast' as const, label: 'Fast', hint: 'Quicker short answers' },
                { id: 'max' as const, label: 'Max', hint: 'Fuller answers' },
              ] as const
            ).map((opt) => {
              const selected = answerMode === opt.id;
              return (
                <Box
                  key={opt.id}
                  component="button"
                  type="button"
                  disabled={busy || loadingModel}
                  title={opt.hint}
                  onClick={() => setAnswerMode(opt.id)}
                  sx={{
                    background: selected
                      ? alpha(opt.id === 'fast' ? '#3DDC97' : '#7EB6FF', isDark ? 0.28 : 0.22)
                      : 'transparent',
                    border: selected
                      ? `1px solid ${alpha(opt.id === 'fast' ? '#3DDC97' : '#7EB6FF', 0.55)}`
                      : '1px solid transparent',
                    borderRadius: '8px',
                    color: theme.palette.text.primary,
                    cursor: busy || loadingModel ? 'default' : 'pointer',
                    fontSize: '0.78rem',
                    fontWeight: selected ? 800 : 600,
                    letterSpacing: '0.03em',
                    minWidth: 64,
                    opacity: busy || loadingModel ? 0.55 : 1,
                    px: 1.35,
                    py: 0.55,
                    textTransform: 'uppercase',
                  }}
                >
                  {opt.label}
                </Box>
              );
            })}
          </Box>
          <Typography
            sx={{
              color: alpha(theme.palette.text.primary, 0.55),
              fontSize: '0.68rem',
              lineHeight: 1.3,
              maxWidth: '52%',
              textAlign: 'right',
            }}
          >
            {qdnMode
              ? answerMode === 'fast'
                ? `QDN ${humanLabelForSearchKind(qdnSearchKind)} · Fast = recent txs`
                : `QDN ${humanLabelForSearchKind(qdnSearchKind)} · Max = full history`
              : answerMode === 'fast'
                ? 'Fast: short reply, lighter model when available'
                : 'Max: deeper knowledge + longer reply'}
          </Typography>
        </Box>
      </Box>

      <QortinoChatHistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        sessions={drawerSessions}
        activeId={activeSessionId}
        modeLabel={qdnMode ? 'QDN' : 'Offline'}
        onNewChat={handleNewChat}
        onSelect={handleSelectSession}
        onRename={handleRenameSession}
        onTogglePin={handleTogglePin}
        onDelete={handleDeleteSession}
      />

      <QortinoImageLightbox
        open={!!avatarLightbox}
        src={avatarLightbox?.src || null}
        alt={avatarLightbox?.alt || ''}
        onClose={() => setAvatarLightbox(null)}
      />

      <QortinoAnswerReportDialog
        open={!!answerReport}
        payload={answerReport}
        onClose={() => setAnswerReport(null)}
      />

      <Snackbar
        open={!!copySnack}
        autoHideDuration={2200}
        onClose={() => setCopySnack('')}
        message={copySnack}
        sx={{ zIndex: 12000 }}
      />
    </Box>
  );
}

export default QortinoAgentChat;
