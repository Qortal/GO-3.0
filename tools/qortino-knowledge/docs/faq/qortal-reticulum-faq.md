# qortal-reticulum — golden FAQ

Curated offline Q&A for Qortino (292 entries). Prefer these answers when relevant.

## Q: What is Reticulum?

A: Reticulum is open networking software that lets devices find each other and exchange encrypted data without central servers. It runs over almost any link: the internet, Wi-Fi, LoRa radios, serial cables and more, even very slow ones. It is a tool for building many independent networks, not one network you sign up to. Qortal Hub and Qortal GO use it for Q-Chat, online status and voice calls.

Also asked as: reticulum explained · reticulum network stack · what is rns · reticulum meaning · explain reticulum simply · reticulum mesh software

## Q: Does Reticulum need the internet?

A: No. Reticulum does not depend on the internet or on IP at all: it can run directly over LoRa radios, packet radio, serial lines, Wi-Fi or Ethernet. It can also use the internet as one of its links, which is easy and common. Qortal Hub and GO currently reach each other through Qortal's Reticulum hubs over a normal internet connection.

Also asked as: reticulum without internet · reticulum offline · does reticulum use internet · reticulum no internet · reticulum internet required

## Q: Why does Qortal use Reticulum?

A: Qortal wants communication that doesn't depend on central servers and, in time, less on internet providers. Reticulum fits: it is open, encrypts traffic between devices, needs no central coordination and runs over many kinds of links. Qortal's wiki calls it the mesh networking protocol that could one day make ISPs unnecessary; qortal.org describes it as an evolving layer, not a finished replacement. Today Hub and GO use it for real-time chat, online status and calls.

Also asked as: why qortal uses reticulum · why reticulum for qortal · qortal chose reticulum · reason qortal reticulum · benefits of reticulum for qortal

## Q: What does Reticulum do in Qortal Hub?

A: In Hub 3.0, Reticulum carries Q-Chat (groups, channels and direct messages), chat attachments, online status, voice calls (always the set-up, and the audio whenever a direct link isn't used), group calendars, Qortal Land, and the syncing of read marks and notification settings between your devices. The blockchain, names and QDN still run through Qortal Core.

Also asked as: reticulum in qortal hub · what hub uses reticulum for · hub reticulum features · hub 3.0 reticulum · what is reticulum in qortal hub · reticulum hub chat and calls

## Q: What does Reticulum do in Qortal GO?

A: The same as in Hub: GO runs a full Reticulum inside the app for Q-Chat groups and DMs, attachments, Saved Messages, online status, calls and syncing with your other devices. It connects to Qortal's community hubs over Wi-Fi or mobile data, and the badge in GO's top bar shows its Reticulum status.

Also asked as: reticulum in qortal go · what go uses reticulum for · go reticulum features · reticulum on go phone · go 3.0 reticulum

## Q: What is Reticulum Q-Chat?

A: It is the Q-Chat in Hub 3.0 and GO 3.0, where messages travel over Reticulum instead of being recorded as Qortal transactions. It keeps Qortal accounts, names and group membership at its centre, and adds channels and categories inside groups, Group Score for finding communities, message expiry you choose, replies, mentions, attachments, edits, calls and Qortal Land.

Also asked as: reticulum q-chat · new q-chat reticulum · q-chat over reticulum · what is the new q-chat · reticulum chat explained

## Q: How is Reticulum Q-Chat different from legacy Q-Chat?

A: Legacy Q-Chat recorded messages through Qortal transactions and centred each group on one text conversation. Reticulum Q-Chat sends messages over Reticulum in real time, so they arrive faster, and adds channels and categories, search, previews and Group Score, mentions, direct chat, calls and proximity voice in Qortal Land.

Also asked as: legacy q-chat vs reticulum · old q-chat vs new q-chat · difference legacy and reticulum chat · q-chat before and after reticulum · reticulum q-chat changes

## Q: Are Reticulum Q-Chat messages stored on the blockchain?

A: No. Each message is a signed event kept in a local database on the devices of the people in the chat, and devices fetch missing messages from each other. Nothing goes on the blockchain and there is no central chat server. The blockchain still decides who is a member and who is an admin of a group.

Also asked as: reticulum chat blockchain · are q-chat messages on chain · where are reticulum messages stored · reticulum q-chat storage · q-chat on the blockchain · is qortal chat on the blockchain

## Q: Is my Q-Chat on Reticulum encrypted?

A: Yes, while it travels: messages go over Reticulum links that are encrypted between the two devices at each end, so the hubs in between only pass on scrambled data. Each message is also signed with your Qortal account key. Group messages are handed only to devices of the group's members, checked with the Qortal node, and DMs only to the two people's own devices. On those devices messages are stored readable, without an extra group key, so a group is as private as its members.

Also asked as: is q-chat encrypted · reticulum q-chat encryption · who can read my reticulum messages · q-chat privacy reticulum · are reticulum dms encrypted · q-chat end to end encrypted · are q-chat messages private

## Q: How does Qortal know someone is online?

A: Through presence messages over Reticulum. While you are signed in, Hub or GO sends a small online-status message signed with your account key, and repeats it every 25 seconds. Other devices see it and show you as online, busy or idle. If nothing arrives from a device for about a minute and a half, it counts as offline.

Also asked as: how does online status work qortal · qortal presence reticulum · online dot qortal · how hub knows im online · reticulum presence heartbeat

## Q: Do Qortal voice calls go over Reticulum?

A: Partly. Setting up a call (ringing, joining, keys) always travels over Reticulum. For the audio, a one-to-one call first tries a direct WebRTC connection between the two devices and switches to Reticulum by itself if that fails. Group calls also prefer direct WebRTC links between participants and use Reticulum on any link that can't connect. GO's Private (Reticulum only) setting sends all call audio over Reticulum.

Also asked as: qortal calls reticulum · do calls use reticulum · voice calls over reticulum · call audio reticulum or webrtc · hub call transport

## Q: Are Qortal voice calls encrypted?

A: Yes. In a group call the room's root creates a room key and sends it to each participant, and every audio packet is encrypted with that key before it leaves the device, so forwarders and hubs only pass on scrambled audio. One-to-one calls show Encrypted on GO's call screen, whether the audio goes direct or is relayed over Reticulum.

Also asked as: are qortal calls encrypted · call encryption reticulum · group call room key · voice call privacy qortal · encrypted calls hub go

## Q: Do I need to set up Reticulum myself to use Qortal?

A: No. Hub and GO start Reticulum by themselves, create their network identity, connect to Qortal's community hubs and link up with other devices once you sign in. Hub's Reticulum settings are optional, for advanced users.

Also asked as: set up reticulum for qortal · configure reticulum hub · reticulum setup needed go · do i configure reticulum · reticulum automatic in qortal

## Q: Who made Reticulum?

A: Reticulum was created by Mark Qvist, who also maintains its reference implementation: the Python code that defines the protocol. It is an independent open project, not a Qortal product. Its home is reticulum.network, where the Reticulum manual lives.

Also asked as: who created reticulum · reticulum creator · who develops reticulum · mark qvist reticulum · reticulum author · who owns reticulum · who created rns

## Q: Is Reticulum part of Qortal?

A: No. Reticulum is a separate open-source project by Mark Qvist that anyone can use. Qortal builds on it: Qortal Hub and Qortal GO run Reticulum to carry chat, online status and calls between devices, and Qortal developers are also testing it inside Qortal Core.

Also asked as: is reticulum made by qortal · does qortal own reticulum · reticulum separate from qortal · reticulum qortal project · did qortal build reticulum

## Q: Why does Reticulum exist?

A: Its goal is to let anyone be their own network operator, and to make it cheap and easy to cover large areas with many independent networks that can link up with each other. The project describes these as networks without kill-switches, surveillance, censorship or central control. It is built to keep working over slow, unreliable links that normal internet tools struggle with.

Also asked as: why reticulum exists · reticulum goal · purpose of reticulum · reticulum vision · what is reticulum for · reticulum mission

## Q: Is Reticulum one big network like the internet?

A: No. Reticulum is a tool for building networks, and there can be thousands of them. They can join up, split apart and work with each other without any central oversight. Qortal Hub and GO, for example, join a Reticulum network segment named qortal-hub, carried by Qortal's community hubs.

Also asked as: is reticulum one network · reticulum single network · join the reticulum network · how many reticulum networks · reticulum global network

## Q: Do I need an account to use Reticulum?

A: No. Reticulum is free software, not a service you subscribe to. There are no accounts, phone numbers or email addresses: each device makes its own cryptographic identity, which works as its address. In Qortal Hub and GO this happens by itself in the background; you just sign in with your Qortal account as usual.

Also asked as: reticulum sign up · reticulum account needed · reticulum registration · reticulum phone number · do i pay for reticulum · reticulum subscription

## Q: Does Reticulum use IP addresses?

A: Not for addressing. A Reticulum address is a short hash made from a public key and an app name, so it works on any kind of link and needs no central registry. Reticulum can still travel over IP networks such as your Wi-Fi or the internet, but it does not rely on IP addresses to find anyone.

Also asked as: reticulum ip address · reticulum addressing · reticulum without ip · how reticulum addresses work · reticulum uses ip

## Q: What can Reticulum run over?

A: Almost any medium that can carry data: LoRa radios (using RNodes), packet radio modems and TNCs, amateur radio digital modes, serial lines, Wi-Fi, Ethernet, free-space optical links, and the internet over TCP or UDP. It can also talk to other programs through pipes. One network can mix several of these at once.

Also asked as: reticulum mediums · reticulum hardware support · what links does reticulum support · reticulum over radio · reticulum transports · where can reticulum be used

## Q: Can one Reticulum network mix LoRa, Wi-Fi and the internet?

A: Yes, that is one of its strengths. A device with several interfaces, say a LoRa radio, a packet radio modem and Wi-Fi, joins them into one network: once the interfaces are set up, Reticulum handles the routing, so a device on the Wi-Fi can reach nodes on the radio side and the other way round.

Also asked as: reticulum mix lora wifi · reticulum combine networks · reticulum bridge radio and wifi · reticulum multiple interfaces · reticulum lora to internet

## Q: How is Reticulum different from the normal internet?

A: The normal internet relies on providers, central services and IP addresses, and much of it is unencrypted by default. Reticulum is peer to peer, encrypts its traffic, addresses devices by cryptographic keys instead of IP addresses, and is designed to keep working over slow or broken links during outages. It can also run on top of the internet when that is available.

Also asked as: reticulum vs internet · reticulum compared to internet · difference reticulum internet · reticulum alternative to internet · reticulum versus tcp ip

## Q: Does Reticulum work on phones?

A: Yes. Reticulum runs on Android: apps such as Sideband and Columba use it, and reticulum-kt is a version made for Android. Qortal GO runs a full Reticulum inside the app, so you don't need any other Reticulum app for Qortal chat.

Also asked as: reticulum android · reticulum on phone · reticulum mobile · reticulum smartphone app · reticulum android apps

## Q: Is Reticulum a blockchain?

A: No. Reticulum is a networking stack: it moves encrypted data between devices. It has no blockchain or ledger. In Qortal, the blockchain is Qortal Core's job; Reticulum carries real-time traffic such as chat, online status and calls between Hub and GO.

Also asked as: reticulum blockchain · reticulum crypto coin · reticulum token · reticulum ledger · reticulum vs blockchain

## Q: What is a Reticulum identity?

A: A Reticulum identity is a set of cryptographic keys: a 256-bit Ed25519 key for signing and a 256-bit X25519 key for setting up encryption, 512 bits together. It is made on your device, its public half can be shared, and it takes the place of a username or phone number. Qortal Hub and GO each create one per installation, separate from your Qortal account keys.

Also asked as: reticulum identity explained · rns identity · reticulum identity keys · reticulum identity keyset · what is my reticulum identity

## Q: What is a Reticulum destination?

A: A destination is an endpoint you can send to on a Reticulum network, a bit like an address plus a service. It is named by an app name and some extra words called aspects, and is usually tied to an identity. A destination can announce itself, which shares the keys others need to reach it securely. Qortal Hub and GO each run a presence destination of their own.

Also asked as: reticulum destination explained · rns destination · reticulum endpoint · reticulum destination meaning · destination in rns

## Q: What does a Reticulum address look like?

A: It is a destination hash: 16 bytes, usually written as 32 hexadecimal characters (0 to 9 and a to f). It is calculated from the app name, its aspects and the identity's public key, and it cannot be turned back into the key. Hub shows its own under Destination hash in Settings, Reticulum tab, Reticulum details.

Also asked as: reticulum address format · reticulum destination hash · 32 character reticulum address · rns hash address · reticulum address length · what is a destination hash

## Q: What is an announce in Reticulum?

A: An announce is a small signed message a destination sends out to say it exists. It carries the destination's public key and optional app data, and as it spreads, nodes learn which way leads back to it. That is how others can find and encrypt to a destination without any directory. Qortal Hub and GO announce themselves this way so other Hubs and phones can find them.

Also asked as: reticulum announce · rns announce meaning · what does an announce do reticulum · reticulum announcements · how reticulum devices advertise · what is an announce

## Q: How do Reticulum devices find a route to each other?

A: Through announces and path requests. When a destination announces, transport nodes pass the announce on and remember which side it came from, building a table of next hops. Traffic to that address then follows the remembered path. A node that has no path yet can send a path request, and a node that knows the way answers.

Also asked as: reticulum routing · how reticulum finds paths · reticulum path discovery · reticulum route to destination · rns routing explained

## Q: What is a Reticulum link?

A: A link is an encrypted, verified connection between two destinations, used when they need to talk back and forth, transfer files or stream data. Setting one up takes only 3 packets (297 bytes in total), and keeping it open costs about 0.44 bits per second. Qortal Hub and GO keep links to a limited number of other Hub and GO devices to pass chat and online status along.

Also asked as: reticulum link explained · rns link · reticulum encrypted link · reticulum link setup cost · reticulum connection between devices

## Q: What encryption does Reticulum use?

A: Every identity has an Ed25519 key for signatures and an X25519 key for key exchange. Each packet or link gets fresh keys from an X25519 exchange; data is encrypted with AES-256 in CBC mode and checked with HMAC-SHA256, and keys are derived with HKDF. SHA-256 and SHA-512 are used for hashing. By default OpenSSL does the heavy lifting.

Also asked as: reticulum encryption · reticulum cryptography · reticulum aes x25519 · how does reticulum encrypt · reticulum crypto algorithms

## Q: Is all Reticulum traffic encrypted?

A: Traffic to a normal (SINGLE) destination and everything inside a link is encrypted end to end, with fresh keys each time. Reticulum also has PLAIN destinations, which are deliberately unencrypted for open broadcasts, and GROUP destinations, which use a shared key. Apps choose which to use; Qortal Hub and GO carry chat and presence over encrypted links.

Also asked as: is reticulum encrypted · reticulum end to end encryption · reticulum unencrypted traffic · reticulum plain packets · does reticulum encrypt everything

## Q: What is a transport node in Reticulum?

A: A transport node routes traffic for others: it passes announces along, forwards packets and answers path requests. It is turned on with enable_transport in the config. Reticulum advises it only for machines that stay in one place and are always on, such as a home server. Qortal's community hubs do this job for Hub and GO.

Also asked as: reticulum transport node · enable_transport reticulum · reticulum router node · transport mode reticulum · rns transport instance

## Q: What is a Reticulum interface?

A: An interface is one way a Reticulum node sends and receives data: a network card, a TCP connection to another node, a LoRa radio, a serial port and so on. You list your interfaces in the config, and Reticulum uses all of them together, passing traffic between them when transport is on.

Also asked as: reticulum interface meaning · rns interface · reticulum interfaces config · interfaces in reticulum · reticulum interface explained

## Q: Which interface types does Reticulum include?

A: The built-in interfaces cover: AutoInterface (local networks, no setup), UDP, TCP server and client, Backbone (fast TCP on Linux and Android), I2P, RNode (LoRa radios), KISS (packet radio modems), AX.25 KISS (amateur radio), plain serial ports, and Pipe (talking to other programs). You can also load custom interfaces.

Also asked as: reticulum interface list · supported reticulum interfaces · reticulum built-in interfaces · reticulum tcp udp lora interfaces · all reticulum interfaces

## Q: What is an RNode for Reticulum?

A: An RNode is an open-source LoRa radio designed for Reticulum. You can build one yourself or buy a complete transceiver that only needs a USB connection to a computer, and some can also connect over Bluetooth LE. With RNodes, Reticulum nodes can reach each other by radio, without internet or a mobile network.

Also asked as: rnode explained · rnode lora radio · what is rnode · rnode reticulum · rnode transceiver · lora rnode device · what is an rnode

## Q: Can Reticulum run over the internet?

A: Yes, easily. Reticulum can be tunnelled over the internet or any private IP network with its TCP or UDP interfaces, and it works just as well there. That is how Qortal Hub and GO users reach each other today: each device connects out to Qortal's community Reticulum hubs.

Also asked as: reticulum over internet · tunnel reticulum over internet · reticulum ip network · reticulum through the internet · reticulum wan link

## Q: What is LXMF?

A: LXMF (Lightweight Extensible Message Format) is a messaging format and delivery protocol built on Reticulum. It gives end-to-end encrypted messages with forward secrecy and routing that needs no setup, over any medium Reticulum supports, and is light enough for LoRa or packet radio. Apps such as Sideband, Nomad Network, MeshChat and Columba use it.

Also asked as: lxmf explained · lxmf messaging · lightweight extensible message format · lxmf reticulum · lxmf protocol

## Q: What is Sideband?

A: Sideband is a Reticulum app for Android, Linux, macOS and Windows with a graphical interface. It does LXMF messaging plus file transfers, image and voice messages, real-time voice calls, a distributed telemetry system, maps and plugins. It is a separate app from Qortal and doesn't show Q-Chat.

Also asked as: sideband app · sideband reticulum · sideband messenger · sideband android reticulum · sideband lxmf · what is sideband app

## Q: What is Columba?

A: Columba is a messaging and voice app for Reticulum on Android. It sends LXMF messages and makes LXST voice calls without needing the internet, cell towers or central servers, connecting over Bluetooth LE, Wi-Fi, LoRa radios (through an RNode) or TCP. There are no accounts: it creates your identity on the phone. It is a separate project, not part of Qortal.

Also asked as: columba app · columba reticulum · columba android messenger · columba lxmf · columba voice calls · what is columba app

## Q: Can I message Sideband or Columba users from Q-Chat?

A: No. Q-Chat in Hub and GO uses Qortal's own signed chat protocol over Reticulum, tied to Qortal accounts and groups, while Sideband, Columba, Nomad Network and MeshChat use LXMF. The two kinds of app don't read each other's messages, so each app only talks to its own users.

Also asked as: q-chat sideband · message columba from qortal · qortal chat lxmf compatible · q-chat to sideband users · is q-chat compatible with sideband · qortal reticulum interoperability · talk to sideband users from qortal

## Q: Do Qortal Hub and GO use LXMF?

A: Not for Q-Chat. Hub and GO send chat as signed Qortal chat events, using Qortal's own RCHAT protocol over Reticulum links, and keep them in a local database on each device. Hub's bundled Reticulum runtime includes the LXMF package, which Reticulum can use for things like interface discovery stamps, but Q-Chat itself is not LXMF.

Also asked as: does qortal use lxmf · hub lxmf · qortal go lxmf · q-chat lxmf · rchat vs lxmf

## Q: Do I need Sideband or another Reticulum app to use Qortal chat?

A: No. Qortal Hub and Qortal GO each include their own Reticulum and connect to Qortal's hubs by themselves, so chat, online status and calls work with nothing else installed. Hub doesn't need a Python install either.

Also asked as: need sideband for qortal · install reticulum for qortal · qortal chat extra app · hub needs reticulum installed · go needs a reticulum app

## Q: Who works on Reticulum for Qortal?

A: siddi leads the Reticulum work: the qortal.dev team page lists siddi as Core Network (Reticulum) Developer, working on Reticulum integration and networking infrastructure. The Reticulum chat and call features are part of the Qortal Hub code, which Qortal GO is built from.

Also asked as: who works on reticulum qortal · siddi reticulum · qortal reticulum developer · who built qortal reticulum · reticulum qortal team

## Q: When did Q-Chat move to Reticulum?

A: With Hub 3.0, in 2026. Legacy Q-Chat (2022) recorded chat messages through Qortal transactions; Reticulum Q-Chat sends them as fast, real-time conversations over Reticulum, and added channels, Group Score, message expiry and calls. Qortal GO 3.0 uses the same Reticulum chat.

Also asked as: when did q-chat switch to reticulum · reticulum q-chat release · q-chat 2026 reticulum · hub 3.0 q-chat change · when reticulum chat started

## Q: Does Reticulum Q-Chat still need 4 QORT in my account?

A: No. Holding a small QORT balance before you could post was a rule of legacy Q-Chat, where messages went through Qortal transactions. With Reticulum chat on, Hub and GO don't check your balance before sending. You still need QORT for blockchain actions, such as joining or creating a group.

Also asked as: reticulum chat 4 qort · q-chat minimum balance reticulum · need qort to chat on reticulum · low balance reticulum chat · q-chat balance requirement reticulum

## Q: How does Reticulum chat use the Qortal blockchain?

A: For identity and permissions. Every message, edit, reaction and online-status update is signed with your Qortal account key, so others can check it really came from you. Who may read and post in a group, and who is an admin, comes from the group's membership on the Qortal chain, which devices check with their Qortal node. Hub's Q-Chat card puts it as: powered by Reticulum, validated on Qortal blockchain.

Also asked as: reticulum chat qortal blockchain · q-chat validated on blockchain · reticulum group membership chain · how reticulum uses qortal accounts · reticulum chat signatures · powered by reticulum validated on qortal blockchain

## Q: Is Reticulum replacing Qortal Core?

A: No. Qortal Core still runs the blockchain, names, groups, trades and QDN, and Hub and GO still talk to a Qortal node for those. Reticulum runs beside it and carries real-time traffic: chat, online status and calls. Qortal developers are separately testing a Core build that can also use Reticulum for its own peer network.

Also asked as: reticulum replace qortal core · reticulum instead of core · does hub still need core with reticulum · reticulum vs qortal node · is core still needed with reticulum

## Q: How does Reticulum relate to QDN?

A: They are separate. QDN, the Qortal Data Network, is run by Qortal Core: websites, Q-Apps and published files spread between nodes over Core's own peer network. Reticulum is what Hub and GO use for chat, online status and calls. Chat can still show QDN content: a qortal:// link gets a preview card, and a GIF from the GIF library is sent as a QDN reference that each reader loads from their own node.

Also asked as: reticulum and qdn · reticulum vs qdn · qdn over reticulum · is qdn reticulum · reticulum qortal data network

## Q: Are Reticulum chat attachments stored on QDN?

A: No. Files and pictures you attach in Reticulum Q-Chat are sent over Reticulum between devices and kept on the devices of the people in the chat; they are not published to QDN. Each file is identified by its hash and checked when it arrives, and a device can fetch it from any other device in the chat that has it.

Also asked as: reticulum attachments qdn · are chat files on qdn · where are q-chat attachments stored · reticulum chat files storage · q-chat files published to qdn

## Q: Does Qortal Core run over Reticulum?

A: Not in the normal Core release: Core syncs the blockchain and QDN over its own peer-to-peer network on the internet. Qortal developers have been testing a Reticulum-enabled Core that runs Reticulum as a second network beside the usual one, carrying the same blockchain and QDN traffic. Hub and GO already use Reticulum for chat and calls.

Also asked as: qortal core reticulum · does core use reticulum · reticulum qortal node · core blockchain over reticulum · reticulum core build

## Q: What are Qortal's Reticulum hubs?

A: They are community-run Reticulum servers on the internet that Hub and GO connect to. Each device dials out to them, and the hubs pass Reticulum traffic between everyone connected, so phones and computers behind home routers can reach each other. Hub and GO come with a built-in list of them. The hubs only pass encrypted traffic along; your messages are kept on the devices in the chat.

Also asked as: qortal reticulum hubs · what are reticulum hubs · community hubs reticulum · hub links in go · qortal hub servers reticulum

## Q: Do I need to open a port on my router for Reticulum chat?

A: No. Hub and GO connect outward to Qortal's Reticulum hubs, which works behind normal home routers. Hub also listens on TCP port 4243 and tries to open it with UPnP, so other Hubs can connect to it directly; that helps the network but isn't needed for your own chat. Hub's Community transport switch does need UPnP or a forwarded Reticulum port.

Also asked as: reticulum port forwarding · open port for q-chat · reticulum router settings · hub reticulum port 4243 · reticulum upnp hub

## Q: Can the Qortal hubs read my messages?

A: No. Your device and the device it talks to set up an encrypted Reticulum link with keys only those two hold, and the hubs only forward that encrypted traffic. The hubs don't keep copies of chats either: messages live on the devices of the people in the conversation.

Also asked as: can reticulum hubs read chat · hub operators see messages · reticulum hub privacy · do hubs store messages · reticulum relay read messages

## Q: Can people outside my group read its Reticulum chat?

A: No. A device only hands out a group's messages to someone the Qortal node confirms as a member of that group, and messages from non-members are rejected. Devices that only pass network traffic along learn that something new exists, not what it says. Keep in mind that every member's device keeps a readable copy.

Also asked as: non members read group chat · reticulum group chat privacy · who can see group messages reticulum · outsiders read q-chat group · reticulum group access

## Q: Who stores my Reticulum DMs?

A: Only the devices of the two accounts in the conversation: yours, including your other signed-in devices such as your Hub, and the other person's. A device answers a request for DM history only when the requester is one of those two accounts. There is no server holding DMs in between.

Also asked as: where are reticulum dms stored · who has a copy of my dm · q-chat dm storage · reticulum direct message privacy · dm server reticulum · is my dm stored on a server

## Q: Can someone fake a message from me on Reticulum chat?

A: Not without your private key. Every message, edit, delete and reaction is signed with your Qortal account key, and other devices check the signature, and your group membership, before accepting it. A message that reuses a known message ID with different content is rejected as a conflict.

Also asked as: fake reticulum message · impersonate me on q-chat · reticulum message signature · spoof q-chat message · forged messages reticulum

## Q: Does Reticulum hide my IP address?

A: Reticulum packets carry no sender address, and when chat or a call goes over Reticulum the other person doesn't see your IP address. Calls are the exception to watch: GO's Direct (faster) call setting connects you straight to the other person, who can then see your IP, while Private (Reticulum only) keeps it hidden. Hub's Community call support shares your public IP anonymously with other Hub users.

Also asked as: reticulum ip privacy · does reticulum hide my ip · reticulum shows ip address · q-chat ip address visible · reticulum anonymity ip

## Q: Is my Reticulum identity the same as my Qortal account?

A: No. Your Qortal account (address, keys, seed phrase) is who you are on Qortal. Each Hub or GO installation has its own Reticulum identity, made on first start and kept in the app's data, which is just its network address. While you are signed in, your account signs a short-lived, renewed statement linking it to that address, so one account can use several devices and one device can switch accounts. A device's Reticulum identity never holds your QORT.

Also asked as: reticulum identity vs qortal account · hub reticulum identity · go reticulum identity · presence-bridge identity · reticulum identity per device

## Q: What does Idle mean in Qortal chat?

A: Idle means the account is signed in but not in use. Hub or GO switches to Idle by itself after 30 minutes without activity, and also while the app is locked, then goes back to your chosen status as soon as you are active again. Idle is set per device and can't be picked by hand.

Also asked as: idle status qortal · why am i idle · idle in q-chat · idle presence hub go · qortal shows idle · what does idle mean

## Q: Who can see that I'm online on Qortal?

A: Other Qortal Hub and GO users on the Reticulum network: your presence messages spread across it, so contacts and group members see your status. If you don't want that, pick Offline in your status menu to appear offline. Group voice calls need your status set to Online.

Also asked as: who sees my online status · qortal online status public · hide online status qortal · presence privacy reticulum · appear offline reticulum

## Q: What does the online count in GO mean?

A: It is how many Qortal accounts your phone currently sees as present on the Reticulum network. The same number shows on Home and on the Reticulum badge in the top bar. It is not the number of hubs or Reticulum nodes.

Also asked as: go online count · number next to reticulum badge · online accounts go · how many online qortal go · go top bar number

## Q: What do the colours of GO's Reticulum badge mean?

A: Green, online: your phone sees at least one Qortal account on the network. Orange, connecting: Reticulum is starting or still reaching the hubs. Red, offline: the phone has no network, or Reticulum failed. Grey, idle: Reticulum hasn't started yet, for example before you sign in. Tap the badge for details.

Also asked as: go reticulum badge colours · reticulum badge green orange red · go badge connecting · go badge offline red · reticulum status badge meaning · go badge orange · reticulum badge red · badge says connecting

## Q: What does Hubs mean in GO's Reticulum details?

A: It is how many links your phone has open right now to Qortal's community Reticulum hubs: the TCP connections that put it on the network. 0 means the phone is not on the network yet; 2 is typical and healthy.

Also asked as: go hubs count · go badge hubs zero · hubs number go badge · go reticulum hubs meaning · how many hubs go

## Q: What does Chat engine mean in GO's Reticulum details?

A: It shows whether GO's local chat database and chat worker are ready: "ready" is good; "starting" means it is still booting, with the time so far; "failed" shows the error; "idle" means it hasn't been asked to start yet (chat off or not signed in). The green badge only covers the network, so check this line when chats won't load or send.

Also asked as: go chat engine status · chat engine starting go · chat engine failed go · go chat engine ready · chat engine idle go · what does chat engine starting mean

## Q: Why is GO's Reticulum badge green but my chats don't load?

A: Green only means the network side is up: GO is linked to the hubs and sees other accounts. Loading and sending chats also need GO's chat engine. Tap the badge and look at the Chat engine line; if it isn't ready, use Copy diagnostics and send the text with your problem report.

Also asked as: badge green chat not working · reticulum online but no messages · go chat not loading green badge · chats wont send badge green · reticulum badge green chat broken

## Q: What does Reticulum offline in GO's notification mean?

A: It means GO can't reach the network, most often because the phone has no Wi-Fi or mobile data at that moment. If it also says, for example, 4 unsent, those are your messages waiting on the phone; they go out once the connection is back.

Also asked as: reticulum offline go · go notification reticulum offline · reticulum offline unsent · reticulum offline in notification · reticulum offline phone · reticulum offline notification

## Q: Why does a DM need both people online on Reticulum?

A: Because nothing in between stores it. A Reticulum DM stays on the sender's devices until the recipient's device fetches it, which can only happen while a device holding it and the recipient are online together. An always-on Hub signed in with the sender's account can do this for a phone.

Also asked as: dm both online reticulum · why dm not delivered offline · reticulum dm offline recipient · dm waits until online · no mailbox for q-chat dm

## Q: Is there a server that keeps Q-Chat messages for people who are offline?

A: No. Qortal's Reticulum chat has no store-and-forward server, and the hubs only pass traffic along. Group messages are kept by the members' devices, so a member who comes back fetches what they missed from any member who has it. DMs are kept by the two people's devices.

Also asked as: q-chat offline storage server · reticulum store and forward qortal · who keeps messages when offline · q-chat mailbox server · reticulum propagation node qortal

## Q: What is STUN and why do Qortal calls need it?

A: A STUN server helps a device learn the public address its router shows to the internet, which two devices behind home routers need in order to set up a direct (WebRTC) call. When a direct call can't connect, Qortal calls fall back to Reticulum. Hub doesn't use big public STUN servers: it uses small STUN services run by other Hub users and found over Reticulum.

Also asked as: what is stun · stun server calls · why calls need stun · stun qortal calls · stun webrtc qortal

## Q: What is Community call support in Hub?

A: It is a Hub setting, on the System tab of Settings and on by default, that makes your Hub offer a small STUN service on UDP port 47321 so other people's direct calls can connect. Your Hub announces it over Reticulum under a throwaway identity that is replaced every day, so your public IP address is shared with other Hub users but not tied to your account. Only one Hub per computer runs it.

Also asked as: community call support hub · hub stun service · offer stun from hub · hub udp 47321 · community stun contribution

## Q: Where are Hub's Reticulum settings?

A: Open Hub's Settings and choose the Reticulum tab. It has Enable Reticulum, Managed Reticulum config, Community transport, Reticulum details (this computer's destination hash and its overlay peers) and a Config editor. The Reticulum group chat switch, Attachment storage and Community call support are on the System tab. GO doesn't show these tabs.

Also asked as: hub reticulum settings · reticulum tab hub · where are reticulum settings in hub · hub settings reticulum tab · reticulum options qortal hub

## Q: What happens if I turn off Reticulum in Hub?

A: Hub asks you to confirm first. With Reticulum off, Q-Chat goes back to legacy chat, and calls and Qortal Land are unavailable until you turn Reticulum on again. The switch applies to that computer only; it doesn't change your other devices.

Also asked as: turn off reticulum hub · disable reticulum hub · hub without reticulum · enable reticulum switch · reticulum off legacy chat · turn off reticulum · what happens if i disable reticulum

## Q: What is Community transport in Hub?

A: It makes your Hub a Reticulum transport node that helps relay traffic for other users. It is off by default, needs Managed Reticulum config on, and works with UPnP or a Reticulum port you forward on your router yourself. Restart Hub after changing it. It suits a computer that stays on most of the time.

Also asked as: community transport hub · hub relay reticulum traffic · reticulum transport hub setting · help relay reticulum traffic · turn on community transport

## Q: Can Qortal chat work without the internet?

A: Not today. Hub and GO reach each other through Qortal's Reticulum hubs on the internet, and they also ask a Qortal node about group membership. Reticulum itself can run over radios and local networks, which is part of Qortal's longer-term mesh plans, but Hub and GO don't set that up.

Also asked as: q-chat without internet · qortal chat offline mesh · reticulum chat no internet · chat without internet qortal · offline q-chat · chat offline qortal

## Q: Do Hub and GO join the same Reticulum network?

A: Yes. GO connects to hubs from the same list the desktop Hub uses, on the same qortal-hub network name, so phones and computers see each other. GO's hub list is kept in step with Hub's for exactly this reason.

Also asked as: hub and go same reticulum network · go sees hub users · go same mesh as hub · phone and computer reticulum · go hub network

## Q: What does RNS stand for?

A: RNS stands for Reticulum Network Stack, the full name of Reticulum's reference software. You'll see it as the name of the Python package (rns) and in Qortal's Reticulum settings and logs.

Also asked as: rns meaning · what does rns mean · rns abbreviation · reticulum network stack meaning · rns stands for

## Q: Do I need a radio to use Reticulum?

A: No. Reticulum works over ordinary Wi-Fi, Ethernet and the internet; radios such as LoRa RNodes or packet radio are optional, for places without internet. Two devices on the same Wi-Fi are enough to start, and radio interfaces can be added later. Qortal Hub and GO use internet links only today.

Also asked as: reticulum without radio · need lora for reticulum · reticulum radio required · do i need an rnode for reticulum · reticulum over wifi only

## Q: Is Qortal's Reticulum network a mesh?

A: Not in the radio sense, yet. Reticulum can build real meshes over radios and local links, but today Hub and GO form a network of Qortal devices linked through community hubs on the internet, each device keeping direct Reticulum links to a few others. A wider mesh is part of Qortal's longer-term plans.

Also asked as: is qortal reticulum a mesh · qortal mesh network today · reticulum mesh hub go · qortal chat mesh or internet · real mesh qortal reticulum

## Q: How is Reticulum different from Qortal's normal peer network?

A: Qortal Core's peer network links nodes over the internet by IP address to sync the blockchain and QDN. Reticulum is a separate network used by Hub and GO: devices are addressed by cryptographic keys, traffic is encrypted end to end, and it carries chat, online status and calls. Your node and your Reticulum connection run side by side.

Also asked as: reticulum vs qortal p2p · qortal peer network and reticulum · core peers vs reticulum · two networks in qortal · reticulum and core network difference

## Q: How do I check that Reticulum is working in Hub?

A: In Hub's Reticulum settings, the Reticulum daemon line should say hub-connected, and the status line shows how many Qortal hubs are linked out of those configured (for example Hubs 2/6) and how many overlay links Hub has. The Core information popover also shows P2P Hub health and P2P Hub peers; Good means chat and calls can work.

Also asked as: check reticulum hub · is reticulum working hub · hub reticulum status · hub connected to reticulum · reticulum hub-connected check

## Q: How do I check that Reticulum is working in GO?

A: Look at the badge next to the Qortal name in GO's top bar: green with a number means GO is online and sees that many accounts. Tap it: Hubs should be 1 or more (2 is typical) and Chat engine should say ready. If something looks wrong, Copy diagnostics gives you a report to send.

Also asked as: check reticulum go · is reticulum working go · go reticulum status check · go connected to reticulum · reticulum badge check go

## Q: Can Reticulum be shut down by a company or government?

A: Reticulum itself has no central switch: there is no registry, no required server and no owner, and anyone can run nodes and build networks. A particular network can still lose its links, though. Qortal chat today reaches devices through a short list of community hubs on the internet, so it depends on those hubs staying reachable.

Also asked as: can reticulum be shut down · reticulum kill switch · ban reticulum · block reticulum network · reticulum censorship resistant

## Q: Is Reticulum anonymous?

A: Reticulum packets don't say who sent them, and a link stays anonymous unless an app identifies itself inside it. Qortal chat is not anonymous, though: every message and status update is signed with your Qortal account, so others see which account sent it, and your online status is visible on the network.

Also asked as: reticulum anonymity · qortal chat anonymous · reticulum hide my identity · anonymous messaging reticulum · reticulum sender anonymous

## Q: What do the coloured status dots mean in Qortal chat?

A: Green means online, red means busy, yellow means idle (signed in but not in use), and grey means offline or not seen on the Reticulum network. The status comes from the presence messages each device sends over Reticulum.

Also asked as: status dot colours · green dot qortal chat · red dot busy qortal · yellow dot idle qortal · grey dot offline qortal

## Q: Are my Reticulum chats backed up anywhere?

A: Not in any central place. Your chats live in the chat database on each of your devices, and other members' devices, plus your own other devices, hold copies of group and DM history. A new or reinstalled device fetches recent history back from them (about the last month on Hub), so older history only survives on devices that already had it. GO's chat data is not copied to Google's backups.

Also asked as: reticulum chat backup · q-chat backup · are my chats saved in the cloud · backup reticulum messages · lost chats new phone

## Q: What is Reticulum used for?

A: Many things: messaging apps (Sideband, Columba, MeshChatX, Nomad Network), voice calls and group voice, browsing and serving pages, file transfer and file sync, remote shells, Git hosting, bulletin boards, bots, and sensor or telemetry data, often over radio as well as the internet. In Qortal, Hub and GO use it for chat, online status and calls.

Also asked as: reticulum uses · what can reticulum do · reticulum use cases · apps built on reticulum · what people do with reticulum

## Q: What is the Reticulum badge in GO's top bar?

A: It is the small pill next to the Qortal name that shows GO's Reticulum status and how many Qortal accounts are online. Tap it for details (Online, Network, IFAC, Hubs, Known paths, Received, Sent and Chat engine, each with a short explanation) and for Copy diagnostics or Save as .md file.

Also asked as: go reticulum badge · badge next to qortal name go · go top bar reticulum pill · reticulum status pill go · tap reticulum badge go

## Q: Is a Reticulum hub the same as Qortal Hub?

A: No. Qortal Hub is the desktop app. Reticulum hubs are community-run servers on the internet that Hub and GO connect to so they can reach each other. The Hubs line in GO's Reticulum details counts links to those servers, not Qortal Hub apps.

Also asked as: reticulum hub vs qortal hub · hubs in go badge meaning · difference hub app and reticulum hub · is qortal hub a reticulum hub · reticulum hub qortal hub confusion

## Q: Reticulum chat isn't working in Hub. What should I check?

A: 1. In Settings, Reticulum tab, check that Enable Reticulum is on and the Reticulum daemon says hub-connected, with at least one hub linked.
2. Open Core information: P2P Hub health should turn Good after a short while.
3. Make sure Hub is connected to a working Qortal node, since group membership is checked there.
4. Check that your computer's date and time are set automatically.
5. If you edited the Reticulum config, restart Reticulum or Hub, or use Reset to Hub default.
6. Still stuck? Look at reticulum.log in the logs folder of Hub's app data.

Also asked as: hub reticulum chat not working · hub q-chat not connecting reticulum · reticulum problems hub · fix reticulum hub · hub chat not loading reticulum

## Q: Is Reticulum open source?

A: Yes. The reference implementation is published under the Reticulum License, and the Reticulum protocol itself was dedicated to the public domain in 2016. Anyone can read the code, run it, or build their own compatible version.

Also asked as: reticulum license · is reticulum free software · reticulum public domain · reticulum source code · reticulum open source license

## Q: How slow a link can Reticulum work on?

A: Reticulum needs very little: a link of at least 5 bits per second that can carry 500-byte packets, even if it only sends one way at a time. Its usable range today is roughly 150 bits per second up to about 500 megabits per second; the goal is 250 bits per second to 1 gigabit.

Also asked as: reticulum minimum speed · reticulum bandwidth needed · reticulum low bandwidth · reticulum slow links · reticulum speed range · how fast is reticulum

## Q: What programming language is Reticulum written in?

A: The reference implementation is written in Python and runs as a normal program: no kernel modules or drivers are needed, and it works on practically any system with Python 3. Other compatible versions exist, such as reticulum-kt in Kotlin for Android and Java systems.

Also asked as: reticulum programming language · reticulum python · is reticulum python · reticulum code language · reticulum needs python

## Q: Is there a written specification for Reticulum?

A: No separate one, by design. The Python reference implementation and its manual are the authoritative definition of the protocol. Other software counts as Reticulum only if it fully works together with that reference implementation and uses the same cryptographic building blocks.

Also asked as: reticulum spec · reticulum protocol specification · reticulum rfc · reticulum reference implementation · reticulum standard document

## Q: What is reticulum-kt?

A: reticulum-kt is a Kotlin version of Reticulum for Android and Java systems. It is tested against the Python reference implementation so the two can talk to each other, and it adds Android-only extras such as Bluetooth LE links. Qortal GO no longer uses it: GO runs the Python Reticulum inside the app as its only Reticulum stack.

Also asked as: reticulum kotlin · reticulum-kt android · kotlin reticulum implementation · reticulum java version · does go use reticulum-kt

## Q: Has Reticulum been security audited?

A: Not externally, according to its own README. It was built with cryptography best practice in mind, but the project calls itself relatively young software and says there could still be privacy or security bugs. By default it uses well-tested building blocks (X25519, Ed25519, AES-256, SHA-256) from OpenSSL.

Also asked as: reticulum audit · is reticulum audited · reticulum security review · is reticulum safe · reticulum security bugs

## Q: What does self-configuring mean in Reticulum?

A: You don't set up routes by hand. Devices announce themselves, and the nodes that pass traffic learn the way to each address on their own, across several hops and mixed link types. Once the interfaces are configured, Reticulum takes care of the rest.

Also asked as: reticulum self configuring · reticulum automatic routing · reticulum multi-hop routing · reticulum no manual routes · reticulum autoconfiguring

## Q: Can Reticulum handle long delays?

A: Yes. Reticulum is built to work even with very high latency and extremely low bandwidth. Messaging apps on top of it, such as LXMF messengers, are delay tolerant: if no path to the recipient exists yet, the message waits and goes out once one appears. A quiet Reticulum app usually means no traffic, not a failure.

Also asked as: reticulum high latency · reticulum delay tolerant · reticulum slow delivery · reticulum message delay · reticulum patchy connection

## Q: Can Reticulum run on a Raspberry Pi?

A: Yes. Reticulum runs on practically any system with Python 3, and a Raspberry Pi is a common choice for an always-on node. The Reticulum README gives the example of a Pi with a LoRa radio, a packet radio modem and Wi-Fi that joins all three into one network.

Also asked as: reticulum raspberry pi · reticulum on pi · pi reticulum node · run rnsd on raspberry pi · reticulum single board computer

## Q: How do I install Reticulum on a computer?

A: Qortal Hub users don't need to: Hub ships its own Reticulum and needs no Python install. To install Reticulum by itself, use Python's package tool: pip install rns, or pipx install rns for an isolated install. On first start Reticulum writes a default config file with basic settings for reaching peers nearby.

Also asked as: install reticulum · pip install rns · reticulum setup computer · how to get reticulum · reticulum linux install · install rnsd

## Q: What is rnsd?

A: rnsd is the Reticulum daemon: it runs Reticulum as an always-available background service, and other Reticulum programs on the same machine can share it. Qortal Hub starts its own rnsd when it opens and shares it between all open Hub windows, stopping it when the last one closes.

Also asked as: rnsd daemon · reticulum daemon · what does rnsd do · rnsd background daemon · reticulum background service

## Q: What tools come with Reticulum?

A: Reticulum comes with command-line tools: rnsd (run it as a service), rnstatus (interface status), rnpath (path tables), rnprobe (reachability check), rncp (file copy), rnid (identities and file encryption), rnsh and rnx (remote shell and commands), rnodeconf (RNode radio setup) and rngit (Git over Reticulum). They work even over slow links like LoRa.

Also asked as: reticulum utilities · reticulum command line tools · rnstatus rnpath rnprobe · reticulum cli programs · reticulum included programs

## Q: What does rnstatus show?

A: rnstatus is Reticulum's status tool: it shows information about the interfaces of the running Reticulum instance, so you can see whether a node is connected. Qortal Hub shows similar details for its own Reticulum in Settings, on the Reticulum tab.

Also asked as: rnstatus command · reticulum status tool · check reticulum interfaces · rnstatus output · reticulum interface status

## Q: What is rnprobe for?

A: rnprobe is Reticulum's connectivity test: it sends a probe to a destination and shows whether, and how quickly, it answers. A transport node only answers probes if its operator turns on respond_to_probes in its config; it is off by default.

Also asked as: rnprobe command · reticulum ping · test reticulum connection · reticulum probe tool · check reticulum destination reachable

## Q: What is rncp?

A: rncp is a simple file transfer program that copies files between machines over Reticulum. Like the other Reticulum tools, it works even over very low-bandwidth links such as LoRa or packet radio.

Also asked as: rncp file transfer · copy files over reticulum · reticulum file copy · send file with reticulum command · rncp command

## Q: What is rnodeconf?

A: rnodeconf is the RNode configuration and firmware tool that comes with Reticulum. It changes an RNode's settings and startup modes, and it can install, flash and update the firmware on supported LoRa devices.

Also asked as: rnodeconf tool · flash rnode firmware · configure rnode · rnode firmware update · rnode setup utility

## Q: What is rnid?

A: rnid is Reticulum's identity and encryption tool. You can use it to create and manage Reticulum identities, and to encrypt or decrypt files with them.

Also asked as: rnid command · reticulum identity tool · reticulum encrypt file · manage reticulum identity · rnid utility

## Q: What are rnsh and rnx?

A: Both let you work on another computer over Reticulum. rnsh opens a fully interactive remote shell session, and rnx runs single commands or programs on a remote system and brings back their output. Both work even over slow links like LoRa.

Also asked as: rnsh remote shell · rnx remote command · reticulum ssh · remote shell over reticulum · rnsh rnx difference

## Q: What is rngit?

A: rngit is a Git node for Reticulum: it serves one or more Git repositories over a Reticulum network. The included git-remote-rns helper lets ordinary Git work with those repositories over Reticulum.

Also asked as: rngit git · git over reticulum · git-remote-rns · reticulum git server · host git repo on reticulum

## Q: Where is the Reticulum config file?

A: Standalone Reticulum keeps its config in a folder called .reticulum in your home folder (or in /etc/reticulum or ~/.config/reticulum if one of those exists), and writes a default config there on first start. Qortal Hub uses its own folder inside Hub's app data instead; Settings, Reticulum tab, shows it and has Reveal in file explorer.

Also asked as: reticulum config location · reticulum config folder · where is reticulum config · .reticulum folder · hub reticulum config path

## Q: What is a shared instance in Reticulum?

A: The first program on a computer to start Reticulum opens all the configured interfaces and becomes the shared instance; other Reticulum programs on that machine connect to it over a local socket instead of opening their own. This happens automatically. Qortal Hub runs one shared instance, named qortal-hub-shared, for all its windows, while GO runs its own instance inside the app.

Also asked as: reticulum shared instance · share_instance reticulum · several reticulum apps one computer · reticulum local instance · qortal-hub-shared instance

## Q: What is the rnspure package?

A: rnspure contains exactly the same Reticulum code as the normal rns package, but lists no dependencies. Without the PyCA/cryptography library, Reticulum falls back to its own pure-Python crypto, which is much slower and has had less review. Use it only on systems that cannot install the normal package, and read the README's warning first.

Also asked as: rnspure · reticulum without dependencies · rns vs rnspure · pure python reticulum · reticulum pure python crypto

## Q: What does Reticulum need installed to run?

A: The normal rns package needs just two Python libraries: PyCA/cryptography (crypto through OpenSSL) and pyserial (serial devices such as RNodes). Reticulum loads them only when they are needed, so on a system without serial support it still runs, just without serial interfaces.

Also asked as: reticulum dependencies · rns requirements · reticulum python libraries · reticulum pyserial cryptography · what does reticulum depend on

## Q: How does a Reticulum node connect to the wider Reticulum network?

A: Reticulum is not a network you join automatically. You add interfaces that reach other nodes: a TCP connection to a public entry point, a LoRa radio, local Wi-Fi and so on. Reticulum can also discover public interfaces announced over the network itself, and the community keeps directories of public entry points. Qortal Hub and GO do this for you with a built-in list of Qortal hubs.

Also asked as: bootstrap reticulum · connect to reticulum network · reticulum entry points · join global reticulum · reticulum public interfaces

## Q: Is there a public Reticulum testnet?

A: Not any more. The Reticulum project used to run a public testnet, including an Amsterdam entry point, but it has been shut down now that there are many independent public nodes. New setups use the distributed backbone and Reticulum's built-in interface discovery instead.

Also asked as: reticulum testnet · amsterdam testnet reticulum · reticulum public testnet gone · reticulum test network · reticulum testnet decommissioned

## Q: What is LXST?

A: LXST is a protocol and toolkit from the Reticulum project for real-time audio and signals over Reticulum. It has building blocks for voice apps and hardware, such as the rnphone program for building telephones. Columba uses it for voice calls. Qortal Hub and GO calls use Qortal's own call system instead.

Also asked as: lxst protocol · reticulum voice protocol · rnphone · lxst voice calls · reticulum real-time audio

## Q: Can Reticulum carry large files?

A: Yes. Reticulum can move anything from a few bytes to files of many gigabytes, and it handles the splitting, ordering, compression and checksums automatically while reporting progress. Qortal Hub and GO also send chat attachments between devices over Reticulum links.

Also asked as: reticulum big files · reticulum file size limit · reticulum resource transfer · send large file over reticulum · reticulum gigabytes

## Q: How is a Reticulum identity created?

A: It is generated on the device from fresh random keys, with no registration and no server. Apps such as Columba create one on first launch. Qortal Hub and GO create theirs on first start, keep it in a file in the app's data, and reuse it every time after that.

Also asked as: create reticulum identity · generate reticulum identity · reticulum identity first start · new reticulum identity · reticulum identity registration

## Q: Why don't Reticulum addresses need a central registry?

A: Each address is derived from keys made on the device itself, so nobody has to hand addresses out, and the chance of two devices getting the same one is negligible. The project calls this coordination-less, globally unique addressing.

Also asked as: reticulum address registry · reticulum unique addresses · who assigns reticulum addresses · reticulum coordination-less addressing · reticulum address collision

## Q: What types of destinations does Reticulum have?

A: Four: SINGLE (one identity; data is encrypted to its keys), GROUP (a shared symmetric key held by a group of nodes), PLAIN (no encryption, for open broadcasts) and LINK (an established encrypted link between two endpoints).

Also asked as: reticulum destination types · single group plain destination · reticulum plain destination · reticulum group destination · rns destination kinds

## Q: What is a path request in Reticulum?

A: It is how a node asks the network for a way to reach a destination it has no path for. Nodes that know a path answer, and the requester can then send its traffic. By default a client waits up to 15 seconds for an answer.

Also asked as: reticulum path request · rns path request · request a path reticulum · reticulum unknown destination path · reticulum no path

## Q: How long does Reticulum remember a path?

A: Normally one week. Paths learned through an interface in access point mode expire after one day, and through a roaming interface after 6 hours. A destination that keeps announcing keeps its paths fresh, and entries that go unused are cleaned up.

Also asked as: reticulum path expiry · how long are reticulum paths kept · reticulum path timeout · rns path expiration · reticulum route lifetime

## Q: How many hops can a Reticulum packet travel?

A: Up to 128 hops. Reticulum also limits how much bandwidth announces may use and gives priority to announces from fewer hops away, so large fast networks don't swamp small slow ones.

Also asked as: reticulum max hops · reticulum hop limit · how far can reticulum route · rns maximum hops · reticulum 128 hops

## Q: How much bandwidth do Reticulum announces use?

A: At most 2% of an interface's bandwidth by default. If sending an announce would go over that, it waits in a queue, and announces with fewer hops go first, so distant large networks on fast links don't overwhelm small networks on slow radios. An announce that waits too long is dropped.

Also asked as: reticulum announce cap · reticulum announce bandwidth · announce traffic reticulum · reticulum 2 percent announces · reticulum announce rate limit

## Q: Does Reticulum have forward secrecy?

A: Yes, for all kinds of communication. Forward secrecy means traffic recorded today stays safe even if keys leak later. Links get fresh keys from every key exchange, and single packets can have it too through ratchets: extra keys a destination rotates, at most every 30 minutes, with old ones expiring after 30 days.

Also asked as: reticulum forward secrecy · reticulum ratchets · rns forward secrecy · reticulum key rotation · reticulum perfect forward secrecy

## Q: What is initiator anonymity in Reticulum?

A: Reticulum packets carry no source address. A packet names where it is going but not who sent it, so you can talk to a destination without revealing your own identity, unless your app chooses to identify itself on a link.

Also asked as: reticulum initiator anonymity · reticulum source address · reticulum anonymous sender · does reticulum hide the sender · reticulum sender privacy

## Q: What are delivery proofs in Reticulum?

A: When a destination receives a packet, it can send back a small proof signed with its own key. Nobody else can fake that signature, so the sender knows for certain the packet arrived. The project calls these unforgeable delivery confirmations.

Also asked as: reticulum delivery proof · reticulum delivery confirmation · reticulum packet receipts · rns packet proof · reticulum acknowledgement

## Q: What are channels and buffers in Reticulum?

A: They are tools for apps that need a steady stream over a link. A channel delivers messages reliably and in order, with flow control and resending of lost packets, and a buffer lets an app read and write over a channel like an ordinary data stream.

Also asked as: reticulum channel · reticulum buffer · rns channel buffer · reticulum reliable stream · reticulum ordered delivery

## Q: What is the request and response feature in Reticulum?

A: A destination can register request handlers for named paths. Another node opens a link, sends a request to one of those paths and gets the answer back over the same link. Reticulum describes it as a lightweight, flexible request/response mechanism; Qortal's bridge uses one to set up chat file sessions.

Also asked as: reticulum request response · rns request handler · reticulum requests over link · reticulum request path · reticulum api request

## Q: What is the Reticulum MTU?

A: Reticulum's packet size limit (MTU) is 500 bytes, which lets it run over very slow radio links. On a link, Reticulum can discover and use a bigger size when the path allows it, which speeds up fast connections a lot. Apps such as Qortal chat cut their messages into pieces that fit.

Also asked as: reticulum mtu · reticulum packet size · 500 byte reticulum packet · reticulum link mtu discovery · reticulum max packet size

## Q: What is IFAC in Reticulum?

A: IFAC (Interface Access Code) makes an interface part of a named, protected network. You give the interface a network name and/or a passphrase; Reticulum then adds an access code to every packet it sends there, and drops packets that arrive without the right code. That gives authentication and separate virtual networks on any interface type. Qortal's hubs use the network name qortal-hub.

Also asked as: reticulum ifac · interface access code · reticulum network name passphrase · reticulum private network segment · ifac size reticulum

## Q: Should my laptop or phone be a Reticulum transport node?

A: Usually not. Reticulum recommends transport only for systems that stay put and are always on, because the network starts relying on them for routes. A phone or laptop that comes and goes is better as a plain client. Qortal GO always runs with transport off, and Hub's Community transport switch stays off unless you turn it on.

Also asked as: should i enable reticulum transport · phone as reticulum transport · laptop reticulum transport node · reticulum transport always on · turn on reticulum transport · should my phone be a transport node

## Q: What are interface modes in Reticulum?

A: Each interface can run in a mode that tells a transport node how to treat it: full (the default), point to point, access point, roaming, boundary or gateway. For example, paths learned over an access point interface expire after a day and over a roaming one after 6 hours, instead of a week. Qortal Hub's mesh listen interface can run in gateway mode.

Also asked as: reticulum interface modes · reticulum gateway mode · reticulum roaming mode · reticulum interface mode full · reticulum boundary mode

## Q: What is interface discovery in Reticulum?

A: Transport nodes can announce their public interfaces over the network, with details such as type, address and port, and for radios the frequency and other settings. Nodes with discover_interfaces on collect these, and autoconnect_discovered_interfaces sets how many they join automatically. Each announced interface needs a valid cryptographic stamp, which keeps spam down. Qortal Hub turns discovery on with a small autoconnect limit.

Also asked as: reticulum interface discovery · discover_interfaces reticulum · autoconnect discovered interfaces · reticulum find public nodes · reticulum discovery stamp

## Q: What is a blackhole list in Reticulum?

A: It is a list of identities whose announces a node blocks. Operators of public entry points can keep their own, or pull lists that other transport nodes publish, to keep spammy or excessive announces off their network.

Also asked as: reticulum blackhole · reticulum block identity · reticulum announce spam · blackhole_sources reticulum · reticulum blocklist

## Q: What happens to a Reticulum network when a node goes offline?

A: The rest of the network keeps working. Nodes keep learning paths from fresh announces, so if another route to a destination exists, traffic can use it. Delay-tolerant apps such as LXMF messengers hold messages until a path is available again.

Also asked as: reticulum node offline · reticulum resilience · reticulum network failure · reticulum lost node · reticulum self healing

## Q: What is AutoInterface in Reticulum?

A: AutoInterface finds other Reticulum nodes on the same local network by itself, over link-local IPv6 and UDP. It needs no router setup or DHCP server, only IPv6, which is on in almost every system. It is on in Reticulum's default config, but Qortal Hub and GO leave it off and use their list of Qortal hubs instead.

Also asked as: reticulum autointerface · reticulum local network discovery · reticulum lan discovery · autointerface ipv6 · reticulum same network discovery

## Q: Can two devices on the same Wi-Fi use Reticulum without internet?

A: Yes. With Reticulum's AutoInterface (or a UDP interface), devices on the same local network find each other with no internet and no setup; apps like Columba work this way. Qortal Hub and GO don't do this by default: they connect through Qortal's hubs over the internet.

Also asked as: reticulum wifi without internet · reticulum local wifi only · reticulum lan no internet · two phones same wifi reticulum · reticulum offline wifi

## Q: What is the UDP interface in Reticulum?

A: The UDP interface sends Reticulum traffic in UDP packets: usually as broadcasts across a local network (port 4242 in the example config), or to one specific IP address. It is a simple way to link machines on the same network or over a plain IP connection.

Also asked as: reticulum udp interface · udpinterface reticulum · reticulum udp broadcast · reticulum port 4242 udp · reticulum over udp

## Q: What are the TCP server and client interfaces in Reticulum?

A: A TCP server interface listens for incoming connections from other Reticulum nodes, and a TCP client interface connects out to one, by IP address or hostname. This is the usual way to carry Reticulum over the internet. Qortal Hub and GO connect out to Qortal's hubs over TCP, so chat works without opening ports on your router.

Also asked as: reticulum tcp interface · tcpclientinterface · tcpserverinterface · reticulum over internet tcp · reticulum tcp port

## Q: What is the Backbone interface in Reticulum?

A: BackboneInterface is a fast TCP interface for Linux and Android, built for high-throughput links between nodes. Qortal's community hubs are reached with it: Hub on Linux and GO on Android connect to them through BackboneInterface, while Hub on Windows and macOS uses a TCP client interface instead.

Also asked as: reticulum backbone interface · backboneinterface · reticulum backbone linux · reticulum fast tcp interface · rns backbone

## Q: What is the I2P interface in Reticulum?

A: It carries Reticulum over the I2P anonymity network. You need an I2P router running on the same system with its SAMv3 API enabled; the interface can then connect to I2P peers and, when set as connectable, accept connections too.

Also asked as: reticulum i2p · i2pinterface · reticulum over i2p · reticulum i2p router · i2p sam reticulum

## Q: What is the KISS interface in Reticulum?

A: The KISS interface runs Reticulum over packet radio hardware: KISS-compatible TNCs and software modems, connected by a serial port. You set the serial speed, preamble, TX tail and similar modem settings, and can have it send a callsign ID at set intervals.

Also asked as: reticulum kiss interface · kissinterface · reticulum packet radio tnc · reticulum kiss modem · packet radio reticulum

## Q: What is the AX.25 KISS interface in Reticulum?

A: It wraps Reticulum traffic in AX.25 frames and marks transmissions with your station callsign and SSID, for use on amateur radio spectrum. The Reticulum config notes that Reticulum doesn't need AX.25 for anything and that it adds overhead to every packet, so the plain KISS interface with callsign beaconing is the more efficient choice.

Also asked as: reticulum ax.25 · ax25kissinterface · reticulum ax25 amateur radio · reticulum callsign ssid · ax25 reticulum overhead

## Q: Can Reticulum use amateur radio?

A: Yes. Reticulum runs over packet radio TNCs and amateur radio digital modes through its KISS and AX.25 KISS interfaces, and both can send your callsign as station identification at set intervals.

Also asked as: reticulum ham radio · reticulum amateur radio · reticulum packet radio ham · ham radio mesh reticulum · reticulum callsign id

## Q: Can Reticulum use a serial port?

A: Yes. Reticulum can run over any device with a serial port, such as a data radio or a direct cable between two machines, using its serial interface. KISS modems and RNodes also connect through serial ports. Serial support needs the pyserial library.

Also asked as: reticulum serial interface · reticulum serial cable · reticulum over serial · serialinterface reticulum · reticulum usb serial

## Q: What is the Pipe interface in Reticulum?

A: The Pipe interface connects Reticulum to an external program through stdin and stdout or pipes. That lets you carry Reticulum over almost anything another program can pass bytes through, custom hardware included.

Also asked as: reticulum pipe interface · pipeinterface · reticulum stdio interface · reticulum external program interface · reticulum custom hardware pipe

## Q: Can I write my own Reticulum interface?

A: Yes. Reticulum can load custom interface types written by users or the community, so you can make it talk over hardware it doesn't support yet. The project accepts new interfaces when they are generally useful and well tested in real use.

Also asked as: custom reticulum interface · write a reticulum interface · reticulum interface plugin · add new interface reticulum · reticulum unsupported hardware

## Q: Can Reticulum run over Bluetooth between phones?

A: Some apps do this. Columba uses an Android version of ble-reticulum to message over Bluetooth LE with other Android and Linux devices, and reticulum-kt has its own Bluetooth LE mesh interface. The standard Python Reticulum uses Bluetooth LE to reach RNode radios. Qortal GO does not use Bluetooth for chat.

Also asked as: reticulum bluetooth · reticulum ble phones · bluetooth mesh reticulum · phone to phone bluetooth reticulum · reticulum ble mesh

## Q: What is an LXMF propagation node?

A: A propagation node stores and forwards LXMF messages for people who can't be reached when a message is sent. Propagation nodes peer with each other and keep their stores in sync, forming an encrypted, distributed message store, and users collect messages meant for them from any available one. They can also host bulletin or discussion boards.

Also asked as: lxmf propagation node · propagation node reticulum · lxmf store and forward · lxmf offline messages node · lxmd propagation

## Q: How does LXMF reach someone who is offline?

A: The message can go to a propagation node, which keeps it encrypted and syncs it with other propagation nodes. When the recipient comes online, their app collects it from any available propagation node. Without one, the sending app keeps the message and delivers it once a path to the recipient appears.

Also asked as: lxmf offline delivery · lxmf recipient offline · reticulum message to offline person · lxmf deliver later · lxmf holds messages

## Q: What are LXMF paper messages?

A: An encrypted LXMF message can be written as a QR code or as a text link starting with lxm://, so it can travel on paper or any other analog way. The recipient scans or opens it in an LXMF app, such as Sideband on Android, which decrypts it and adds it as a message.

Also asked as: lxmf paper message · lxm link · reticulum qr message · paper message reticulum · lxmf qr code

## Q: How much overhead does an LXMF message add?

A: Only 111 bytes in total, mostly a 16-byte destination, a 16-byte source and a 64-byte Ed25519 signature. In return every message is timestamped, signed, end-to-end encrypted and routed with no setup, which is why LXMF works over very slow radio links.

Also asked as: lxmf overhead · lxmf message size · lxmf bytes per message · lxmf wire format · lxmf 111 bytes

## Q: What is lxmd?

A: lxmd is the LXMF daemon that comes with the lxmf package: a lightweight message router that can also run as a propagation node (lxmd -p). It can run a program each time a message arrives, and lxmd --exampleconfig prints a fully commented example configuration.

Also asked as: lxmd daemon · lxmf daemon · run lxmf propagation node · lxmd propagation node · lxmd example config

## Q: Is LXMF encrypted?

A: Yes, end to end by default, using Reticulum's encryption. Messages sent over a Reticulum link (the default) use ephemeral keys with forward secrecy, messages sent as a single packet are encrypted per packet, and messages to a GROUP destination use that group's shared key.

Also asked as: lxmf encryption · is lxmf end to end · lxmf forward secrecy · lxmf message security · lxmf encrypted messages

## Q: What can LXMF be used for besides chat?

A: LXMF is flexible. Short SMS-like messages use only the content; email-like mail uses a title and content, with attachments in the fields; machines can exchange commands or sensor readings in the fields; and with propagation nodes it can carry USENET-style discussion groups or broadcast bulletins.

Also asked as: lxmf uses · lxmf email · lxmf sensor data · lxmf bulletin board · lxmf use cases

## Q: What is Nomad Network?

A: Nomad Network (NomadNet) is an off-grid, encrypted and resilient communications platform built on Reticulum and LXMF. Its nodes host pages that people browse over Reticulum, a bit like small websites, and apps such as Columba and MeshChatX include a browser for them.

Also asked as: nomad network reticulum · nomadnet · nomadnet pages · what is nomadnet · nomad network app

## Q: What can Columba do?

A: Besides messages and voice calls, Columba can share your location with others on a map, download or import offline maps (MBTiles), browse Nomad Network pages, relay traffic for others to grow the mesh, manage several identities, export and import identities (including from Sideband), share your identity as a QR code, and use custom colour themes.

Also asked as: columba features · columba location sharing · columba offline maps · columba nomadnet browser · columba multiple identities

## Q: How do I start a chat in Columba?

A: Open Announces, tap a contact's name and choose Start Chat. Or open Chats, choose New Conversation, add the contact by scanning their QR code or pasting their destination, then type and press Send. If they are reachable it arrives at once; if not, Columba keeps it and delivers it when they come within reach.

Also asked as: columba new chat · columba send message · columba add contact · columba announces screen · columba first message

## Q: How do I install Columba?

A: Columba is an Android app installed from an APK. Get the latest release from the Columba project's Releases page (or through Obtainium), allow your browser or file manager to install unknown apps, then open the APK. Its guide recommends Android 12 or newer and about 100 MB of free space. A copy is also offered on a Nomad Network page.

Also asked as: install columba · columba apk · download columba · columba requirements · columba android version

## Q: Why didn't my Columba message arrive right away?

A: That is normal on a delay-tolerant network: the message is delivered once a path to the recipient exists. If no peers show up, check that both devices are running Columba and share a medium, such as the same Wi-Fi, Bluetooth range or a radio, then restart the app. Silence often just means no traffic, not a failure.

Also asked as: columba message not delivered · columba no peers found · columba not working · columba message delay · columba troubleshooting

## Q: What is MeshChat?

A: MeshChat and MeshChatX are LXMF clients for Reticulum. MeshChatX is described as full-featured: it supports image and voice messages, file transfers and voice calls, and has a built-in browser for Nomad Network pages.

Also asked as: meshchat reticulum · meshchatx · reticulum meshchat app · meshchat lxmf client · what is meshchatx

## Q: Can I use my Qortal account in Sideband or Columba?

A: No. Sideband and Columba create their own Reticulum identities and use LXMF, while Qortal chat signs everything with your Qortal account keys and needs Qortal groups and names. Your Qortal account belongs in Hub or GO; never type your seed phrase into another app.

Also asked as: qortal account in sideband · use qortal identity in columba · import qortal account columba · qortal seed in sideband · qortal keys in reticulum app

## Q: Can I move my Reticulum identity between Columba and Sideband?

A: Yes. Columba can export your identity as a backup or to move to a new device, and it can import identities from other Reticulum clients such as Sideband. You can also share your identity with others as a QR code. Keep identity backups private: the file holds your private keys.

Also asked as: columba export identity · columba import sideband identity · move reticulum identity · backup reticulum identity · columba identity qr code

## Q: Why is the Columba app called Columba?

A: Columba is Latin for dove, and also the name of a constellation in the southern sky that depicts a dove. Doves are symbols of peace and hope and have carried messages throughout history.

Also asked as: columba name meaning · why called columba · columba latin dove · columba constellation · meaning of columba

## Q: How does the Reticulum test build of Qortal Core work?

A: It adds Reticulum as a second network stack that runs alongside Core's normal IP networking. Reticulum peers are treated like ordinary peers, so blockchain sync and QDN work over either. Its Reticulum config is generated from Core's settings.json, or can be edited by hand in a .reticulum folder inside the Qortal folder, and Core builds and manages the mesh by itself. It is a test build, not the normal Core release.

Also asked as: reticulum enabled qortal core · core reticulum test · core second network stack · qortal core reticulum settings · reticulum core testing

## Q: What is the qortal-hub network name?

A: It is the name of the Reticulum network segment Qortal uses. Hub and GO set it on their connections to Qortal's hubs, so they only exchange traffic with devices on that same named network. GO's Reticulum details show it as Network; a different name there means a different network, whose peers you can't see.

Also asked as: qortal-hub network · reticulum network name qortal · qortal mesh name · network qortal-hub · go reticulum network name

## Q: Which ports does Hub use for Reticulum?

A: Hub dials out to Qortal's hubs (they listen on ports such as 4400 and 4444), listens for other Hubs on TCP port 4243 (opened with UPnP when the router allows), and, with Community call support on, offers a STUN service on UDP port 47321. Its own Reticulum daemon also uses local ports from 37428 up, on the computer itself only.

Also asked as: hub reticulum ports · reticulum port 4243 · port 47321 stun · reticulum firewall ports · which ports reticulum hub

## Q: Can I copy my Hub data folder to a new computer?

A: It is better to install Hub fresh and sign in with your account. Copying Hub's whole app data folder also copies that installation's Reticulum identity and chat author stream, so two computers would look like one device to the network, and Hub can't detect a copied profile yet. A fresh install gets its own identity and fetches chats from your other devices and group members.

Also asked as: copy hub data folder · move hub to new computer reticulum · clone hub profile · copy qortal hub appdata · hub new pc reticulum identity

## Q: What happens to my Reticulum identity if I reinstall GO?

A: GO makes a new one. The Reticulum identity lives in GO's app data, which is removed on uninstall and is not backed up to Google, so a reinstalled GO starts with a fresh identity. Your Qortal account is not affected: restore it from your backup file or seed phrase, and GO links the account to the new identity when you sign in.

Also asked as: reinstall go reticulum identity · go new reticulum identity · uninstall go reticulum keys · reticulum identity lost go · go reinstall chat identity

## Q: How is someone's status shown when they use several devices?

A: Each device sends its own presence, and Hub and GO combine them into the most available status: Busy wins over Online, and Online over Idle. So a phone in use plus an idle desktop shows as Online, and one device going offline doesn't hide the others.

Also asked as: status multiple devices qortal · busy online idle priority · presence several devices · why does contact show online and idle · multi device status reticulum

## Q: How long after closing Hub or GO do I show as offline?

A: Logging out sends an offline notice right away. If a device simply stops sending presence, for example because it lost its connection, other devices show it as offline after about 95 seconds without a presence message (presence repeats every 25 seconds).

Also asked as: how long until offline qortal · offline after closing hub · presence timeout qortal · when do i show offline · reticulum presence expiry

## Q: What does Known paths mean in GO's Reticulum details?

A: It is how many destinations Reticulum currently knows a route to. Each announce your phone hears teaches it a way to reach an identity, and a few hundred is normal on a busy network. It is not the number of people chatting right now.

Also asked as: known paths go · reticulum known paths · go badge paths · paths count reticulum · known paths number · what does known paths mean

## Q: What does IFAC mean in GO's Reticulum details?

A: IFAC is the Interface Access Code size: the shared network filter that comes from the network name. 16 B means your phone is on the named Qortal network; 0 B would mean an open, unfiltered interface.

Also asked as: ifac 16 b go · go ifac meaning · ifac 0 b · go badge ifac · interface access code go · what does ifac 16 b mean

## Q: What do Received and Sent mean in GO's Reticulum details?

A: They are the total data your phone has received from and sent to the hubs since Reticulum started this session. They reset when the Reticulum stack restarts, not when you close a chat.

Also asked as: go received sent reticulum · reticulum data usage go · go badge received sent · how much data reticulum go · reticulum traffic counter go

## Q: What do Reticulum starting, connecting and online mean in GO's notification?

A: Starting: GO's Reticulum bridge is booting. Connecting: it is up but hasn't seen any Qortal account on the network yet. Online: it sees at least one account. Offline: no network, or a failure. Chat paused means the phone stopped GO's chat engine in the background; open GO to sync.

Also asked as: reticulum connecting go · reticulum starting notification · reticulum online notification · go status notification meaning · chat paused go notification

## Q: How does a Qortal group call carry everyone's audio?

A: Through forwarders, rather than everyone sending to everyone. One participant, chosen by a fixed rule from the account addresses and the call room, is the root forwarder: the others send their encrypted audio to it, and it passes the audio on to the rest. Calls of more than 10 people add cluster forwarders, and a standby forwarder can take over. Forwarders pass the audio on without decrypting it.

Also asked as: group call forwarder · how group calls work qortal · root forwarder group call · group call audio routing · qortal group call topology

## Q: How does Hub find STUN servers for calls?

A: Hubs with Community call support announce their STUN service over Reticulum, and other Hubs collect these announcements. Each Hub checks the servers with its own test probes, ranks them, and gives a call at most 6 of the best. After a one-to-one call, Hub notes how well that set worked. The old list of public STUN servers is switched off.

Also asked as: how hub finds stun · decentralized stun qortal · stun servers over reticulum · hub stun cache · community stun discovery

## Q: Why does a call say Reticulum is not ready yet?

A: Calls need Reticulum connected first, because ringing and joining travel over it. Right after Hub or GO starts, Reticulum is still reaching the hubs and finding other devices; in GO, calls get ready about half a minute after it connects. Wait a moment and try again.

Also asked as: reticulum not ready call · call not ready yet · cant join call reticulum · calls get ready half a minute · group call reticulum not ready

## Q: What is P2P Hub health in Hub?

A: It is Hub's measure of its Reticulum peer links, shown in the Core information popover next to the number of P2P Hub peers. Bad means no Reticulum peer is sending data to Hub yet, Low means peers are linked but not yet steady for 30 seconds, and Good means at least one has been steady that long. Group voice calls wait for a healthy connection.

Also asked as: p2p hub health · p2p health bad hub · p2p hub peers · hub p2p health low · reticulum peers hub health

## Q: Can I be in the same group call from two devices?

A: Not at once: a group call allows one active device per account. If you join from a second device, that device takes your place and the first one leaves the call.

Also asked as: group call two devices · join call from phone and hub · same account twice in a call · group call device takeover · move group call to other device

## Q: Does Qortal Land use Reticulum?

A: Yes. Qortal Land, the shared social space in Q-Chat, runs over Reticulum: your avatar's moves, room, mood and status, Land chat, proximity voice, and games such as Chess, Checkers and Qonnect Four travel between devices over it, signed with your account. If you turn Reticulum off in Hub, Qortal Land is unavailable.

Also asked as: qortal land reticulum · qortalland network · qortal land network reticulum · is qortal land peer to peer · does qortal land need reticulum

## Q: Are group calendar events shared over Reticulum?

A: Yes. Group calendar events in Q-Chat are signed events sent between members' devices over Reticulum, much like messages, and they can carry a cover image. Only members of the group can see its events.

Also asked as: group calendar reticulum · q-chat calendar events · calendar sync reticulum · group events shared reticulum · reticulum calendar

## Q: What is Managed Reticulum config in Hub?

A: When it is on (the default), Hub writes its own Reticulum daemon config at startup, with Qortal's hubs and its mesh settings. Turn it off if you want to keep a config you edited by hand; Hub then leaves the file alone. Community transport can only be switched while it is on.

Also asked as: managed reticulum config · hub managed config · hub rnsd config managed · keep my own reticulum config · managed config off

## Q: How do I edit Hub's Reticulum config?

A: In Settings, Reticulum tab, open the Config editor, make your change and save; it takes effect after Reticulum or Hub restarts. Reset to Hub default loads Hub's standard config for you to review and save, and Reveal in file explorer shows where the file is. All Hub windows on the computer share this config.

Also asked as: edit reticulum config hub · hub config editor · reset reticulum config hub · hub reticulum config file · change rnsd config hub

## Q: What does Reticulum details show in Hub?

A: It shows this Hub's Reticulum destination hash and the overlay peers it has links with right now: each peer's hash and Qortal address, whether the link is inbound or outbound, and how long it has been connected.

Also asked as: hub reticulum details · hub overlay peers list · hub destination hash · reticulum details button · established overlay peers hub

## Q: What do the Reticulum daemon states in Hub mean?

A: hub-connected: at least one of Qortal's Reticulum hubs is online for this computer. lan-only: only local discovery is available. disconnected: the hubs are set up but none can be reached right now. unknown: Hub hasn't worked it out yet.

Also asked as: hub-connected reticulum · lan-only reticulum · reticulum disconnected hub · reticulum daemon status · hub reticulum reachability

## Q: What is Attachment storage in Hub?

A: It sets how much disk space Hub may use for Reticulum chat files: 2, 5, 10, 25 or 50 GB, with 10 GB as the default. It is on the System tab of Hub's Settings, next to how much is in use now.

Also asked as: hub attachment storage · reticulum file storage limit · hub chat files space · attachment storage 10 gb · q-chat attachments disk hub

## Q: What is the Reticulum group chat switch in Hub?

A: It is on the System tab of Hub's Settings and turns the Reticulum transport for group chat on or off; it is on by default. With it off, groups use legacy Q-Chat. The Enable Reticulum switch on the Reticulum tab turns all Reticulum features on or off.

Also asked as: reticulum group chat setting · hub reticulum group chat switch · turn off reticulum group chat · legacy group chat hub · reticulum chat toggle hub

## Q: What is RCHAT?

A: RCHAT is the chat protocol Qortal Hub and GO speak over Reticulum. It doesn't sync chat screens; it copies a log of signed events (messages, edits, deletes, reactions, channel changes) between devices. Each device keeps the events in its own local database, which is the source of truth, and the chat you see is built from it.

Also asked as: rchat protocol · qortal chat protocol reticulum · what protocol does q-chat use · rchat events · reticulum chat replication

## Q: How does Reticulum chat find messages a device missed?

A: Devices swap short summaries of what they hold, compare them, and then ask a peer only for the pages they are missing, in small batches that fit Reticulum's packet size. Each author's messages are also numbered in order, so a gap, say message 39 then 42, shows exactly what to fetch.

Also asked as: reticulum chat missing messages · how q-chat syncs history · chat digest reticulum · reticulum gap repair · q-chat catch up missed messages

## Q: What is an author stream in Reticulum chat?

A: Each installation of Hub or GO numbers the messages it writes in its own sequence, called an author stream. With several devices on one account, each device has its own stream, so peers can tell the devices' messages apart and spot a missing one, while edits, deletes and reactions still belong to the account.

Also asked as: author stream reticulum · authorstreamid · reticulum chat sequence numbers · per device message stream · q-chat author sequence

## Q: How much chat history does a new device get?

A: A new device fills in history from other members' devices as you open chats. Desktop Hub 3.0 accepts chat events from other devices only up to 30 days old, and GO hands other devices only the last 29 days (though GO takes older history from Hubs). So expect a fresh install to show about the last month; older messages stay on the devices that already had them.

Also asked as: new device chat history · old messages on new computer · why no old messages new device · chat history 30 days reticulum · fresh install q-chat history

## Q: Does my device clock matter for Reticulum chat?

A: Yes. Messages and online-status updates carry signed timestamps, and devices refuse ones that look too far in the future (more than about 5 minutes for chat events), so a wrong clock can get your messages or status dropped by others. Keep your device's date and time set automatically.

Also asked as: clock wrong reticulum chat · device time q-chat · wrong time messages rejected · reticulum timestamp · clock skew qortal chat · does my clock matter for chat

## Q: What are overlay peers in Hub and GO?

A: Overlay peers are the other Hub and GO installations your device keeps direct Reticulum links with, to pass chat notices, online status and other small messages along. A desktop Hub keeps up to 12 outgoing and 8 incoming; a phone keeps up to 6 of each, and more while charging on Wi-Fi.

Also asked as: overlay peers reticulum · overlay links hub · hub reticulum neighbours · how many peers go reticulum · overlay neighbours phone · what are overlay peers

## Q: Does Hub relay chat traffic for other people?

A: Yes, by default: a desktop Hub passes group notices and other small chat messages on to its neighbours, which helps them spread. That is separate from Community transport, which also makes Hub a Reticulum transport node that routes traffic for others.

Also asked as: hub relays chat · hub gossip relay · does hub forward messages · hub relay group traffic · hub helps chat network

## Q: Why does GO reconnect after I switch between Wi-Fi and mobile data?

A: When the phone moves to another network, its old connections to the hubs stop working. GO notices the switch and reconnects to the hubs as soon as the phone settles on the new network, instead of waiting a couple of minutes for the dead links to time out.

Also asked as: go switch wifi mobile data · reticulum reconnect network change · go hubs reconnect · go offline after switching wifi · go network switch chat · go reconnect after switching wifi

## Q: What happens to Reticulum when I swipe GO away or log out?

A: GO pauses its Reticulum network connection, so it doesn't keep running with nothing attached to it. When you open GO and sign in again, it connects to the hubs again.

Also asked as: swipe away go reticulum · logout go reticulum · go closed reticulum stops · reticulum after closing go · go network pause

## Q: How does GO keep Reticulum light on battery?

A: GO runs one Reticulum stack, keeps fewer links than a desktop (6 out and 6 in), doesn't relay other people's group traffic on battery, and slows its timers and keepalives when you aren't chatting or calling. Opening a chat or a call brings everything back to full speed.

Also asked as: go reticulum battery · reticulum battery drain phone · go saves battery reticulum · reticulum phone power use · go idle reticulum

## Q: Can two Hubs on the same local network chat without internet?

A: Not with the default setup. Hub's managed config connects through Qortal's hubs and leaves Reticulum's local network discovery off, and Hub also checks group membership with a Qortal node. Advanced users can turn off Managed Reticulum config and add local interfaces in the Config editor, but Hub doesn't do this for you.

Also asked as: hub lan chat no internet · two hubs same network reticulum · local network q-chat hub · hub offline lan · reticulum lan between hubs

## Q: How often is Group Score updated?

A: It is worked out in six-hour slots based on Qortal network time, so it can refresh four times a day, and saved score data is reused for up to 24 hours when a new fetch fails. A group seen for the first time can get an extra refresh, with a five-minute cooldown. The activity part comes from a public-group activity directory shared over Reticulum, the holdings part from the Qortal node.

Also asked as: group score update · group score refresh · how often group score changes · group score activity data · group score six hours

## Q: Why does GO keep a link free for my own Hub?

A: So your own devices can always reach each other. GO's Reticulum bridge reserves an incoming link slot for your own devices, so Saved Messages and settings sync still get through when the phone's other link slots are full of other peers.

Also asked as: go link slot own hub · reserved link own device · go saved messages link · own device link reticulum · go inbound slot hub

## Q: What happens to Reticulum chat when my Qortal node is down?

A: Messages still travel over Reticulum, but anything that needs the node waits: devices confirm group membership and admin rights with it, so accepting new messages, calendars and admin changes can be slower until it answers. GO keeps serving recent history to members the node confirmed within the last hour, and a not-a-member answer from the node always wins.

Also asked as: node down reticulum chat · node offline reticulum chat · chat when node unreachable · membership check node down · reticulum chat needs node

## Q: Is Reticulum Q-Chat still experimental?

A: It is the main Q-Chat in Hub 3.0 and GO 3.0 and is on by default, but it is still developing fast. qortal.org calls Reticulum-backed communication an evolving layer, marks group voice as beta, and notes that the hosted web version of Hub is still on an older build. Hub's own setting still describes the Reticulum group chat transport as experimental.

Also asked as: is reticulum chat beta · reticulum q-chat experimental · group voice beta · is reticulum chat finished · reticulum chat stable

## Q: Can a Reticulum address move to another network?

A: Yes. A Reticulum address belongs to a key, not a place, so a device can take it from Wi-Fi to a LoRa mesh to the internet, or even to a different Reticulum network. It only has to send a new announce where it is now, and after a short while it can be reached there.

Also asked as: reticulum address portable · move reticulum destination · reticulum roaming address · reticulum address and location · reticulum address change network

## Q: Does any Reticulum node know the full route to a destination?

A: No. Each transport node only knows the best next hop that brings a packet one step closer to its destination, and nothing about the rest of the way. Paths are pieced together hop by hop from announces.

Also asked as: reticulum full route · reticulum next hop · who knows the path reticulum · reticulum route knowledge · reticulum path one hop

## Q: Can Reticulum transport nodes see who is talking to whom?

A: No. Transport nodes forward traffic blindly, using cryptographic proofs, and know only their immediate surroundings, while packets carry no source address. They can't read the encrypted contents either, or pick out traffic by sender or type.

Also asked as: reticulum transport privacy · can transport nodes see traffic · reticulum relay sees who talks · reticulum metadata privacy · reticulum hub sees senders

## Q: How quickly does a Reticulum network learn about a new device?

A: Quickly. A new device's announce spreads in a predictable way, and the manual says even very complex networks using the full 128 hops reach end-to-end connectivity in about a minute, given enough bandwidth. Slow parts of a network, such as LoRa, catch up over time and look up the paths they actually need.

Also asked as: reticulum convergence time · how fast reticulum finds a device · reticulum announce spread · reticulum new node reachable · reticulum network convergence

## Q: Can Reticulum work without any transport nodes?

A: Yes. Without transport nodes, devices within range of each other, for example on the same radio channel or local network, can still talk directly. Transport nodes are only needed to carry traffic over several hops.

Also asked as: reticulum no infrastructure · reticulum without transport nodes · reticulum direct communication · reticulum without a hub · reticulum devices in range

## Q: Can anyone filter or slow down certain kinds of Reticulum traffic?

A: Not by content or sender. All Reticulum traffic is encrypted with fresh keys and carries no source address, so the transport and routing layers can't inspect it, prioritise it or throttle one kind over another: they pass all traffic equally. Only announces follow their own bandwidth rules.

Also asked as: reticulum traffic filtering · reticulum throttling · reticulum traffic censorship · reticulum deep packet inspection · reticulum traffic priority

## Q: Can I make a private, closed Reticulum network?

A: Yes. You can add authentication to any interface, even old devices such as modems, with a network name and passphrase, so only nodes that know them get in. Open and closed interfaces can be mixed on the same system. Qortal Hub and GO use a named network, qortal-hub, on their hub links.

Also asked as: private reticulum network · closed reticulum network · reticulum passphrase network · reticulum network for my family · restrict reticulum access

## Q: What is a network identity in Reticulum?

A: It is an ordinary Reticulum identity that several transport nodes share to show they belong to the same network, like one flag flown by a fleet of ships. Today it is used mainly for interface discovery: it signs discovery announces, and can encrypt them so only nodes holding that identity can read the connection details.

Also asked as: reticulum network identity · network_identity reticulum · reticulum shared identity · reticulum network signing key · identity for a reticulum network

## Q: What is the mesh network identity that Qortal Hub ships with?

A: Every Hub comes with the same bundled Reticulum network identity and community mesh passphrase. Hub uses them for its mesh listen interface: a Hub that can be reached from the internet announces itself as a gateway in encrypted discovery announces, which only other Hubs holding that identity can read, so Hubs can find and connect to each other's gateways.

Also asked as: hub mesh network identity · mesh-network.identity · hub private gateway · hub mesh listen interface · qortal hub mesh gateway

## Q: What is a bootstrap-only interface in Reticulum?

A: It is an interface Reticulum uses mainly to find better connections. With interface discovery and auto-connect on, a bootstrap_only interface, such as a TCP tunnel to a wider network, helps your node discover nearby or more relevant interfaces and is dropped once enough have been found. That keeps the network from leaning on a few central entry points.

Also asked as: bootstrap_only reticulum · reticulum bootstrap interface · temporary reticulum entry point · reticulum bootstrap connection · reticulum discover then disconnect

## Q: Why shouldn't everyone connect to the same few Reticulum entry points?

A: Because it brings back the centralisation Reticulum is meant to avoid: if everyone dials the same handful of public servers, the network becomes brittle. The manual suggests temporary bootstrap links plus interface discovery instead, so devices find local infrastructure and form more direct links.

Also asked as: reticulum central entry points · reticulum public servers brittle · reticulum organic growth · reticulum hard-coded entrypoints · reticulum decentralised bootstrapping

## Q: Should I run my own Reticulum node at home?

A: The Reticulum manual encourages it. Rather than connecting every phone and computer straight to a distant public gateway, use an old computer, a Raspberry Pi or a supported router as your own transport node, on your Wi-Fi and perhaps with a radio such as an RNode, with interface discovery on. For Qortal, an always-on Hub with Community transport is the simplest way to help.

Also asked as: home reticulum node · personal reticulum infrastructure · run reticulum transport at home · reticulum home server · my own reticulum node

## Q: How much does it cost to set up a Reticulum node?

A: Very little. The manual's reference setup, a LoRa radio with open-source firmware on USB plus any Linux computer such as a Raspberry Pi, should get you on a Reticulum network for around 100 dollars even if you buy everything. Over Wi-Fi or the internet you already have, it costs nothing extra.

Also asked as: reticulum node cost · cheap reticulum setup · reticulum 100 dollars · reticulum reference setup · price of a reticulum node

## Q: What is the Zen of Reticulum?

A: It is the essay in the Reticulum manual on the system's philosophy. Its main ideas: there is no cloud, only other people's computers; an address should name who you are, not where you are; assume every link is hostile, so encryption is built in rather than added on; trust math, not institutions; treat low bandwidth as a design discipline; and build your own personal infrastructure.

Also asked as: zen of reticulum · reticulum philosophy · reticulum design principles · why reticulum is designed this way · reticulum manifesto

## Q: Why can't Reticulum run without encryption?

A: Because its routing depends on it. Transport nodes use the per-packet encryption and signatures to verify paths and keep them alive, so plain, unencrypted packets can't travel over several hops at all; they only reach nodes in direct range. The Zen of Reticulum puts it as: encryption is not a feature.

Also asked as: reticulum without encryption · disable reticulum encryption · reticulum plain multi-hop · encryption not a feature reticulum · unencrypted reticulum

## Q: What is Reticulum Relay Chat?

A: Reticulum Relay Chat (RRC) is a live chat system on Reticulum, close in spirit to IRC: you connect, join a room and talk. It keeps no message history on purpose; if you weren't there, you didn't see it. The rrcd program runs an RRC hub, and clients include Nomad Network and MeshChatX. It is separate from Qortal's Q-Chat.

Also asked as: reticulum relay chat · rrc reticulum · rrcd · irc over reticulum · rrc chat rooms

## Q: What is Partyline?

A: Partyline is a group voice app for Reticulum, built on LXST and inspired by Mumble. It offers real-time group voice over any Reticulum link faster than about 6 kilobits per second, LXST dial-in, and listen-only rooms for music or broadcasts.

Also asked as: partyline reticulum · reticulum group voice app · mumble for reticulum · partyline lxst · reticulum voice rooms

## Q: What is Retipedia?

A: Retipedia lets you host all of Wikipedia, StackExchange or any other .zim file and serve it to Nomad Network clients over Reticulum.

Also asked as: retipedia · wikipedia over reticulum · offline wikipedia reticulum · zim file reticulum · nomadnet wikipedia

## Q: What is RNS FileSync?

A: RNS FileSync keeps files in sync between devices over Reticulum, with no central servers, internet or cloud services needed. It works over any medium Reticulum supports, such as radio, LoRa, Wi-Fi or the internet.

Also asked as: rns filesync · reticulum file sync · sync files over reticulum · reticulum offline file sharing · filesync over lora

## Q: What is Ren Browser?

A: Ren Browser is a standalone browser for Nomad Network pages built on Reticulum-Go, an implementation of Reticulum in the Go language. It can run its own embedded Reticulum or use a shared Reticulum instance already running on the computer. It is alpha software, still under active development.

Also asked as: ren browser · golang reticulum · ren browser alpha · ren browser nomadnet · ren reticulum browser

## Q: What is Modem73?

A: Modem73 is an open-source software modem for Reticulum that works with any HF, VHF or UHF radio able to pass 2400 Hz of bandwidth. Besides the radio you only need a sound card and an audio cable; its companion Modem73Interface connects it to Reticulum.

Also asked as: modem73 · reticulum sound card modem · hf radio reticulum modem · software modem reticulum · reticulum audio cable radio

## Q: How do I run Reticulum as a service at boot?

A: Install rnsd as a systemd service:
1. With a pip install, link rnsd into a system path: sudo ln -s $(which rnsd) /usr/local/bin/
2. Create /etc/systemd/system/rnsd.service that runs rnsd --service as your user.
3. Start it with sudo systemctl start rnsd and turn it on at boot with sudo systemctl enable rnsd.
A per-user service under ~/.config/systemd/user works too.

Also asked as: rnsd systemd · reticulum start at boot · rnsd service linux · reticulum autostart · rnsd --service

## Q: Can I manage a Reticulum node remotely?

A: Yes. Set enable_remote_management = yes in the [reticulum] section and list the identity hashes allowed to query it in remote_management_allowed. Tools such as rnstatus and rnpath can then check that node from another machine over Reticulum.

Also asked as: reticulum remote management · enable_remote_management · rnstatus remote node · manage rnsd remotely · reticulum remote status

## Q: What does rnpath do?

A: rnpath looks up and manages paths to destinations: give it a destination hash and it tells you how many hops away it is and through which interface. It can also list the whole path table (-t), show announce rates (-r) and drop a path (-d).

Also asked as: rnpath command · reticulum path lookup · rnpath table · how many hops to reticulum destination · drop reticulum path

## Q: How do I see which interfaces my Reticulum node has discovered?

A: With discover_interfaces on, run rnstatus -d to list discovered interfaces with their type, status, when they were last heard and their stamp value. rnstatus -D followed by a name shows full details, including a ready-to-paste config entry, and --json exports the list.

Also asked as: rnstatus -d · list discovered interfaces · reticulum discovered entrypoints · rnstatus discovered · reticulum interface discovery list

## Q: How big are common Reticulum packets?

A: Small. On the wire, without access codes, a path request is 51 bytes, an announce 167, a link request 83, a link proof 115, a link RTT packet 99 and a link keepalive 20. A single packet carries up to 465 bytes of data.

Also asked as: common reticulum packet sizes · reticulum announce size bytes · reticulum link request size · reticulum overhead bytes · reticulum keepalive size

## Q: How does GO run Reticulum without installing Python?

A: GO carries its own Python runtime inside the app and runs the same Reticulum code and Qortal bridge as Hub, inside GO's own process. Unlike Hub, which starts a separate Reticulum daemon, GO runs Reticulum standalone and connects straight to the Qortal hubs.

Also asked as: go python reticulum · go bundled python · how go runs reticulum · go reticulum standalone · reticulum inside go app

## Q: Does the hosted web version of Hub have Reticulum chat?

A: Not yet. qortal.org says Hub and Q-Chat are being rebuilt around Reticulum quickly, and hosted access stays on an earlier version until a new hosted build is ready. For Reticulum Q-Chat, use the installed Qortal Hub or Qortal GO.

Also asked as: hosted hub reticulum · web hub reticulum chat · browser hub old version · hosted qortal hub q-chat · online hub reticulum

## Q: Can I edit or delete a message from my other device?

A: Yes. Edits and deletes are checked against your Qortal account, not the device, so any device signed in with your account can change or remove that account's messages. Reactions also count once per account across your devices.

Also asked as: edit message from other device · delete message from hub sent on go · reactions across my devices · edit q-chat message second device · account level edits reticulum

## Q: Does Hub sign Reticulum messages without asking me?

A: Yes, for chat traffic: Hub and GO sign your messages, online status and similar Reticulum messages with your account key automatically. They only sign message types on a fixed list, with the expected fields and size limits, and refuse anything else. Payments and other blockchain transactions still need your approval.

Also asked as: reticulum signing approval · hub signs chat automatically · does go ask to sign messages · reticulum signing policy · chat signatures without approval

## Q: Where are Hub's Reticulum logs?

A: Hub writes its Reticulum log to reticulum.log, in the logs folder inside Hub's app data folder. Include it, or the relevant part, when you report a Reticulum problem in Hub.

Also asked as: hub reticulum log · reticulum.log · where are reticulum logs hub · hub logs reticulum problem · rnsd log hub

## Q: Why does Hub need a Qortal node if chat goes over Reticulum?

A: Because the node holds the blockchain's facts. Hub and GO ask it who is a member or admin of each group and look up names, and they use it for everything else on chain, such as your wallet, Q-Apps and QDN. Reticulum only carries the messages.

Also asked as: why hub needs node for chat · reticulum chat qortal node · node and reticulum chat · does reticulum chat need core · chat membership from node

## Q: Why do my devices show different online counts?

A: Each device counts the Qortal accounts it currently hears on the Reticulum network through its own links, so two devices can show slightly different numbers at the same moment. The count also includes your own account.

Also asked as: online count differs · different online numbers hub go · why online count changes · online accounts mismatch · reticulum online count varies

## Q: Why does my contact show offline even though they use GO?

A: Online status only reaches you while their device is connected to the Reticulum network and sending it. A phone whose GO is closed, paused in the background or without network, or set to appear Offline, shows as offline, and calls to them can't start.

Also asked as: contact shows offline go · why is my friend offline qortal · offline but has go · contact offline voice call unavailable · presence offline contact

## Q: What happens if one of Qortal's Reticulum hubs goes down?

A: Hub and GO keep links to several hubs from their built-in list, so traffic carries on through the others. A hub that stays down is retried with growing pauses, up to a minute apart, instead of every few seconds.

Also asked as: qortal hub down · reticulum hub offline · hub server down chat · what if a reticulum hub fails · hub links drop

## Q: What does UPnP do for Hub's Reticulum?

A: Hub asks your router through UPnP to open TCP port 4243 for its Reticulum mesh listener, and learns your public address from the router so it can tell other Hubs where to reach it. If your router doesn't allow UPnP, Hub still works through the Qortal hubs, and you can forward the port yourself instead.

Also asked as: hub upnp reticulum · upnp port 4243 · router upnp hub mesh · hub reticulum upnp failed · forward port 4243

## Q: Does Reticulum chat use a lot of mobile data?

A: It is light, but a phone on a busy network keeps a steady trickle going: online status, chat notices and summaries from its links. GO keeps it down by limiting links and not relaying for others on battery or mobile data. GO's Reticulum details show the Received and Sent totals since Reticulum started, so you can check.

Also asked as: reticulum data usage · does q-chat use much data · go mobile data reticulum · reticulum bandwidth phone · chat data consumption go

## Q: Why can't I send files in Q-Chat with Reticulum chat off?

A: Q-Chat attachments travel only over Reticulum, so with Reticulum chat off Hub shows that file attachments require Reticulum chat. Turn Reticulum, or the Reticulum group chat switch, back on to send files.

Also asked as: attachments need reticulum · cant send files q-chat · file attachments require reticulum chat · reticulum off no attachments · send file in legacy chat

## Q: What does "Reticulum image file is not available" mean?

A: The picture's file isn't on this device and couldn't be fetched from another device right now, often because the members who have it are offline. It can load once a device that holds the file is reachable again.

Also asked as: reticulum image not available · chat image not loading reticulum · picture unavailable q-chat · image file not available hub · reticulum picture missing

## Q: What does Hubs 2/6 mean in Hub's Reticulum status?

A: It means 2 of the 6 Qortal hubs in Hub's list are connected right now. One connected hub is enough for Hub to count as hub-connected; more give it spare routes.

Also asked as: hubs 2/6 hub settings · hub reticulum hubs count · hubs online configured · reticulum hubs status in hub · how many hubs connected hub

## Q: Does Reticulum start before I sign in?

A: In GO, no: Reticulum and the chat engine start only after you sign in, so they don't slow down unlocking. In Hub, the Reticulum daemon starts when the app opens, and chat and online status begin once you are signed in.

Also asked as: reticulum before login · reticulum starts at login go · reticulum on lock screen · when does reticulum start · reticulum startup go hub

## Q: Can I use the same account on two computers with Hub?

A: Yes. Each Hub installation has its own Reticulum identity and message stream, and chat for your account reaches both. Reading a chat on one marks it read on the other, and either can edit or delete your messages. Don't copy one computer's Hub data folder to the other; install Hub there and sign in instead.

Also asked as: same account two hubs · hub on two computers · multi computer qortal hub · two hub installations same account · hub laptop and desktop same account

## Q: Can Sideband and Columba users message each other?

A: Yes. Both are LXMF apps, and Sideband works with all other LXMF clients, so Sideband, Columba, Nomad Network and MeshChatX users can message each other whenever their devices can reach each other over Reticulum.

Also asked as: sideband columba compatible · sideband to columba · lxmf apps interoperate · meshchatx sideband messages · lxmf clients talk

## Q: What is LXMFy?

A: LXMFy is a framework for building bots and automations that run over LXMF and Reticulum. Bots built with it exist for things like Home Assistant control and LLM integrations.

Also asked as: lxmfy · lxmf bot · reticulum bot framework · lxmf automation · bot over reticulum

## Q: What is RetiBBS?

A: RetiBBS is an old-school bulletin board system for Reticulum networks, where users communicate securely through message boards.

Also asked as: retibbs · reticulum bbs · bulletin board reticulum · reticulum message boards · bbs over reticulum

## Q: What are rnsd and presence_bridge running on my computer?

A: They are the two parts of Hub's Reticulum. rnsd is the Reticulum daemon that holds the network connections, shared by all open Hub windows. presence_bridge is Hub's helper that carries online status, chat, calls and file transfers over Reticulum for the app. Both ship inside Hub and are stopped when Hub quits.

Also asked as: presence_bridge process · rnsd process hub · hub background processes · what is presence bridge · rnsd running on my computer

## Q: What does "Reticulum chat is disabled" mean?

A: Reticulum chat is switched off on this Hub (Enable Reticulum, or the Reticulum group chat switch), so Reticulum chat features don't run there; notification settings, for example, then stay on that device instead of syncing. Turn the switch back on in Hub's Settings to use them.

Also asked as: reticulum chat is disabled message · reticulum chat disabled hub · turn on reticulum chat · reticulum disabled settings stay on device · why is reticulum chat off

## Q: Does Qortino use Reticulum?

A: No. Qortino's model is fetched once from QDN and assembled on your phone; after that it answers fully offline. Nothing you ask it goes over Reticulum or anywhere else.

Also asked as: qortino reticulum · does qortino use the network · qortino offline reticulum · qortino internet connection · is qortino sending data

## Q: Does Torq use Reticulum?

A: No. Torq posts, replies, likes and follows are published on QDN under your registered name, the same data Quitter uses. In Hub and GO, Reticulum carries chat, online status and calls, not Torq.

Also asked as: torq reticulum · torq posts network · torq qdn or reticulum · torq over reticulum · is torq on reticulum

## Q: Does Q-Mail go over Reticulum?

A: No. Q-Mail keeps mail on QDN as encrypted mail resources under registered names, and your node fetches them like other QDN data. Reticulum carries Q-Chat, not Q-Mail.

Also asked as: q-mail reticulum · does q-mail use reticulum · q-mail network · q-mail qdn · q-mail vs q-chat transport

## Q: Why might a Reticulum hub refuse my connection for a while?

A: Reticulum's Backbone listeners automatically block an IP address that keeps connecting for a few seconds and dropping. By default that is 5 quick connections lasting under 20 seconds each, and the block lasts 12 hours. Avoid restarting Reticulum or switching networks over and over in a short time; other hubs in the list can still carry your traffic.

Also asked as: reticulum hub blocks me · reticulum fast flapping · hub refuses connection reticulum · reticulum ip blocked · too many reconnects reticulum

## Q: How does Reticulum protect public entry points from spam?

A: With several limits. Announces may use only a small share of bandwidth; when a burst of announces for brand-new destinations arrives on a public interface, Reticulum holds them so traffic for known destinations keeps flowing, and releases them once things calm down. Path requests have similar burst control, and announced interfaces need a valid cryptographic stamp.

Also asked as: reticulum ingress control · new destination rate limiting · reticulum announce burst · reticulum spam protection · path request burst control

## Q: How often should a Reticulum app announce?

A: Rarely. The Reticulum manual says most apps can announce when they start and then about once every 6 hours, and that needing to announce more than once an hour usually means the design is wrong. Interfaces can also enforce a minimum time between announces from one destination (announce_rate_target).

Also asked as: reticulum announce frequency · how often to announce reticulum · announce rate target · reticulum app announce interval · too many announces reticulum

## Q: Does Reticulum chat work on networks that only allow web traffic?

A: It may not. Hub and GO need to reach Qortal's Reticulum hubs over TCP on ports such as 4400 and 4444, so a network that only lets web browsing through can block them, and chat then can't connect even though websites load. Try another network, such as mobile data.

Also asked as: reticulum firewall · reticulum blocked network · q-chat school work network · reticulum ports blocked · chat not connecting firewall

## Q: What can Nomad Network do?

A: Nomad Network is a terminal-based program with a complete encrypted communications suite: LXMF messaging (direct, or delayed delivery for people who are offline), file sharing, a built-in text browser and a page server with dynamic pages and user logins, plus an RRC chat client and network tools.

Also asked as: nomad network features · nomadnet terminal app · nomadnet page server · nomadnet file sharing · nomadnet lxmf messaging

## Q: What is Micron in Nomad Network?

A: Micron is the markup language Nomad Network pages are written in. Web-based Nomad Network browsers display it with the Micron Parser JS library, and apps such as Columba include their own page browser.

Also asked as: micron markup · nomadnet micron · micron pages reticulum · micron parser · nomad network page format

## Q: What is a Reticulum instance?

A: Any system running Reticulum is an instance: it can create destinations, send and receive, set up links and host services others can reach. A transport node is an instance that has also been set to route traffic for others. Phones, laptops and sensors are normally plain instances.

Also asked as: reticulum instance · instance vs transport node · rns instance · reticulum node types · reticulum client node

## Q: Can I host a service from home on Reticulum?

A: Yes. Any Reticulum instance can host destinations that anyone on the network can connect to, so you can offer a globally reachable service from your home or office, as long as there is some physical path for the packets.

Also asked as: host service reticulum home · reticulum server at home · reticulum hosting · publish service reticulum · reticulum home server reachable

## Q: What is the difference between a Reticulum identity and a destination?

A: An identity is a set of keys that stands for a person, device, program or service. A destination is an endpoint built from an identity plus an app name, and one identity can create any number of destinations. Whoever holds the identity's private keys controls all of its destinations, so those keys must be kept private.

Also asked as: reticulum identity vs destination · identity and destination reticulum · one identity many destinations · reticulum destination owner · reticulum identity destinations

## Q: Why does Reticulum use 16-byte addresses?

A: It is a trade-off between address space and packet size. 16 bytes (128 bits, from a truncated SHA-256 hash) is enough for many billions of devices on one network while keeping packets small, which matters on slow links. The manual notes that a one-line change could raise it to 256 bits if ever needed.

Also asked as: reticulum address size · 128 bit reticulum address · reticulum address space · why 16 bytes reticulum · reticulum hash length

## Q: What happens on Reticulum when I switch accounts in Hub or GO?

A: The device keeps its own Reticulum identity and stays connected. The new account signs its own short-lived link to that device, and the old account's link expires or is removed, so messages for each account only route through the device while that account is signed in there.

Also asked as: switch accounts reticulum · change account reticulum identity · reticulum account switch · multiple accounts one device reticulum · reticulum lease account

## Q: How does Reticulum chat cope with very large groups?

A: Its syncing is built around the messages that are missing, not the size of the group: devices swap compact summaries and pages of events and never need full member lists. Large lists, such as all the groups an account follows, are split into pages that fit Reticulum's packets.

Also asked as: reticulum chat large groups · q-chat big group sync · reticulum chat thousands of members · q-chat scale · reticulum many groups sync

## Q: Why can't I read a group's chat right after joining?

A: Devices only hand out a group's messages to accounts the Qortal node confirms as members, so your join has to be confirmed on the chain first. Once it is, members' devices start sharing the group's history with you, and it fills in as you open the chat.

Also asked as: new group chat empty · joined group no messages · group chat after joining reticulum · cant see group messages after join · group history after join

## Q: Does Reticulum run on Windows and macOS?

A: Yes. Install Python (on Windows, tick the option to add it to PATH), then run pip install rns from the command line; on macOS use pip3. The fast Backbone interface works only on Linux and Android, so on Windows and macOS you use the TCP interfaces instead, as Qortal Hub does.

Also asked as: reticulum windows · reticulum macos · install reticulum on windows · reticulum mac install · reticulum desktop os

## Q: Can Reticulum run on an OpenWRT router?

A: Yes, on routers with enough storage and memory. Install python3, python3-pip, python3-cryptography and python3-pyserial with opkg, then pip install rns. The manual tested this on OpenWRT 21.02; you may need firewall rules and your own startup script, and pre-built OpenWRT packages are being worked on.

Also asked as: reticulum openwrt · reticulum on router · openwrt rnsd · install reticulum router · reticulum home router

## Q: Can I run Reticulum on Android without an app like Sideband?

A: Yes, with Termux, a Linux terminal environment for Android. In Termux run pkg update and pkg upgrade, install python and python-cryptography with pkg, update pip, then pip install rns. For everyday messaging an app like Sideband is easier, and Qortal GO already has Reticulum built in.

Also asked as: reticulum termux · rnsd on android · termux reticulum install · reticulum command line android · pip install rns android

## Q: Does Reticulum collect telemetry or analytics?

A: No. The Reticulum project states that absolutely no automated analytics, telemetry, error reporting or statistics are collected and reported by Reticulum under any circumstances; it relies on people sending feedback by hand.

Also asked as: reticulum telemetry · reticulum analytics · does reticulum track me · reticulum error reporting · reticulum statistics collection

## Q: How can I support Reticulum development?

A: The project accepts donations (Monero, Bitcoin, Ethereum, Liberapay and Ko-Fi are listed on its support page), plus well-informed feedback, code and learning resources. Running a well-placed transport node or sharing useful interfaces also helps the wider network.

Also asked as: support reticulum · donate to reticulum · help reticulum project · reticulum donations · contribute to reticulum

## Q: Why does pip refuse to install Reticulum on my Linux system?

A: Newer Debian and Ubuntu releases block pip installs by default. Use pipx install rns, or run pip install rns --break-system-packages, which despite its name doesn't break system packages, or allow it permanently with break-system-packages = true in the [global] section of ~/.config/pip/pip.conf. If a dependency won't build, install your system's build-essential package first.

Also asked as: pip install rns error · externally managed environment reticulum · break-system-packages rns · pipx install rns · install reticulum ubuntu debian

## Q: Which Raspberry Pi OS should I use for Reticulum?

A: A 64-bit Raspberry Pi OS. The manual recommends it because 32-bit versions don't always have packages for some dependencies. Install python3, python3-pip, python3-cryptography and python3-pyserial with apt, then pip install rns --break-system-packages.

Also asked as: reticulum raspberry pi os · 64-bit pi reticulum · 32-bit raspberry pi reticulum · install reticulum raspberry pi · pi os for rnsd

## Q: What is a hop in Reticulum?

A: A hop is one step from one node to the next. A packet that goes from your device to a hub and on to another device has travelled two hops. Reticulum counts hops in every packet, prefers announces from fewer hops away, and allows up to 128.

Also asked as: reticulum hop meaning · hops reticulum · what does hops mean rns · reticulum hop count · multi hop reticulum meaning

## Q: How does Reticulum find someone's public key?

A: Usually from their announce, which carries the destination's public key and is signed by it. If your device knows only the destination hash, it can ask the network for the key: transport nodes act as a distributed store of public keys. Keys can also be shared other ways, such as a QR code.

Also asked as: reticulum public key lookup · get public key reticulum · reticulum key from destination hash · reticulum key distribution · unknown public key reticulum

## Q: How do I know I'm talking to the right Reticulum destination?

A: A Reticulum address is tied to a key, and only the holder of that private key can read traffic to it or prove a link to it, so no one else can answer as that address. What you must check is that you have the right address: compare the destination hash with the person through another channel, such as in person or by QR code.

Also asked as: verify reticulum destination · reticulum impersonation · check reticulum hash fingerprint · trust reticulum contact · reticulum fake destination

## Q: Why does Hub's Reticulum config say Managed by Qortal Hub?

A: That first line marks a config Hub wrote itself. While Managed Reticulum config is on, Hub may rewrite a file with that marker at startup; a config without it is treated as your own and left alone. To keep your edits safe, turn off Managed Reticulum config, or remove the marker line.

Also asked as: managed by qortal hub · hub config marker · hub overwrites reticulum config · keep custom reticulum config hub · reticulum config reset by hub

## Q: Why does Hub restart Reticulum by itself?

A: When Hub's mesh settings change, for example it learns your public address through UPnP or its gateway or transport settings change, it rewrites its managed Reticulum config and restarts Reticulum so the change takes effect. Chat and calls reconnect a moment later.

Also asked as: hub restarts reticulum · reticulum restarted hub · hub reticulum reload · reticulum restarts after upnp · hub rewrites reticulum config

## Q: Is Columba open source?

A: Yes. Columba is published under the Mozilla Public License 2.0, and its source code and releases are on the Columba project's repository. reticulum-kt, the Kotlin Reticulum by the same developers, uses the same license.

Also asked as: columba license · columba source code · columba mpl · is columba free · columba open source license

## Q: What do the WebRTC and Reticulum labels mean in a Hub group call?

A: They show how your call audio is travelling. WebRTC means the audio goes over direct WebRTC links between participants; Reticulum means it is using the Reticulum fallback, for example because a direct link couldn't be made. The audio is encrypted with the call's room key either way.

Also asked as: group call webrtc label · group call reticulum fallback · audio is using the reticulum fallback · hub group call transport label · webrtc or reticulum group call

## Q: What audio codec do Qortal calls use?

A: Opus. Group call audio is cut into 20 ms frames, encoded once as 48 kHz mono Opus (with in-band error correction where supported), and encrypted with the room key before it is sent. Receivers decrypt it, smooth out timing in a jitter buffer, decode it and play it.

Also asked as: qortal call codec · opus qortal calls · group call audio format · call audio quality qortal · qortal voice codec

## Q: How do I let devices on my Wi-Fi reach a LoRa Reticulum network?

A: Make one machine a gateway: give it the outside interface (for example an RNode), turn on transport, and keep it on your Wi-Fi. Other devices on the same Wi-Fi then reach the wider network through it with just Reticulum's default AutoInterface configuration.

Also asked as: reticulum gateway wifi lora · wifi devices reach lora · reticulum gateway node · share rnode with wifi devices · lora gateway home wifi

## Q: Does Reticulum work over IPv6?

A: Yes. AutoInterface uses link-local IPv6 to find peers on a local network, and the Backbone interface carries TCP over IPv4 and IPv6; on a device with both, prefer_ipv6 makes it use the IPv6 address.

Also asked as: reticulum ipv6 · reticulum ipv4 ipv6 · prefer_ipv6 reticulum · reticulum link-local ipv6 · ipv6 rns

## Q: Can Reticulum run over Yggdrasil?

A: Yes. A Backbone interface can listen on the Yggdrasil tun device (for example device = tun0 with a port), or connect to a remote's Yggdrasil IPv6 address and port, so Reticulum runs on top of Yggdrasil like any other IP network.

Also asked as: reticulum yggdrasil · yggdrasil rns · backbone over yggdrasil · reticulum tun0 yggdrasil · yggdrasil reticulum interface

## Q: Can I turn off Community call support and still make calls?

A: Yes. Turn it off on the System tab of Hub's Settings if you don't want your Hub to offer a STUN service, which shares your public IP anonymously with other Hub users. Your Hub still uses the STUN servers other Hubs announce, and calls fall back to Reticulum whenever a direct link can't be made.

Also asked as: turn off community call support · disable hub stun service · calls without community stun · community call support off · stop sharing ip hub calls

## Q: Can I turn off Reticulum in GO?

A: There is no switch for it: GO's chat, calls and online status all run over Reticulum, so it is on while you are signed in. With Background sync set to Off, GO's chat pauses about a minute after you leave the app, and swiping GO away or logging out pauses its Reticulum connection.

Also asked as: disable reticulum go · go without reticulum · reticulum switch go · turn off reticulum phone · go reticulum setting

## Q: Can I add my own Reticulum hubs to GO?

A: No. GO writes its own Reticulum config with a built-in list of Qortal hubs each time it starts, and it has no Reticulum settings or config editor. Changing hubs and interfaces is only possible in the desktop Hub's Reticulum settings.

Also asked as: add reticulum hub go · custom hub go reticulum · change go reticulum hubs · go reticulum config editor · go hub list

## Q: How does proximity voice in Qortal Land work?

A: It is voice between people whose avatars are near each other in Qortal Land, carried over Reticulum links between their devices. Each Land session signs, with its account key, a short-lived capability tied to its exact Reticulum address, and both sides check it before the voice link starts. Blocking an account blocks it across all of its sessions.

Also asked as: qortal land proximity voice · proximity voice reticulum · land voice chat · qortal land voice nearby · proximity audio qortal land

## Q: How do Qortal Land games connect the players?

A: Directly between the two players' devices over Reticulum. A challenge sends a signed invitation that names both players' Land sessions and Reticulum addresses; the other side checks it, and the game then runs over an authenticated Reticulum link that stays pinned to those two devices.

Also asked as: qortal land games reticulum · chess qortal land network · qonnect four reticulum · land game invite signed · qortal land checkers link

## Q: What does GO's Copy diagnostics report include?

A: It covers the Reticulum radio and hub links, the chat engine's state and start-up times, the WebView's capabilities and speed, whether your Qortal node answers, recent send failures, sync health, battery and background state, and the end of the engine's log. It never includes a URL or your API key (only whether one is set), and Qortal addresses, group, peer, conversation and file IDs and your own node's host are replaced with stand-in names.

Also asked as: go copy diagnostics contents · what is in reticulum diagnostics · diagnostics report go reticulum · diagnostics stand-in names · go diagnostics pseudonyms

## Q: Can Reticulum send one message to a whole group?

A: Only in a limited way. A GROUP destination uses a shared key, so everyone holding it can read what is sent to it, but such packets don't yet travel over several hops (the manual mentions a planned upgrade). Qortal group chat works differently: it keeps events on each member's device and syncs them between devices over links.

Also asked as: reticulum group message · reticulum multicast · reticulum group destination multi-hop · send to many reticulum · reticulum broadcast group
