import { act, render } from '@testing-library/react';
import i18n from 'i18next';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { subscribeToEvent, unsubscribeFromEvent } from '../../../utils/events';
import { ChatShareHost } from './ChatShareHost';
import { resetChatShareInbox, returnChatShare } from './chatShareInbox';
import { resetChatShareIntake, routeChatShare } from './chatShareIntake';
import { pendingChatShareAtom } from './chatShareState';

const ME = 'QdSnUy6sUiEnaN87dWmE92g1uQjrvPgrWG';
const OTHER = 'QZ3oBnvd1T3xqAkx3pXvTyrvAwGVhtsdM8';

let store: ReturnType<typeof createStore>;

const renderHost = (account = ME) => {
  const view = render(
    <Provider store={store}>
      <ChatShareHost account={account} />
    </Provider>
  );
  return {
    ...view,
    switchTo: (next: string) =>
      view.rerender(
        <Provider store={store}>
          <ChatShareHost account={next} />
        </Provider>
      ),
  };
};

const listen = (name: string) => {
  const calls: unknown[] = [];
  const handler = (event: Event) => calls.push((event as CustomEvent).detail);
  subscribeToEvent(name, handler);
  return { calls, stop: () => unsubscribeFromEvent(name, handler) };
};

beforeAll(async () => {
  // The notices are worded through the app's i18next instance.
  if (!i18n.isInitialized) {
    await i18n.init({
      lng: 'en',
      resources: {
        en: {
          reticulum: {
            share: { notice_unreadable: 'the shared file could not be read.' },
          },
        },
      },
    });
  }
});

beforeEach(() => {
  store = createStore();
});

afterEach(() => {
  resetChatShareIntake();
  resetChatShareInbox();
});

describe('ChatShareHost', () => {
  it('puts a share up for the chat lists', () => {
    renderHost();
    act(() =>
      routeChatShare({
        target: 'chats:directs',
        items: [],
        text: 'https://qortal.dev',
      })
    );
    const share = store.get(pendingChatShareAtom);
    expect(share?.scope).toBe('directs');
    expect(share?.text).toBe('https://qortal.dev');
  });

  it('takes a share that came before it mounted (cold start)', () => {
    routeChatShare({ target: 'chats:self', items: [], text: 'note' });
    renderHost();
    expect(store.get(pendingChatShareAtom)?.scope).toBe('self');
  });

  it('a newer share replaces the waiting one', () => {
    renderHost();
    act(() =>
      routeChatShare({ target: 'chats:groups', items: [], text: 'first' })
    );
    act(() =>
      routeChatShare({ target: 'chats:directs', items: [], text: 'second' })
    );
    expect(store.get(pendingChatShareAtom)?.text).toBe('second');
  });

  it('says why when nothing usable came, and puts nothing up', () => {
    const snacks = listen('openGlobalSnackBar');
    renderHost();
    act(() =>
      routeChatShare({
        target: 'chats:groups',
        items: [],
        unreadableCount: 1,
      })
    );
    expect(store.get(pendingChatShareAtom)).toBeNull();
    expect(snacks.calls).toEqual([
      { message: 'the shared file could not be read.', type: 'error' },
    ]);
    snacks.stop();
  });

  it('puts a share a chat handed back up again', () => {
    renderHost();
    act(() =>
      routeChatShare({ target: 'chats:groups', items: [], text: 'hi' })
    );
    const share = store.get(pendingChatShareAtom);
    act(() => store.set(pendingChatShareAtom, null));
    act(() => returnChatShare(share!));
    expect(store.get(pendingChatShareAtom)).toBe(share);
    // Anything that is not a whole share is ignored.
    act(() => store.set(pendingChatShareAtom, null));
    act(() =>
      returnChatShare({ text: 'x', files: Promise.resolve([]), notices: [] })
    );
    expect(store.get(pendingChatShareAtom)).toBeNull();
  });

  it('drops the waiting share on an account switch or sign-out', () => {
    const { switchTo, unmount } = renderHost();
    act(() =>
      routeChatShare({ target: 'chats:groups', items: [], text: 'hi' })
    );
    expect(store.get(pendingChatShareAtom)).not.toBeNull();
    act(() => switchTo(OTHER));
    expect(store.get(pendingChatShareAtom)).toBeNull();

    act(() =>
      routeChatShare({ target: 'chats:groups', items: [], text: 'again' })
    );
    expect(store.get(pendingChatShareAtom)?.text).toBe('again');
    unmount();
    expect(store.get(pendingChatShareAtom)).toBeNull();
  });
});
