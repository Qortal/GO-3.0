/**
 * Local fix for Hub bug H1 (scratchpad note 02 §7) without editing
 * electron/src/group-call.ts.
 *
 * GroupCallManager caches verified GC_* signatures under `type:signature`
 * only (`gcSignatureCacheKey`) and, on a cache hit, applies join / join_rk /
 * link_auth_join / leave / topology / cluster_heartbeat envelopes WITHOUT
 * verifying them (`enqueueVerify`). Anyone who saw one valid signature can
 * replay it with another fromAddress / publicKey / destination / timestamp.
 *
 * Here every instance keeps the exact signed content behind each cached
 * signature. A cache hit whose signed fields differ from what was verified
 * evicts the entry, so the envelope goes through full Ed25519 verification
 * (and a forgery fails it). Genuine duplicates still hit the cache exactly as
 * on desktop (same dedupe semantics, e.g. the 7 repeated GC_KEY copies).
 */
type VerifyJobLike = { env?: { type?: unknown; signature?: unknown } };

type GroupCallManagerInternals = {
  verifiedGcSignatures: Map<string, true>;
  inFlightGcVerify: Map<string, unknown>;
  gcSignatureCacheKey(type: string, signature: string): string;
  enqueueVerify(
    fields: Record<string, unknown>,
    signature: string,
    fromPublicKey: string,
    fromAddress: string,
    job: VerifyJobLike
  ): void;
  rememberVerifiedGcSignature(type: string, signature: string): void;
};

const HARDENED = Symbol.for('qortal.go.gcSignatureCacheHardened');

function contentKey(
  fields: Record<string, unknown>,
  fromPublicKey: string
): string {
  // Same canonical form the signature covers (presence.ts
  // canonicalizeForSigning: top-level keys sorted, JSON.stringify).
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(fields).sort()) sorted[key] = fields[key];
  let canonical: string;
  try {
    canonical = JSON.stringify(sorted);
  } catch {
    // Unserialisable fields never match a cached entry.
    canonical = `unserialisable:${Math.random()}`;
  }
  return `${fromPublicKey}\n${canonical}`;
}

/**
 * Returns false (and changes nothing) when the manager's internals do not
 * look like Hub 3.0.3's — the caller should log that, the fix is then off.
 */
export function hardenGroupCallSignatureCache(manager: object): boolean {
  const mgr = manager as unknown as GroupCallManagerInternals &
    Record<symbol, boolean>;
  if (mgr[HARDENED]) return true;
  if (
    !(mgr.verifiedGcSignatures instanceof Map) ||
    !(mgr.inFlightGcVerify instanceof Map) ||
    typeof mgr.gcSignatureCacheKey !== 'function' ||
    typeof mgr.enqueueVerify !== 'function' ||
    typeof mgr.rememberVerifiedGcSignature !== 'function'
  ) {
    return false;
  }
  /** cache key → signed content that was actually verified */
  const verifiedContent = new Map<string, string>();
  /** cache key → content whose verification is in flight */
  const inFlightContent = new Map<string, string>();
  const originalEnqueue = mgr.enqueueVerify;
  const originalRemember = mgr.rememberVerifiedGcSignature;

  mgr.enqueueVerify = function enqueueVerify(
    this: GroupCallManagerInternals,
    fields,
    signature,
    fromPublicKey,
    fromAddress,
    job
  ) {
    const type = typeof job?.env?.type === 'string' ? job.env.type : '';
    const envSignature =
      typeof job?.env?.signature === 'string' ? job.env.signature : signature;
    const key = this.gcSignatureCacheKey(type, envSignature);
    const content = contentKey(fields, fromPublicKey);
    if (this.verifiedGcSignatures.has(key)) {
      if (verifiedContent.get(key) !== content) {
        // Same signature, different signed fields: never trust the cache.
        this.verifiedGcSignatures.delete(key);
        verifiedContent.delete(key);
      }
    } else if (this.inFlightGcVerify.has(key)) {
      if (inFlightContent.get(key) !== content) {
        // Dropped by the manager (in flight); nothing to record.
        return originalEnqueue.call(
          this,
          fields,
          signature,
          fromPublicKey,
          fromAddress,
          job
        );
      }
    }
    if (
      !this.verifiedGcSignatures.has(key) &&
      !this.inFlightGcVerify.has(key)
    ) {
      inFlightContent.set(key, content);
      if (inFlightContent.size > 2_048) {
        // Failed or skipped verifications never reach remember(); drop them.
        for (const pending of [...inFlightContent.keys()]) {
          if (pending !== key && !this.inFlightGcVerify.has(pending)) {
            inFlightContent.delete(pending);
          }
        }
      }
    }
    return originalEnqueue.call(
      this,
      fields,
      signature,
      fromPublicKey,
      fromAddress,
      job
    );
  };

  mgr.rememberVerifiedGcSignature = function rememberVerifiedGcSignature(
    this: GroupCallManagerInternals,
    type,
    signature
  ) {
    const key = this.gcSignatureCacheKey(type, signature);
    const content = inFlightContent.get(key);
    inFlightContent.delete(key);
    if (content === undefined) {
      // Unknown content: do not let the signature-only cache vouch for it.
      verifiedContent.delete(key);
      return;
    }
    originalRemember.call(this, type, signature);
    verifiedContent.set(key, content);
    if (verifiedContent.size > this.verifiedGcSignatures.size + 256) {
      for (const cached of [...verifiedContent.keys()]) {
        if (!this.verifiedGcSignatures.has(cached)) {
          verifiedContent.delete(cached);
        }
      }
    }
  };

  mgr[HARDENED] = true;
  return true;
}
