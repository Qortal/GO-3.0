import { describe, expect, it, vi } from 'vitest';
import { TestWallet } from './testing/testWallet';
import { VerifyWorkerPool } from '../../reticulumChat/mobile/shims/verify-worker-pool';

vi.mock(
  'crypto',
  async () => await import('../../reticulumChat/mobile/shims/crypto')
);
vi.mock(
  '../../../electron/src/presence',
  async () => await import('../../reticulumChat/mobile/shims/presence-slim')
);

describe('verify-worker-pool shim (inline Ed25519 on GO)', () => {
  const wallet = new TestWallet(42);
  const fields = {
    type: 'GC_LEAVE',
    roomId: 'gcall-qortal-1',
    fromAddress: wallet.address,
    fromPublicKey: wallet.publicKey,
    timestamp: Date.now(),
  };
  const signature = wallet.sign(fields);

  it('verifies like the desktop pool fallback (signature + derived address)', async () => {
    const pool = new VerifyWorkerPool('gcall', 2, 64);
    pool.start();
    await expect(
      pool.verify({
        kind: 'gc',
        fields,
        signature,
        fromPublicKey: wallet.publicKey,
        fromAddress: wallet.address,
      })
    ).resolves.toBe(true);
    await expect(
      pool.verify({
        kind: 'gc',
        fields: { ...fields, timestamp: fields.timestamp + 1 },
        signature,
        fromPublicKey: wallet.publicKey,
        fromAddress: wallet.address,
      })
    ).resolves.toBe(false);
    // Address must derive from the key.
    await expect(
      pool.verify({
        kind: 'gc',
        fields,
        signature,
        fromPublicKey: wallet.publicKey,
        fromAddress: new TestWallet(43).address,
      })
    ).resolves.toBe(false);
    expect(pool.stats()).toMatchObject({ verified: 1, rejected: 2 });
    pool.stop();
  });

  it('resolves asynchronously, never inside the caller’s turn', async () => {
    const pool = new VerifyWorkerPool('call', 1, 1);
    let settled = false;
    const pending = pool
      .verify({
        kind: 'gc',
        fields,
        signature,
        fromPublicKey: wallet.publicKey,
        fromAddress: wallet.address,
      })
      .then(() => {
        settled = true;
      });
    await Promise.resolve();
    expect(settled).toBe(false);
    await pending;
    expect(settled).toBe(true);
  });
});
