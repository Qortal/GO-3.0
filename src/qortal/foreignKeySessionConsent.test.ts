import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllForeignKeyConsent,
  clearForeignKeyConsentForApp,
  clearForeignKeyConsentForTab,
  ensureForeignKeyConsent,
  foreignKeyConsentScope,
  hasForeignKeyConsent,
} from './foreignKeySessionConsent';

const scopeFor = (overrides: Record<string, unknown> = {}) =>
  foreignKeyConsentScope({
    tabId: 'tab-1',
    appName: 'Q-Wallets',
    address: 'QaddressA',
    node: 'https://mynode.example.com',
    coin: 'ARRR',
    ...overrides,
  });

afterEach(() => {
  clearAllForeignKeyConsent();
});

describe('foreignKeyConsentScope', () => {
  it('needs a tab, app, address and node', () => {
    expect(scopeFor()).not.toBeNull();
    expect(scopeFor({ tabId: undefined })).toBeNull();
    expect(scopeFor({ appName: '' })).toBeNull();
    expect(scopeFor({ address: undefined })).toBeNull();
    expect(scopeFor({ node: '' })).toBeNull();
  });

  it('accepts a numeric tab id', () => {
    expect(scopeFor({ tabId: 3 })).toMatchObject({ tabId: '3' });
  });
});

describe('ensureForeignKeyConsent', () => {
  it('asks once and then remembers an accepted consent', async () => {
    const prompt = vi.fn(async () => true);

    await expect(ensureForeignKeyConsent(scopeFor(), prompt)).resolves.toBe(
      true
    );
    await expect(ensureForeignKeyConsent(scopeFor(), prompt)).resolves.toBe(
      true
    );

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(hasForeignKeyConsent(scopeFor())).toBe(true);
  });

  it('does not remember a declined prompt', async () => {
    const prompt = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(ensureForeignKeyConsent(scopeFor(), prompt)).resolves.toBe(
      false
    );
    expect(hasForeignKeyConsent(scopeFor())).toBe(false);
    await expect(ensureForeignKeyConsent(scopeFor(), prompt)).resolves.toBe(
      true
    );
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it('shares one prompt between requests made at the same time', async () => {
    let answer: (value: boolean) => void = () => undefined;
    const prompt = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        })
    );

    const first = ensureForeignKeyConsent(scopeFor(), prompt);
    const second = ensureForeignKeyConsent(scopeFor(), prompt);
    answer(true);

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('forgets a prompt that threw, so the next request asks again', async () => {
    const prompt = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('dialog failed'))
      .mockResolvedValueOnce(true);

    await expect(ensureForeignKeyConsent(scopeFor(), prompt)).rejects.toThrow(
      'dialog failed'
    );
    await expect(ensureForeignKeyConsent(scopeFor(), prompt)).resolves.toBe(
      true
    );
  });

  it('asks every time when the request has no tab scope', async () => {
    const prompt = vi.fn(async () => true);

    await ensureForeignKeyConsent(null, prompt);
    await ensureForeignKeyConsent(null, prompt);

    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['another tab', { tabId: 'tab-2' }],
    ['another app', { appName: 'Q-Trade' }],
    ['another account', { address: 'QaddressB' }],
    ['another node', { node: 'https://other.example.com' }],
    [
      'another port on the same host',
      { node: 'https://mynode.example.com:8443' },
    ],
    ['plain http on the same host', { node: 'http://mynode.example.com' }],
    ['another coin', { coin: 'LTC' }],
  ])('asks again for %s', async (_label, overrides) => {
    await ensureForeignKeyConsent(scopeFor(), async () => true);
    expect(hasForeignKeyConsent(scopeFor(overrides))).toBe(false);
  });
});

describe('clearing consent', () => {
  it('clears everything for a closed tab', async () => {
    await ensureForeignKeyConsent(scopeFor(), async () => true);
    await ensureForeignKeyConsent(
      scopeFor({ tabId: 'tab-2' }),
      async () => true
    );

    clearForeignKeyConsentForTab('tab-1');

    expect(hasForeignKeyConsent(scopeFor())).toBe(false);
    expect(hasForeignKeyConsent(scopeFor({ tabId: 'tab-2' }))).toBe(true);
  });

  it('clears one app in a tab', async () => {
    await ensureForeignKeyConsent(scopeFor(), async () => true);
    await ensureForeignKeyConsent(
      scopeFor({ appName: 'Q-Trade' }),
      async () => true
    );

    clearForeignKeyConsentForApp('tab-1', 'q-wallets');

    expect(hasForeignKeyConsent(scopeFor())).toBe(false);
    expect(hasForeignKeyConsent(scopeFor({ appName: 'Q-Trade' }))).toBe(true);
  });
});
