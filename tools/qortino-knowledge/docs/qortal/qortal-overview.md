# Qortal Overview

## What Qortal is

Qortal is a fully decentralized platform combining a blockchain, a data network
(QDN), a communication layer (Q-Chat), and an application layer (Q-Apps). Its
goal is user sovereignty: identity, data, apps, and value exchange all run on
infrastructure operated by the community, with no central servers. The native
coin is QORT.

## Accounts and names

A Qortal account is a keypair derived from a seedphrase; the address starts
with "Q". To publish data or build a public identity, an account registers a
**name** on-chain. Names are unique, tradeable, and are the anchor for
everything published on QDN. Losing a seedphrase means losing the account —
there is no recovery service, so back it up offline.

## Minting and levels

Qortal replaces mining with **minting**: approved accounts that stay online
with a full node help produce blocks and earn QORT. Accounts progress through
levels (1–10) from `blocksMinted`. Higher levels earn a larger share of each
block reward. New minters join via the **Nomination** system in Q-Mintership
(a Level 5+ nominator + Minter Admin on-chain approval) — not the old
sponsorship-key model. See `minting-nominations.md` for the full flow.

## Groups

On-chain groups provide shared membership, group chat, and group-managed
permissions. Groups can be open or closed (invite/approval based), and
group-encrypted data on QDN is readable only by members.

## The Trade Portal

Qortal includes built-in cross-chain trading. QORT can be traded directly for
coins such as LTC, BTC, DOGE, RVN, DGB, and ARRR using AT (Automated
Transaction) smart contracts — no exchange or custodian involved. Prices are
set by open offers from other users, not an order-matching company.

## Fees and philosophy

Transactions and QDN publishes cost small QORT fees proportional to data size.
The project's philosophy emphasizes long-term infrastructure independence:
anyone can run a node, host data for names they follow, and use the system
without permission.
