import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildQappPublishUiScript,
  parseQappPublishUiReport,
  QAPP_PUBLISH_UI_MESSAGE_KEY,
  QAPP_PUBLISH_UI_RELEASE_DELAY_MS,
  QAPP_PUBLISH_UI_WATCH_MS,
  qappPublishUiCommand,
} from './qappPublishUi';

const GO_ORIGIN = 'https://localhost';
const NODE_LOCATION = { origin: 'http://127.0.0.1:12391' };

type Posted = { msg: Record<string, unknown>; origin: string };

/**
 * Runs the serialised helper the way it runs in a Q-App frame: `window` is
 * the frame (its top is GO), the document is jsdom's.
 */
function runInQappFrame({ isTop = false } = {}) {
  const posted: Posted[] = [];
  const listeners: ((event: unknown) => void)[] = [];
  const top = {
    postMessage: (msg: Record<string, unknown>, origin: string) =>
      posted.push({ msg, origin }),
  };
  const frame: Record<string, unknown> = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      if (type === 'message') listeners.push(listener);
    },
  };
  frame.top = isTop ? frame : top;
  frame.parent = isTop ? frame : top;
  new Function('window', 'location', buildQappPublishUiScript(GO_ORIGIN))(
    frame,
    NODE_LOCATION
  );
  const send = (
    command: 'hide' | 'release',
    jobId: string,
    { origin = GO_ORIGIN, source = top as unknown } = {}
  ) => {
    for (const listener of listeners) {
      listener({
        data: qappPublishUiCommand(command, jobId),
        origin,
        source,
      });
    }
  };
  return { posted, send, listeners };
}

/** An open MUI dialog as MUI draws it: a portal after the app's root. */
function addMuiDialog({
  progress = true,
  zIndex = 1300,
  className = 'MuiDialog-root MuiModal-root',
} = {}) {
  const root = document.createElement('div');
  root.setAttribute('role', 'presentation');
  root.className = className;
  root.style.position = 'fixed';
  root.style.zIndex = String(zIndex);
  root.innerHTML = `
    <div class="MuiBackdrop-root"></div>
    <div class="MuiDialog-container">
      <div role="dialog" class="MuiPaper-root">
        <h2>Publishing Status</h2>
        ${progress ? '<span role="progressbar" class="MuiLinearProgress-root"></span>' : ''}
        <button>Close</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  // What MUI does to the page under an open modal.
  document.getElementById('root')!.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = 'hidden';
  return root;
}

const reports = (posted: Posted[]) =>
  posted.map(({ msg, origin }) => ({
    event: msg.event,
    jobId: msg.jobId,
    layers: msg.layers,
    origin,
    marked: msg[QAPP_PUBLISH_UI_MESSAGE_KEY] === 1,
  }));

describe('Q-App publish window helper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.head.innerHTML = '';
    document.body.innerHTML =
      '<div id="root"><main><input id="search" /></main></div>';
    document.body.removeAttribute('style');
    // jsdom lays nothing out; every element counts as on screen.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 360,
      bottom: 640,
      width: 360,
      height: 640,
      toJSON: () => ({}),
    } as DOMRect);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('hides the app’s publish window and gives the page back', () => {
    const { posted, send } = runInQappFrame();
    const dialog = addMuiDialog();
    send('hide', 'job-1');
    expect(dialog.hasAttribute('data-go-publish-hidden')).toBe(true);
    expect((dialog as unknown as { inert: boolean }).inert).toBe(true);
    expect(document.getElementById('root')!.hasAttribute('aria-hidden')).toBe(
      false
    );
    expect(document.body.style.overflow).toBe('');
    expect(
      document.head.querySelector('style[data-go-publish-ui]')
    ).not.toBeNull();
    expect(reports(posted)).toEqual([
      {
        event: 'hidden',
        jobId: 'job-1',
        layers: 1,
        origin: GO_ORIGIN,
        marked: true,
      },
    ]);
  });

  it('hands the window back when the app still shows it after the publish', () => {
    const { posted, send } = runInQappFrame();
    const dialog = addMuiDialog();
    send('hide', 'job-1');
    send('release', 'job-1');
    // The app gets a moment to close it by itself first.
    vi.advanceTimersByTime(QAPP_PUBLISH_UI_RELEASE_DELAY_MS - 1);
    expect(dialog.hasAttribute('data-go-publish-hidden')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(dialog.hasAttribute('data-go-publish-hidden')).toBe(false);
    expect(dialog.hasAttribute('data-go-publish-reveal')).toBe(true);
    expect((dialog as unknown as { inert: boolean }).inert).toBe(false);
    expect(document.getElementById('root')!.getAttribute('aria-hidden')).toBe(
      'true'
    );
    expect(document.body.style.overflow).toBe('hidden');
    expect(reports(posted).map((r) => r.event)).toEqual(['hidden', 'revealed']);
  });

  it('leaves the page alone when the app closed its window itself', () => {
    const { posted, send } = runInQappFrame();
    const dialog = addMuiDialog();
    send('hide', 'job-1');
    // MUI closing its last modal puts the page back by itself.
    dialog.remove();
    document.getElementById('root')!.removeAttribute('aria-hidden');
    send('release', 'job-1');
    vi.advanceTimersByTime(QAPP_PUBLISH_UI_RELEASE_DELAY_MS);
    expect(document.body.style.overflow).toBe('');
    expect(document.getElementById('root')!.hasAttribute('aria-hidden')).toBe(
      false
    );
    expect(reports(posted).map((r) => r.event)).toEqual(['hidden', 'gone']);
  });

  it('hides nothing when the top window shows no progress', () => {
    const { posted, send } = runInQappFrame();
    const dialog = addMuiDialog({ progress: false });
    send('hide', 'job-1');
    vi.advanceTimersByTime(QAPP_PUBLISH_UI_WATCH_MS);
    expect(dialog.hasAttribute('data-go-publish-hidden')).toBe(false);
    expect(document.body.style.overflow).toBe('hidden');
    expect(reports(posted).map((r) => r.event)).toEqual(['none']);
  });

  it('finds a publish window the app draws a moment later', async () => {
    const { posted, send } = runInQappFrame();
    send('hide', 'job-1');
    const dialog = addMuiDialog();
    await Promise.resolve();
    vi.advanceTimersByTime(60);
    expect(dialog.hasAttribute('data-go-publish-hidden')).toBe(true);
    vi.advanceTimersByTime(QAPP_PUBLISH_UI_WATCH_MS);
    expect(reports(posted).map((r) => r.event)).toEqual(['hidden']);
  });

  it('takes the whole stack: the form under the publish window too', () => {
    const { send } = runInQappFrame();
    // qapp-core's window sits on top by z-index, though mounted first.
    const publishWindow = addMuiDialog({ zIndex: 999990 });
    const form = addMuiDialog({ progress: false });
    send('hide', 'job-1');
    expect(publishWindow.hasAttribute('data-go-publish-hidden')).toBe(true);
    expect(form.hasAttribute('data-go-publish-hidden')).toBe(true);
  });

  it('ignores menus and popovers', () => {
    const { posted, send } = runInQappFrame();
    const dialog = addMuiDialog();
    const menu = addMuiDialog({
      progress: false,
      className: 'MuiMenu-root MuiPopover-root MuiModal-root',
    });
    send('hide', 'job-1');
    expect(dialog.hasAttribute('data-go-publish-hidden')).toBe(true);
    expect(menu.hasAttribute('data-go-publish-hidden')).toBe(false);
    expect(reports(posted)[0].event).toBe('hidden');
  });

  it('never hides the app’s own root, even for a dialog drawn inside it', () => {
    const { posted, send } = runInQappFrame();
    const inline = document.createElement('div');
    inline.setAttribute('role', 'dialog');
    inline.setAttribute('aria-modal', 'true');
    inline.innerHTML = '<span role="progressbar"></span>';
    document.querySelector('main')!.appendChild(inline);
    send('hide', 'job-1');
    vi.advanceTimersByTime(QAPP_PUBLISH_UI_WATCH_MS);
    expect(
      document.getElementById('root')!.hasAttribute('data-go-publish-hidden')
    ).toBe(false);
    expect(reports(posted).map((r) => r.event)).toEqual(['none']);
  });

  it('hides an ARIA modal from another library’s portal', () => {
    const { send } = runInQappFrame();
    const portal = document.createElement('div');
    portal.innerHTML =
      '<div role="dialog" aria-modal="true"><progress></progress></div>';
    document.body.appendChild(portal);
    send('hide', 'job-1');
    expect(portal.hasAttribute('data-go-publish-hidden')).toBe(true);
  });

  it('only takes GO’s word', () => {
    const { posted, send } = runInQappFrame();
    const dialog = addMuiDialog();
    send('hide', 'job-1', { origin: 'http://127.0.0.1:12391' });
    send('hide', 'job-1', { source: {} });
    expect(dialog.hasAttribute('data-go-publish-hidden')).toBe(false);
    expect(posted).toHaveLength(0);
  });

  it('does nothing in GO’s own window', () => {
    const { listeners } = runInQappFrame({ isTop: true });
    expect(listeners).toHaveLength(0);
  });
});

describe('parseQappPublishUiReport', () => {
  it('accepts a well-formed report', () => {
    expect(
      parseQappPublishUiReport({
        [QAPP_PUBLISH_UI_MESSAGE_KEY]: 1,
        event: 'hidden',
        jobId: 'publish-1',
        layers: 2,
      })
    ).toEqual({ event: 'hidden', jobId: 'publish-1', layers: 2 });
  });

  it('rejects anything else', () => {
    expect(parseQappPublishUiReport(null)).toBeNull();
    expect(
      parseQappPublishUiReport({ event: 'hidden', jobId: 'publish-1' })
    ).toBeNull();
    expect(
      parseQappPublishUiReport({
        [QAPP_PUBLISH_UI_MESSAGE_KEY]: 1,
        event: 'explode',
        jobId: 'publish-1',
      })
    ).toBeNull();
    expect(
      parseQappPublishUiReport({
        [QAPP_PUBLISH_UI_MESSAGE_KEY]: 1,
        event: 'none',
        jobId: 7,
      })
    ).toBeNull();
  });
});
