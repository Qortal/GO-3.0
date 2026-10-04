import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  QAPP_MESSAGES_ALLOWED_WHILE_LOCKED,
  createQappRequestLockGate,
  type QappRequestLockGate,
} from './appLockQappGate';

type FakePort = { postMessage: ReturnType<typeof vi.fn> };

/** A Q-App request as the Q-App's parent frame receives it. */
const qappRequest = (
  action: string,
  options: { port?: FakePort; source?: unknown } = {}
) => {
  const event = new MessageEvent('message', {
    data: { action, requestedHandler: 'UI', requestId: 'r1' },
    origin: 'http://127.0.0.1:12391',
  });
  // jsdom has no MessagePort; GO only calls postMessage on it.
  Object.defineProperty(event, 'ports', {
    value: options.port ? [options.port] : [],
  });
  Object.defineProperty(event, 'source', { value: options.source ?? {} });
  return event;
};

const addFrame = () => {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  return frame.contentWindow as Window;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let gate: QappRequestLockGate | null = null;
const cleanups: Array<() => void> = [];

/** What useQortalMessageListener does: a plain listener on the frame window. */
const listenAsGo = (win: Window) => {
  const handler = vi.fn();
  win.addEventListener('message', handler);
  cleanups.push(() => win.removeEventListener('message', handler));
  return handler;
};

const setup = (locked = true) => {
  const state = { locked };
  gate = createQappRequestLockGate({
    isLocked: () => state.locked,
    lockedMessage: () => 'GO is locked. Unlock it and try again.',
  });
  return state;
};

afterEach(() => {
  gate?.release();
  gate = null;
  cleanups.splice(0).forEach((undo) => undo());
  document.body.innerHTML = '';
});

describe('Q-App request lock gate (GO-04)', () => {
  it('refuses a Q-App request while locked and answers it with an error', () => {
    const frameWindow = addFrame();
    const handler = listenAsGo(frameWindow);
    setup(true);
    gate!.engage();

    const port = { postMessage: vi.fn() };
    frameWindow.dispatchEvent(qappRequest('SEND_COIN', { port }));

    expect(handler).not.toHaveBeenCalled();
    expect(port.postMessage).toHaveBeenCalledWith({
      result: null,
      error: {
        error: 'GO is locked. Unlock it and try again.',
        message: 'GO is locked. Unlock it and try again.',
      },
    });
  });

  it('refuses silent requests too: reads with a saved grant, signing', () => {
    const frameWindow = addFrame();
    const handler = listenAsGo(frameWindow);
    setup(true);
    gate!.engage();
    for (const action of [
      'GET_USER_ACCOUNT',
      'SIGN_FOREIGN_FEES',
      'SAVE_FILE',
      'SET_TAB',
      'PUBLISH_QDN_RESOURCE',
    ]) {
      frameWindow.dispatchEvent(qappRequest(action));
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('lets navigation reports through, so the tab keeps its address', () => {
    const frameWindow = addFrame();
    const handler = listenAsGo(frameWindow);
    setup(true);
    gate!.engage();
    QAPP_MESSAGES_ALLOWED_WHILE_LOCKED.forEach((action) =>
      frameWindow.dispatchEvent(qappRequest(action))
    );
    expect(handler).toHaveBeenCalledTimes(
      QAPP_MESSAGES_ALLOWED_WHILE_LOCKED.size
    );
  });

  it('ignores messages that are not Q-App requests', () => {
    const handler = listenAsGo(window);
    setup(true);
    gate!.engage();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { action: 'decryptWallet', type: 'backgroundMessage' },
      })
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('passes everything once unlocked, and removes its listeners on release', () => {
    const frameWindow = addFrame();
    const handler = listenAsGo(frameWindow);
    const state = setup(true);
    gate!.engage();
    state.locked = false;
    frameWindow.dispatchEvent(qappRequest('GET_USER_ACCOUNT'));
    expect(handler).toHaveBeenCalledTimes(1);

    state.locked = true;
    gate!.release();
    frameWindow.dispatchEvent(qappRequest('GET_USER_ACCOUNT'));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('also covers a Q-App frame that appears while locked', async () => {
    setup(true);
    gate!.engage();
    const frameWindow = addFrame();
    const handler = listenAsGo(frameWindow);
    await flush();
    frameWindow.dispatchEvent(qappRequest('GET_USER_ACCOUNT'));
    expect(handler).not.toHaveBeenCalled();
  });
});
