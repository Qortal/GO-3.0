import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Editor } from '@tiptap/core';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  IconButton,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { alpha, useTheme } from '@mui/material/styles';
import { reticulumChatTextScaleAtom } from '../../atoms/global';
import { SAFE_AREA_BOTTOM, SAFE_AREA_TOP } from '../../utils/mobileSafeArea';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import { MAX_SIZE_MESSAGE } from '../../constants/constants';
import Tiptap, {
  composerHasSendableText,
  type MentionSuggestionItem,
} from './TipTap';
import { normalizeExactReticulumMentions } from './reticulumMentionNormalization';
import { MessageItem } from './MessageItem';
import type { ReticulumChannelLinkAccess } from './MessageDisplay';
import { ReticulumGifCompressionStatus } from './ReticulumGifCompressionStatus';
import { ReticulumMessageExpiryButton } from './ReticulumMessageExpiryButton';
import { resolveReticulumPreferredMessageExpiryDurationMs } from './reticulumMessageExpiry';
import { reticulumChatTextScaleClassName } from './reticulumChatTextScale';
import { ReactionPicker } from '../ReactionPicker';
import { fetchLibraryGifFile, type LibraryGif } from './gifs/libraryGifs';
import { MessageSizeLimitLip } from './MessageSizeLimitLip';
import { ComposerDiscardButton } from './ComposerDiscardButton';
import { ComposerDismissButton } from './ComposerDismissButton';
import {
  COMPOSER_SEND_BUTTON_PX,
  COMPOSER_SEND_ICON_PX,
} from './composerCornerLayout';
import { BACK_PRIORITY, useAndroidBack } from '../../utils/androidBack';
import { executeEvent } from '../../utils/events';
import {
  type ChatDocNode,
  type SplitChatDocumentError,
  chatDocumentToHtml,
  jsonPayloadFits,
  splitChatDocument,
  utf8ByteLength,
} from '../../utils/chat/splitLongMessage';

const RETICULUM_BLUE = '#2563eb';

export type ReticulumDiscussionFile = {
  base64?: string;
  fileName: string;
  filePath?: string;
  height?: number;
  isImage: boolean;
  mimeType: string;
  previewUrl?: string;
  sizeBytes: number;
  temporaryFilePath?: string;
  width?: number;
};

export type ReticulumDiscussionDraft = {
  expiryDurationMs?: number;
  htmlContent: string;
  messageText: Record<string, unknown>;
};

type ReticulumDiscussionDialogProps = {
  canWrite: boolean;
  channelExpiryDurationMs?: number;
  compressingGif: boolean;
  files: ReticulumDiscussionFile[];
  loading: boolean;
  membersWithNames: unknown[];
  mentionSuggestions?: MentionSuggestionItem[];
  messages: any[];
  myAddress: string;
  onClose: () => void;
  onPreferredExpiryChange: (durationMs: number | undefined) => void;
  onRemoveFile: (index: number) => void;
  onSelectFiles: (files: File[]) => void | Promise<void>;
  onSend: (draft: ReticulumDiscussionDraft) => Promise<boolean>;
  onTypingChange: (active: boolean) => void;
  open: boolean;
  replyCount: number;
  reticulumGroupAvatarOwnerName?: string;
  reticulumGroupDisplayName?: string;
  reticulumMemberJoinedByAddress?: Record<string, number>;
  reticulumMemberRolesByAddress?: Record<string, 'owner' | 'admin'>;
  reticulumMemberRolesReady?: boolean;
  reticulumMentionUsers?: Record<
    string,
    { address: string; joined?: number; name: string }
  >;
  reticulumChannelLinkAccess?: ReticulumChannelLinkAccess;
  preparingFile: boolean;
  preferredExpiryDurationMs?: number;
  selectedGroup: number | string;
};

/**
 * The phone field's height budget, which TipTap measures its stages against:
 * the chat composer bar's cap (min(50vh, 320px)) less that bar's 6px top and
 * bottom padding. The size lip and the captions sit outside the field, so they
 * never take the text's room.
 */
export const DISCUSSION_PHONE_FIELD_MAX_HEIGHT =
  'calc(min(50vh, 320px) - 12px)';
/**
 * One row of attachment chips (a 48px chip under the row's 3px top padding):
 * as far as the chips give way when the field runs out of height. They scroll
 * from there, and the typing row never shrinks.
 */
export const DISCUSSION_PHONE_CHIP_ROW_PX = 51;

/** Least time between two split plans while the text stays over the limit. */
const SPLIT_PLAN_THROTTLE_MS = 300;
/**
 * Longest a split reply that carries files waits, after its first part, for
 * the parent to re-render its onSend. Only a safety net: the new handler
 * normally arrives with the next render.
 */
const NEXT_PART_SENDER_TIMEOUT_MS = 10_000;

/**
 * The thread composer's size of a reply document: the larger of its own rule
 * (JSON.stringify length + 300) and the UTF-8 bytes of that JSON, which the
 * parent's send handler refuses above MAX_SIZE_MESSAGE. For ASCII text this is
 * exactly the old `JSON.stringify(json).length + 300`, so every reply that
 * went out as one message before still does, unchanged.
 */
export const reticulumDiscussionPayloadSize = (doc: unknown): number => {
  const json = JSON.stringify(doc) ?? '';
  return Math.max(json.length + 300, utf8ByteLength(json));
};

// Parts are cut by the stricter byte rule of the group composer (UTF-8 bytes
// + 300), which also satisfies both checks above.
const fitsReticulumDiscussionPart = jsonPayloadFits(MAX_SIZE_MESSAGE);

export type ReticulumDiscussionSplitPlan = {
  /** How many replies the over-limit text goes out as; null within limit. */
  splitParts: number | null;
  /** Why the over-limit text cannot be sent, even split. */
  splitError: SplitChatDocumentError | null;
};

const NO_SPLIT_PLAN: ReticulumDiscussionSplitPlan = {
  splitParts: null,
  splitError: null,
};

/** How the composer text will be sent, for the size lip. */
export const planReticulumDiscussionSplit = (
  doc: Record<string, unknown>
): ReticulumDiscussionSplitPlan => {
  if (reticulumDiscussionPayloadSize(doc) <= MAX_SIZE_MESSAGE) {
    return NO_SPLIT_PLAN;
  }
  const result = splitChatDocument(
    doc as ChatDocNode,
    fitsReticulumDiscussionPart
  );
  return result.error
    ? { splitParts: null, splitError: result.error }
    : { splitParts: result.parts.length, splitError: null };
};

export type ReticulumDiscussionDraftPlan =
  | { drafts: ReticulumDiscussionDraft[]; error?: undefined }
  | { drafts?: undefined; error: SplitChatDocumentError };

/**
 * The thread replies one composer text is sent as. Within the limit it is the
 * single draft it always was (the same JSON object and the editor's own HTML).
 * A longer text becomes one draft per part, in order, each with the HTML of
 * its own part (so the parent resolves its mentions from that part alone) and
 * the same expiry. The parent links every reply to the thread root and
 * attaches the pending files to the first reply it sends.
 */
export const planReticulumDiscussionDrafts = ({
  expiryDurationMs,
  htmlContent,
  messageText,
  partToHtml,
}: ReticulumDiscussionDraft & {
  /** The HTML editor.getHTML() would give for a part. */
  partToHtml: (part: ChatDocNode) => string;
}): ReticulumDiscussionDraftPlan => {
  if (reticulumDiscussionPayloadSize(messageText) <= MAX_SIZE_MESSAGE) {
    return { drafts: [{ expiryDurationMs, htmlContent, messageText }] };
  }
  const result = splitChatDocument(
    messageText as ChatDocNode,
    fitsReticulumDiscussionPart
  );
  if (result.error) return { error: result.error };
  return {
    drafts: result.parts.map((part) => ({
      expiryDurationMs,
      htmlContent: partToHtml(part),
      messageText: part as Record<string, unknown>,
    })),
  };
};

export type ReticulumDiscussionSender = (
  draft: ReticulumDiscussionDraft
) => Promise<boolean>;

/**
 * Sends the drafts in order and stops at the first one that is not sent;
 * resolves to how many were sent. The first goes through `send`. Every later
 * one goes through `send` too, unless `nextSender` is given: it is then asked
 * once, as soon as the first draft was sent, for the sender of all the later
 * ones, and a null answer stops there with nothing more sent.
 *
 * The parent keeps its sending flag and its pending files in the closure of
 * its handler. The handler held when Send was pressed saw no send running, so
 * it can send every part (its thread root stays fixed even if the thread is
 * closed meanwhile), but it attaches the files it saw to each reply. With
 * files, the later parts therefore need the handler the parent re-rendered
 * with once the first reply had taken them.
 */
export const sendReticulumDiscussionDrafts = async (
  drafts: ReticulumDiscussionDraft[],
  send: ReticulumDiscussionSender,
  nextSender?: () => Promise<ReticulumDiscussionSender | null>
): Promise<number> => {
  let sender: ReticulumDiscussionSender | null = send;
  let sent = 0;
  for (const draft of drafts) {
    if (sent === 1 && nextSender) sender = await nextSender();
    if (!sender || !(await sender(draft))) break;
    sent += 1;
  }
  return sent;
};

/** The drafts not sent yet, as one composer document. */
export const mergeReticulumDiscussionDrafts = (
  drafts: ReticulumDiscussionDraft[]
): ChatDocNode => ({
  type: 'doc',
  content: drafts.flatMap((draft) =>
    Array.isArray(draft.messageText?.content)
      ? (draft.messageText.content as ChatDocNode[])
      : []
  ),
});

export const ReticulumDiscussionDialog = ({
  canWrite,
  channelExpiryDurationMs,
  compressingGif,
  files,
  loading,
  membersWithNames,
  mentionSuggestions,
  messages,
  myAddress,
  onClose,
  onPreferredExpiryChange,
  onRemoveFile,
  onSelectFiles,
  onSend,
  onTypingChange,
  open,
  replyCount,
  reticulumGroupAvatarOwnerName,
  reticulumGroupDisplayName,
  reticulumMemberJoinedByAddress,
  reticulumMemberRolesByAddress,
  reticulumMemberRolesReady = true,
  reticulumMentionUsers,
  reticulumChannelLinkAccess,
  preparingFile,
  preferredExpiryDurationMs,
  selectedGroup,
}: ReticulumDiscussionDialogProps) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { t } = useTranslation(['core', 'group', 'reticulum']);
  // The chat's text size reaches the thread's messages and composers.
  const textScale = useAtomValue(reticulumChatTextScaleAtom);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [expiryDurationMs, setExpiryDurationMs] = useState<
    number | undefined
  >();
  const [formattingResetKey, setFormattingResetKey] = useState(0);
  const [focused, setFocused] = useState(false);
  const [messageSize, setMessageSize] = useState(0);
  const [messageSizeLimitShakeKey, setMessageSizeLimitShakeKey] = useState(0);
  const [splitPlan, setSplitPlan] =
    useState<ReticulumDiscussionSplitPlan>(NO_SPLIT_PLAN);
  const [sending, setSending] = useState(false);
  // A split reply is going out: the composer is locked until it is done.
  const [sendingSplit, setSendingSplit] = useState(false);
  const splitPlanRef = useRef<ReticulumDiscussionSplitPlan>(NO_SPLIT_PLAN);
  const splitPlanTimerRef = useRef<number | null>(null);
  const splitPlannedAtRef = useRef(0);
  const mountedRef = useRef(true);
  const openRef = useRef(open);
  const onSendRef = useRef(onSend);
  const onSendWaitersRef = useRef(new Set<() => void>());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rootMessage = messages[0] || null;
  const messageById = useMemo(
    () =>
      new Map(
        messages.map((message) => [String(message?.signature || ''), message])
      ),
    [messages]
  );
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    estimateSize: () => 92,
    getItemKey: (index) =>
      String(messages[index]?.signature || `discussion-message-${index}`),
    getScrollElement: () => scrollRef.current,
    overscan: 8,
  });

  const applySplitPlan = (plan: ReticulumDiscussionSplitPlan) => {
    splitPlanRef.current = plan;
    setSplitPlan(plan);
  };

  const cancelSplitPlanTimer = () => {
    if (splitPlanTimerRef.current === null) return;
    window.clearTimeout(splitPlanTimerRef.current);
    splitPlanTimerRef.current = null;
  };

  const resetComposerSize = () => {
    cancelSplitPlanTimer();
    setMessageSize(0);
    applySplitPlan(NO_SPLIT_PLAN);
  };

  // The size shows on every keystroke; the split plan behind the lip is
  // throttled, except when the text first goes over the limit (or
  // `immediate`), so the lip never flashes the size error before the notice.
  const updateComposerSize = (nextEditor: Editor, immediate = false) => {
    const size = reticulumDiscussionPayloadSize(nextEditor.getJSON());
    setMessageSize(size);
    if (size <= MAX_SIZE_MESSAGE) {
      cancelSplitPlanTimer();
      if (splitPlanRef.current !== NO_SPLIT_PLAN) applySplitPlan(NO_SPLIT_PLAN);
      return;
    }
    if (immediate) cancelSplitPlanTimer();
    if (splitPlanTimerRef.current !== null) return;
    const plan = () => {
      splitPlanTimerRef.current = null;
      splitPlannedAtRef.current = Date.now();
      if (nextEditor.isDestroyed) return;
      applySplitPlan(
        planReticulumDiscussionSplit(
          nextEditor.getJSON() as Record<string, unknown>
        )
      );
    };
    const wait =
      splitPlannedAtRef.current + SPLIT_PLAN_THROTTLE_MS - Date.now();
    if (immediate || splitPlanRef.current === NO_SPLIT_PLAN || wait <= 0) {
      plan();
    } else {
      splitPlanTimerRef.current = window.setTimeout(plan, wait);
    }
  };

  useLayoutEffect(() => {
    openRef.current = open;
  }, [open]);

  useLayoutEffect(() => {
    onSendRef.current = onSend;
    onSendWaitersRef.current.forEach((wake) => wake());
  }, [onSend]);

  useEffect(() => {
    mountedRef.current = true;
    const waiters = onSendWaitersRef.current;
    return () => {
      mountedRef.current = false;
      if (splitPlanTimerRef.current !== null) {
        window.clearTimeout(splitPlanTimerRef.current);
      }
      // A split reply waiting for the parent's next handler stops here.
      waiters.forEach((wake) => wake());
    };
  }, []);

  // For the later parts of a split reply that carries files: the onSend the
  // parent hands down once it re-rendered after the first reply took the
  // files. The one held until then would attach the files again or still see
  // its send running, so it is never used: null when no new one comes in
  // time, or when the thread was closed first (its handler refuses then).
  const waitForFreshOnSend = (): Promise<ReticulumDiscussionSender | null> => {
    const stale = onSendRef.current;
    const waiters = onSendWaitersRef.current;
    return new Promise((resolve) => {
      let timer = 0;
      const settle = (sender: ReticulumDiscussionSender | null) => {
        window.clearTimeout(timer);
        waiters.delete(wake);
        resolve(sender);
      };
      const wake = () => {
        if (!mountedRef.current || !openRef.current) settle(null);
        else if (onSendRef.current !== stale) settle(onSendRef.current);
      };
      if (!mountedRef.current || !openRef.current) {
        resolve(null);
        return;
      }
      timer = window.setTimeout(
        () => settle(null),
        NEXT_PART_SENDER_TIMEOUT_MS
      );
      waiters.add(wake);
    });
  };

  useEffect(() => {
    if (!open) {
      editor?.commands.clearContent();
      setExpiryDurationMs(undefined);
      resetComposerSize();
      setFormattingResetKey((key) => key + 1);
      return;
    }
    setExpiryDurationMs(
      resolveReticulumPreferredMessageExpiryDurationMs(
        preferredExpiryDurationMs,
        channelExpiryDurationMs
      )
    );
  }, [channelExpiryDurationMs, editor, open, preferredExpiryDurationMs]);

  useEffect(() => {
    if (!open || messages.length === 0) return;
    window.requestAnimationFrame(() => {
      rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
    });
  }, [messages.length, open, rowVirtualizer]);

  const send = async () => {
    if (!canWrite || !editor || sending || preparingFile || loading) return;
    const normalizedMentions = normalizeExactReticulumMentions(
      editor.getJSON() as Record<string, unknown>,
      mentionSuggestions
    );
    if (normalizedMentions.changed) {
      editor.commands.setContent(normalizedMentions.document, false);
    }
    const htmlContent = editor.getHTML();
    const hasText = composerHasSendableText(editor.getText());
    if (!hasText && files.length === 0) return;
    const messageText = editor.getJSON() as Record<string, unknown>;
    // Over the limit, the text goes out as several replies in the thread.
    const plan = planReticulumDiscussionDrafts({
      expiryDurationMs,
      htmlContent,
      messageText,
      partToHtml: (part) => chatDocumentToHtml(part, editor.schema),
    });
    if (plan.error) {
      cancelSplitPlanTimer();
      setMessageSize(reticulumDiscussionPayloadSize(messageText));
      applySplitPlan({ splitParts: null, splitError: plan.error });
      setMessageSizeLimitShakeKey((key) => key + 1);
      return;
    }
    const splitReply = plan.drafts.length > 1;
    setSending(true);
    if (splitReply) {
      // Sending every part takes a while, and nothing typed or attached
      // meanwhile would survive the clear (or the restore of the parts not
      // sent) at the end, so the composer is locked until then.
      setSendingSplit(true);
      editor.setEditable(false, false);
    }
    let senderLost = false;
    try {
      const sent = await sendReticulumDiscussionDrafts(
        plan.drafts,
        onSend,
        files.length > 0
          ? async () => {
              const sender = await waitForFreshOnSend();
              senderLost = !sender;
              return sender;
            }
          : undefined
      );
      // The thread may have been closed (and another one opened) meanwhile:
      // its composer was reset then, and this editor is not the one shown.
      const composerKept =
        mountedRef.current && openRef.current && !editor.isDestroyed;
      if (sent === plan.drafts.length) {
        if (composerKept) {
          editor.commands.clearContent();
          setExpiryDurationMs(
            resolveReticulumPreferredMessageExpiryDurationMs(
              preferredExpiryDurationMs,
              channelExpiryDurationMs
            )
          );
          resetComposerSize();
          setFormattingResetKey((key) => key + 1);
        }
      } else if (sent > 0) {
        if (composerKept) {
          // Some parts went out: keep only the rest, so sending again does
          // not repeat them.
          editor.commands.setContent(
            mergeReticulumDiscussionDrafts(plan.drafts.slice(sent)),
            false
          );
          updateComposerSize(editor, true);
        }
        // The parent reports its own failures. Say it here when the next part
        // was never even tried, or when the rest of the text left with the
        // thread, so a reply cut short is never silent.
        if (senderLost || !composerKept) {
          executeEvent('openGlobalSnackBar', {
            message: t('core:message.error.send_failed', {
              postProcess: 'capitalizeFirstChar',
            }),
            type: 'error',
          });
        }
      }
    } finally {
      if (splitReply) {
        if (!editor.isDestroyed) editor.setEditable(true, false);
        setSendingSplit(false);
      }
      setSending(false);
    }
  };

  const closeDisabled = sending || preparingFile;

  // Android back closes the thread, not the whole chat under it, and like the
  // disabled close button it does nothing while a reply is going out.
  useAndroidBack(
    () => {
      if (!closeDisabled) onClose();
      return true;
    },
    { enabled: open, priority: BACK_PRIORITY.dialog }
  );

  // No attachment is taken while a split reply goes out: its later parts are
  // text only, and the parent drops pending files after each reply it sends.
  const selectFiles = sendingSplit ? undefined : onSelectFiles;
  const selectGif = async (gif: LibraryGif) => {
    if (sendingSplit) return;
    const file = await fetchLibraryGifFile(gif);
    if (file) void onSelectFiles([file]);
  };

  const overSizeLimit = messageSize > MAX_SIZE_MESSAGE;
  // Over the limit, a text that splits is still sendable. One part means
  // trimming blank lines was enough, so the lip has nothing to say.
  const sendableParts = splitPlan.splitError ? null : splitPlan.splitParts;
  const showSizeLip = overSizeLimit && sendableParts !== 1;
  const composerHasContent =
    composerHasSendableText(editor?.getText()) || files.length > 0;
  const sendDisabled =
    loading || !canWrite || closeDisabled || !composerHasContent;
  const sendLabel = t('core:action.send', {
    postProcess: 'capitalizeFirstChar',
  });

  // The phone corner X: the text, the attachments and the expiry picked for
  // this reply go, as after a send. Nothing goes while a reply is on its way
  // or a file is still being prepared, which would land after the discard.
  const discardComposer = () => {
    if (!editor || editor.isDestroyed || closeDisabled) return;
    editor.commands.clearContent();
    // Last first, so every index still points at the file it meant.
    for (let index = files.length - 1; index >= 0; index -= 1) {
      onRemoveFile(index);
    }
    setExpiryDurationMs(
      resolveReticulumPreferredMessageExpiryDurationMs(
        preferredExpiryDurationMs,
        channelExpiryDurationMs
      )
    );
    resetComposerSize();
    // Clearing the editor emits no update, so the typing signal would linger.
    onTypingChange(false);
  };

  // Phones: the main group composer's corner cluster (expiry, discard, send),
  // which TipTap places down the right edge of the one rounded field. Send and
  // the X fade in with the first character or attachment.
  const renderCornerActions = () => (
    <>
      <Box
        className="compact-composer-expiry"
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexShrink: 0,
          justifyContent: 'center',
        }}
      >
        <ReticulumMessageExpiryButton
          channelExpiryDurationMs={channelExpiryDurationMs}
          corner
          disabled={loading || closeDisabled}
          disabledReason={t('reticulum:discussion.wait_until_ready', {
            postProcess: 'capitalizeFirstChar',
          })}
          onChange={setExpiryDurationMs}
          onPreferredExpiryChange={onPreferredExpiryChange}
          preferredExpiryDurationMs={preferredExpiryDurationMs}
          value={expiryDurationMs}
        />
      </Box>
      <ComposerDiscardButton
        disabled={closeDisabled}
        idle={!composerHasContent}
        onDiscard={discardComposer}
      />
      {/* Kept mounted while there is nothing to send, so the rail CSS can
          fade it in and out. Never `disabled`, as in the group composer: a
          disabled button lets taps through the rail to the editor under it,
          which would move the caret or raise the keyboard. */}
      <IconButton
        aria-disabled={sendDisabled || undefined}
        aria-label={sendLabel}
        className="compact-composer-send"
        data-idle={composerHasContent ? undefined : ''}
        disableRipple={sendDisabled}
        onClick={() => {
          if (sendDisabled) return;
          void send();
        }}
        size="small"
        sx={{
          backgroundColor: sendDisabled
            ? theme.palette.action.disabledBackground
            : RETICULUM_BLUE,
          borderRadius: '50%',
          color: sendDisabled
            ? sending
              ? theme.palette.text.secondary
              : theme.palette.action.disabled
            : 'common.white',
          cursor: sendDisabled ? 'default' : 'pointer',
          flexShrink: 0,
          height: COMPOSER_SEND_BUTTON_PX,
          padding: 0,
          pointerEvents: 'auto',
          width: COMPOSER_SEND_BUTTON_PX,
          '&:hover': {
            backgroundColor: sendDisabled
              ? theme.palette.action.disabledBackground
              : '#1e40af',
          },
        }}
      >
        {sending ? (
          <CircularProgress color="inherit" size={COMPOSER_SEND_ICON_PX - 2} />
        ) : (
          <SendRoundedIcon sx={{ fontSize: COMPOSER_SEND_ICON_PX }} />
        )}
      </IconButton>
    </>
  );

  // Stops a tap on a chip's X from taking focus, and the soft keyboard with
  // it, away from the reply being written.
  const keepComposerFocus = (event: { preventDefault: () => void }) => {
    event.preventDefault();
  };

  const composerEditor = (
    <Tiptap
      collapseFormattingTraySignal={formattingResetKey}
      compactActions={isMobile ? renderCornerActions : undefined}
      compactChat
      disableEnter={!canWrite || loading || closeDisabled}
      enableMentions
      inOverlay
      insertFiles={selectFiles}
      insertGif={selectGif}
      isChat
      isFocusedParent={focused}
      membersWithNames={membersWithNames}
      mentionSuggestions={mentionSuggestions}
      onContentUpdate={(nextEditor) => {
        updateComposerSize(nextEditor);
        onTypingChange(composerHasSendableText(nextEditor.getText()));
      }}
      onEnter={send}
      placeholder={t('reticulum:discussion.reply_placeholder', {
        postProcess: 'capitalizeFirstChar',
      })}
      setEditorRef={setEditor}
      setIsFocusedParent={setFocused}
    />
  );

  const sizeLip = (
    <MessageSizeLimitLip
      maximum={MAX_SIZE_MESSAGE}
      shakeKey={messageSizeLimitShakeKey}
      size={messageSize}
      splitError={splitPlan.splitError}
      splitParts={splitPlan.splitParts}
    />
  );

  const preparingStatus = compressingGif ? (
    <ReticulumGifCompressionStatus />
  ) : preparingFile ? (
    <Box sx={{ alignItems: 'center', display: 'flex', gap: 1, px: 0.5 }}>
      <CircularProgress size={16} />
      <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>
        {t('reticulum:discussion.preparing_attachment', {
          postProcess: 'capitalizeFirstChar',
        })}
      </Typography>
    </Box>
  ) : null;

  const fileThumbnail = (file: ReticulumDiscussionFile, sizePx: number) =>
    file.previewUrl ? (
      <Box
        component="img"
        src={file.previewUrl}
        sx={{
          borderRadius: '5px',
          height: sizePx,
          objectFit: 'cover',
          width: sizePx,
        }}
      />
    ) : file.isImage ? (
      <ImageRoundedIcon sx={{ color: 'text.secondary' }} />
    ) : (
      <InsertDriveFileRoundedIcon sx={{ color: 'text.secondary' }} />
    );

  const fileNameLabel = (file: ReticulumDiscussionFile) => (
    <Typography
      sx={{
        flex: 1,
        fontSize: 12,
        fontWeight: 600,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {file.fileName}
    </Typography>
  );

  const writeNotice = !canWrite && (
    <Typography
      sx={{
        color: 'text.secondary',
        fontSize: 11.5,
        mt: 0.5,
        pl: isMobile ? 1.5 : 0.5,
      }}
    >
      {t('group:chat_group.admins_only_write', {
        postProcess: 'capitalizeFirstChar',
      })}
    </Typography>
  );

  const sizeCounter = messageSize >= 3200 && (
    <Typography
      sx={{
        color:
          overSizeLimit && !sendableParts ? 'error.main' : 'text.secondary',
        fontSize: 11,
        mt: 0.5,
        pl: isMobile ? 1.5 : 0.5,
      }}
    >
      {t('reticulum:discussion.size_counter', {
        maximum: MAX_SIZE_MESSAGE,
        size: messageSize,
      })}
    </Typography>
  );

  return (
    <Dialog
      BackdropProps={{
        sx: {
          backdropFilter: 'blur(3px)',
          backgroundColor: 'rgba(3, 6, 12, 0.76)',
        },
      }}
      // The phone composer's emoji and GIF picker opens outside the dialog;
      // a focus trap would pull focus back from its search field (and the
      // soft keyboard down with it) on every tap.
      disableEnforceFocus={isMobile}
      fullScreen={isMobile}
      fullWidth
      maxWidth={false}
      onClose={closeDisabled ? undefined : onClose}
      open={open}
      PaperProps={{
        className: reticulumChatTextScaleClassName(textScale),
        sx: {
          background:
            theme.palette.mode === 'dark'
              ? 'linear-gradient(180deg, rgba(15, 19, 27, 0.98) 0%, rgba(9, 12, 18, 0.98) 100%)'
              : 'linear-gradient(180deg, rgba(250, 251, 253, 0.98) 0%, rgba(242, 245, 249, 0.98) 100%)',
          overflow: 'hidden',
          // A floating card on a phone wastes the height the thread and the
          // composer need, so take the whole screen instead.
          ...(isMobile
            ? {
                border: 'none',
                borderRadius: 0,
                boxShadow: 'none',
                height: '100%',
                m: 0,
                maxWidth: '100%',
                paddingTop: `calc(4px + ${SAFE_AREA_TOP})`,
                width: '100%',
              }
            : {
                border: '1px solid',
                borderColor:
                  theme.palette.mode === 'dark'
                    ? 'rgba(126, 139, 166, 0.2)'
                    : 'rgba(38, 52, 74, 0.16)',
                borderRadius: '14px',
                boxShadow:
                  theme.palette.mode === 'dark'
                    ? '0 22px 70px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.02)'
                    : '0 22px 70px rgba(27, 39, 58, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.72)',
                height: 'min(782px, calc(100vh - 24px))',
                m: { xs: 1, sm: 1.5 },
                maxWidth: 935,
                width: 'min(935px, calc(100vw - 32px))',
              }),
        },
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          justifyContent: 'space-between',
          minHeight: isMobile ? 56 : 92,
          px: isMobile ? '12px' : '22px',
          pb: isMobile ? '8px' : '15px',
          pt: isMobile ? '8px' : '18px',
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: isMobile ? 1.25 : 2,
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              backgroundColor: alpha(theme.palette.text.primary, 0.06),
              border: `1px solid ${alpha(theme.palette.text.primary, 0.12)}`,
              borderRadius: isMobile ? '9px' : '12px',
              color: alpha(theme.palette.text.primary, 0.58),
              display: 'flex',
              height: isMobile ? 32 : 42,
              justifyContent: 'center',
              width: isMobile ? 32 : 42,
            }}
          >
            <ForumRoundedIcon sx={{ fontSize: isMobile ? 18 : 22 }} />
          </Box>
          <Box>
            <Typography
              sx={{
                color: 'text.primary',
                fontSize: isMobile ? 17 : 24,
                fontWeight: 700,
                letterSpacing: '-0.025em',
                lineHeight: isMobile ? '21px' : '30px',
              }}
            >
              {t('reticulum:discussion.title', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
            <Typography
              sx={{
                color: 'text.secondary',
                fontSize: isMobile ? 12 : 14,
                fontWeight: 500,
                lineHeight: isMobile ? '15px' : '18px',
                mt: '2px',
              }}
            >
              {t('group:message_item.reply_count', { count: replyCount })}
            </Typography>
          </Box>
        </Box>
        <IconButton
          aria-label={t('reticulum:discussion.close', {
            postProcess: 'capitalizeFirstChar',
          })}
          disabled={closeDisabled}
          onClick={closeDisabled ? undefined : onClose}
          size="small"
          sx={{
            backgroundColor: alpha(theme.palette.text.primary, 0.025),
            border: `1px solid ${alpha(theme.palette.text.primary, 0.14)}`,
            color: 'text.primary',
            height: 40,
            width: 40,
            '&:hover': {
              backgroundColor: alpha(theme.palette.text.primary, 0.07),
            },
          }}
        >
          <CloseRoundedIcon />
        </IconButton>
      </Box>

      <Box
        data-reticulum-chat-root="true"
        ref={scrollRef}
        sx={{
          '--discussion-body-text-color': theme.palette.text.primary,
          flex: 1,
          minHeight: 0,
          overflowX: 'hidden',
          overflowY: 'auto',
          py: 0,
        }}
      >
        {loading ? (
          <Box sx={{ display: 'grid', height: '100%', placeItems: 'center' }}>
            <CircularProgress size={26} />
          </Box>
        ) : messages.length === 0 ? (
          <Box sx={{ display: 'grid', height: '100%', placeItems: 'center' }}>
            <Typography sx={{ color: 'text.secondary', fontSize: 14 }}>
              {t('reticulum:discussion.unavailable', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </Box>
        ) : (
          <Box
            sx={{
              height: rowVirtualizer.getTotalSize(),
              position: 'relative',
              width: '100%',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const index = virtualRow.index;
              const message = messages[index];
              const reply = message?.repliedTo
                ? messageById.get(String(message.repliedTo)) || rootMessage
                : null;
              return (
                <Box
                  data-index={index}
                  key={virtualRow.key}
                  ref={rowVirtualizer.measureElement}
                  sx={{
                    boxSizing: 'border-box',
                    left: 0,
                    maxWidth: '100%',
                    overflow: 'hidden',
                    px: isMobile ? '10px' : '22px',
                    pb: index === 0 ? (isMobile ? '14px' : '24px') : '10px',
                    pt: index === 0 ? (isMobile ? '12px' : '20px') : 0,
                    position: 'absolute',
                    top: 0,
                    transform: `translateY(${virtualRow.start}px)`,
                    width: '100%',
                  }}
                >
                  {(index === 0 || index === 1) && (
                    <Typography
                      sx={{
                        color: 'text.secondary',
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: '0.11em',
                        lineHeight: '16px',
                        mb: '14px',
                        textTransform: 'uppercase',
                      }}
                    >
                      {index === 0
                        ? t('reticulum:discussion.initial_post', {
                            postProcess: 'capitalizeEachFirstChar',
                          })
                        : t('reticulum:discussion.replies', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                    </Typography>
                  )}
                  <Box
                    className={`reticulum-discussion-message ${
                      index === 0
                        ? 'reticulum-discussion-message--initial'
                        : 'reticulum-discussion-message--reply'
                    }`}
                    sx={{
                      backgroundColor:
                        index === 0
                          ? theme.palette.mode === 'dark'
                            ? '#1b1f27'
                            : '#eef2f6'
                          : theme.palette.mode === 'dark'
                            ? '#171a21'
                            : '#f5f7fa',
                      border: '1px solid',
                      borderColor:
                        index === 0
                          ? alpha(theme.palette.primary.main, 0.22)
                          : alpha(theme.palette.text.primary, 0.08),
                      borderRadius: '14px',
                      boxShadow:
                        index === 0
                          ? 'inset 0 1px 0 rgba(255, 255, 255, 0.02)'
                          : 'none',
                      maxWidth: '100%',
                      minWidth: 0,
                      overflow: 'hidden',
                      p: index === 0 ? '18px' : '16px 18px',
                    }}
                  >
                    <MessageItem
                      handleReaction={() => undefined}
                      isLast={index === messages.length - 1}
                      isPrivate={false}
                      isTemp={false}
                      isUpdating={false}
                      lastSignature={String(messages.at(-1)?.signature || '')}
                      message={message}
                      myAddress={myAddress}
                      onDelete={() => undefined}
                      onEdit={() => undefined}
                      onReply={() => undefined}
                      onSeen={() => undefined}
                      reactions={null}
                      reply={reply}
                      replyIndex={0}
                      reticulumChatEnabled
                      reticulumDiscussionRootId={String(
                        rootMessage?.signature || ''
                      )}
                      reticulumDiscussionView
                      reticulumGroupAvatarOwnerName={
                        reticulumGroupAvatarOwnerName
                      }
                      reticulumGroupDisplayName={reticulumGroupDisplayName}
                      reticulumMemberJoinedByAddress={
                        reticulumMemberJoinedByAddress
                      }
                      reticulumMemberRolesByAddress={
                        reticulumMemberRolesByAddress
                      }
                      reticulumMemberRolesReady={reticulumMemberRolesReady}
                      reticulumMentionUsers={reticulumMentionUsers}
                      reticulumChannelLinkAccess={reticulumChannelLinkAccess}
                      scrollToItem={() => undefined}
                      selectedGroup={selectedGroup}
                    />
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      {isMobile ? (
        // Phones: the main group composer, as one full-width rounded field
        // that holds the attachment chips, the text with + 😊 Aa on its left
        // and expiry, X and send on its right, growing by its stages and then
        // scrolling. The field is capped like the chat's composer bar, so the
        // chips and the formatting tray take their rows out of the text's
        // room rather than squeezing the thread away.
        <Box
          className="reticulum-discussion-composer reticulum-discussion-composer--corners"
          sx={{
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            padding: '6px 8px',
            paddingBottom: `max(6px, ${SAFE_AREA_BOTTOM})`,
          }}
        >
          <Box sx={{ flexShrink: 0, mb: showSizeLip ? '6px' : 0 }}>
            {sizeLip}
          </Box>
          <Box
            className="reticulum-discussion-composer__field"
            sx={{
              backgroundColor: alpha(theme.palette.text.primary, 0.06),
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: '22px',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              flexShrink: 0,
              gap: '2px',
              maxHeight: DISCUSSION_PHONE_FIELD_MAX_HEIGHT,
              minWidth: 0,
              overflow: 'hidden',
              padding: '3px 5px',
            }}
          >
            {(files.length > 0 || preparingFile) && (
              <Box
                className="reticulum-discussion-composer__attachments"
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  // Two rows of chips, more scroll. Short of height they give
                  // way down to one row, and the typing row never does.
                  flexShrink: files.length > 0 ? 1 : 0,
                  flexWrap: 'wrap',
                  gap: '6px',
                  maxHeight: 108,
                  minHeight:
                    files.length > 0 ? DISCUSSION_PHONE_CHIP_ROW_PX : undefined,
                  overflowY: 'auto',
                  pt: '3px',
                  px: '3px',
                }}
              >
                {preparingStatus}
                {files.map((file, index) => (
                  <Box
                    key={`${file.fileName}-${index}`}
                    sx={{
                      alignItems: 'center',
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: '8px',
                      boxSizing: 'border-box',
                      display: 'flex',
                      gap: 1,
                      maxWidth: 'min(280px, 100%)',
                      minHeight: 48,
                      minWidth: 0,
                      p: '3px 2px 3px 6px',
                    }}
                  >
                    {fileThumbnail(file, 36)}
                    {fileNameLabel(file)}
                    <ComposerDismissButton
                      desktopIcon={<CloseRoundedIcon sx={{ fontSize: 17 }} />}
                      keepFocus={keepComposerFocus}
                      label={t('reticulum:discussion.remove_file', {
                        fileName: file.fileName,
                        postProcess: 'capitalizeFirstChar',
                      })}
                      onClick={() => onRemoveFile(index)}
                    />
                  </Box>
                ))}
              </Box>
            )}
            {/* Keeps the formatting tray and the typing row at their own
                height: TipTap's root may otherwise shrink, clipping them. */}
            <Box
              className="reticulum-discussion-composer__editor"
              sx={{ flexShrink: 0, minWidth: 0 }}
            >
              {composerEditor}
            </Box>
          </Box>
          {writeNotice}
          {sizeCounter}
        </Box>
      ) : (
        <Box
          className="reticulum-discussion-composer"
          sx={{
            '--discussion-composer-field-bg':
              theme.palette.mode === 'dark' ? '#131720' : '#ffffff',
            '--discussion-composer-field-border': alpha(
              theme.palette.text.primary,
              0.16
            ),
            backgroundColor:
              theme.palette.mode === 'dark'
                ? 'rgba(15, 18, 25, 0.82)'
                : 'rgba(247, 249, 252, 0.94)',
            borderTop: '1px solid',
            borderColor: 'divider',
            p: '16px 18px',
          }}
        >
          <Box sx={{ mb: showSizeLip ? 1.25 : 0 }}>{sizeLip}</Box>
          {(files.length > 0 || preparingFile) && (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 1,
                mb: 1,
                px: 0.25,
              }}
            >
              {preparingStatus}
              {files.map((file, index) => (
                <Box
                  key={`${file.fileName}-${index}`}
                  sx={{
                    alignItems: 'center',
                    backgroundColor: alpha(
                      theme.palette.background.default,
                      0.72
                    ),
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: '8px',
                    display: 'flex',
                    gap: 1,
                    maxWidth: 280,
                    minHeight: 48,
                    p: 0.75,
                  }}
                >
                  {fileThumbnail(file, 36)}
                  {fileNameLabel(file)}
                  <Tooltip
                    title={t('reticulum:discussion.remove_attachment', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  >
                    <IconButton
                      aria-label={t('reticulum:discussion.remove_file', {
                        fileName: file.fileName,
                        postProcess: 'capitalizeFirstChar',
                      })}
                      onClick={() => onRemoveFile(index)}
                      size="small"
                    >
                      <CloseRoundedIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </Tooltip>
                </Box>
              ))}
            </Box>
          )}

          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: 1,
              minHeight: 44,
            }}
          >
            {/* Without this the editor is just another flex item and the
                fixed width controls beside it squeeze the typing area to
                nothing. */}
            <Box sx={{ flex: 1, minWidth: 0 }}>{composerEditor}</Box>
            <Tooltip
              title={t('reticulum:discussion.choose_emoji', {
                postProcess: 'capitalizeFirstChar',
              })}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'inline-flex',
                  flexShrink: 0,
                  justifyContent: 'center',
                  opacity: sendingSplit ? 0.4 : 1,
                  pointerEvents: sendingSplit ? 'none' : undefined,
                }}
              >
                <ReactionPicker
                  compactComposer
                  neutralIcon
                  onGifSelect={selectGif}
                  onReaction={(emoji: string) => {
                    editor?.chain().focus().insertContent(emoji).run();
                  }}
                />
              </Box>
            </Tooltip>
            <Box
              sx={{
                alignItems: 'stretch',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: '10px',
                display: 'inline-flex',
                flexShrink: 0,
                height: 38,
                overflow: 'hidden',
              }}
            >
              <ReticulumMessageExpiryButton
                channelExpiryDurationMs={channelExpiryDurationMs}
                disabled={loading || closeDisabled}
                disabledReason={t('reticulum:discussion.wait_until_ready', {
                  postProcess: 'capitalizeFirstChar',
                })}
                onChange={setExpiryDurationMs}
                onPreferredExpiryChange={onPreferredExpiryChange}
                preferredExpiryDurationMs={preferredExpiryDurationMs}
                segmented
                value={expiryDurationMs}
              />
              <Button
                disabled={sendDisabled}
                onClick={() => void send()}
                startIcon={
                  sending ? (
                    <CircularProgress color="inherit" size={16} />
                  ) : (
                    <SendRoundedIcon sx={{ fontSize: 18 }} />
                  )
                }
                sx={{
                  backgroundColor: RETICULUM_BLUE,
                  borderRadius: 0,
                  color: 'common.white',
                  flexShrink: 0,
                  fontWeight: 650,
                  height: 38,
                  minWidth: 82,
                  px: '14px',
                  textTransform: 'none',
                  '&:hover': { backgroundColor: '#1e40af' },
                  '&.Mui-focusVisible': {
                    boxShadow: (theme) =>
                      `inset 0 0 0 2px ${theme.palette.common.white}`,
                  },
                }}
                variant="contained"
              >
                {sendLabel}
              </Button>
            </Box>
          </Box>
          {writeNotice}
          {sizeCounter}
        </Box>
      )}
    </Dialog>
  );
};
