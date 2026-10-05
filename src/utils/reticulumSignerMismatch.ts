import i18n from '../i18n/i18n';

/**
 * Builds the error shown when the background signer returns a different Qortal
 * address than the account the UI believes it is acting for.
 *
 * The bare "author mismatch" text gave field reports nothing to go on. The
 * message now carries the two (abbreviated) addresses, and distinguishes a
 * signer that answered for another account from one that returned no address
 * at all.
 *
 * Signing for another account no longer means a broken saved entry: unlock,
 * session resume and the boot restore all refuse a key that is not the
 * account's own, and that unlock error already says to re-add the account.
 * What is left is stale session state (a send racing a logout or account
 * switch), so every case here asks for a fresh unlock. Telling the user to
 * remove the account would cost anyone without a seed phrase or backup it.
 */
export function describeSignerMismatch(
  signed: unknown,
  expectedAddress: string,
  label: string
): string {
  const record =
    signed && typeof signed === 'object'
      ? (signed as {
          authorAddress?: unknown;
          error?: unknown;
          message?: unknown;
        })
      : null;
  const signer =
    typeof record?.authorAddress === 'string' ? record.authorAddress : '';
  const expected = String(expectedAddress || '');
  const short = (value: string) =>
    value.length > 14 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value;
  // `sendMessageBackground` resolves signer failures as `{ error, message }`
  // instead of throwing, so the failure used to surface as a "mismatch". Show
  // the signer's own reason (wallet locked, timeout, bad key) when there is one.
  const failure =
    typeof record?.error === 'string' && record.error
      ? record.error
      : typeof record?.message === 'string' && record.message
        ? record.message
        : '';
  if (failure && !signer) {
    return i18n.t('auth:wallet_errors.signer.failed', {
      label,
      reason: failure,
      postProcess: 'capitalizeFirstChar',
    });
  }
  if (!record) {
    return i18n.t('auth:wallet_errors.signer.no_response', {
      label,
      account: short(expected),
      postProcess: 'capitalizeSentenceStarts',
    });
  }
  if (!signer) {
    return i18n.t('auth:wallet_errors.signer.no_address', {
      label,
      account: short(expected),
      postProcess: 'capitalizeSentenceStarts',
    });
  }
  return i18n.t('auth:wallet_errors.signer.account_key_mismatch', {
    label,
    account: short(expected),
    signer: short(signer),
    postProcess: 'capitalizeSentenceStarts',
  });
}
