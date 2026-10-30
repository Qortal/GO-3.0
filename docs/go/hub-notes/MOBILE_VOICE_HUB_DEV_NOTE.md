# Native mobile voice calls are working with the Hub — one small Hub tweak away from complete

We've built a native Android Qortal client with **Reticulum voice calling that
interoperates with the desktop Hub**, and we're genuinely at the finish line. This is
the breakthrough: a phone and the Hub now hold a real RNS voice call. We just need one
small adjustment on the Hub side to make it work in both call directions.

## The breakthrough

**Hub → mobile calls work fully today — clean two‑way audio, low latency.** No Hub
changes were needed for this. The phone:

- captures mic audio, encodes Opus, and `QGAU`‑wraps frames byte‑for‑byte like the
  desktop peer;
- performs the `QGCCTL1` + signed `GC_JOIN` link‑auth handshake over the RNS audio
  link, and the **Hub verifies it and delivers `GC_KEY` over the link** — exactly as
  designed;
- carries audio both ways over the verified Reticulum link.

In other words, the entire wire protocol — audio framing, Ed25519 link‑auth
signatures, key delivery, RNS link transport — is already correct and the Hub already
accepts it. That's the hard part, and it's done.

## The one remaining gap

**Mobile‑initiated calls** (phone → Hub) get stuck on the Hub showing "connecting…"
and drop after a few seconds, even though the phone is already "in call", sending audio,
and sending the same signed link‑auth the Hub happily accepts in the other direction.

We traced it through `electron/src/group-call.ts`, and it is **not** a protocol or
signature problem — the join verifies. It's a small **ordering precondition**:

- The audio‑link owner is chosen by address ordering
  (`isLocalAddressReticulumAudioLinkOwner`), not by who placed the call, so the Hub
  opens the link in both directions.
- Inbound link audio is dropped unless the link is marked verified
  (`audio-unverified-address`).
- A link is only marked verified in `applyVerifiedReticulumLinkAuthJoin` **if the
  sender is already present in `room.participants`** at that instant.

When the **phone initiates**, its verified link‑auth `GC_JOIN` arrives before the Hub
has registered the caller in `room.participants`, so the Hub closes the link with
`link-auth-no-participant` / drops audio as `audio-unverified-address`, and never leaves
"connecting". In the Hub‑initiated direction the participant state is already in place,
so the identical handshake verifies and the call connects. That single ordering
difference is the whole gap.

## The small Hub change we're asking for

In `applyVerifiedReticulumLinkAuthJoin`, when the signed `GC_JOIN` **verifies** and the
sender is a valid Qortal member of the call, **admit the participant from the verified
join** instead of bailing with `link-auth-no-participant`.

The verified join is itself authenticated proof of membership (Ed25519 over
`buildGcJoinSignedFields`, already checked), so this removes the race **without
weakening security at all** — it just lets a correctly‑signed mobile caller be admitted
regardless of which side's participant bookkeeping landed first.

That's it. One precondition relaxed for the already‑verified path. With that in place,
mobile→Hub (and mobile↔mobile) calls verify deterministically, exactly like the
Hub→mobile calls that already work today.

## What we are NOT asking for

- No change to the wire format, audio framing, signing, key delivery, or the
  link‑owner rule.
- Nothing changes for Hub‑initiated calls — they keep working as‑is.

Happy to jump on a call or share a build to demo the working direction live. We think
this is a great step toward Qortal voice on phones, and we're one small Hub tweak from
calls working every direction.
