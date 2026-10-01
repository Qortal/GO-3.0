import { Editor, getSchema } from '@tiptap/core';
import Mention from '@tiptap/extension-mention';
import StarterKit from '@tiptap/starter-kit';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useCallback, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';
import { ANDROID_BACK_EVENT } from '../../bridge/capacitorBridge';
import {
  MAX_SIZE_MESSAGE,
  MAX_SPLIT_MESSAGE_PARTS,
} from '../../constants/constants';
import {
  type ChatDocNode,
  chatDocumentText,
  chatDocumentToHtml,
} from '../../utils/chat/splitLongMessage';
import {
  type ReticulumDiscussionDraft,
  type ReticulumDiscussionFile,
  type ReticulumDiscussionSender,
  ReticulumDiscussionDialog,
  mergeReticulumDiscussionDrafts,
  planReticulumDiscussionDrafts,
  planReticulumDiscussionSplit,
  reticulumDiscussionPayloadSize,
  sendReticulumDiscussionDrafts,
} from './ReticulumDiscussionDialog';

// The dialog's composer, reduced to a real headless TipTap editor so the test
// drives the dialog's own size, split and send logic.
const composer = vi.hoisted(() => ({
  editor: null as any,
  props: null as any,
}));

vi.mock('./TipTap', async () => {
  const { useEffect, useRef } = await import('react');
  const { Editor: TiptapEditor } = await import('@tiptap/core');
  const { default: Starter } = await import('@tiptap/starter-kit');
  const { default: MentionNode } = await import('@tiptap/extension-mention');
  const MockTiptap = (props: any) => {
    const { onContentUpdate, setEditorRef } = props;
    composer.props = props;
    const onContentUpdateRef = useRef(onContentUpdate);
    onContentUpdateRef.current = onContentUpdate;
    useEffect(() => {
      const editor = new TiptapEditor({ extensions: [Starter, MentionNode] });
      editor.on('update', () => onContentUpdateRef.current?.(editor));
      composer.editor = editor;
      setEditorRef(editor);
      return () => {
        composer.editor = null;
        editor.destroy();
      };
    }, []);
    return null;
  };
  return {
    default: MockTiptap,
    composerHasSendableText: (text: string | null | undefined) =>
      /[^\n]/.test(String(text ?? '')),
  };
});
vi.mock('./MessageItem', () => ({ MessageItem: () => null }));
vi.mock('../ReactionPicker', () => ({ ReactionPicker: () => null }));
vi.mock('./ReticulumMessageExpiryButton', () => ({
  ReticulumMessageExpiryButton: () => null,
}));
vi.mock('./gifs/libraryGifs', () => ({ fetchLibraryGifFile: vi.fn() }));

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const schema = getSchema([StarterKit, Mention]);

const text = (value: string): ChatDocNode => ({ type: 'text', text: value });
const paragraph = (...content: ChatDocNode[]): ChatDocNode => ({
  type: 'paragraph',
  content,
});
const mention = (id: string, label: string): ChatDocNode => ({
  type: 'mention',
  attrs: { id, label },
});
const doc = (...content: ChatDocNode[]): Record<string, unknown> => ({
  type: 'doc',
  content,
});
/** `count` paragraphs of about `length` ASCII characters each. */
const longDoc = (count: number, length = 300) =>
  doc(
    ...Array.from({ length: count }, (_, index) =>
      paragraph(
        text(
          `Paragraph ${index + 1}: ${'lorem ipsum dolor '.repeat(length / 18)}`.trim()
        )
      )
    )
  );
const partToHtml = (part: ChatDocNode) => chatDocumentToHtml(part, schema);
const htmlOf = (value: Record<string, unknown>) => {
  const editor = new Editor({
    extensions: [StarterKit, Mention],
    content: value,
  });
  try {
    return editor.getHTML();
  } finally {
    editor.destroy();
  }
};
const visibleText = (node: ChatDocNode) =>
  chatDocumentText(node).replace(/\s+/g, '');
const parentAccepts = (draft: ReticulumDiscussionDraft) =>
  new TextEncoder().encode(JSON.stringify(draft.messageText)).byteLength <=
  MAX_SIZE_MESSAGE;

describe('reticulumDiscussionPayloadSize', () => {
  it('is the old JSON length + 300 for ASCII text', () => {
    const value = longDoc(3);
    expect(reticulumDiscussionPayloadSize(value)).toBe(
      JSON.stringify(value).length + 300
    );
  });

  it('counts UTF-8 bytes once they outgrow that rule', () => {
    const value = doc(paragraph(text('漢'.repeat(1400))));
    const json = JSON.stringify(value);
    expect(json.length + 300).toBeLessThanOrEqual(MAX_SIZE_MESSAGE);
    expect(reticulumDiscussionPayloadSize(value)).toBe(
      new TextEncoder().encode(json).byteLength
    );
    expect(reticulumDiscussionPayloadSize(value)).toBeGreaterThan(
      MAX_SIZE_MESSAGE
    );
  });
});

describe('planReticulumDiscussionDrafts', () => {
  it('keeps a reply within the limit as the one draft it always was', () => {
    const messageText = longDoc(2);
    const plan = planReticulumDiscussionDrafts({
      expiryDurationMs: ONE_DAY_MS,
      htmlContent: '<p>as the editor gave it</p>',
      messageText,
      partToHtml: () => {
        throw new Error('not called within the limit');
      },
    });
    expect(plan.error).toBeUndefined();
    expect(plan.drafts).toHaveLength(1);
    expect(plan.drafts?.[0]).toEqual({
      expiryDurationMs: ONE_DAY_MS,
      htmlContent: '<p>as the editor gave it</p>',
      messageText,
    });
    expect(plan.drafts?.[0].messageText).toBe(messageText);
  });

  it('splits a long reply into ordered drafts the parent accepts', () => {
    const messageText = doc(
      ...(longDoc(12).content as ChatDocNode[]),
      paragraph(text('Ping '), mention('QaddrAlice', 'alice'), text(' here')),
      ...(longDoc(12).content as ChatDocNode[])
    );
    const plan = planReticulumDiscussionDrafts({
      expiryDurationMs: ONE_DAY_MS,
      htmlContent: htmlOf(messageText),
      messageText,
      partToHtml,
    });
    const drafts = plan.drafts as ReticulumDiscussionDraft[];
    expect(drafts.length).toBeGreaterThan(1);
    expect(planReticulumDiscussionSplit(messageText)).toEqual({
      splitParts: drafts.length,
      splitError: null,
    });
    for (const draft of drafts) {
      expect(parentAccepts(draft)).toBe(true);
      expect(
        reticulumDiscussionPayloadSize(draft.messageText)
      ).toBeLessThanOrEqual(MAX_SIZE_MESSAGE);
      expect(draft.expiryDurationMs).toBe(ONE_DAY_MS);
      // Each part carries its own HTML, exactly what the editor would give.
      expect(draft.htmlContent).toBe(htmlOf(draft.messageText));
    }
    // The mention is resolved from the one part that holds it.
    expect(
      drafts.filter((draft) => draft.htmlContent.includes('QaddrAlice'))
    ).toHaveLength(1);
    // Nothing but whitespace at the cuts is lost, and the order is kept.
    expect(drafts.map((draft) => visibleText(draft.messageText)).join('')).toBe(
      visibleText(messageText)
    );
  });

  it('splits a text the parent would refuse by UTF-8 bytes alone', () => {
    const messageText = doc(
      paragraph(text('漢字 '.repeat(500).trim())),
      paragraph(text('かな '.repeat(500).trim()))
    );
    expect(JSON.stringify(messageText).length + 300).toBeLessThanOrEqual(
      MAX_SIZE_MESSAGE
    );
    const plan = planReticulumDiscussionDrafts({
      htmlContent: htmlOf(messageText),
      messageText,
      partToHtml,
    });
    expect(plan.drafts?.length).toBeGreaterThan(1);
    expect(plan.drafts?.every(parentAccepts)).toBe(true);
  });

  it('refuses a text that needs more than the most parts', () => {
    const messageText = longDoc(MAX_SPLIT_MESSAGE_PARTS * 20);
    expect(
      planReticulumDiscussionDrafts({
        htmlContent: '',
        messageText,
        partToHtml,
      })
    ).toEqual({ error: 'too_many_parts' });
    expect(planReticulumDiscussionSplit(messageText)).toEqual({
      splitParts: null,
      splitError: 'too_many_parts',
    });
  });

  it('refuses a mention that cannot fit in any part', () => {
    const messageText = doc(
      paragraph(text('hi '), mention('Q'.repeat(MAX_SIZE_MESSAGE), 'huge'))
    );
    expect(
      planReticulumDiscussionDrafts({
        htmlContent: '',
        messageText,
        partToHtml,
      })
    ).toEqual({ error: 'unsplittable' });
  });

  it('plans no split within the limit', () => {
    expect(planReticulumDiscussionSplit(longDoc(2))).toEqual({
      splitParts: null,
      splitError: null,
    });
  });
});

describe('sendReticulumDiscussionDrafts', () => {
  const drafts = ['one', 'two', 'three'].map((value) => ({
    htmlContent: `<p>${value}</p>`,
    messageText: doc(paragraph(text(value))),
  }));

  const recorder = (calls: string[]) => (name: string) =>
    vi.fn<ReticulumDiscussionSender>(async (draft) => {
      calls.push(`${name}:${draft.htmlContent}`);
      return true;
    });

  it('sends every draft through send without a nextSender', async () => {
    const calls: string[] = [];
    await expect(
      sendReticulumDiscussionDrafts(drafts, recorder(calls)('first'))
    ).resolves.toBe(3);
    expect(calls).toEqual([
      'first:<p>one</p>',
      'first:<p>two</p>',
      'first:<p>three</p>',
    ]);
  });

  it('asks nextSender once, after the first draft, for all later ones', async () => {
    const calls: string[] = [];
    const sender = recorder(calls);
    const nextSender = vi.fn(async () => {
      calls.push('asked');
      return sender('fresh');
    });
    await expect(
      sendReticulumDiscussionDrafts(drafts, sender('first'), nextSender)
    ).resolves.toBe(3);
    expect(calls).toEqual([
      'first:<p>one</p>',
      'asked',
      'fresh:<p>two</p>',
      'fresh:<p>three</p>',
    ]);
    expect(nextSender).toHaveBeenCalledTimes(1);
  });

  it('stops when nextSender has no sender', async () => {
    const send = vi.fn(async () => true);
    await expect(
      sendReticulumDiscussionDrafts(drafts, send, async () => null)
    ).resolves.toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('stops at the first draft that is not sent', async () => {
    const send = vi.fn(async () => true);
    const refuse = vi.fn(async () => false);
    await expect(
      sendReticulumDiscussionDrafts(drafts, send, async () => refuse)
    ).resolves.toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(refuse).toHaveBeenCalledTimes(1);

    const failSecond = vi
      .fn<ReticulumDiscussionSender>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await expect(
      sendReticulumDiscussionDrafts(drafts, failSecond)
    ).resolves.toBe(1);
    expect(failSecond).toHaveBeenCalledTimes(2);
  });

  it('sends one draft without asking for another sender', async () => {
    const send = vi.fn(async () => true);
    const nextSender = vi.fn();
    await expect(
      sendReticulumDiscussionDrafts(drafts.slice(0, 1), send, nextSender)
    ).resolves.toBe(1);
    expect(send).toHaveBeenCalledWith(drafts[0]);
    expect(nextSender).not.toHaveBeenCalled();
  });
});

describe('mergeReticulumDiscussionDrafts', () => {
  it('joins the drafts back into one document', () => {
    expect(
      mergeReticulumDiscussionDrafts([
        { htmlContent: '', messageText: doc(paragraph(text('a'))) },
        { htmlContent: '', messageText: doc(paragraph(text('b'))) },
      ])
    ).toEqual(doc(paragraph(text('a')), paragraph(text('b'))));
  });
});

type SendLogEntry = {
  draft: ReticulumDiscussionDraft;
  files: string[];
  refused: boolean;
  rootId: string;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Stands in for ChatGroup's sendReticulumDiscussionReply: the thread root, the
 * sending flag and the pending files live in the handler's closure, the files
 * go with the reply that is sent and are cleared after it, and a busy handler
 * or one of a closed thread refuses without a word.
 */
const ParentHarness = ({
  closeDuringFirstSend = false,
  failAtSend = -1,
  initialFiles = [],
  log,
  onClose = () => undefined,
  onSendStarted,
  preparingFile = false,
}: {
  /** The thread closes (a group switch) while the first reply goes out. */
  closeDuringFirstSend?: boolean;
  failAtSend?: number;
  initialFiles?: ReticulumDiscussionFile[];
  log: SendLogEntry[];
  onClose?: () => void;
  onSendStarted?: () => void;
  preparingFile?: boolean;
}) => {
  const [files, setFiles] = useState(initialFiles);
  const [isSending, setIsSending] = useState(false);
  const [rootId, setRootId] = useState('root-1');
  const isSendingRef = useRef(false);
  const onSend = useCallback(
    async (draft: ReticulumDiscussionDraft) => {
      if (!rootId || isSendingRef.current || isSending) {
        log.push({ draft, files: [], refused: true, rootId });
        return false;
      }
      isSendingRef.current = true;
      setIsSending(true);
      try {
        onSendStarted?.();
        await delay(5);
        const index = log.filter((entry) => !entry.refused).length;
        log.push({
          draft,
          files: files.map((file) => file.fileName),
          refused: false,
          rootId,
        });
        if (index === failAtSend) return false;
        setFiles([]);
        if (index === 0 && closeDuringFirstSend) setRootId('');
        await delay(5);
        return true;
      } finally {
        isSendingRef.current = false;
        setIsSending(false);
      }
    },
    [
      closeDuringFirstSend,
      failAtSend,
      files,
      isSending,
      log,
      onSendStarted,
      rootId,
    ]
  );
  return (
    <ReticulumDiscussionDialog
      canWrite
      compressingGif={false}
      files={files}
      loading={false}
      membersWithNames={[]}
      messages={[]}
      myAddress="Qme"
      onClose={onClose}
      onPreferredExpiryChange={() => undefined}
      onRemoveFile={() => undefined}
      onSelectFiles={() => undefined}
      onSend={onSend}
      onTypingChange={() => undefined}
      open={Boolean(rootId)}
      preferredExpiryDurationMs={ONE_DAY_MS}
      preparingFile={preparingFile}
      replyCount={0}
      selectedGroup={7}
    />
  );
};

const renderDialog = async (props: Parameters<typeof ParentHarness>[0]) => {
  const view = render(<ParentHarness {...props} />);
  await waitFor(() => expect(composer.editor).not.toBeNull());
  return view;
};

const typeIntoComposer = (value: Record<string, unknown>) => {
  act(() => {
    composer.editor.commands.setContent(value, true);
  });
};

const pressAndroidBack = () => {
  const event = new CustomEvent(ANDROID_BACK_EVENT, { cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
};

const image: ReticulumDiscussionFile = {
  fileName: 'photo.webp',
  isImage: true,
  mimeType: 'image/webp',
  sizeBytes: 1200,
};

describe('ReticulumDiscussionDialog long replies', () => {
  const snackbars: Array<{ message?: string; type?: string }> = [];
  const onSnackbar = (event: Event) => {
    snackbars.push((event as CustomEvent).detail);
  };

  beforeEach(() => {
    snackbars.length = 0;
    document.addEventListener('openGlobalSnackBar', onSnackbar);
  });

  afterEach(() => {
    document.removeEventListener('openGlobalSnackBar', onSnackbar);
    vi.useRealTimers();
    composer.editor = null;
    composer.props = null;
  });

  it('sends a reply within the limit as one draft, as before', async () => {
    const log: SendLogEntry[] = [];
    await renderDialog({ initialFiles: [image], log });
    const value = longDoc(3);
    typeIntoComposer(value);
    const expectedHtml = composer.editor.getHTML();
    expect(screen.queryByRole('status')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(composer.editor.isEmpty).toBe(true));

    expect(log).toHaveLength(1);
    expect(log[0].files).toEqual(['photo.webp']);
    expect(log[0].draft).toEqual({
      expiryDurationMs: ONE_DAY_MS,
      htmlContent: expectedHtml,
      messageText: value,
    });
    // A single reply never locks the composer.
    expect(composer.editor.isEditable).toBe(true);
    expect(snackbars).toEqual([]);
  });

  it('sends a long reply as ordered thread replies, files on the first', async () => {
    const log: SendLogEntry[] = [];
    await renderDialog({ initialFiles: [image], log });
    const value = longDoc(30);
    typeIntoComposer(value);
    const expectedParts = planReticulumDiscussionSplit(value).splitParts;
    expect(expectedParts).toBeGreaterThan(1);
    expect(screen.getByRole('status')).toHaveTextContent(
      `Long message: it will be sent as ${expectedParts} messages.`
    );

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(composer.editor.isEmpty).toBe(true), {
      timeout: 5000,
    });

    expect(log.filter((entry) => entry.refused)).toEqual([]);
    expect(log).toHaveLength(expectedParts as number);
    expect(log.map((entry) => entry.files)).toEqual([
      ['photo.webp'],
      ...Array.from({ length: log.length - 1 }, () => []),
    ]);
    for (const { draft } of log) {
      expect(draft.expiryDurationMs).toBe(ONE_DAY_MS);
      expect(parentAccepts(draft)).toBe(true);
      expect(draft.htmlContent).toBe(htmlOf(draft.messageText));
    }
    expect(
      log.map(({ draft }) => visibleText(draft.messageText)).join('')
    ).toBe(visibleText(value));
    expect(screen.queryByRole('status')).toBeNull();
    expect(composer.editor.isEditable).toBe(true);
    expect(snackbars).toEqual([]);
  });

  it('locks the composer and takes no attachment while a split reply goes out', async () => {
    const log: SendLogEntry[] = [];
    const states: Array<{ editable: boolean; insertFiles: unknown }> = [];
    await renderDialog({
      log,
      onSendStarted: () =>
        states.push({
          editable: composer.editor.isEditable,
          insertFiles: composer.props.insertFiles,
        }),
    });
    expect(typeof composer.props.insertFiles).toBe('function');
    typeIntoComposer(longDoc(30));
    const expectedParts = planReticulumDiscussionSplit(longDoc(30)).splitParts;

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(composer.editor.isEmpty).toBe(true), {
      timeout: 5000,
    });

    expect(states).toHaveLength(expectedParts as number);
    expect(states.every((state) => !state.editable)).toBe(true);
    // Every part after the first sees the composer re-rendered as locked.
    expect(states.slice(1).every((state) => !state.insertFiles)).toBe(true);
    expect(composer.editor.isEditable).toBe(true);
    expect(typeof composer.props.insertFiles).toBe('function');
  });

  it('keeps only the parts not sent when a later part fails', async () => {
    const log: SendLogEntry[] = [];
    await renderDialog({ failAtSend: 1, log });
    const value = longDoc(30);
    typeIntoComposer(value);
    const totalParts = planReticulumDiscussionSplit(value).splitParts as number;
    expect(totalParts).toBeGreaterThan(2);

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(log).toHaveLength(2), { timeout: 5000 });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        `Long message: it will be sent as ${totalParts - 1} messages.`
      )
    );

    expect(log.filter((entry) => entry.refused)).toEqual([]);
    const sentText = visibleText(log[0].draft.messageText);
    const leftText = visibleText(composer.editor.getJSON());
    expect(sentText + leftText).toBe(visibleText(value));
    await waitFor(() => expect(composer.editor.isEditable).toBe(true));
    // The parent already reported its own failure.
    expect(snackbars).toEqual([]);
  });

  it('still sends every part when the thread closes mid-send', async () => {
    const log: SendLogEntry[] = [];
    await renderDialog({ closeDuringFirstSend: true, log });
    const value = longDoc(30);
    typeIntoComposer(value);
    const totalParts = planReticulumDiscussionSplit(value).splitParts as number;

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(log).toHaveLength(totalParts), {
      timeout: 5000,
    });

    // The handler held at Send keeps its thread root, as a single reply in
    // flight always did, so nothing is refused or lost.
    expect(log.filter((entry) => entry.refused)).toEqual([]);
    expect(log.every((entry) => entry.rootId === 'root-1')).toBe(true);
    expect(
      log.map(({ draft }) => visibleText(draft.messageText)).join('')
    ).toBe(visibleText(value));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(snackbars).toEqual([]);
  });

  it('says so when a reply with files cannot go on after the thread closed', async () => {
    const log: SendLogEntry[] = [];
    await renderDialog({
      closeDuringFirstSend: true,
      initialFiles: [image],
      log,
    });
    typeIntoComposer(longDoc(30));

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(snackbars).toHaveLength(1), { timeout: 5000 });

    // The first part went out with the files; no handler that would attach
    // them again, or refuse, was called for the rest.
    expect(log).toHaveLength(1);
    expect(log[0].files).toEqual(['photo.webp']);
    expect(snackbars[0]).toEqual({ message: 'Failed to send', type: 'error' });
  });

  it('never sends a later part through the stale handler that holds the files', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const log: SendLogEntry[] = [];
    // A parent that never re-renders its handler: it keeps the files.
    const StaleParent = () => {
      const onSendRef = useRef<ReticulumDiscussionSender>(async (draft) => {
        log.push({
          draft,
          files: ['photo.webp'],
          refused: false,
          rootId: 'root-1',
        });
        return true;
      });
      return (
        <ReticulumDiscussionDialog
          canWrite
          compressingGif={false}
          files={[image]}
          loading={false}
          membersWithNames={[]}
          messages={[]}
          myAddress="Qme"
          onClose={() => undefined}
          onPreferredExpiryChange={() => undefined}
          onRemoveFile={() => undefined}
          onSelectFiles={() => undefined}
          onSend={onSendRef.current}
          onTypingChange={() => undefined}
          open
          preferredExpiryDurationMs={ONE_DAY_MS}
          preparingFile={false}
          replyCount={0}
          selectedGroup={7}
        />
      );
    };
    render(<StaleParent />);
    await waitFor(() => expect(composer.editor).not.toBeNull());
    const value = longDoc(30);
    typeIntoComposer(value);

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(log).toHaveLength(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await waitFor(() => expect(snackbars).toHaveLength(1));

    expect(log).toHaveLength(1);
    const leftText = visibleText(composer.editor.getJSON());
    expect(visibleText(log[0].draft.messageText) + leftText).toBe(
      visibleText(value)
    );
    expect(composer.editor.isEditable).toBe(true);
  });

  it('blocks a reply too long even split, with the reason', async () => {
    const log: SendLogEntry[] = [];
    await renderDialog({ log });
    typeIntoComposer(longDoc(MAX_SPLIT_MESSAGE_PARTS * 20));
    expect(screen.getByRole('alert')).toHaveTextContent(
      `This message is too long to send, even split into ${MAX_SPLIT_MESSAGE_PARTS} messages.`
    );

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(log).toEqual([]);
    expect(composer.editor.isEmpty).toBe(false);
  });
});

describe('ReticulumDiscussionDialog Android back', () => {
  afterEach(() => {
    composer.editor = null;
    composer.props = null;
  });

  it('closes the thread, not the chat under it', async () => {
    const onClose = vi.fn();
    const view = await renderDialog({ log: [], onClose });
    expect(pressAndroidBack()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(pressAndroidBack()).toBe(false);
  });

  it('does nothing while a reply is going out or a file is prepared', async () => {
    const onClose = vi.fn();
    await renderDialog({ log: [], onClose, preparingFile: true });
    expect(pressAndroidBack()).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does nothing mid-send and closes again once the reply is out', async () => {
    const onClose = vi.fn();
    const backResults: boolean[] = [];
    const log: SendLogEntry[] = [];
    let sends = 0;
    await renderDialog({
      log,
      onClose,
      // The first part starts in the same tick as the click, before any
      // back press could arrive; press while each later part goes out.
      onSendStarted: () => {
        sends += 1;
        if (sends > 1) backResults.push(pressAndroidBack());
      },
    });
    typeIntoComposer(longDoc(30));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    );
    backResults.push(pressAndroidBack());
    await waitFor(() => expect(composer.editor.isEmpty).toBe(true), {
      timeout: 5000,
    });
    expect(backResults.length).toBeGreaterThan(2);
    expect(backResults.every(Boolean)).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    );
    pressAndroidBack();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
