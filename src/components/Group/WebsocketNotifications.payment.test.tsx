import { act, render } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extStateAtom,
  paymentNotificationsAtom,
  userInfoAtom,
} from '../../atoms/global';
import { resetPaymentSenderNames } from '../../utils/paymentNotifications';
import { WebSocketNotifications } from './WebsocketNotifications';

const mocks = vi.hoisted(() => ({
  fire: vi.fn(async (..._args: unknown[]) => undefined),
}));

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
  getBaseApiReactSocket: () => 'ws://localhost:12391',
}));
vi.mock('../../utils/globalApi', () => ({
  getBaseApiReactForPrimaryName: () => 'http://localhost:12391',
}));
vi.mock('../../background/background', () => ({
  fireOsNotificationPayment: mocks.fire,
  dismissOsNotificationByKey: vi.fn(),
}));
vi.mock('../../qortal/qortal-requests', () => ({
  getNotificationPermissionKey: (appName: string) => appName,
  getPermission: vi.fn(async () => false),
}));
vi.mock('../../assets/svgs/LogoSelected.svg', () => ({ default: 'logo' }));
vi.mock('../../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/platform')>()),
  isCapacitor: () => false,
}));

const ME = 'QmeAddressxxxxxxxxxxxxxxxxxxxxxxxx';
const PAYER = 'QiFUUj4GvfHTTuAhFseuoWZm3wYemqxSDn';

class FakeSocket {
  static last: FakeSocket | null = null;
  static OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  receive(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

const paymentEvent = (signature: string) => ({
  type: 'notification',
  event: 'PAYMENT_RECEIVED',
  notificationId: 'payment-notification',
  data: {
    sender: PAYER,
    recipient: ME,
    amount: '5.00000000',
    created: Date.now(),
    signature,
  },
});

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });

describe('WebSocketNotifications payments', () => {
  beforeEach(() => {
    resetPaymentSenderNames();
    mocks.fire.mockClear();
    FakeSocket.last = null;
    vi.stubGlobal('WebSocket', FakeSocket);
    (window as any).sendMessage = vi.fn(async () => null);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          url.includes('/names/primary/') ? { name: 'Alice' } : [],
      }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('alerts with the payer, their avatar and a Q-Wallets tap, and fills the bell', async () => {
    const store = createStore();
    store.set(userInfoAtom, { address: ME });
    store.set(extStateAtom, 'authenticated');
    render(
      <Provider store={store}>
        <WebSocketNotifications myAddress={ME} userName="me" />
      </Provider>
    );
    await flush();
    const socket = FakeSocket.last!;
    expect(socket).toBeTruthy();
    act(() => socket.onopen?.());

    act(() => socket.receive(paymentEvent('sig-1')));
    await flush();
    // Core repeats itself: still one alert.
    act(() => socket.receive(paymentEvent('sig-1')));
    await flush();

    expect(mocks.fire).toHaveBeenCalledTimes(1);
    const [, title, body, icon, link, payload, options] =
      mocks.fire.mock.calls[0];
    expect(title).toBe('Payment from Alice');
    expect(body).toBe('You received 5 QORT.');
    expect(icon).toBe(
      'http://localhost:12391/arbitrary/THUMBNAIL/Alice/qortal_avatar?async=true'
    );
    expect(link).toBeUndefined();
    expect(payload).toEqual({ openWallets: true });
    expect(options).toEqual({
      alertKey: 'payment-sig-1',
      fromAddress: PAYER,
      notificationType: 'payment',
    });

    const items = store.get(paymentNotificationsAtom);
    expect(items).toHaveLength(1);
    expect(items[0].data.senderName).toBe('Alice');
    expect(items[0].image).toBe(
      '/arbitrary/THUMBNAIL/Alice/qortal_avatar?async=true'
    );
  });
});
