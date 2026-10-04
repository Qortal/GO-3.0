import { describe, expect, it } from 'vitest';
import {
  APPROVAL_EXPIRY_MARGIN_MS,
  APPROVAL_TIMEOUT_MS,
  acceptedPermissionResult,
  approvalCheckbox1Default,
  approvalExpiry,
  approvalNeedsConfirm,
  approvalSecondsLeft,
  buildApprovalDialogMessage,
  isApprovalAcceptable,
  requestingAppFromAppInfo,
} from './qappApproval';

const NOW = 1_700_000_000_000;

describe('requestingAppFromAppInfo (GO-28)', () => {
  it('takes name and service from appInfo', () => {
    expect(
      requestingAppFromAppInfo({ name: 'Q-Wallets', service: 'APP', tabId: 1 })
    ).toEqual({ name: 'Q-Wallets', service: 'APP' });
  });

  it('returns null without a usable name', () => {
    expect(requestingAppFromAppInfo(null)).toBeNull();
    expect(requestingAppFromAppInfo(undefined)).toBeNull();
    expect(requestingAppFromAppInfo('Q-Wallets')).toBeNull();
    expect(requestingAppFromAppInfo({ service: 'APP' })).toBeNull();
    expect(requestingAppFromAppInfo({ name: 42 })).toBeNull();
    expect(requestingAppFromAppInfo({ name: '  ​ ' })).toBeNull();
  });

  it('removes characters that hide or reorder part of the name', () => {
    const app = requestingAppFromAppInfo({
      name: 'Evil‮​stellaW-Q\u0007⁦',
      service: 'APP',
    });
    expect(app?.name).toBe('EvilstellaW-Q');
  });

  it('removes fillers, joiners, selectors and tags that draw nothing', () => {
    const hidden = [
      '\u034f', // combining grapheme joiner
      '\u115f', // Hangul choseong filler
      '\u3164', // Hangul filler
      '\uffa0', // halfwidth Hangul filler
      '\ufe0f', // variation selector
      '\u2800', // Braille blank
      '\u{e0041}', // tag character
      '\u{e007f}', // cancel tag
      '\u{1d173}', // musical symbol format character
    ];
    const app = requestingAppFromAppInfo({
      name: `${hidden.join('')}Q-${hidden.join('')}Wallets${hidden.join('')}`,
      service: 'APP',
    });
    expect(app?.name).toBe('Q-Wallets');
    // A name made only of them is no name.
    expect(requestingAppFromAppInfo({ name: hidden.join('') })).toBeNull();
    // Visible text outside the basic plane stays.
    expect(requestingAppFromAppInfo({ name: 'Q-\u{1f600}' })?.name).toBe(
      'Q-\u{1f600}'
    );
  });

  it('names GO itself only for its own internal requests', () => {
    expect(
      requestingAppFromAppInfo({ name: 'Anything', internal: true })
    ).toEqual({ name: '', service: null, internal: true });
    expect(
      requestingAppFromAppInfo({ name: 'Q-Wallets', internal: 'true' })
    ).toEqual({ name: 'Q-Wallets', service: null });
  });

  it('shortens a very long name', () => {
    const app = requestingAppFromAppInfo({ name: 'A'.repeat(200) });
    expect(Array.from(app!.name)).toHaveLength(49);
    expect(app!.name.endsWith('…')).toBe(true);
  });

  it('keeps only a plain service code', () => {
    expect(requestingAppFromAppInfo({ name: 'x', service: 'website' })).toEqual(
      { name: 'x', service: 'WEBSITE' }
    );
    expect(
      requestingAppFromAppInfo({ name: 'x', service: 'APP<script>' })?.service
    ).toBeNull();
    expect(requestingAppFromAppInfo({ name: 'x' })?.service).toBeNull();
  });
});

describe('buildApprovalDialogMessage (GO-28)', () => {
  it('names the app from appInfo and drops attribution in the payload', () => {
    const message = buildApprovalDialogMessage(
      {
        text1: 'Send coins',
        appName: 'Q-Wallets',
        sourceKind: 'GO',
        sourceLabel: 'Q-Wallets',
        requestingApp: { name: 'Q-Wallets', service: 'APP' },
        expiresAt: NOW + 10 * 60_000,
      },
      { name: 'Evil-App', service: 'APP' },
      NOW + 30_000,
      NOW
    );
    expect(message.text1).toBe('Send coins');
    expect(message.requestingApp).toEqual({ name: 'Evil-App', service: 'APP' });
    expect(message.appName).toBeUndefined();
    expect(message.sourceKind).toBeUndefined();
    expect(message.sourceLabel).toBeUndefined();
    expect(message.expiresAt).toBe(NOW + 30_000);
  });

  it('never takes the internal mark from the payload', () => {
    const message = buildApprovalDialogMessage(
      { text1: 'Send', requestingApp: { name: '', internal: true } },
      null,
      undefined,
      NOW
    );
    expect(message.requestingApp).toBeNull();
  });

  it('has no app when appInfo is missing, whatever the payload says', () => {
    const message = buildApprovalDialogMessage(
      { text1: 'x', appName: 'Q-Wallets' },
      undefined,
      undefined,
      NOW
    );
    expect(message.requestingApp).toBeNull();
    expect(message.appName).toBeUndefined();
  });

  it('copies the payload instead of changing it', () => {
    const payload = { text1: 'x', appName: 'Q-Wallets' };
    buildApprovalDialogMessage(payload, null, undefined, NOW);
    expect(payload.appName).toBe('Q-Wallets');
  });

  it('accepts a missing or odd payload', () => {
    expect(buildApprovalDialogMessage(null, null, null, NOW).text1).toBe(
      undefined
    );
    expect(
      Object.keys(buildApprovalDialogMessage(['a'], null, null, NOW))
    ).toEqual(['requestingApp', 'expiresAt']);
  });
});

describe('deadline', () => {
  it('uses the requester deadline, never later than a full timeout', () => {
    expect(approvalExpiry(NOW + 20_000, NOW)).toBe(NOW + 20_000);
    expect(approvalExpiry(NOW + 10 * 60_000, NOW)).toBe(
      NOW + APPROVAL_TIMEOUT_MS
    );
    expect(approvalExpiry(undefined, NOW)).toBe(NOW + APPROVAL_TIMEOUT_MS);
    expect(approvalExpiry(Number.NaN, NOW)).toBe(NOW + APPROVAL_TIMEOUT_MS);
    expect(approvalExpiry('soon', NOW)).toBe(NOW + APPROVAL_TIMEOUT_MS);
  });

  it('counts down whole seconds and stops a moment before the requester', () => {
    const expiresAt = NOW + 60_000;
    expect(approvalSecondsLeft(expiresAt, NOW)).toBe(59);
    expect(
      approvalSecondsLeft(expiresAt, expiresAt - APPROVAL_EXPIRY_MARGIN_MS)
    ).toBe(0);
    expect(approvalSecondsLeft(expiresAt, expiresAt + 5_000)).toBe(0);
  });
});

describe('accepting (GO-28)', () => {
  const plain = { text1: 'Get your address' };
  const ticked = { text1: 'Send coins', confirmCheckbox: true };

  it('answers only the request that is on screen', () => {
    expect(
      isApprovalAcceptable(plain, 2, { requestId: 2, confirmed: false })
    ).toBe(true);
    expect(
      isApprovalAcceptable(plain, 3, { requestId: 2, confirmed: false })
    ).toBe(false);
    expect(
      isApprovalAcceptable(plain, null, { requestId: null, confirmed: false })
    ).toBe(false);
    expect(isApprovalAcceptable(plain, 2, null)).toBe(false);
  });

  it('needs the tick when the request asks for it', () => {
    expect(approvalNeedsConfirm(ticked)).toBe(true);
    expect(approvalNeedsConfirm(plain)).toBe(false);
    expect(
      isApprovalAcceptable(ticked, 1, { requestId: 1, confirmed: false })
    ).toBe(false);
    expect(
      isApprovalAcceptable(ticked, 1, { requestId: 1, confirmed: true })
    ).toBe(true);
  });

  it("reports the request's own checkbox, and only when it has one", () => {
    const withBox = { checkbox1: { value: true, label: 'Always allow' } };
    expect(approvalCheckbox1Default(withBox)).toBe(true);
    expect(approvalCheckbox1Default({ checkbox1: { value: 'yes' } })).toBe(
      false
    );
    expect(approvalCheckbox1Default(plain)).toBe(false);
    expect(
      acceptedPermissionResult(withBox, {
        requestId: 1,
        checkbox1: false,
        confirmed: false,
      })
    ).toEqual({ accepted: true, checkbox1: false });
    expect(
      acceptedPermissionResult(plain, {
        requestId: 1,
        checkbox1: true,
        confirmed: false,
      })
    ).toEqual({ accepted: true });
  });
});
