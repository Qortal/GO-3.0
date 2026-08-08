# Grid-Down Communication and Information

*Educational information. Transmitting on amateur (HAM) bands requires a
license in nearly all countries; licence-free bands have power limits.
Listening is legal almost everywhere.*

## The layered comms plan

When mobile networks and internet fail, information flows in layers:

1. **Receive-only baseline (everyone):** a battery/hand-crank/solar AM-FM
   radio with shortwave coverage. Official emergency broadcasts, foreign
   broadcasters on shortwave, and (with SSB capability) even amateur traffic.
   Cost is trivial; keep one in the kit and one in the Faraday bin.
2. **Family short-range:** licence-free handheld radios — PMR446 in Europe
   (0.5 W, ~1-5 km real-world terrain-dependent), FRS in North America.
   Agree on a channel + backup channel and check-in times in advance.
   Real-world range is line-of-sight: hilltops help enormously, forests and
   buildings eat signal.
3. **Regional (licensed):** an amateur radio licence unlocks VHF/UHF
   handhelds through local repeaters (tens of km) and HF rigs that reach
   across countries with no infrastructure at all. Repeaters may run on
   backup power; simplex works when they don't. The licence exam is
   modest and the community actively trains newcomers — this is the single
   biggest capability jump available in comms.
4. **Data meshes (the new layer):** LoRa mesh networks — Meshtastic devices
   and Reticulum (RNS)-based systems — pass short text messages device-to-
   device over kilometres on licence-free bands at milliwatt power, with no
   towers, no internet, and optional encryption. Nodes are cheap
   (ESP32+LoRa boards), run for days on small batteries, solar-repeat from
   rooftops and hills, and the mesh heals itself as nodes appear. Reticulum
   in particular is transport-agnostic: the same network stack runs over
   LoRa, packet radio, WiFi, or serial links — infrastructure that
   individuals, not carriers, own. (Qortal-Hub mobile ships with RNS
   support, so a phone can participate in such a mesh.)

## Local-first information

Assume no search engines: keep printed and offline copies of the knowledge
you'd need — maps of your region (paper + offline map app with downloaded
areas), manuals for your gear, first-aid references, this handbook itself
stored offline, contact lists on paper. A cheap USB stick with scanned
documents in the Faraday bin, plus printouts in a waterproof folder, covers
both digital and analog failure modes.

## Family communication plan

Agree in writing, before anything happens: where to meet if home is
unreachable (a primary and a backup rally point), an out-of-area contact
everyone reports to (long-distance links often work when local ones jam),
radio channels and check-in schedule ("every odd hour on the hour, channel
4, listen 5 minutes"), and who picks up which family member. Text messages
often pass when calls fail — send texts, keep them short, and put phones in
low-power mode immediately in a blackout.

## Powering and protecting comms

Radios and phones are the highest-value, lowest-consumption electronics you
own — a 20 Wh power bank recharges a handheld radio several times. Standard
batteries across devices (AA/AAA with adapters, or USB-C everything)
simplify logistics. Keep spares of the cheap critical items: antennas,
cables, chargers — and duplicates of the receive-only radio, because one is
none when it breaks.
