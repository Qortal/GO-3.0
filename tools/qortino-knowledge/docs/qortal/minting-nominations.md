# Minting and the Nomination system

Authoritative overview aligned with qortal.dev/wiki/minting and
qortal.dev/wiki/q-mintership. Prefer this over older “sponsorship key” language.

## What minting is

Minting is how Qortal produces blocks. Accounts with minting rights run a full
node and share in each block’s reward while online. It is not Proof of Work
mining and not Proof of Stake — influence comes from sustained participation
(`blocksMinted` → minting **level**), not from buying hardware races or locking
coins.

One minting account per person. Running multiple minting accounts to multiply
rewards is not allowed; Minter Admins remove related accounts from the MINTER
group if the rule is broken.

## Levels (practical facts)

- `blocksMinted` is cumulative and never resets.
- Level drives reward share and permissions (e.g. Level 5+ can nominate).
- Level 1 is about 7,200 online minted blocks. Credits are batched (~every
  1,000 blocks), so Level 1 often shows after roughly 8,000–9,000 online blocks.
  Trust the Level shown in Hub, not a raw counter alone.

Approximate block-reward share by level bands:

- Levels 1–2: 6%
- Levels 3–4: 13%
- Levels 5–6: 19%
- Levels 7–8: 26%
- Levels 9–10: 32% (tier may be inactive until minters exist there)
- Legacy QORA transition share: 1%
- Minter/Dev Admin share: at least 3% (details evolve; see live chain / Q-Mintership)

## Block reward emission

At Genesis (29 June 2020) the reward was 5 QORT per block. About every six
months it steps down by 0.25 QORT toward a floor of 2 QORT. After that, yearly
votes can adjust within 1–5 QORT per block. There is no hard cap on total QORT;
new coins are created by minting.

## From sponsorship to Nominations (current)

Qortal **no longer uses sponsorship keys** for onboarding minters.

Current path = **Nominations** inside the **Q-Mintership** Q-App, approved by
community-elected **Minter Admins** on-chain:

1. A **Level 5+** minter publishes a **nomination card** for you (you cannot
   nominate yourself).
2. A poll opens; community and admin votes are tracked separately.
3. At roughly **40% Minter Admin “yes”**, admin action buttons unlock.
4. An admin creates a **MINTER group invite**; ~40% of admins must sign via
   group approval (~9 of ~21 admins at typical counts — the exact number changes).
5. You **JOIN_GROUP**, then add a minting account in **Q-Node** and keep a
   synced full node online.

What helps a nomination: registered name, real QDN publishes, helpful community
presence, and a nominator who knows your work. Viewing content alone is weak
evidence; durable QDN publishes are strongest.

## Guides to open on QDN

- **Welcome to Qortal** (APP) — onboarding / orientation for newcomers.
- **Q-Minter** (WEBSITE, “Q-Minter Guide”) — detailed minting guide.
- **Q-Mintership** (APP) — live nomination board and admin flow.

When the user is in QDN mode, recommend opening these as QDN tabs.
