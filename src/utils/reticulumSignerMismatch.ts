/**
 * Builds the error shown when the background signer returns a different Qortal
 * address than the account the UI believes it is acting for.
 *
 * The bare "author mismatch" text gave field reports nothing to go on. The
 * message now carries the two (abbreviated) addresses so a report tells apart
 * a stale session for another account from a device deriving addresses wrongly,
 * and distinguishes both from the signer returning no address at all.
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
    return `Signing ${label} failed: ${failure}`;
  }
  if (!record) {
    return `Signed ${label} author mismatch: the signer returned no response (expected ${short(expected)}). Log out and unlock the wallet again.`;
  }
  if (!signer) {
    return `Signed ${label} author mismatch: the signer returned no address (expected ${short(expected)}). Log out and unlock the wallet again.`;
  }
  return `Signed ${label} author mismatch: signer ${short(signer)} ≠ account ${short(expected)}. Log out and unlock the wallet again.`;
}
