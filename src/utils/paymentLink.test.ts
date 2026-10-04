import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleQortalDeepLink, parsePaymentTarget } from './paymentLink';

// Audit GO-21: a deep link (Android intent, QR code or gateway URL) whose path
// climbs out of /render/APP/<name>/ must not open a tab.
const ATTACK_LINKS = [
  'qortal://APP/Q-Wallets/../../../render/APP/Evil',
  'qortal://APP/Q-Wallets/..\\..\\..\\render\\APP/Evil',
  'qortal://APP/Q-Wallets/%2e%2e/%2e%2e/%2e%2e/render/APP/Evil',
  'qortal://APP/Q-Wallets/..;/..;/render/APP/Evil',
  'qortal://APP/Q-Wallets/..%2f..%2frender%2fAPP%2fEvil',
  'https://qortal.link/APP/Q-Wallets/..%5C..%5Crender%5CAPP%5CEvil',
  'https://qortal.link/APP/Q-Wallets/..;/..;/render/APP/Evil',
];

describe('qortal:// deep links and path traversal', () => {
  let opened: unknown[] = [];
  const onAddTab = (e: Event) => {
    opened.push((e as CustomEvent).detail?.data);
  };

  beforeEach(() => {
    opened = [];
    document.addEventListener('addTab', onAddTab);
  });

  afterEach(() => {
    document.removeEventListener('addTab', onAddTab);
  });

  it.each(ATTACK_LINKS)('refuses %s', (link) => {
    expect(parsePaymentTarget(link)).toEqual({ kind: 'none' });
    expect(handleQortalDeepLink(link)).toBe(false);
    expect(opened).toEqual([]);
  });

  it('opens an ordinary app link', () => {
    expect(handleQortalDeepLink('qortal://APP/Q-Tube/video/abc')).toBe(true);
    expect(opened).toEqual([
      {
        service: 'APP',
        name: 'Q-Tube',
        identifier: undefined,
        path: 'video/abc',
      },
    ]);
  });

  it('opens an ordinary gateway link', () => {
    expect(handleQortalDeepLink('https://qortal.link/WEBSITE/REON')).toBe(true);
    expect(opened).toEqual([
      { service: 'WEBSITE', name: 'REON', identifier: undefined, path: '' },
    ]);
  });

  it('keeps payment links working', () => {
    expect(
      parsePaymentTarget('qortal://pay?recipient=Alice&amount=1.5')
    ).toEqual({ kind: 'payment', recipient: 'Alice', amount: 1.5 });
  });
});
