# qortal-hardware — golden FAQ

Curated offline Q&A for Qortino (122 entries). Prefer these answers when relevant.

## Q: How much RAM does Qortal Core need?

A: Qortal Core's own notes say as little as 4 GB of RAM is acceptable in most cases, and its start script is tuned for machines with 6 GB or more. Core only uses as much memory as it needs, up to a share of the RAM set in start.sh (50% by default). On a machine with less than 6 GB, the script suggests raising that 50 to 75. For a Raspberry Pi, the Qortal wiki recommends the 8 GB model.

Also asked as: qortal core ram · how much memory for a qortal node · ram for qortal node · qortal node memory requirement · qortal java memory setting · qortal core memory use

## Q: Is a 4 GB Raspberry Pi enough for a Qortal node?

A: It works, but 8 GB is recommended. The Qortal wiki's Raspberry Pi guide says a 4 GB Pi 4 or Pi 5 will work and recommends the 8 GB model. On a machine with less than 6 GB of RAM, Core's start script suggests letting Java use 75% of the RAM instead of 50%.

Also asked as: 4gb raspberry pi qortal · pi 4 4gb qortal node · pi 5 4gb qortal · 4gb or 8gb pi for qortal · is 4gb pi enough for qortal

## Q: Should I get a Raspberry Pi 4 or a Pi 5 for a Qortal node?

A: Both work, and the Qortal wiki gives the same advice for each: 8 GB of RAM (4 GB works), a power supply, a case with a fan, and a USB 3.0 SSD of 500 GB or more. The wiki also lists community Qortal OS images for both boards (RaspiPHENIX for the Pi 4, Ra5piPHENIX for the Pi 5). Pick the one you can get and keep running all the time.

Also asked as: pi 4 or pi 5 for qortal · which raspberry pi for qortal · best raspberry pi for a qortal node · raspberry pi 5 qortal node · qortal node raspberry pi model

## Q: Do I need a fan on my Raspberry Pi node?

A: Yes. The Qortal wiki lists a case with a fan for every Raspberry Pi node and says the fan is important. The QORTector guide goes further: do not run the device if the fan isn't spinning after you power it on, because the board can overheat.

Also asked as: raspberry pi fan qortal · pi node overheating · qortector fan not spinning · case with fan for qortal pi · cooling a qortal raspberry pi

## Q: Can I run a Qortal node from a microSD card?

A: It works, but an SSD is recommended. The Qortal wiki says a 128 GB microSD card will work in a Pi 4 or Pi 5, and recommends a USB 3.0 SSD of 500 GB or more instead. You can write the Qortal OS image straight to the SSD with Balena Etcher and start the Pi from it.

Also asked as: microsd card qortal node · sd card or ssd for qortal · raspberry pi sd card qortal · 128gb sd card qortal node · boot qortal pi from ssd

## Q: What size SSD should I buy for a Qortal node?

A: For a Raspberry Pi node the Qortal wiki recommends a USB 3.0 SSD of 500 GB or more, plugged into one of the Pi's blue USB 3.0 ports, and the QORTector comes with a 500 GB SSD. The wiki's general guide gives about 50 GB as the starting need, and says you will likely need more once you use QDN, because your node keeps copies of the sites and apps you open and the names you follow.

Also asked as: ssd size for qortal · 500gb ssd qortal · how big an ssd for a qortal node · qortal node drive size · ssd for raspberry pi qortal node

## Q: Does my router need UPnP for a Qortal node?

A: It helps but isn't required. If your router has UPnP turned on, a single node gets incoming connections with no setup. Without UPnP, give the node a fixed address on your network (static assignment, usually under the router's DHCP settings) and forward port 12392 (blockchain peers) and 12394 (QDN data peers) to it.

Also asked as: upnp for qortal · qortal router upnp · qortal node router settings · do i need upnp for qortal core · upnp or port forwarding qortal

## Q: Can I run a Qortal node on a limited data plan?

A: It can be hard: the Minter Guide warns that a 24/7 node may use well over 1 TB a month and recommends unlimited plans. To cut usage, the Qortal wiki suggests "maxPeers": 7 in settings.json first, since peers use the most data. For tighter plans you can also turn off relay mode ("relayModeEnabled": false) and, on a minting-only machine, QDN ("qdnEnabled": false), which means no websites or Q-Apps through that node. Stop Core before editing settings.json.

Also asked as: qortal node data usage · limited data plan qortal node · reduce qortal node bandwidth · qortal node bandwidth · metered connection qortal node · qortal maxpeers data

## Q: Can my Qortal node computer go to sleep?

A: No. Core stops while the computer sleeps, so the node falls out of sync and stops minting. Turn off sleep in the power settings of any machine you use as a node. Hub doesn't need to stay open, but Core must keep running.

Also asked as: qortal node sleep mode · does qortal core run while computer sleeps · disable sleep for qortal · computer sleep stops minting · qortal core sleep setting

## Q: Does my Qortal node need to run 24/7?

A: It's recommended, not required. A node that was off has to catch up on the blocks it missed before you can use it, and it only mints while it's online and synced. There's no other penalty. That's why many people keep a small, low-power machine such as a Raspberry Pi running as their node.

Also asked as: run qortal node 24/7 · qortal node always on · turn off qortal node at night · qortal node uptime · keep qortal node running

## Q: What happens if my Qortal node loses power suddenly?

A: Cutting power while Core is running can damage its database. The Qortal wiki says to always stop Core first, then shut the machine down, and only then switch it off. If the database does get damaged, a bootstrap rebuilds the chain data; your wallet is stored separately. A UPS gives the node time to shut down cleanly in a blackout.

Also asked as: power cut qortal node · unplug qortal node · qortal database corrupted after power loss · power outage qortal database · pulled the plug on qortal pi

## Q: Can I run a Qortal node without a monitor?

A: Yes. A QORTector starts Core in the background on its own, with or without a monitor, and any node can run headless once Core is set to start by itself. You can reach the machine from another computer over SSH or remote desktop (RDP, or VNC on some images), and use Hub on your main computer with the node added under Choose custom node. On a QORTector, plug in HDMI before powering on if you do want a screen.

Also asked as: headless qortal node · qortal pi without monitor · run qortal node without a screen · headless raspberry pi qortal · qortector without monitor

## Q: Can I use an old PC as a Qortal node?

A: Usually, yes. Qortal Core runs on any machine with Java 11 or newer, on Linux, Windows or macOS, and its notes say as little as 4 GB of RAM is acceptable in most cases. Give it an SSD with room to grow, turn off sleep, and keep it running. For Windows the Qortal wiki suggests more: a quad-core CPU, 8 GB of RAM and at least 50 GB free for the database.

Also asked as: old computer as qortal node · old pc qortal core · repurpose a computer for qortal · spare pc qortal node · mini pc qortal node

## Q: Can I run Qortal Core on an Android phone?

A: It's possible but not recommended. The Qortal wiki has a Termux guide and warns it is not for the average user: a phone node uses a lot of resources, could damage the phone, and has to stay at home on steady Wi-Fi and power. Qortal GO doesn't run Core itself; it connects to a node, your own or a public one.

Also asked as: qortal core on android · termux qortal node · phone as a qortal node · old phone as qortal node · run qortal node on android phone

## Q: Can Qortal Hub run on a Raspberry Pi?

A: Yes. The Qortal Hub release page has a Linux arm64 AppImage next to the x86 Linux, Windows and macOS builds, so it runs on a Pi with a 64-bit OS. Qortal Core runs on the Pi too, since it only needs Java 11 or newer.

Also asked as: qortal hub raspberry pi · qortal hub arm64 linux · qortal hub on pi 5 · qortal hub arm64 appimage · hub linux arm

## Q: Which computers can run Qortal Hub?

A: Qortal Hub has builds for 64-bit Windows, macOS, Linux on x86 (AppImage or .deb) and Linux on arm64 (an AppImage, for example for a Raspberry Pi). On an Android phone, use Qortal GO instead.

Also asked as: qortal hub system requirements · qortal hub windows mac linux · qortal hub 64-bit windows · qortal hub supported platforms · qortal hub download types

## Q: Why should I change the password on a Qortal Pi image?

A: Every QORTector and community Qortal OS image starts with the same default password, and it is printed in the public wiki guides. The images can be reached over SSH or remote desktop, so change it as soon as the device is set up: type passwd in a terminal. On a QORTector, set your locale first.

Also asked as: qortector default password · change password qortal pi image · qortal os default login · secure my qortector · qortal pi ssh password

## Q: Does Qortal GO work on 32-bit phones?

A: No. GO only contains native code for 64-bit ARM phones (arm64-v8a), plus x86_64 for emulators, because its Reticulum engine and Qortino run as native code. A phone that only runs 32-bit Android can't install it.

Also asked as: qortal go 32-bit phone · qortal go arm64 only · armeabi-v7a qortal go · qortal go 64-bit phone · go app wont install old phone

## Q: Does my phone need NFC to use Qortal GO?

A: No. NFC is only used by the optional Qortal Card (testing) feature, and GO installs and works on phones without it. A phone with no NFC simply can't read Qortal cards or tap other GO phones.

Also asked as: qortal go without nfc · phone with no nfc qortal go · is nfc required for qortal go · qortal go nfc phone

## Q: Which phone should I buy for Qortal GO and Qortino?

A: There is no official model list. Look for a recent 64-bit Android phone (Android 8.0 is the minimum, newer is better) with at least 6 GB of RAM so Qortino runs well, and a few GB of free storage for Qortino's model. Add NFC if you want to try Qortal Card. Some brands freeze apps in the background more than others, so check that the phone lets you allow GO in its battery settings.

Also asked as: best phone for qortal go · phone for qortino · buy a phone for qortal · recommended phone for qortal go · good phone for go and qortino

## Q: How much free storage does Qortino need?

A: Qortino's model is one download of about 2.3 GB (as GO counts it), saved in two parts. Before it starts, GO checks for that much free space plus about 300 MB spare, so plan for roughly 2.6 GB free. If a try fails partway, parts that already arrived and passed their check are kept and don't count again.

Also asked as: qortino storage space · qortino model size · space needed for qortino · qortino not enough free space · qortino download size · how many gb is qortino

## Q: How much RAM does Qortino need?

A: 6 GB of RAM or more is recommended. On phones with less, GO still lets you assemble Qortino but warns that answers may be slow and that Android may close it while it runs in the background. The model itself takes about 2.5 GB of memory while it runs, plus about 0.3 GB for its working memory.

Also asked as: qortino ram · qortino memory requirement · qortino on a 4gb phone · qortino low memory warning · phone ram for qortino

## Q: Why is Qortino slow on my phone?

A: Qortino runs a 4-billion-parameter model on your phone's own processor, so its speed depends on the phone. On a recent mid-range phone with about 8 GB of RAM, GO's tests saw 3 to 5 tokens (word pieces) a second. It is slower on phones with less than 6 GB of RAM, and the first open takes longer because the model has to load into memory.

Also asked as: qortino slow · qortino takes long to answer · qortino slow phone · speed up qortino · qortino words per second

## Q: Why does Qortino take a while to start?

A: When it opens, Qortino loads its whole model into the phone's memory ("Waking Qortino up…"); on a mid-range phone that took about 12 to 15 seconds in tests. After that it stays loaded for 90 seconds when you close Qortino (45 seconds once GO is in the background), and its instructions are saved after the first read, so later opens are much quicker.

Also asked as: qortino slow to open · waking qortino up · qortino loading the model · qortino first start slow · qortino load time

## Q: Does Android backup move Qortal GO to my new phone?

A: No. GO turns off Android's cloud backup and phone-to-phone transfer for all its data, because that data holds wallet files, Reticulum keys and chat history. To move to a new phone, install GO there and restore your account from your backup file or seed phrase, so keep those safe before you reset or give away the old phone.

Also asked as: android backup qortal go · google backup qortal go wallet · phone transfer qortal go · move qortal go to a new phone · switch phone qortal go data

## Q: Does Qortal GO work on Android 15 and 16?

A: Yes. GO is built for Android 16 and is tested on it. Android 15 and newer stop some kinds of background service after about 6 hours a day; GO runs its background connection in a way that avoids that cutoff, and on battery (unless Background sync is set to Always) it pauses itself after 6 hours instead. Opening GO reconnects.

Also asked as: qortal go android 15 · qortal go android 16 · qortal go newest android · go on new android version · android 15 background limit go

## Q: Which phone brands freeze GO in the background?

A: GO has its own steps for the battery managers of vivo/iQOO, Xiaomi/Redmi/POCO, Samsung, OPPO/realme/OnePlus and Huawei/Honor. Google, GrapheneOS, Motorola, Nokia and other phones get the general Android steps. vivo is the brand GO measured freezing apps when the screen turns off. Menu names can differ a little between models and Android versions.

Also asked as: phone brands that freeze qortal go · which phones kill qortal go · brands that stop go in the background · phone makers battery managers qortal go · does my phone brand freeze qortal go

## Q: What is the Qortal Card in GO?

A: Qortal Card (testing) lets you pay and take QORT payments by tapping, with a Qortal test card or between two GO phones, over NFC. It is off until you switch it on in Settings > System; then Qortal Card shows in the avatar menu below Notifications, with three tabs: My card, Take payment and Send. Test cards have no PIN yet, so keep only a few QORT on one.

Also asked as: qortal card go · qortal nfc card · tap to pay qortal · qortal card testing · pay with a card in qortal go · qortal payment card

## Q: How do I turn on Qortal Card in GO?

A: Open Settings > System and switch on Qortal Card (testing); it is there from GO v0.0.18. Qortal Card then appears in the avatar menu, just below Notifications.

Also asked as: enable qortal card in go · turn on qortal card · qortal card setting · where is qortal card in go · qortal card avatar menu

## Q: Which cards work with GO's Qortal Card?

A: Only Qortal test cards: smart cards that carry one of the Qortal Card test applets GO knows. Other cards and tags don't work; GO says "That is not a Qortal Card" or that the card has no Qortal Card applet. You can also skip the card and pay between two GO phones.

Also asked as: cards that work with qortal card · qortal test card · what card for qortal go · qortal card applet · qortal card compatible cards

## Q: Can I use any NFC tag or sticker as a Qortal Card?

A: No. A Qortal Card has a chip that keeps its key inside and signs each payment itself, never giving the key out. Ordinary NFC tags, stickers and fobs (such as NTAG or MIFARE chips) can't sign Qortal payments, so they can't work as a wallet. GO answers "That is not a Qortal Card" when you tap one.

Also asked as: nfc sticker as qortal card · ntag qortal wallet · nfc tag as a qortal wallet · mifare card qortal · cheap nfc tag qortal card

## Q: How do I connect a Qortal card in GO?

A: 1. Open Qortal Card from the avatar menu and go to My card.
2. Tap Connect a card and hold the card to the back of the phone; keep it still until the phone buzzes.
3. A blank card gets its own new account in the same tap, with a key GO makes from your wallet (never your main key).
If GO can't make that key, for example because the wallet is locked, you can try again or choose Make a new key on the card.

Also asked as: connect a qortal card · set up a qortal card · add a card to qortal go · link nfc card qortal go · new qortal card setup

## Q: What is the difference between Key GO can restore and Key made on the card?

A: Key GO can restore: GO makes the card's key from your wallet just for that card (never your main account's key), so GO can move the card's QORT back even without the card, and you can save a backup file. Key made on the card: only the card knows it and it never leaves the card, so there is no backup file, and if you lose the card the QORT on it is lost. The restorable key is the recommended choice.

Also asked as: key go can restore · key made on the card · qortal card key types · wallet key vs card key qortal · which key for my qortal card

## Q: Is my main Qortal account key stored on the card?

A: No. Each card gets its own account and address. With a key GO can restore, GO derives a key for that one card from your wallet; it is never your main account's key, and the card's key can't reveal your main key. Cards you connect belong to the account you are using in GO.

Also asked as: main key on qortal card · does the qortal card hold my wallet · qortal card separate account · qortal card key and main account · is my seed on the qortal card

## Q: How do I top up a Qortal card?

A: In Qortal Card > My card, tap Top up on the card. GO opens its own Send QORT screen with the card's address filled in; confirm the amount there. The card's balance updates in about a minute, once the payment is in a block.

Also asked as: top up a qortal card · add qort to my card · fund a qortal card · send qort to my qortal card · qortal card top up balance

## Q: How do I take a payment with a Qortal card?

A: 1. Open Qortal Card > Take payment and choose Card under Who pays.
2. Enter the amount and tap Charge.
3. The customer holds their card to the back of your phone.
GO checks the card's signature and balance before it sends anything, then shows Paid; the payment confirms in the next block, in about a minute. The fee is paid from the card.

Also asked as: take a payment with a qortal card · charge a qortal card · shop accepts qortal card · customer pays with qortal card · qortal card point of sale

## Q: How do I send QORT to another GO phone by tapping?

A: 1. The person receiving opens Qortal Card > Take payment, chooses GO phone and taps Ask for QORT.
2. You open Qortal Card > Send, tap Tap the other phone, and hold the two phones back to back.
3. GO opens its own Send QORT screen with their address and amount filled in.
Nothing is sent until you confirm there, and their request lasts 2 minutes.

Also asked as: tap to pay phone to phone qortal · send qort by nfc · phone to phone qortal payment · qortal go tap phones together · nfc send qort in go

## Q: How do I receive QORT from another GO phone by tapping?

A: 1. Open Qortal Card > Take payment and choose GO phone under Who pays.
2. Enter an amount if you like (it's optional) and tap Ask for QORT.
3. The other person opens Qortal Card > Send on their GO phone and holds it to the back of yours.
They confirm the payment on their own phone; yours waits and shows Received. The request times out after 2 minutes.

Also asked as: receive qort by nfc tap · ask for qort qortal card · request qort phone to phone · get paid by tap qortal go · qortal go payment request nfc

## Q: What happens if I lose my Qortal card?

A: It depends on the card's key. With a key GO can restore, GO can move the card's QORT back to your account without the card, so do that right away (Move back > All). With a key made on the card, only that card can move its QORT, so a lost card means that QORT is lost. Test cards have no PIN yet, so whoever finds one can pay with it.

Also asked as: lost my qortal card · qortal card stolen · lost nfc card with qort · recover qort from a lost card · qortal card lost funds

## Q: Can someone copy my Qortal card by tapping it?

A: No. The key never leaves the card: over NFC a phone can only read the card's public key and address. Every payment has to be signed by the card itself, and the shop's GO checks that signature before sending. But a test card has no PIN yet, so anyone holding it can make it pay; keep only a few QORT on it.

Also asked as: copy a qortal card · skim qortal card nfc · clone qortal card · read qortal card key · is a qortal card safe

## Q: Does the Qortal Card have a PIN or spending limit?

A: Not yet. Test cards have no PIN or limit, so anyone holding one can pay with it. PINs and limits need the final card program, which isn't ready yet, so for now keep only a few QORT on a card.

Also asked as: qortal card pin code · qortal card limit · qortal card spending limit · set a pin on qortal card

## Q: How do I move QORT back from a Qortal card to my account?

A: In Qortal Card > My card, tap Move back on the card and choose All, Amount or Percent. The fee comes off the card on top, and the form shows what stays on it. A card with a key GO can restore needs no tap; a card with its own key must be held to the phone to sign. Your balance updates in about a minute.

Also asked as: move back qortal card · withdraw qort from a qortal card · empty a qortal card · qortal card qort back to wallet · qortal card move back all

## Q: Can I back up a Qortal card?

A: Yes, if it has a key GO can restore. In the card's More (⋮) menu choose Save backup file and set a password; GO saves a password-protected backup of the card's account to Documents/Qortal Go. It opens in GO or Hub like any Qortal backup file, even without the card. A card that made its own key has no backup file, because that key never leaves the card.

Also asked as: qortal card backup file · back up my nfc card · save a qortal card backup · restore qortal card without the card · qortal card backup password

## Q: Where do I hold the Qortal card on my phone?

A: Hold it to the back of the phone and keep it still until the phone buzzes. If it slips away mid-read, GO tries again by itself; if it says "The card moved away too soon", tap again and hold it steady. NFC must be on, and GO only listens for a card while a Qortal Card screen is waiting for a tap.

Also asked as: where to tap the qortal card · qortal card not reading · hold the card to the phone qortal · qortal card tap position · the card moved away too soon

## Q: Is there a Qortal NFC bracelet?

A: Not yet. A tap-to-pay bracelet is being developed, but you can't get or use one today. What works now is GO's Qortal Card (testing), with a Qortal test card or between two GO phones.

Also asked as: qortal nfc bracelet · qortal wristband · qortal bracelet tap to pay · buy a qortal bracelet · qortal nfc wristband

## Q: Is an RNode the same as LoRaWAN?

A: No. RNodes use LoRa only as the radio modulation, with no LoRaWAN protocol on top. LoRaWAN is a separate standard for centrally controlled IoT devices; with Reticulum, all the networking is done by Reticulum itself. So you need a plain LoRa radio with RNode firmware, not a LoRaWAN gateway or service.

Also asked as: rnode lorawan · reticulum lorawan · is lora the same as lorawan · rnode lora vs lorawan · lorawan gateway for reticulum

## Q: Which LoRa boards can become an RNode?

A: The Reticulum manual lists boards its auto-installer supports: LilyGO T-Beam, T-Beam Supreme, T3S3, LoRa32 (v1.0, v2.0, v2.1), T-Deck and T-Echo; Heltec LoRa32 (v2, v3, v4) and T114; RAK4631-based boards; the openCom XL; and unsigned.io's RNode v2.x. rnodeconf also offers the Seeed XIAO ESP32S3 Wio-SX1262. Most come in versions for different frequency bands, so get the one for the band you will use.

Also asked as: rnode supported boards · lora boards for reticulum · t-beam rnode · heltec rnode · rak4631 rnode · which board for an rnode

## Q: How do I turn a LoRa board into an RNode?

A: 1. Install Reticulum on a computer with pip install rns; that includes rnodeconf.
2. Connect the supported board by USB.
3. Run rnodeconf --autoinstall and answer its questions about your board and band.
It installs and sets up the RNode firmware. The manual also mentions a web-based flasher, and ready-made RNodes can be bought if you would rather not build one.

Also asked as: make my own rnode · build an rnode · rnode autoinstall · install rnode firmware on a lora board · diy rnode

## Q: What frequency band should my RNode use?

A: LoRa boards come in versions for 433 MHz or for 868/915/923 MHz, and a few for 2.4 GHz, so buy the version for the band you will use. Which band and how much power you may use depends on your country: the Reticulum manual warns that radio spectrum is legally controlled, rules vary widely, and knowing them is your responsibility.

Also asked as: rnode frequency band · 433 or 868 mhz rnode · 915 mhz rnode · lora band for reticulum · rnode legal frequency

## Q: How far can an RNode reach?

A: The Reticulum manual gives no fixed distance; range depends on your settings and setup. Higher spreading factors (up to 12) and coding rates (up to 8) reach further but send more slowly, while 7 and 5 are the fastest; transmit power and bandwidth matter too. For long, fast links between fixed sites the manual suggests Wi-Fi-type radios with high-gain directional antennas, with LoRa RNodes covering wide areas.

Also asked as: rnode range · lora range with reticulum · how far does an rnode reach · rnode distance km · increase rnode range

## Q: How fast is a LoRa link with Reticulum?

A: Slow by internet standards: the Reticulum manual describes LoRa links of a few hundred bits per second, and its rnstatus example shows an RNode at about 1.3 kbps. That is enough for text messaging, since setting up an encrypted link costs only 297 bytes and keeping it open about 0.45 bits per second, but big files take a long time.

Also asked as: lora speed with reticulum · rnode data rate · lora bits per second · how fast is an rnode · lora bandwidth reticulum

## Q: Can I use an RNode with Qortal GO?

A: No. GO's Reticulum connects only to Qortal's Reticulum hubs over the internet; it doesn't set up LoRa radios, USB serial devices or Bluetooth RNodes, and it doesn't use local Wi-Fi discovery either. Other Reticulum apps can use RNodes, but chat and calls in GO always go through the Qortal hubs.

Also asked as: rnode with qortal go · qortal go lora radio · connect a lora radio to qortal go · qortal go bluetooth rnode · qortal go reticulum radio

## Q: How do I connect an RNode to my computer?

A: You choose the connection in the RNodeInterface section of Reticulum's config: a USB serial port (for example port = /dev/ttyUSB0), Bluetooth LE (port = ble://, after pairing the RNode with the computer), or Wi-Fi if the RNode supports it (port = tcp:// followed by its address). rnodeconf -p puts an RNode into Bluetooth pairing mode.

Also asked as: connect an rnode by usb · rnode bluetooth connection · rnode wifi connection · rnode serial port · pair an rnode over bluetooth

## Q: Do I need a licence to use an RNode?

A: Reticulum is designed to work on licence-free ISM radio bands, which is where RNodes usually run. But radio rules vary widely between countries, and the Reticulum manual says it is your responsibility to know and follow the rules where you are. If you transmit on amateur bands under a licence, an RNode can send your callsign at set intervals (id_callsign and id_interval).

Also asked as: rnode licence · lora licence needed · reticulum radio licence · ham licence for an rnode · rnode legal use

## Q: What operating system should I use on a Raspberry Pi node?

A: The Qortal wiki lists trusted community Qortal OS images: RaspiPHENIX for the Pi 4 and Ra5piPHENIX for the Pi 5, both based on Debian 12, usable with a desktop or headless, with remote desktop, SSH and Qortal tools included. You can also use any 64-bit Linux and install Core yourself, since it only needs Java 11 or newer. After flashing an image, expand the filesystem, update the system and get the latest Core as the wiki shows.

Also asked as: raspberry pi os for qortal · qortal os image for pi · raspiphenix · ra5piphenix · best os for a qortal raspberry pi

## Q: Is the Qortal Card a hardware wallet?

A: Not in the usual sense. A Qortal card is a small separate wallet for spending: it has its own account, its chip signs payments, and it never holds your main account's key. Test cards have no PIN yet, so anyone holding one can pay with it. Keep only a few QORT on a card and your savings in your main account.

Also asked as: qortal card hardware wallet · qortal card cold storage · keep savings on qortal card · qortal card vs ledger · qortal card safe for savings

## Q: Why doesn't Wi-Fi work on my QORTector?

A: Set your country first: the QORTector's Wi-Fi and time zone follow its locale, and the default is USA, Pacific time. Run sudo raspi-config, open Localisation Options and set the country (and time zone), then set up Wi-Fi. A network cable is still the recommended connection for a node.

Also asked as: qortector wifi not working · qortector wireless setup · qortector country locale wifi · qortal pi wifi country setting · qortector no wifi networks

## Q: Should I put my Qortal node in the router's DMZ?

A: No. The Qortal wiki warns never to put a node in the DMZ: it skips the router's firewall checks, so all internet traffic can reach that computer directly, which is a real risk if the node's API is opened up. Use UPnP or normal port forwarding instead.

Also asked as: dmz qortal node · qortal router dmz · dmz instead of port forwarding qortal · is dmz safe for a qortal node

## Q: Can I run two Qortal nodes on the same home network?

A: Yes. With UPnP, the first node works as it is; for each extra node, set a different listenPort and listenDataPort in its settings.json (for example 22392 and 22394). Without UPnP, leave the ports alone and forward a different external port to each node's 12392 and 12394. A second node doesn't earn more QORT, but it keeps your account synced and minting if one machine has trouble.

Also asked as: two qortal nodes same network · multiple qortal nodes on lan · second qortal node behind router · two qortal nodes one router · run 2 qortal nodes at home

## Q: How much power does a Raspberry Pi Qortal node use?

A: Very little. The Qortal wiki says a Pi-based node or QORTector uses about 5 W, about the same as leaving a phone charging all day, and far less than most computers. Minting needs no extra power, because Qortal has no mining race.

Also asked as: raspberry pi qortal power use · qortector watts · qortal node electricity cost · pi node 5 watts · low power qortal node

## Q: How do I shut down a Raspberry Pi Qortal node safely?

A: Stop Core first, then the Pi:
1. Cancel any open trades in the Trade Portal.
2. In a terminal: cd qortal, then ./stop.sh, and wait for "Qortal ended gracefully".
3. Shut down with sudo shutdown (or restart with sudo reboot).
4. Switch the power off only after the Pi has powered down. The QORTector guide says not to use the power switch to turn it off.

Also asked as: shut down qortector safely · turn off qortal pi · qortector power switch · reboot qortal raspberry pi · stop qortal core before shutdown

## Q: Can I run a Qortal node on solar power?

A: Yes, a small node is one of the easier loads to run that way: the Qortal wiki says a Pi-based node draws about 5 W, about like a phone charging. Size the battery for nights and cloudy days, and avoid sudden power loss, because Core should be stopped cleanly or its database can be damaged. The node also still needs a network connection to stay in sync.

Also asked as: solar powered qortal node · off grid qortal node · qortal node on battery power · solar raspberry pi qortal · run qortal node off grid

## Q: Do minting and non-minting nodes need different hardware?

A: No. The Qortal wiki says minting and non-minting nodes need the same hardware. A faster machine earns nothing extra; what counts is that the node stays online and synced.

Also asked as: hardware for a minting node · minter node specs · minting node vs normal node hardware · does minting need a better computer

## Q: Can I run a Qortal node on a VPS?

A: Yes. The Qortal wiki has a VPS page with a Linux install: install Java, unzip the qortal.zip release, and start Core as a normal user (its start script refuses to run as root). The settings shipped with Core let any address reach its API (port 12391), so on a VPS keep that port closed in the firewall or turn on apiWhitelist; sensitive calls still need the API key.

Also asked as: vps qortal node · qortal node on a cloud server · rent a server for qortal · headless vps qortal core · qortal linux vps install

## Q: What hardware does a Qortal gateway node need?

A: Not much: the Qortal wiki's gateway guide says even a Raspberry Pi 4 with 4 GB of RAM can work. What a gateway really needs is a public IP address with ports 80 and 443 forwarded to it (a static IP is preferred; dynamic DNS also works) and unlimited or high-cap data, because everyone who opens a site through it uses your connection. Anything people open through your gateway is stored on your node.

Also asked as: qortal gateway node hardware · qortal gateway requirements · run a public qortal gateway · gateway node raspberry pi · gateway node bandwidth

## Q: Do I need a 64-bit OS on my Raspberry Pi for Qortal?

A: Use a 64-bit OS. The Qortal OS images on the wiki are full 64-bit (ARM64), which the wiki notes is what lets them support ARRR, and the Hub build for the Pi is an arm64 AppImage.

Also asked as: 64-bit os raspberry pi qortal · 32-bit pi os qortal · arm64 qortal pi · raspberry pi os 64 bit qortal · arrr trading on raspberry pi

## Q: What is inside a QORTector?

A: A QORTector is a ready-made Qortal node on a Raspberry Pi with a custom Qortal OS. The Gen 2 uses a Raspberry Pi 4 with 8 GB of RAM and a 500 GB SSD; the QORTector KB uses a Raspberry Pi 400 keyboard computer with 4 GB of RAM and a 500 GB Samsung T7 SSD. Gen 3 comes with a keyboard and mouse. The first QORTector used an Orange Pi board that couldn't run a full node, and that board was discontinued.

Also asked as: qortector specs · qortector gen 2 · qortector kb · qortector hardware · qortector raspberry pi

## Q: Where can I get a QORTector?

A: Pre-built QORTectors are sold on crowetic.com by Crowetic Hardware Development, a third-party company set up by Qortal founders. You can also build your own: the Qortal wiki has the Raspberry Pi guide, community Qortal OS images, and 3D printing files for a case that holds a Pi 4, a Samsung T7 SSD and a 40 mm Noctua fan.

Also asked as: buy a qortector · qortector for sale · build my own qortector · crowetic hardware development · diy qortector

## Q: What should I do first on a new QORTector?

A: 1. Plug in the monitor (HDMI before power), keyboard, mouse, Ethernet and power.
2. Set your country and time zone under Localisation Options in sudo raspi-config. Do this before changing the password, or you could lock yourself out.
3. Change the default password with passwd.
4. Let Core sync, then add your account and save a backup file.
5. Set up port forwarding if you can.

Also asked as: qortector setup steps · new qortector first steps · set up a qortector · qortector first boot · qortector timezone and password

## Q: Why does my QORTector show nothing on the monitor?

A: Connect the HDMI cable before you power the device on; the QORTector guide says it won't show a picture otherwise. If you need to unplug HDMI, power the device off first. Core keeps running in the background either way.

Also asked as: qortector no display · qortector black screen hdmi · qortal pi no picture · qortector hdmi not working

## Q: Why does my Qortal Pi only use 32 GB of my SSD?

A: The image's partition is 32 GB or less, so it has to be expanded after flashing. Run sudo raspi-config, choose Advanced Options, then Expand Filesystem, and reboot. After that the node can use the whole drive.

Also asked as: expand filesystem qortal pi · raspi-config expand qortector · qortector only 32gb · ssd space after flashing qortal image · qortal image partition size

## Q: Can I keep Qortal's blockchain database on another drive?

A: Yes. Stop Core, then set "repositoryPath" in Core's settings.json to a folder on that drive; by default the database is the db folder next to settings.json. On Windows the wiki's example is "repositoryPath":"D://db". Core finds the database there, or creates one if the folder is empty. QDN data has its own setting, dataPath.

Also asked as: qortal database on another drive · move qortal db folder · qortal repositorypath · qortal blockchain on external ssd · qortal db second drive

## Q: Can an older Raspberry Pi run a Qortal node?

A: The Qortal wiki's guides and images cover the Pi 4, the Pi 400 and the Pi 5, with 4 GB of RAM as the working minimum. Older boards aren't covered, and the first QORTector, on a weaker Orange Pi board, couldn't run a full node. A Pi 4 or Pi 5 with 8 GB is the safe choice.

Also asked as: raspberry pi 3 qortal · old raspberry pi qortal node · pi 3 qortal core · orange pi qortal node · older pi for qortal · raspberry pi zero qortal

## Q: Does a Qortal node need a powerful CPU?

A: No. The Minter Guide asks for at least a dual-core CPU and recommends quad-core or better, and Core runs on Raspberry Pi-class processors. Its start script runs Core at the lowest CPU priority so it doesn't slow your other programs, and no graphics card is needed, since Qortal has no mining.

Also asked as: qortal node cpu · cpu for qortal core · qortal node processor · graphics card for qortal node · how many cpu cores for qortal

## Q: Can a Raspberry Pi 400 run a Qortal node?

A: Yes. The QORTector KB is a Pi 400 with 4 GB of RAM and a 500 GB Samsung T7 SSD. The wiki's torchieMATE image works on it (the newer RaspiPHENIX image is for Pi 4 boards only).

Also asked as: raspberry pi 400 qortal · pi 400 qortal node · qortector kb image · keyboard pi qortal node

## Q: Where does GO keep Qortino's model on my phone?

A: In GO's own app folder on the phone's shared storage, in a folder called Qortino AI (under Android/data, in GO's files folder), with the two model parts in its models folder. If the phone has no shared storage available, GO uses its internal storage instead.

Also asked as: qortino model location · qortino files on phone · where is qortino stored · qortino ai folder · qortino gguf files

## Q: Does assembling Qortino delete the old Lite and Standard packs?

A: Yes. The old Lite and Standard packs can't be used any more, so assembling the new model deletes them (up to about 4 GB) and their space counts toward the new one. GO says "Qortino has a new, smarter brain" when it finds an old install.

Also asked as: qortino old packs · qortino lite and standard deleted · free space from old qortino · qortino new brain storage · remove old qortino model

## Q: Does Qortino run on my phone's CPU or GPU?

A: On the CPU. Qortino's engine is a CPU-only build of llama.cpp that runs on the phone's fast cores; it doesn't use the graphics chip. Once the model is assembled it needs no internet at all.

Also asked as: qortino cpu or gpu · qortino uses graphics chip · qortino processor · qortino fast cores · qortino gpu acceleration

## Q: Do I need my phone with me to pay with a Qortal card?

A: No. When you pay, the shop's GO phone reads your card, the card signs the payment itself, and the shop's phone sends it. You only need your own GO to set the card up, top it up and move QORT back.

Also asked as: pay with qortal card without phone · qortal card no phone needed · qortal card phone at home · does the qortal card need my phone

## Q: Can a Qortal card have its own name and avatar?

A: Yes. In the card's More (⋮) menu, Name on chain registers a Qortal name for the card's account, paid from the card (a card with its own key must be held to the phone to sign). Payments from it then show that name, and Card avatar can add a picture; that works for cards with a key GO can restore and needs your own node, because the public node doesn't take uploads. Rename only changes what this phone shows.

Also asked as: qortal card name on chain · register a name for my qortal card · qortal card avatar · qortal card shows a name when paying · name my qortal card

## Q: What does This card already has a key mean in GO?

A: GO never replaces a key that is already on a card, so no QORT can be stranded at the card's old address. A card that already has a key is read and added as it is instead of being set up again.

Also asked as: qortal card already has a key · card has key error qortal go · go never replaces a card key · qortal card key exists

## Q: What does Switch to a key GO can restore do?

A: It turns a card that made its own key into one you can back up. GO first moves the card's QORT back to your account (you hold the card to sign), waits until the old address is empty, then loads a new key made from your wallet with one more tap. The card gets a new address, so don't send anything to the old one. It can't switch if the card has a name on chain, because the name belongs to the old key.

Also asked as: switch qortal card key · switch to a wallet key qortal card · make my qortal card restorable · change qortal card key · qortal card gets a new address

## Q: What happens to the QORT if I remove a card from GO?

A: Removing a card only takes it off GO's list; its QORT stays on the card's account. A card with a key GO can restore shows up again when you connect it. For a card that made its own key, only that card can move the QORT, so keep the card.

Also asked as: remove a qortal card from go · delete card from qortal go · forget qortal card · qortal card removed balance

## Q: Why does GO say NFC is off?

A: Qortal Card needs the phone's NFC switched on. Tap Turn on NFC in GO to get to Android's NFC setting, switch it on and come back. If GO says the phone has no NFC, it can't read cards or tap other phones.

Also asked as: qortal card nfc is off · turn on nfc for qortal go · nfc off qortal card · enable nfc for qortal card

## Q: Does taking Qortal card payments cost the shop anything?

A: No. The normal Qortal transaction fee is paid from the customer's card, and GO shows it before you charge. The shop's account only receives the payment; it doesn't sign anything.

Also asked as: qortal card fee for shop · who pays the qortal card fee · merchant fee qortal card · qortal card transaction fee

## Q: Can the shop see who paid with a Qortal card?

A: The Paid screen shows the card's address, or its name and avatar if the card has a name on chain, and how much QORT is left on the card.

Also asked as: qortal card payer name · who paid with a qortal card · qortal card payment shows address · qortal card paid from

## Q: What do Try again, Use another card and Send again mean for a card payment?

A: Try again: the card part failed, so the customer taps again for the same amount. Use another card: the card doesn't hold enough QORT for the payment plus fee. Send again: the node didn't take it, and GO resends the very same signed payment, never a second one. If the node sees too little QORT right after a top up, wait for the next block (about a minute) and try again.

Also asked as: qortal card payment failed · card payment try again qortal · send again qortal card · use another card qortal · qortal card not enough qort

## Q: Can I pay with Q-Assets using a Qortal card?

A: Not yet. GO's Qortal Card screens handle QORT payments only for now.

Also asked as: qortal card q-assets · pay tokens with qortal card · qortal card other coins · qortal card asset payment

## Q: Can I take Qortal card payments without internet?

A: No. The shop's GO phone checks the card's balance on its node and sends the payment through it, so it needs a working connection to a node. The card itself needs no connection.

Also asked as: qortal card offline payment · qortal card without internet · take card payments offline qortal · qortal card needs node

## Q: Do both phones need NFC for phone-to-phone payments?

A: Yes, both need NFC switched on and GO's Qortal Card screens open. The phone that asks for QORT answers a tap only while its request is open (2 minutes) and only while that phone is unlocked.

Also asked as: both phones nfc qortal · phone to phone nfc requirements · qortal tap phones need nfc · nfc on both phones qortal go

## Q: Is the RNode firmware stable on LoRa development boards?

A: The installer says RNode firmware on boards such as the T-Beam, LoRa32, Heltec, RAK4631, T-Echo and T-Deck, and on homebrew RNodes, should currently be considered experimental: it is supplied as-is and not intended for production or critical use.

Also asked as: rnode firmware experimental · rnode on t-beam reliable · rnode dev board for production · homebrew rnode experimental

## Q: Which LoRa board should I avoid for an RNode?

A: The RNode installer warns about the LilyGO LoRa32 v1.0: it has a faulty battery charging circuit that can overcharge and damage batteries, so it recommends avoiding that board if at all possible.

Also asked as: lora32 v1.0 battery problem · avoid lilygo lora32 v1 · rnode board battery charging fault · bad lora board for rnode

## Q: Can I use an RNode with Qortal Hub?

A: Not as a built-in feature: Hub's Reticulum connects through Qortal's hubs over the internet and has no radio settings. Advanced users can switch off Managed Reticulum config in Hub's Reticulum settings and add an RNodeInterface in the Config editor, as the Reticulum manual describes, but Qortal doesn't document this. Hub then stops updating that config for you, so keep its Qortal hub entries in place.

Also asked as: rnode with qortal hub · qortal hub lora radio · add a lora radio to qortal hub · qortal hub rnode interface · qortal hub radio mesh

## Q: Can Qortal voice calls work over LoRa?

A: Not realistically. Qortal Hub and GO send call audio at about 24 to 32 kbps, while the Reticulum manual describes LoRa links of a few hundred bits per second to around a kilobit. Qortal calls run over the internet, either directly or through Qortal's Reticulum hubs.

Also asked as: qortal calls over lora · voice call over lora qortal · rnode voice calls qortal · lora too slow for qortal calls

## Q: Can Reticulum use Wi-Fi radios for long links?

A: Yes. Any Wi-Fi hardware that passes bridged Ethernet works with Reticulum's AutoInterface, with no DHCP or other IP setup needed. The manual names Ubiquiti airMAX and LTU radios and MikroTik radios as examples for long, high-capacity links, often used as the backbone between sites while LoRa RNodes cover wide areas for client devices.

Also asked as: wifi radios for reticulum · ubiquiti with reticulum · mikrotik with reticulum · long range wifi reticulum · point to point wifi reticulum

## Q: Can I limit how much my RNode transmits?

A: Yes. In the RNodeInterface config, airtime_limit_short caps transmit time over a window of about 15 seconds and airtime_limit_long over a rolling 60 minutes, both in percent; the manual's example uses 33 and 1.5.

Also asked as: rnode airtime limit · rnode duty cycle · limit rnode transmit time · rnode airtime_limit_long · rnode transmit percentage

## Q: What computer should run my RNode at home?

A: Almost anything that runs Python 3. The Reticulum manual's reference setup is an RNode on USB plus any Linux computer, and it calls a Raspberry Pi with a Debian-based OS a good place to start. For a home node it suggests repurposing an old computer, a Raspberry Pi or a supported router that stays on, connected to your Wi-Fi and perhaps an RNode.

Also asked as: computer for an rnode · raspberry pi with an rnode · home reticulum node hardware · rnode host computer · always on rnode computer

## Q: How should I set up an RNode in a car or other vehicle?

A: The manual's example: give the vehicle an outside LoRa interface set to mode = roaming, an inside Wi-Fi interface for the devices travelling with it, and enable transport. Devices inside can then reach each other and any LoRa nodes in range, and those nodes can reach them. Paths through roaming interfaces expire faster.

Also asked as: rnode in a vehicle · mobile rnode setup · rnode roaming mode · car lora reticulum · vehicle reticulum mesh

## Q: How do I set up a LoRa node that also has an internet link?

A: Set the interface that connects over the internet to mode = boundary; that is what the Reticulum manual recommends for a node on a LoRa network that also links to a public transport node online. The manual also warns that passing all announce traffic from a fast link onto LoRa wastes its airtime, and the LoRa network won't work well.

Also asked as: lora and internet reticulum gateway · boundary mode reticulum · rnode with internet uplink · lora gateway to internet reticulum · reticulum lora internet bridge

## Q: How do I set up an RNode as a quiet access point for a wide area?

A: Put its interface in mode = access_point. The interface then doesn't send announces on its own and stays quiet until someone uses it, and paths to devices on it expire sooner. The manual gives a radio serving a wide area, where users connect for a while and then leave, as the example.

Also asked as: rnode access point mode · reticulum access_point mode · wide area rnode access point · quiet rnode interface

## Q: What is the RNode Multi interface for?

A: It is for RNodes with more than one LoRa transceiver, such as the openCom XL with its SX1262 and SX1280 chips. Each radio gets its own sub-interface with its own frequency, bandwidth, power, spreading factor and coding rate; the manual's example pairs a 2.4 GHz high-speed radio with an 865.6 MHz low-speed one.

Also asked as: rnode multi interface · rnode two transceivers · rnodemultiinterface · dual band rnode · opencom xl reticulum

## Q: Can I run Qortal Core in Docker?

A: Yes. Qortal Core's source includes Docker files: copy .env.example to .env and run docker compose up -d --build. The node's data and settings.json live in ./data/qortal, and Java's memory options are in start-arguments.txt there (by default up to 25% of the RAM). Only the container itself may use the API by default, so add other containers to the API whitelist in settings.json if they need it.

Also asked as: qortal core docker · docker compose qortal · qortal node in a container · run qortal in docker · qortal docker memory setting

## Q: Do I need a static IP address for a Qortal node?

A: Not for a normal node: UPnP or port forwarding is enough. For port forwarding, give the node a fixed address on your home network (static assignment in the router's DHCP settings) so the forward always reaches it. Only a public gateway node prefers a static public IP, and dynamic DNS works there too.

Also asked as: static ip qortal node · qortal node fixed ip · dynamic ip qortal node · public ip for a qortal node · ddns qortal node

## Q: Does Qortal Core work over IPv6?

A: Yes, if your operating system supports it. Core's start script runs Java with IPv6 enabled (java.net.preferIPv4Stack=false), and you can add a peer by its IPv6 address in square brackets with the port, for example [address]:12392.

Also asked as: qortal ipv6 · qortal core ipv6 peers · ipv6 qortal node · add an ipv6 peer qortal

## Q: What power settings should a Linux node computer use?

A: The Qortal wiki's Ubuntu guide sets, both plugged in and on battery: Suspend when inactive to Never, Lid close action to Do Nothing, and Power button to Ask. That keeps Core running all the time, even with a laptop closed.

Also asked as: ubuntu power settings qortal · linux node suspend never · laptop lid close qortal node · stop linux suspending qortal · qortal node power button setting

## Q: How do I reach my Raspberry Pi node from another computer?

A: Find the Pi's IP address in your router's list of connected devices (or use its .local hostname), then connect with a remote desktop client such as Microsoft Remote Desktop or Remmina, or over SSH for headless images; some images also have VNC. Log in with the image's user and the password you set. To use Hub with the node, add it under Choose custom node, through an SSH tunnel or the node's API whitelist.

Also asked as: remote desktop qortal pi · rdp to qortector · ssh into qortal pi · access pi node from laptop · vnc qortector

## Q: Can a QORTector be used as a normal desktop computer?

A: Yes. With a monitor, keyboard and mouse it is a stand-alone desktop, and the wiki says the Gen 2 has served as a full replacement for everyday desktops while using a fraction of the power. The Qortal OS images come with software such as the Chromium browser, VLC and LibreOffice, and the KB model is built into a keyboard.

Also asked as: qortector as a desktop · qortector daily computer · qortector browser and office · use qortector with monitor

## Q: What is the difference between a QORTector and a plain Raspberry Pi?

A: The hardware is a normal Raspberry Pi with an SSD: a Raspberry Pi 4 with a fan for the Gen 2, a Raspberry Pi 400 keyboard computer for the KB. What differs is the software and setup. QORTectors run a custom Qortal OS with kernels tuned for Qortal's cryptography and a threat-mitigation layer, and they start Core by themselves. You can build the same thing yourself with the wiki's Raspberry Pi guide and images.

Also asked as: qortector vs raspberry pi · why buy a qortector · qortector or diy pi · qortector custom kernel

## Q: How do I re-image a QORTector?

A: 1. Download the image for your model from the wiki's QORTector page (RaspiPHENIX for the Gen 2, torchieMATE for the KB) and extract it with 7-Zip or Keka.
2. Connect the QORTector's SSD to another computer by its USB cable.
3. Write the .img file to the SSD with Balena Etcher; allow it to write to the large disk.
4. Reconnect the SSD, boot, then expand the filesystem with sudo raspi-config and reboot.

Also asked as: reimage qortector · reinstall qortector os · flash qortector ssd · qortector image download · balena etcher qortector

## Q: Does Qortal Hub support the Qortal Card?

A: No. Qortal Card is a GO feature for Android phones with NFC. A backup file saved from a card with a key GO can restore does open in Hub, like any Qortal backup file.

Also asked as: qortal card on hub · qortal card on desktop · nfc card qortal hub · use qortal card on pc

## Q: Can I connect more than one Qortal card?

A: Yes. Each card you connect gets its own account and appears in Your cards. GO gives every restorable card its own key and never reuses one, even after a card is removed.

Also asked as: several qortal cards · multiple nfc cards in qortal go · second qortal card · more than one qortal card

## Q: Does Qortal Card work on the public node?

A: Yes for paying, topping up, moving QORT back and registering a card's name. Only Card avatar needs your own node, because the public node doesn't take uploads.

Also asked as: qortal card public node · qortal card own node needed · card avatar public node · qortal card on ext-node

## Q: Can I build a homebrew RNode?

A: Yes. rnodeconf --autoinstall has a Homebrew RNode option for your own board design or a development board paired with a supported radio module: an AVR ATmega1284P, ATmega2560 or ESP32 with an SX1276 or SX1278 transceiver. The installer calls homebrew firmware experimental and not meant for production or critical use.

Also asked as: homebrew rnode · custom rnode board · rnode from parts · esp32 lora rnode build · sx1276 homebrew rnode

## Q: Can one RNode serve all the devices on my home Wi-Fi?

A: Yes. Put the RNode on one always-on computer, add its interface to that computer's Reticulum config and enable transport there. Other Reticulum devices on your Wi-Fi can then reach the LoRa side with the default AutoInterface setup. Qortal GO doesn't use local Wi-Fi discovery, so it won't use such a gateway.

Also asked as: share one rnode on home wifi · rnode gateway for home network · one lora radio whole house reticulum · reticulum home gateway rnode

## Q: Can I run a Qortal node with very little storage?

A: Not yet as a full node, which keeps the whole blockchain and needs room to grow. The Qortal wiki describes lite nodes that store no blockchain and ask full nodes for what they need, but they can't mint, and they are still being built. Until they are live, plan a full node around an SSD with plenty of free space.

Also asked as: qortal node small disk · qortal lite node storage · low storage qortal node · qortal node without full blockchain · qortal lite node hardware

## Q: Can I use a regular hard drive for a Qortal node?

A: It isn't recommended. The Minter Guide says solid-state storage (an SSD) is strongly recommended, and the Qortal wiki recommends an SSD for Raspberry Pi nodes. Plan the node around an SSD with plenty of free space and room to grow.

Also asked as: hdd for qortal node · hard disk qortal node · spinning drive qortal · ssd or hdd qortal · qortal node on a hard drive

## Q: Why does GO say that GO phone is not asking for QORT right now?

A: You tapped a GO phone whose request isn't open. On that phone, open Qortal Card > Take payment, choose GO phone and tap Ask for QORT, then tap again within 2 minutes. If GO says it is not a GO phone asking for QORT at all, the other device isn't showing a GO request.

Also asked as: that go phone is not asking for qort · not a go phone asking for qort · phone to phone tap error qortal · qortal card send tap failed · other phone request not ready

## Q: Why does GO say the card's signature did not check out?

A: GO checks every signature the card returns, and that it came from the card's expected key, before anything is sent. When a check fails, GO stops and says "Nothing was sent", so no QORT moved. Hold the card still and try the tap again.

Also asked as: card signature did not check out · qortal card bad signature · card did not use the expected key · qortal card key mismatch · nothing was sent qortal card

## Q: Why does GO say this card can only make its own key?

A: Some test cards carry a test applet that can't take a key from GO, so they can only make a key on the card. That works for paying, but there is no backup file and no switch to a restorable key, and if the card is lost, the QORT on it is lost.

Also asked as: card can only make its own key · qortal card no import · test card makes its own key · qortal card no backup possible · card cannot take wallet key

## Q: Why does Qortal Card ask me to unlock my wallet first?

A: To give a card a key GO can restore, GO derives it from your wallet, so the wallet must be unlocked. Unlock GO and tap the card again, or choose Make a new key on the card instead.

Also asked as: unlock your wallet first qortal card · qortal card wallet locked · card setup wallet locked · qortal card needs unlocked wallet

## Q: Is the QORTector open hardware?

A: The Qortal wiki describes it as an open-source, non-proprietary hardware project: it uses standard Raspberry Pi boards, and the Qortal OS images and 3D printing files for the case can be downloaded to build your own. Pre-built units are also sold.

Also asked as: qortector open source hardware · qortector non proprietary · qortector diy files · qortector images free download

## Q: How do I set the time zone on a QORTector?

A: 1. Open a terminal and run sudo raspi-config.
2. Choose Localisation Options, then Timezone.
3. Pick your country, then your city or region, and choose Finish.
The default is USA, Pacific time. Do this before you change the password.

Also asked as: qortector wrong time · qortector timezone · set timezone raspberry pi qortal · qortector localisation options · qortector clock wrong zone
