# Running a Qortal Node and Self-Hosting Your Data

## Why run a node

A node is full participation: it validates the chain, serves QDN data for
names you follow, lets you mint (earn QORT for securing the network), and
keeps your access to Qortal independent of anyone else's infrastructure —
including gateways. In a censored or degraded-internet scenario, locally
synced chain data and QDN content remain usable, and nodes can sync from
any reachable peer.

## Practical requirements

Qortal Core is Java-based and runs on Linux, Windows, macOS, and modest
hardware — a Raspberry Pi 4/5 class machine with 4+ GB RAM and an SSD is a
popular dedicated node. Storage grows with the chain plus whatever QDN
content the node follows/hosts; budget tens of GB and room to grow. An
uninterruptible power supply pairs naturally with minting, since minting
rewards consistent uptime.

## Data hosting model

QDN storage is follow-based: nodes host data published by names they
follow. This means data persistence is social — content stays alive
because people who value it follow its publisher. For your own resilience:
run a node that follows your own name (your published apps and documents
are then always locally held), and encourage community members to follow
names whose content matters to them. Popular content naturally gains
redundancy across many nodes.

## Ports and connectivity

Qortal peers over its own P2P port and serves a local API/UI. Port
forwarding improves peer connectivity but isn't strictly required to use
the network. The local UI and API (used by Q-Apps in the Hub) run against
your own node — which is the trust model working as intended: your node,
your rules, no third-party API dependency.

## Node hygiene

Keep Core updated (updates ship through the network's auto-update
mechanism), back up the account seedphrase offline (the node holds no
custody — accounts are keys, not server records), monitor disk space, and
if minting, verify the minting key is active and blocks-minted is
increasing. A node that has been offline simply resyncs from peers — the
chain is the backup.
