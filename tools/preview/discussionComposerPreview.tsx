/**
 * Dev-only preview of the thread (Discussion) dialog and its reply composer:
 * the real ReticulumDiscussionDialog with a root post, a reply and a fake
 * parent that sends after a short wait. Run `npm run dev` and open
 * /tools/preview/discussion-composer.html. Under 900px of viewport width the
 * dialog is full screen and the composer is the chat's corner composer; wider
 * windows show the desktop composer, which must look as it always did.
 *
 * The dialog covers the page on phones, so it is driven from the console:
 *
 *   __discussionSet('twoLines')   a sample text (or any HTML)
 *   __discussionFiles(2)          that many pending attachment chips
 *   __discussionPreparing(true)   the "preparing attachment" row
 *   __discussionCanWrite(false)   an admins-only channel
 *   __discussionTray()            opens or closes the Aa formatting tray
 *   __discussionCheck()           field width, stage, control boxes, overlaps,
 *                                 anything clipped by the field, band or screen
 *   __discussionRun()             every sample through __discussionCheck
 *   __discussionSent              what the fake parent was sent
 *
 * URL flags: ?light starts in the light theme, ?timers swaps animation frames
 * for timers and makes the stage moves instant (for a pane that is not on
 * screen, which runs no frames).
 */
import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline } from '@mui/material';
import i18n from '../../src/i18n/i18n';
import '../../src/styles/index.css';
import '../../src/components/Chat/chat.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import { QORTAL_APP_CONTEXT } from '../../src/App';
import {
  ReticulumDiscussionDialog,
  type ReticulumDiscussionDraft,
  type ReticulumDiscussionFile,
} from '../../src/components/Chat/ReticulumDiscussionDialog';

const params = new URLSearchParams(window.location.search);

// Keys this change added, until the locales carry them (only where missing,
// so the real strings win once they are in).
const PENDING_KEYS: Record<string, string> = {
  'discussion.preparing_attachment': 'preparing attachment…',
  'discussion.size_counter': '{{size}} / {{maximum}} bytes',
  'discussion.unavailable': 'this discussion is no longer available',
};
for (const [key, value] of Object.entries(PENDING_KEYS)) {
  if (!i18n.exists(`reticulum:${key}`)) {
    i18n.addResource('en', 'reticulum', key, value);
  }
}

if (params.has('timers')) {
  window.requestAnimationFrame = (callback) =>
    window.setTimeout(() => callback(performance.now()), 16);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => false,
  });
  const instant = document.createElement('style');
  instant.textContent =
    '.tiptap-chat-composer--corners { --composer-chrome-duration: 0s !important; }';
  document.head.append(instant);
}

const ME = 'QMeAddressPreview000000000000000000';
const ALICE = 'QAliceAddressPreview0000000000000000';
const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

const post = (
  id: string,
  sender: string,
  senderName: string,
  text: string,
  minutesAgo: number,
  repliedTo?: string
) => ({
  id,
  eventId: id,
  signature: id,
  timestamp: Date.now() - minutesAgo * 60_000,
  sender,
  senderAddress: sender,
  senderName,
  text: `<p>${text}</p>`,
  message: `<p>${text}</p>`,
  messageText: text,
  repliedTo,
  reticulumChat: true,
});

const MESSAGES = [
  post('root', ALICE, 'alice', 'Release notes for 0.0.15 are up.', 40),
  post('reply-1', ME, 'me', 'Thanks, reading them now.', 12, 'root'),
];

const SAMPLES: Record<string, string> = {
  empty: '',
  short: '<p>Hi there</p>',
  oneLine: '<p>See you at eight tonight</p>',
  twoLines:
    '<p>Running a little late, the bus broke down again. Save me a seat?</p>',
  threeLines:
    '<p>Running a little late, the bus broke down again and the next one is twenty minutes away. Save me a seat near the window if you can?</p>',
  fiveLines: '<p>One</p><p>Two</p><p>Three</p><p>Four</p><p>Five</p>',
  long: `<p>${'All work and no play makes a dull message. '.repeat(14)}</p>`,
  // Over the 4000-byte limit: the size lip and the byte count show.
  huge: `<p>${'All work and no play makes a dull message. '.repeat(110)}</p>`,
};

const fakeFile = (index: number): ReticulumDiscussionFile => ({
  fileName:
    index % 2 === 0 ? `holiday-photo-${index + 1}.webp` : `notes-${index}.txt`,
  isImage: index % 2 === 0,
  mimeType: index % 2 === 0 ? 'image/webp' : 'text/plain',
  sizeBytes: 12_000,
});

const overlaps = (a: DOMRect, b: DOMRect, slack = 1) =>
  a.left < b.right - slack &&
  b.left < a.right - slack &&
  a.top < b.bottom - slack &&
  b.top < a.bottom - slack;

const intersect = (a: DOMRect, b: DOMRect) => {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  return new DOMRect(left, top, right - left, bottom - top);
};

/**
 * The part of the screen a node can show in: the viewport, cut down by every
 * ancestor that clips its overflow (TipTap's root, the field, the dialog).
 */
const visibleArea = (node: Element) => {
  let area = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  for (
    let ancestor = node.parentElement;
    ancestor && ancestor !== document.body;
    ancestor = ancestor.parentElement
  ) {
    const style = getComputedStyle(ancestor);
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
      area = intersect(area, ancestor.getBoundingClientRect());
    }
  }
  return area;
};

/** Whether any of the box is cut off from view. */
const clipped = (node: Element, rect = node.getBoundingClientRect()) => {
  const area = visibleArea(node);
  return (
    rect.top < area.top - 1 ||
    rect.bottom > area.bottom + 1 ||
    rect.left < area.left - 1 ||
    rect.right > area.right + 1
  );
};

/** What the phone composer looks like right now, and anything wrong with it. */
const discussionCheck = () => {
  const band = document.querySelector<HTMLElement>(
    '.reticulum-discussion-composer'
  );
  if (!band) return { error: 'no composer' };
  const corners = band.classList.contains(
    'reticulum-discussion-composer--corners'
  );
  const root = band.querySelector<HTMLElement>('.tiptap-chat-composer');
  const row = band.querySelector<HTMLElement>('.compact-composer-row');
  const field = band.querySelector<HTMLElement>(
    '.reticulum-discussion-composer__field'
  );
  const paper = band.closest<HTMLElement>('.MuiDialog-paper');
  const problems: string[] = [];
  if (!corners || !root || !row || !field) {
    return {
      corners,
      layout: 'desktop',
      bandWidth: Math.round(band.getBoundingClientRect().width),
    };
  }
  const stage = root.hasAttribute('data-composer-stacked')
    ? 'stacked'
    : root.hasAttribute('data-composer-squeezed')
      ? 'squeezed'
      : 'inline';
  const rowRect = row.getBoundingClientRect();
  const fieldRect = field.getBoundingClientRect();
  const paperRect = paper?.getBoundingClientRect();
  if (paperRect && paperRect.width - fieldRect.width > 24) {
    problems.push(
      `field is ${Math.round(fieldRect.width)} of ${Math.round(paperRect.width)}px`
    );
  }
  const controls = [
    ...root.querySelectorAll<HTMLElement>('.compact-composer-rail > *'),
  ]
    .map((node) => {
      const target =
        node.querySelector<HTMLElement>('button, [role="button"]') ||
        (node.matches('button, [role="button"]') ? node : null);
      const style = getComputedStyle(node);
      return {
        name:
          node.className
            .split(' ')
            .find((name) => name.startsWith('compact-composer-'))
            ?.replace('compact-composer-', '') || node.className,
        node: target || node,
        rect: (target || node).getBoundingClientRect(),
        visible:
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0.5 &&
          style.display !== 'none',
      };
    })
    .filter((control) => control.visible && control.rect.width > 0);
  controls.forEach((a, i) => {
    if (
      a.rect.top < rowRect.top - 1 ||
      a.rect.bottom > rowRect.bottom + 1 ||
      a.rect.left < rowRect.left - 1 ||
      a.rect.right > rowRect.right + 1
    ) {
      problems.push(`${a.name} sticks out of the row`);
    }
    if (clipped(a.node, a.rect)) {
      problems.push(`${a.name} is cut off`);
    }
    if (a.rect.width < 39.5 || a.rect.height < 39.5) {
      problems.push(
        `${a.name} is ${Math.round(a.rect.width)}x${Math.round(a.rect.height)}`
      );
    }
    controls.slice(i + 1).forEach((b) => {
      if (overlaps(a.rect, b.rect)) {
        problems.push(`${a.name} overlaps ${b.name}`);
      }
    });
  });
  const editorNode = root.querySelector<HTMLElement>(
    '.compact-composer-editor'
  );
  const editorBox = editorNode?.getBoundingClientRect();
  // The typing row is never squeezed or cut off, whatever sits above it.
  if (rowRect.height < 41.5) {
    problems.push(`row squeezed to ${Math.round(rowRect.height)}px`);
  }
  if (clipped(row, rowRect)) problems.push('row is cut off');
  if (editorNode && clipped(editorNode)) problems.push('editor is cut off');
  if (
    rowRect.top < fieldRect.top - 1 ||
    rowRect.bottom > fieldRect.bottom + 1
  ) {
    problems.push('row is outside the field');
  }
  const bandRect = band.getBoundingClientRect();
  if (fieldRect.bottom > bandRect.bottom + 1 || clipped(field, fieldRect)) {
    problems.push('field is cut off');
  }
  for (const paragraph of root.querySelectorAll<HTMLElement>(
    '.compact-composer-editor .tiptap > *'
  )) {
    const rect = paragraph.getBoundingClientRect();
    const style = getComputedStyle(paragraph);
    const top = Math.max(rect.top, editorBox?.top ?? rect.top);
    const text = new DOMRect(
      rect.left + parseFloat(style.paddingLeft),
      top,
      rect.width -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight),
      Math.min(rect.bottom, editorBox?.bottom ?? rect.bottom) - top
    );
    if (text.height <= 0) continue;
    for (const control of controls) {
      if (overlaps(text, control.rect, 0)) {
        problems.push(`text overlaps ${control.name}`);
      }
    }
  }
  // The placeholder is one line that trails off; never a clipped second one.
  const empty = root.querySelector<HTMLElement>(
    '.tiptap p.is-editor-empty:first-child'
  );
  let placeholder: string | null = null;
  if (empty) {
    const before = getComputedStyle(empty, '::before');
    placeholder = `${before.whiteSpace} ${Math.round(
      empty.getBoundingClientRect().height
    )}px`;
    if (before.whiteSpace !== 'nowrap') {
      problems.push('placeholder can wrap');
    }
    if (
      editorBox &&
      empty.getBoundingClientRect().bottom > editorBox.bottom + 1
    ) {
      problems.push('placeholder is clipped');
    }
  }
  return {
    stage,
    capped: root.hasAttribute('data-composer-capped'),
    fieldWidth: Math.round(fieldRect.width),
    paperWidth: paperRect ? Math.round(paperRect.width) : null,
    rowHeight: Math.round(rowRect.height * 10) / 10,
    bandHeight: Math.round(bandRect.height),
    fieldHeight: Math.round(fieldRect.height),
    placeholder,
    controls: controls.map(
      (control) =>
        `${control.name} ${Math.round(control.rect.left - rowRect.left)},${Math.round(
          control.rect.top - rowRect.top
        )} ${Math.round(control.rect.width)}x${Math.round(control.rect.height)}`
    ),
    problems: [...new Set(problems)],
  };
};

const settle = async () => {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    document.getAnimations().forEach((animation) => {
      try {
        animation.finish();
      } catch {
        // Infinite animations cannot finish.
      }
    });
  }
};

const discussionRun = async (keys: string[] = Object.keys(SAMPLES)) => {
  const report: Record<string, string> = {};
  for (const key of keys) {
    window.__discussionSet(key);
    await settle();
    const check = discussionCheck();
    if ('error' in check || !('stage' in check)) return check;
    report[key] = [
      `${check.stage}${check.capped ? ' capped' : ''} field ${check.fieldWidth}/${check.paperWidth}x${check.fieldHeight} row ${check.rowHeight} band ${check.bandHeight}`,
      check.controls.join('; '),
      `problems: ${check.problems.join(', ') || 'none'}`,
    ].join(' | ');
  }
  return report;
};

declare global {
  interface Window {
    __discussionCanWrite: (canWrite: boolean) => void;
    __discussionCheck: typeof discussionCheck;
    __discussionFiles: (count: number) => void;
    __discussionPreparing: (preparing: boolean) => void;
    __discussionRun: typeof discussionRun;
    __discussionSent: ReticulumDiscussionDraft[];
    __discussionSet: (key: string) => void;
    __discussionTheme: () => void;
    __discussionTray: () => void;
  }
}
window.__discussionCheck = discussionCheck;
window.__discussionRun = discussionRun;
window.__discussionSent = [];
window.__discussionTray = () => {
  document
    .querySelector<HTMLElement>(
      '.reticulum-discussion-composer .compact-composer-format button'
    )
    ?.click();
};

const appContext = { getIndividualUserInfo: async () => null };

function Preview() {
  const { themeMode, toggleTheme } = useThemeContext();
  const [files, setFiles] = useState<ReticulumDiscussionFile[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [canWrite, setCanWrite] = useState(true);
  const [expiry, setExpiry] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (params.has('light') && themeMode === 'dark') toggleTheme();
    // Only on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  window.__discussionFiles = (count) =>
    setFiles(Array.from({ length: count }, (_, index) => fakeFile(index)));
  window.__discussionPreparing = setPreparing;
  window.__discussionCanWrite = setCanWrite;
  window.__discussionTheme = toggleTheme;
  window.__discussionSet = (key) => {
    const editor = document.querySelector<HTMLElement & { editor?: any }>(
      '.reticulum-discussion-composer .ProseMirror'
    )?.editor;
    editor?.commands.setContent(SAMPLES[key] ?? key, true);
  };

  const onSend = useCallback(async (draft: ReticulumDiscussionDraft) => {
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    window.__discussionSent.push(draft);
    setFiles([]);
    return true;
  }, []);

  return (
    <QORTAL_APP_CONTEXT.Provider value={appContext as any}>
      <ReticulumDiscussionDialog
        canWrite={canWrite}
        channelExpiryDurationMs={ONE_MONTH_MS}
        compressingGif={false}
        files={files}
        loading={false}
        membersWithNames={[]}
        messages={MESSAGES}
        myAddress={ME}
        onClose={() => undefined}
        onPreferredExpiryChange={setExpiry}
        onRemoveFile={(index) =>
          setFiles((current) => current.filter((_, i) => i !== index))
        }
        onSelectFiles={(picked) =>
          setFiles((current) => [
            ...current,
            ...picked.map((file) => ({
              fileName: file.name,
              isImage: file.type.startsWith('image/'),
              mimeType: file.type,
              sizeBytes: file.size,
            })),
          ])
        }
        onSend={onSend}
        onTypingChange={() => undefined}
        open
        preferredExpiryDurationMs={expiry}
        preparingFile={preparing}
        replyCount={1}
        selectedGroup={7}
      />
    </QORTAL_APP_CONTEXT.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Preview />
  </ThemeProvider>
);
