import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getNotificationPanelDismissKey,
  getNotificationSeenKey,
} from '../atoms/global';
import {
  applyKnownPaymentSenders,
  formatPaymentAmount,
  isPaymentNotification,
  lookupPaymentSenderName,
  paymentAvatarPath,
  paymentSenderLabel,
  resetPaymentSenderNames,
  resolvePaymentSenders,
} from './paymentNotifications';

vi.mock('./globalApi', () => ({
  getBaseApiReactForPrimaryName: () => 'http://127.0.0.1:12391',
}));

// The shape Core 6.1.9 sends on /websockets/notifications.
const payment = (sender: string, signature = `sig-${sender}`) => ({
  type: 'notification',
  event: 'PAYMENT_RECEIVED',
  notificationId: 'payment-notification',
  data: {
    sender,
    recipient: 'QRecipientAddressxxxxxxxxxxxxxxxx',
    amount: '500.00000000',
    created: 1791232250748,
    signature,
  },
});

const SENDER = 'QiFUUj4GvfHTTuAhFseuoWZm3wYemqxSDn';

describe('payment notifications', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetPaymentSenderNames();
    fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url === `http://127.0.0.1:12391/names/primary/${SENDER}`
          ? { name: 'Alice Smith', owner: SENDER }
          : {},
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('recognises Core payment events only', () => {
    expect(isPaymentNotification(payment(SENDER))).toBe(true);
    expect(
      isPaymentNotification({ event: 'RESOURCE_PUBLISHED', data: {} })
    ).toBe(false);
    expect(isPaymentNotification({ event: 'PAYMENT_RECEIVED' })).toBe(false);
  });

  it('formats amounts without trailing zeros', () => {
    expect(formatPaymentAmount('500.00000000', 'en')).toBe('500');
    expect(formatPaymentAmount('0.10000000', 'en')).toBe('0.1');
    expect(formatPaymentAmount('1234.5', 'en')).toBe('1,234.5');
  });

  it('labels the sender by name, else a short address', () => {
    expect(paymentSenderLabel(payment(SENDER))).toBe('QiFUUj…xSDn');
    const named = payment(SENDER);
    (named.data as any).senderName = 'Alice Smith';
    expect(paymentSenderLabel(named)).toBe('Alice Smith');
  });

  it('builds the sender avatar path, or the Q-Wallets one', () => {
    expect(paymentAvatarPath('Alice Smith')).toBe(
      '/arbitrary/THUMBNAIL/Alice%20Smith/qortal_avatar?async=true'
    );
    expect(paymentAvatarPath('')).toBe(
      '/arbitrary/THUMBNAIL/Q-Wallets/qortal_avatar?async=true'
    );
  });

  it('writes the looked-up name and avatar onto payment items', async () => {
    const other = { event: 'RESOURCE_PUBLISHED', data: { identifier: 'x' } };
    const list = [
      payment(SENDER),
      payment('QNoNameAddressxxxxxxxxxxxxxxxxxxx'),
      other,
    ];

    // Before the lookup: the Q-Wallets icon, no name yet.
    const before = applyKnownPaymentSenders(list);
    expect(before[0].image).toBe(paymentAvatarPath(''));
    expect(before[2]).toBe(other);

    expect(await resolvePaymentSenders(before)).toBe(true);
    const after = applyKnownPaymentSenders(before);
    expect((after[0] as any).data.senderName).toBe('Alice Smith');
    expect(after[0].image).toBe(paymentAvatarPath('Alice Smith'));
    expect((after[1] as any).data.senderName).toBe('');
    expect(after[1].image).toBe(paymentAvatarPath(''));

    // Nothing new: the same array, so the atom does not change.
    expect(applyKnownPaymentSenders(after)).toBe(after);
    expect(await resolvePaymentSenders(after)).toBe(false);
  });

  it('asks the node once per sender', async () => {
    await Promise.all([
      lookupPaymentSenderName(SENDER),
      lookupPaymentSenderName(SENDER),
    ]);
    await lookupPaymentSenderName(SENDER);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a sender whose lookup failed', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await lookupPaymentSenderName(SENDER)).toBe('');
    expect(await lookupPaymentSenderName(SENDER)).toBe('Alice Smith');
  });

  it('can be swiped out of the bell by its signature', () => {
    const item = payment(SENDER, 'abc');
    expect(getNotificationPanelDismissKey(item)).toBe(
      getNotificationSeenKey(item)
    );
    expect(getNotificationPanelDismissKey(item)).toBe('PAYMENT_RECEIVED-abc');
  });
});
