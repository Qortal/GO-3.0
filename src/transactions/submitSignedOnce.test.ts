import { describe, expect, it, vi } from 'vitest';

vi.mock('i18next', () => ({
  default: { t: (key: string) => key },
}));

import {
  submitSignedTransactionOnce,
  TransactionNotConfirmedError,
  TransactionRejectedError,
} from './submitSignedOnce';

const TX = { signedBytes58: 'SIGNED_BYTES', signature58: 'SIG_A' };
const RECORD = { signature: 'SIG_A', type: 'TRANSFER_ASSET', amount: '1' };

function deps({
  submit,
  lookup = async () => null,
}: {
  submit: (bytes: string) => Promise<unknown>;
  lookup?: (signature: string) => Promise<unknown>;
}) {
  return {
    submit: vi.fn(submit),
    lookup: vi.fn(lookup),
    sleep: vi.fn(async () => undefined),
  };
}

/** Replies in order; an Error entry is thrown instead of returned. */
function replies(...values: unknown[]) {
  let index = 0;
  return async () => {
    const value = values[Math.min(index, values.length - 1)];
    index++;
    if (value instanceof Error) throw value;
    return value;
  };
}

describe('submitSignedTransactionOnce (N-24)', () => {
  it('returns the node reply when it carries the signature', async () => {
    const d = deps({ submit: replies(RECORD) });
    await expect(submitSignedTransactionOnce(TX, d)).resolves.toBe(RECORD);
    expect(d.submit).toHaveBeenCalledTimes(1);
    expect(d.lookup).not.toHaveBeenCalled();
    expect(d.sleep).not.toHaveBeenCalled();
  });

  it('after a lost reply, finds the transfer by signature instead of sending again', async () => {
    const d = deps({
      submit: replies(new TypeError('Failed to fetch')),
      lookup: async () => RECORD,
    });
    await expect(submitSignedTransactionOnce(TX, d)).resolves.toBe(RECORD);
    expect(d.submit).toHaveBeenCalledTimes(1);
    expect(d.lookup).toHaveBeenCalledWith('SIG_A');
  });

  it('resends only the same signed bytes when the node does not know it', async () => {
    const d = deps({
      submit: replies(new TypeError('Failed to fetch'), '<html>502</html>', {
        ...RECORD,
      }),
    });
    await expect(
      submitSignedTransactionOnce(TX, d, { retryDelayMs: 5 })
    ).resolves.toMatchObject({ signature: 'SIG_A' });
    expect(d.submit).toHaveBeenCalledTimes(3);
    for (const call of d.submit.mock.calls) {
      expect(call[0]).toBe('SIGNED_BYTES');
    }
    expect(d.sleep).toHaveBeenCalledWith(5);
    expect(d.lookup).toHaveBeenCalledTimes(2);
  });

  it('accepts a transfer the node took while answering with an error', async () => {
    const d = deps({
      submit: replies({ error: 1234, message: 'INVALID' }),
      lookup: async () => RECORD,
    });
    await expect(submitSignedTransactionOnce(TX, d)).resolves.toBe(RECORD);
    expect(d.submit).toHaveBeenCalledTimes(1);
  });

  it('stops at a Core rejection without sending again', async () => {
    const d = deps({
      submit: replies({ error: 2, message: 'NO_BALANCE' }),
    });
    const result = submitSignedTransactionOnce(TX, d);
    await expect(result).rejects.toBeInstanceOf(TransactionRejectedError);
    await expect(result).rejects.toThrow('NO_BALANCE');
    expect(d.submit).toHaveBeenCalledTimes(1);
    expect(d.sleep).not.toHaveBeenCalled();
  });

  it('gives up after the set number of sends and names the signature', async () => {
    const d = deps({ submit: replies(new TypeError('Failed to fetch')) });
    const result = submitSignedTransactionOnce(TX, d, { attempts: 3 });
    await expect(result).rejects.toBeInstanceOf(TransactionNotConfirmedError);
    await expect(result).rejects.toMatchObject({
      message: 'question:message.error.transfer_not_confirmed',
      signature: 'SIG_A',
      detail: 'Failed to fetch',
    });
    expect(d.submit).toHaveBeenCalledTimes(3);
    // Before each resend, and once more at the end.
    expect(d.lookup).toHaveBeenCalledTimes(3);
    expect(d.sleep).toHaveBeenCalledTimes(3);
  });

  it('waits before the last lookup, so a late arrival counts as sent', async () => {
    let sent = 0;
    const d = deps({
      submit: async () => {
        sent++;
        throw new TypeError('Failed to fetch');
      },
      // The node only knows the transfer after the last send.
      lookup: async () => (sent >= 2 ? RECORD : null),
    });
    await expect(
      submitSignedTransactionOnce(TX, d, { attempts: 2, retryDelayMs: 7 })
    ).resolves.toBe(RECORD);
    expect(d.submit).toHaveBeenCalledTimes(2);
    expect(d.sleep).toHaveBeenCalledTimes(2);
    expect(d.sleep).toHaveBeenLastCalledWith(7);
  });

  it('does not treat a reply or record for another signature as this transfer', async () => {
    const other = { signature: 'SIG_B' };
    const d = deps({
      submit: replies(other),
      lookup: async () => other,
    });
    await expect(
      submitSignedTransactionOnce(TX, d, { attempts: 2 })
    ).rejects.toBeInstanceOf(TransactionNotConfirmedError);
    expect(d.submit).toHaveBeenCalledTimes(2);
  });

  it('treats a failing lookup as "not known"', async () => {
    const d = deps({
      submit: replies(new TypeError('offline'), RECORD),
      lookup: async () => {
        throw new TypeError('offline');
      },
    });
    await expect(submitSignedTransactionOnce(TX, d)).resolves.toBe(RECORD);
    expect(d.submit).toHaveBeenCalledTimes(2);
  });

  it('uses the fallback message for a refusal that does not explain itself', async () => {
    const d = deps({ submit: replies({ error: 2 }) });
    await expect(
      submitSignedTransactionOnce(TX, d, { attempts: 1 })
    ).rejects.toThrow('question:message.error.process_transaction');
  });

  it('never shows an HTML or plain-text body as the error', async () => {
    const html = '<html><body>502 Bad Gateway</body></html>';
    const rejected = deps({ submit: replies({ error: 2, message: html }) });
    await expect(
      submitSignedTransactionOnce(TX, rejected, { attempts: 1 })
    ).rejects.toThrow('question:message.error.process_transaction');

    const lost = deps({ submit: replies(html) });
    const result = submitSignedTransactionOnce(TX, lost, { attempts: 1 });
    await expect(result).rejects.toBeInstanceOf(TransactionNotConfirmedError);
    await expect(result).rejects.toMatchObject({
      message: 'question:message.error.transfer_not_confirmed',
      detail: '',
    });
  });

  it('after a resend, treats a refusal as "may have been sent" and looks again', async () => {
    const d = deps({
      submit: replies(new TypeError('Failed to fetch'), {
        error: 1000,
        message: 'NO_BALANCE',
      }),
    });
    const result = submitSignedTransactionOnce(TX, d, { attempts: 3 });
    await expect(result).rejects.toBeInstanceOf(TransactionNotConfirmedError);
    await expect(result).rejects.toMatchObject({ detail: 'NO_BALANCE' });
    // No third send after the refusal; one lookup before the resend, one
    // after the refusal and one after waiting.
    expect(d.submit).toHaveBeenCalledTimes(2);
    expect(d.lookup).toHaveBeenCalledTimes(3);
    expect(d.sleep).toHaveBeenCalledTimes(2);
  });

  it('"transaction already exists" waits and finds the earlier send', async () => {
    let lookups = 0;
    const d = deps({
      submit: replies({ error: 1000, message: 'transaction already exists' }),
      lookup: async () => (++lookups >= 2 ? RECORD : null),
    });
    await expect(submitSignedTransactionOnce(TX, d)).resolves.toBe(RECORD);
    expect(d.submit).toHaveBeenCalledTimes(1);
    expect(d.sleep).toHaveBeenCalledTimes(1);
  });

  it('"transaction already exists" without a record is not a plain refusal', async () => {
    const d = deps({
      submit: replies({ error: 1000, message: 'TRANSACTION_ALREADY_EXISTS' }),
    });
    await expect(submitSignedTransactionOnce(TX, d)).rejects.toBeInstanceOf(
      TransactionNotConfirmedError
    );
    expect(d.submit).toHaveBeenCalledTimes(1);
  });
});
