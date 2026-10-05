/**
 * Dev-only preview of the phone chat composer: the real TipTap composer in its
 * corner layout with the group (expiry, discard, send) or direct-message
 * (discard, send) controls, the reply strip, the edit banner and attachment
 * chips. Run `npm run dev` and open /tools/preview/chat-composer.html in a
 * window under 900px wide: the corner layout only exists on phones. Not a
 * build input, so it never ships.
 *
 * window.__composerCheck() reports the stage, the row height and every overlap
 * between the visible controls, and between them and the text column;
 * window.__composerRun() walks every sample through it. A pane that is not on
 * screen runs no animation frames: open the page with ?timers there. ?thread
 * adds the compact composer threads and announcements use, without corners.
 * ?scale=small|large sets the Q-Chat text size (chat settings → Text size).
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { alpha, Box, CssBaseline, IconButton, useTheme } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import ImageIcon from '@mui/icons-material/Image';
import CloseIcon from '@mui/icons-material/Close';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import '../../src/components/Chat/chat.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import Tiptap, {
  composerHasSendableText,
} from '../../src/components/Chat/TipTap';
import { ComposerDiscardButton } from '../../src/components/Chat/ComposerDiscardButton';
import { ComposerReplyPreview } from '../../src/components/Chat/ComposerReplyPreview';
import { ComposerEditBanner } from '../../src/components/Chat/ComposerEditBanner';
import {
  ComposerAttachmentTile,
  ComposerDismissButton,
} from '../../src/components/Chat/ComposerDismissButton';
import { ReticulumMessageExpiryButton } from '../../src/components/Chat/ReticulumMessageExpiryButton';
import {
  COMPOSER_SEND_BUTTON_PX,
  COMPOSER_SEND_ICON_PX,
} from '../../src/components/Chat/composerCornerLayout';
import {
  normalizeReticulumChatTextScale,
  reticulumChatTextScaleClassName,
} from '../../src/components/Chat/reticulumChatTextScale';

// A browser tab that is not on screen runs no animation frames and reports
// itself hidden, and the composer measures its text in a frame and skips
// hidden documents: ?timers swaps in a timer, a visible document and instant
// moves so the stages can still be driven (and checked) from a script.
if (new URLSearchParams(window.location.search).has('timers')) {
  window.requestAnimationFrame = (callback) =>
    window.setTimeout(() => callback(performance.now()), 16);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => false,
  });
  // Transitions do not advance without frames either, and the fit check
  // would read a box frozen mid-move: make every move instant instead.
  const instant = document.createElement('style');
  instant.textContent =
    '.tiptap-chat-composer--corners { --composer-chrome-duration: 0s !important; }';
  document.head.append(instant);
}

const SAMPLES: Record<string, string> = {
  empty: '',
  short: '<p>Hi there</p>',
  oneLine: '<p>See you at eight tonight</p>',
  twoLines:
    '<p>Running a little late, the bus broke down again. Save me a seat?</p>',
  threeLines:
    '<p>Running a little late, the bus broke down again and the next one is twenty minutes away. Save me a seat near the window if you can?</p>',
  paragraphs: '<p>One</p><p>Two</p><p>Three</p>',
  fiveLines: '<p>One</p><p>Two</p><p>Three</p><p>Four</p><p>Five</p>',
  long: `<p>${'All work and no play makes a dull message. '.repeat(14)}</p>`,
};

type Mode = 'group' | 'dm';

const showThreadComposer = new URLSearchParams(window.location.search).has(
  'thread'
);
const textScale = normalizeReticulumChatTextScale(
  new URLSearchParams(window.location.search).get('scale')
);

const SendButton = ({ idle }: { idle: boolean }) => {
  const theme = useTheme();
  return (
    <IconButton
      aria-label="Send"
      className="compact-composer-send"
      data-idle={idle ? '' : undefined}
      size="small"
      sx={{
        bgcolor: theme.palette.primary.main,
        borderRadius: '50%',
        color: theme.palette.primary.contrastText,
        flexShrink: 0,
        height: COMPOSER_SEND_BUTTON_PX,
        width: COMPOSER_SEND_BUTTON_PX,
        '&:hover': { bgcolor: theme.palette.primary.dark },
      }}
    >
      <SendIcon sx={{ fontSize: COMPOSER_SEND_ICON_PX }} />
    </IconButton>
  );
};

const overlaps = (a: DOMRect, b: DOMRect, slack = 1) =>
  a.left < b.right - slack &&
  b.left < a.right - slack &&
  a.top < b.bottom - slack &&
  b.top < a.bottom - slack;

/** Visible controls in the rails, and the text column of each paragraph. */
const composerCheck = () => {
  const root = document.querySelector<HTMLElement>('.tiptap-chat-composer');
  const row = document.querySelector<HTMLElement>('.compact-composer-row');
  if (!root || !row) return { error: 'no composer' };
  const stage = root.hasAttribute('data-composer-stacked')
    ? 'stacked'
    : root.hasAttribute('data-composer-squeezed')
      ? 'squeezed'
      : 'inline';
  const controls = [
    ...root.querySelectorAll<HTMLElement>('.compact-composer-rail > *'),
  ]
    .map((node) => {
      const target =
        node.querySelector<HTMLElement>('button, [role="button"]') ||
        (node.matches('button, [role="button"]') ? node : null);
      const style = getComputedStyle(node);
      const visible =
        style.visibility !== 'hidden' &&
        Number(style.opacity) > 0.5 &&
        style.display !== 'none';
      const rect = (target || node).getBoundingClientRect();
      return {
        name:
          node.className
            .split(' ')
            .find((name) => name.startsWith('compact-composer-'))
            ?.replace('compact-composer-', '') || node.className,
        rect,
        visible,
      };
    })
    .filter((control) => control.visible && control.rect.width > 0);
  const problems: string[] = [];
  const rowRect = row.getBoundingClientRect();
  for (let i = 0; i < controls.length; i += 1) {
    const a = controls[i];
    if (
      a.rect.top < rowRect.top - 1 ||
      a.rect.bottom > rowRect.bottom + 1 ||
      a.rect.left < rowRect.left - 1 ||
      a.rect.right > rowRect.right + 1
    ) {
      problems.push(`${a.name} sticks out of the row`);
    }
    if (a.rect.width < 39.5 || a.rect.height < 39.5) {
      problems.push(
        `${a.name} is ${Math.round(a.rect.width)}x${Math.round(a.rect.height)}`
      );
    }
    for (let j = i + 1; j < controls.length; j += 1) {
      if (overlaps(a.rect, controls[j].rect)) {
        problems.push(`${a.name} overlaps ${controls[j].name}`);
      }
    }
  }
  const editorBox = root
    .querySelector<HTMLElement>('.compact-composer-editor')
    ?.getBoundingClientRect();
  for (const paragraph of root.querySelectorAll<HTMLElement>(
    '.compact-composer-editor .tiptap > *'
  )) {
    const rect = paragraph.getBoundingClientRect();
    const style = getComputedStyle(paragraph);
    const text = new DOMRect(
      rect.left + parseFloat(style.paddingLeft),
      Math.max(rect.top, editorBox?.top ?? rect.top),
      rect.width -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight),
      Math.min(rect.bottom, editorBox?.bottom ?? rect.bottom) -
        Math.max(rect.top, editorBox?.top ?? rect.top)
    );
    if (text.height <= 0) continue;
    for (const control of controls) {
      if (overlaps(text, control.rect, 0)) {
        problems.push(`text overlaps ${control.name}`);
      }
    }
  }
  return {
    stage,
    short: root.hasAttribute('data-composer-short'),
    capped: root.hasAttribute('data-composer-capped'),
    rowHeight: Math.round(rowRect.height * 10) / 10,
    rowWidth: Math.round(rowRect.width),
    controls: controls.map(
      (control) =>
        `${control.name} ${Math.round(control.rect.left - rowRect.left)},${Math.round(
          control.rect.top - rowRect.top
        )} ${Math.round(control.rect.width)}x${Math.round(control.rect.height)}`
    ),
    problems: [...new Set(problems)],
  };
};

/** Jumps every running transition to its end, a few times over, so the
 *  stage the composer settles on can be measured without waiting on frames. */
const settle = async () => {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    document.getAnimations().forEach((animation) => {
      try {
        animation.finish();
      } catch {
        // Infinite animations cannot finish; nothing to settle there.
      }
    });
  }
};

/** Loads each sample in turn and reports what composerCheck saw. */
const composerRun = async (keys: string[] = Object.keys(SAMPLES)) => {
  const report: Record<string, string> = {};
  for (const key of keys) {
    window.__composerSet(key);
    await settle();
    const check = composerCheck();
    if ('error' in check) return check;
    report[key] = [
      `${check.stage}${check.short ? ' short' : ''}${check.capped ? ' capped' : ''} ${check.rowWidth}x${check.rowHeight}`,
      check.controls.join('; '),
      `problems: ${check.problems.join(', ') || 'none'}`,
    ].join(' | ');
  }
  return report;
};

declare global {
  interface Window {
    __composerCheck: typeof composerCheck;
    __composerRun: typeof composerRun;
    __composerSet: (key: string) => void;
    __composerMode: (mode: Mode) => void;
    __composerEditor: any;
  }
}
window.__composerCheck = composerCheck;
window.__composerRun = composerRun;

const Chip = ({ children }: { children: ReactNode }) => {
  const theme = useTheme();
  return (
    <Box
      sx={{
        alignItems: 'center',
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: '8px',
        display: 'flex',
        gap: '10px',
        padding: '8px 10px',
        width: 'fit-content',
      }}
    >
      {children}
    </Box>
  );
};

function Preview() {
  const theme = useTheme();
  const { themeMode, toggleTheme } = useThemeContext();
  const [mode, setMode] = useState<Mode>('group');
  const [hasContent, setHasContent] = useState(false);
  const [reply, setReply] = useState(false);
  const [editing, setEditing] = useState(false);
  const [attachments, setAttachments] = useState(false);
  const [expiry, setExpiry] = useState<number | undefined>(undefined);
  const editorRef = useRef<any>(null);

  const setEditorRef = useCallback((editor: any) => {
    editorRef.current = editor;
    window.__composerEditor = editor;
  }, []);

  const setSample = (key: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.commands.setContent(SAMPLES[key] ?? key, true);
    setHasContent(composerHasSendableText(editor.getText()));
  };
  window.__composerSet = setSample;
  window.__composerMode = setMode;

  const discard = () => {
    editorRef.current?.commands.clearContent(true);
    setHasContent(false);
  };

  const actions = () => (
    <>
      {mode === 'group' && (
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
            channelExpiryDurationMs={7 * 24 * 60 * 60 * 1000}
            corner
            onChange={setExpiry}
            value={expiry}
          />
        </Box>
      )}
      <ComposerDiscardButton idle={!hasContent} onDiscard={discard} />
      <SendButton idle={!hasContent} />
    </>
  );

  const composer = (
    <Tiptap
      compactActions={actions}
      compactChat
      isChat
      isReply={reply || editing}
      onContentUpdate={(editor) =>
        setHasContent(composerHasSendableText(editor.getText()))
      }
      onEnter={() => {}}
      placeholder={mode === 'group' ? 'Message channel...' : 'Send message...'}
      setEditorRef={setEditorRef}
      insertFiles={() => {}}
    />
  );

  return (
    <Box
      className={reticulumChatTextScaleClassName(textScale)}
      sx={{
        bgcolor: 'background.default',
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px',
          p: '4px',
          '& button': { fontSize: 11 },
        }}
      >
        <button onClick={() => setMode(mode === 'group' ? 'dm' : 'group')}>
          {mode}
        </button>
        {Object.keys(SAMPLES).map((key) => (
          <button key={key} onClick={() => setSample(key)}>
            {key}
          </button>
        ))}
        <button onClick={() => setReply((on) => !on)}>
          reply {reply ? 'on' : 'off'}
        </button>
        <button onClick={() => setEditing((on) => !on)}>
          edit {editing ? 'on' : 'off'}
        </button>
        <button onClick={() => setAttachments((on) => !on)}>
          files {attachments ? 'on' : 'off'}
        </button>
        <button onClick={toggleTheme}>{themeMode}</button>
      </Box>
      <Box sx={{ flex: 1 }} />
      <Box
        sx={{
          alignItems: 'stretch',
          boxSizing: 'border-box',
          display: 'flex',
          flexShrink: 0,
          maxHeight: 'min(50vh, 320px)',
          overflow: 'hidden',
          padding: '6px 8px',
        }}
      >
        <Box
          sx={{
            backgroundColor: alpha(theme.palette.text.primary, 0.06),
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: '22px',
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            gap: '2px',
            minHeight: 0,
            minWidth: 0,
            overflow: 'hidden',
            padding: '3px 5px',
          }}
        >
          {attachments && (
            <Box
              sx={{
                alignItems: 'flex-start',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '10px',
              }}
            >
              <ComposerAttachmentTile label="Remove image" onRemove={() => {}}>
                <ImageIcon
                  color="primary"
                  sx={{ height: '100%', width: '100%' }}
                />
              </ComposerAttachmentTile>
              {/* A direct message's GIF or file chip. */}
              <Chip>
                <Box
                  data-preview-thumb=""
                  sx={{
                    backgroundColor: 'action.selected',
                    borderRadius: '6px',
                    flexShrink: 0,
                    height: 38,
                    width: 38,
                  }}
                />
                <span style={{ fontSize: 12, fontWeight: 600 }}>
                  holiday.pdf
                </span>
                <ComposerDismissButton
                  bleed={2}
                  desktopIcon={<CloseIcon fontSize="small" />}
                  label="Remove file"
                  onClick={() => {}}
                />
              </Chip>
              {/* A group's pending file chip. */}
              <Box
                data-preview-group-file=""
                sx={{
                  alignItems: 'center',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: '8px',
                  display: 'flex',
                  gap: '8px',
                  maxWidth: 260,
                  minHeight: '50px',
                  p: '6px 8px',
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Box sx={{ fontSize: '12px', fontWeight: 600 }}>
                    notes.txt
                  </Box>
                  <Box sx={{ color: 'text.secondary', fontSize: '11px' }}>
                    text/plain
                  </Box>
                </Box>
                <ComposerDismissButton
                  bleed={4}
                  desktopIcon={<CloseIcon fontSize="small" />}
                  label="Remove notes.txt"
                  onClick={() => {}}
                  sx={{ ml: 'auto' }}
                  tooltip
                />
              </Box>
            </Box>
          )}
          {reply && (
            <ComposerReplyPreview
              message={{
                senderName: 'alice',
                messageText: '<p>Are we still on for tonight?</p>',
              }}
              onCancel={() => setReply(false)}
              rounded
            />
          )}
          {editing && (
            <ComposerEditBanner
              desktopIcon={<CloseIcon fontSize="small" />}
              desktopPreview={
                <Box sx={{ flex: 1, fontSize: 13, p: '6px' }}>
                  Editing: “See you at eight”
                </Box>
              }
              onCancel={() => setEditing(false)}
            />
          )}
          {showThreadComposer && (
            // The thread and announcement composers: compact, but without the
            // corner layout. ?thread shows one above the corner composer.
            <Box
              data-preview-thread=""
              sx={{ alignItems: 'center', display: 'flex', gap: 0.5, mb: 1 }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Tiptap
                  compactChat
                  isChat
                  insertFiles={() => {}}
                  onEnter={() => {}}
                  placeholder="Reply in thread..."
                  setEditorRef={() => {}}
                />
              </Box>
            </Box>
          )}
          {mode === 'group' ? (
            composer
          ) : (
            // Direct messages nest the composer in a row of their own, as
            // ChatDirect does on phones.
            <Box
              className="mobile-chat-compose-row"
              sx={{ alignItems: 'center', display: 'flex', gap: '6px' }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>{composer}</Box>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Preview />
  </ThemeProvider>
);
