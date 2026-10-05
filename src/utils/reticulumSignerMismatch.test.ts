import { afterEach, describe, expect, it } from 'vitest';
import i18n, { ensureLanguageLoaded } from '../i18n/i18n';
import { describeSignerMismatch } from './reticulumSignerMismatch';

const ACCOUNT = 'QbcSNSoNPkdn2MU1Zjp9rsC2y2mEfW24nS';
const SIGNER = 'Qh452hdAbCdEfGhJkLmNoPqRsTuV6xxvE';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('describeSignerMismatch', () => {
  it('asks for a fresh unlock when the wallet signed as another account', () => {
    const text = describeSignerMismatch(
      { authorAddress: SIGNER, signature: 'sig' },
      ACCOUNT,
      'DM'
    );
    expect(text).toBe(
      'The wallet signed as Qh452hd…6xxvE (DM, expected QbcSNSo…W24nS). Log out and unlock the wallet again.'
    );
    // Unlock already refuses a broken saved entry and gives the re-add
    // advice there; at send time the cause is stale session state, and
    // removing the account would lose it for anyone without a backup.
    expect(text).not.toMatch(/remove/i);
    expect(text).not.toMatch(/seed phrase/i);
  });

  it("shows the signer's own reason when it failed without an address", () => {
    expect(
      describeSignerMismatch(
        { error: 'Wallet not authenticated' },
        ACCOUNT,
        'Reticulum chat'
      )
    ).toBe('Signing failed (Reticulum chat): Wallet not authenticated');
    expect(describeSignerMismatch({ message: 'timeout' }, ACCOUNT, 'DM')).toBe(
      'Signing failed (DM): timeout'
    );
  });

  it('asks for a fresh unlock when the signer returned nothing', () => {
    const text = describeSignerMismatch(undefined, ACCOUNT, 'QortalLand');
    expect(text).toMatch(/no response/);
    expect(text).toContain('QbcSNSo…W24nS');
    expect(text).toMatch(/Log out and unlock the wallet again/);
  });

  it('asks for a fresh unlock when the signer returned no address', () => {
    const text = describeSignerMismatch({ signature: 'sig' }, ACCOUNT, 'DM');
    expect(text).toMatch(/no address/);
    expect(text).toContain('QbcSNSo…W24nS');
    expect(text).toMatch(/Log out and unlock the wallet again/);
  });

  it('is translated', async () => {
    // The German bundle loads lazily; wait until it is there.
    await ensureLanguageLoaded('de');
    await i18n.changeLanguage('de');
    const text = describeSignerMismatch(
      { authorAddress: SIGNER },
      ACCOUNT,
      'DM'
    );
    expect(text).toContain('QbcSNSo…W24nS');
    expect(text).toContain('Qh452hd…6xxvE');
    expect(text).toMatch(/entsperre das Wallet erneut/);
  });
});
