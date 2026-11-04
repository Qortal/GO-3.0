# qortal-node — golden FAQ

Curated offline Q&A for Qortino (205 entries). Prefer these answers when relevant.

## Q: What does Qortal Core do while it is running?

A: Qortal Core is the node program. While it runs it keeps a full copy of the Qortal blockchain and checks every new block and transaction, passes them on to other nodes (its peers), stores and shares QDN data for names you follow or view, and serves a local API on port 12391 that Hub, GO and Q-Apps use. If you add a minting account, it also mints blocks. Your account's private keys stay in Hub or GO, which sign transactions and send only the signed result to Core.

Also asked as: what is my node doing · qortal core job · purpose of qortal core · qortal core main tasks · what does core do all day · core running in background what for

## Q: What is the difference between Qortal Core and Qortal Hub?

A: Qortal Core is the node: a Java program that syncs the blockchain, talks to peers and serves the API. It has no main window, only a tray icon on desktops. Qortal Hub is the desktop app you use for your account, chat and Q-Apps. Hub can work with Core on the same computer (Local Node), with a node elsewhere that you add (Custom Nodes), or with a public node, so Hub alone is enough to get started.

Also asked as: qortal core or qortal hub · difference between core and hub · is hub the node · are hub and core the same · do i need both core and hub

## Q: Does closing Qortal Hub stop my node?

A: No. Core runs as its own program, so it keeps running, syncing and minting after you close Hub. To stop it, use Stop Core in Hub's Set up Qortal Core window (under Advanced), choose Exit from the Qortal tray icon on Windows, or run ./stop.sh in the qortal folder on Linux and macOS.

Also asked as: close hub stops core · quit hub node keeps running · core still running after closing hub · exit hub does core stop · hub closed is node still on

## Q: What is the difference between Local Node, Public Node and a custom node in Hub?

A: These are the choices in Hub's Connection Mode window. Local Node is Qortal Core on this computer; Hub marks it Recommended for full decentralized access, faster performance and keeping your data local. Public Node is a shared node run by someone else: quick to start, but with limited decentralization. A custom node is any other node you add by its URL and API key, such as your own Core on another machine.

Also asked as: local node vs public node · hub connection mode options · custom node vs local node · which node should hub use · public node or local node hub

## Q: What can I not do while using a public node?

A: Minting needs your own node; Hub says Minting requires a private node. Node admin actions, such as those in the Q-Node app (stop, restart, bootstrap, peers, minting accounts), are refused with this action cannot be done through a public node. Blocking users and editing follow or block lists also need your own node. Big files and some apps can load slowly or stall there, because the public node often drops data again after a while.

Also asked as: public node limitations · what needs my own node · features that need a private node · public node restrictions qortal · limits of the public node · cant do on public node

## Q: Can I use the public node while my own node is still syncing?

A: Yes. Hub's Core setup says you can use a public node while Core starts and syncs. Core keeps catching up in the background, and when it is synced Hub shows Local node ready with a Switch to local button. You can also stay on Local Node while it syncs; Hub then shows how many blocks you are behind.

Also asked as: use public node during sync · node syncing use public meanwhile · switch to local after sync · hub public node until core synced · wait for core sync or use public

## Q: How do I install Qortal Core on Windows?

A: 1. On qortal.dev open Downloads, and under Qortal Core (Optional) choose Windows. This downloads the official installer (qortal.exe).
2. Run it and follow the steps.
3. A splash screen shows Core downloading and extracting the bootstrap, a ready-made copy of the blockchain.
4. Core then runs in the background with a Qortal icon in the taskbar tray and finishes syncing.
Hub can do the same for you: Set up Qortal Core, then Download Core.

Also asked as: install core windows · qortal core windows installer · windows qortal node setup · qortal.exe install · set up qortal core on windows

## Q: Where does Qortal Core keep its files on Windows?

A: The program is in C:\Program Files\Qortal: qortal.exe, qortal.jar and a small settings.json that only points to your data folder. Your node data is in %LOCALAPPDATA%\Qortal (C:\Users\<your name>\AppData\Local\Qortal): the settings.json you edit, the db folder (blockchain), the data folder (QDN), lists and wallets. To open it, right-click Start, choose Run, type %localappdata%\qortal and press Enter.

Also asked as: qortal core folder windows · windows qortal data folder · appdata local qortal · where is qortal installed on windows · qortal db folder windows

## Q: How do I start Qortal Core on Windows?

A: Open the Start menu, type Qortal and run the Qortal app; that is Core. Or in Hub use Set up Qortal Core and Start Core. Core starts in the background, and a Qortal icon appears in the taskbar tray.

Also asked as: start core windows · launch qortal core windows · run qortal node windows · open the qortal core app · turn on qortal core windows

## Q: How do I stop Qortal Core on Windows?

A: Right-click the Qortal icon in the taskbar tray and choose Exit. Or in Hub open Set up Qortal Core, then Advanced, and use Stop Core. Let it finish closing before you shut down the PC or touch its files.

Also asked as: stop core windows · exit qortal core windows · close qortal node windows · shut down qortal core windows · quit core from tray icon

## Q: How do I install Qortal Core on Linux by hand?

A: 1. Install Java 11 or newer (an OpenJDK package) and unzip.
2. Download qortal.zip from qortal.dev Downloads (Qortal Core, Linux) into your home folder.
3. In a terminal run unzip qortal.zip, then cd qortal, then chmod +x *.sh
4. Start Core with ./start.sh
On first start Core downloads the bootstrap and then syncs the rest.

Also asked as: install core linux · qortal core linux zip · linux qortal node manual install · unzip qortal zip start.sh · qortal core ubuntu install

## Q: What does the Linux install script on qortal.dev do?

A: On qortal.dev Downloads, Linux (Script) copies a one-line command; paste it into a terminal and press Enter. The script, written by crowetic, installs Java (21, or 17 as a fallback) and the tools it needs, puts Core in ~/qortal and Hub in ~/qortal-hub, adds Qortal launchers and icons to your menu, and finally offers automation that keeps Core running, updated and synced. It asks for your system password once.

Also asked as: qortal linux script · linux script button qortal.dev · qortal universal linux install script · one line install qortal linux · qortal setup linux script

## Q: How do I install Qortal Core on a Mac?

A: The simplest way is from Hub: Set up Qortal Core, then Download Core. Hub fetches Core, and Java if your Mac has none, into your home folder and starts it. By hand: install Java 11 or newer, then in Terminal download qortal.zip (the Mac uses the same zip as Linux), unzip it, run cd qortal and chmod +x *.sh, then ./start.sh. A splash screen shows the bootstrap, then a Q icon appears.

Also asked as: install core mac · qortal core macos · mac qortal node setup · qortal core on macbook · macos install qortal zip

## Q: How do I start Qortal Core on Linux or macOS?

A: In a terminal run cd ~/qortal and then ./start.sh. It checks Java, starts Core in the background and prints qortal running as pid followed by a number, so you can close the terminal afterwards. Hub can also start it for you with Start Core in Set up Qortal Core.

Also asked as: start core linux · start qortal core mac terminal · run start.sh qortal · launch qortal node linux · turn on qortal core macos

## Q: How do I stop Qortal Core on Linux or macOS?

A: In a terminal run cd ~/qortal and then ./stop.sh. The script asks Core to shut down through its API using the key in apikey.txt, falls back to a normal stop signal if that fails, then waits and prints Qortal ended gracefully. Hub's Stop Core button (Set up Qortal Core, Advanced) does the same job.

Also asked as: stop core linux · stop.sh qortal · shut down qortal core mac · stop qortal node terminal · turn off qortal core linux

## Q: Can Qortal Hub install Qortal Core for me?

A: Yes. Open Set up Qortal Core and use Download Core, then Start Core. On Windows Hub downloads and runs the official Core installer. On Linux and macOS it downloads Core into a qortal folder in your home folder, and if it finds no Java it first fetches a Java 17 copy (you see setting up Java... please wait). Core then starts and syncs in the background.

Also asked as: hub installs core · download core from hub · hub set up qortal core · let hub install the node · hub download core button

## Q: Does Qortal Core start automatically when my computer starts?

A: Not on a plain install: on Windows, macOS and Linux you start Core yourself, or Hub offers to start it when you open Hub. QORTector devices and nodes set up with crowetic's automation start Core by themselves. If your computer restarts for system updates, set Core to start automatically, or minting stops until you start it again.

Also asked as: core start on boot · qortal core autostart · does qortal run at startup · start qortal automatically · core after reboot

## Q: What is a bootstrap in Qortal?

A: A bootstrap is a ready-made, compressed copy of the blockchain database. Instead of downloading and checking every block from peers one at a time, a node downloads the bootstrap, unpacks it into its db folder and then syncs only the blocks made since. Core does this by itself on first start, and the community wiki says a new bootstrap is made every 12 hours.

Also asked as: what is bootstrapping in qortal · qortal bootstrap meaning · bootstrap the chain · node bootstrap explained · bootstrap file qortal core

## Q: What does a bootstrap replace and what does it keep?

A: It only replaces the db folder, which holds the node's copy of the blockchain. settings.json, apikey.txt, your follow and block lists, hosted QDN data and the wallets folder stay. Your minting accounts and trade-bot data are in the database too, but Core saves them to qortal-backup and restores them after the bootstrap, so minting carries on.

Also asked as: bootstrap keeps settings · does bootstrap delete followed names · bootstrap lose minting key · bootstrap keeps apikey and lists · what a bootstrap changes

## Q: What is port 12391 on a Qortal node?

A: It is Core's API port, where Hub, GO, Q-Apps and scripts talk to the node, over HTTPS or plain HTTP. Don't forward it on your router or open it to the internet; only the peer ports 12392 and 12394 need that. To reach your node's API from elsewhere, use a VPN or an SSH tunnel. The settings shipped with Core let devices on your own network reach this port, but sensitive calls still need the API key.

Also asked as: port 12391 · qortal api port · what uses port 12391 · core api port number · should i forward 12391

## Q: What is the Qortal Core API key?

A: It is a long random code, kept in a file called apikey.txt, that works like a password for your node's sensitive API calls. Apps such as Hub send it when they need to control the node or act through it; reading public chain and QDN data doesn't need it. It is not your account password or seed phrase and gives no access to your QORT account, but it does give control over the node.

Also asked as: qortal api key meaning · what is apikey.txt · core api key explained · node api key what for · qortal node apikey

## Q: Where is my node's apikey.txt?

A: Core keeps it in the folder set by apiKeyPath, which by default is the folder Core starts from: ~/qortal/apikey.txt on Linux and macOS, and C:\Program Files\Qortal\apikey.txt on a standard Windows install. To check on any system, open localhost:12391/admin/settings on the node and look for apiKeyPath. The file only appears once something has asked Core to create a key.

Also asked as: where is apikey.txt · find the qortal api key file · apikey.txt location windows · apikey.txt linux path · apiKeyPath setting

## Q: What does my node's API key protect?

A: Calls that control the node or act through it: stopping, restarting and bootstrapping Core, adding or removing minting accounts and peers, database maintenance, building QDN publishes and uploads, changing follow and block lists, foreign-coin wallet calls such as balances and sends, trade-bot actions, and making a new key once one exists. Reading blocks, names, balances and QDN content needs no key.

Also asked as: what needs the api key · api key protected actions · which core calls need the apikey · api key protects node

## Q: Where is Qortal Core's settings.json?

A: On Linux and macOS it is in the qortal folder, ~/qortal/settings.json. On Windows the one you edit is %LOCALAPPDATA%\Qortal\settings.json; the settings.json in C:\Program Files\Qortal only points Core to that folder. Core logs which file it used at startup, as Using settings file followed by the path.

Also asked as: where is settings.json qortal · core settings file location · settings.json linux path · find the qortal settings file · settings.json windows location

## Q: What should I back up from my Qortal node?

A: First and most important is your account backup and seed phrase, which stay with you, not on the node. From the node itself, keep a private copy of the qortal-backup folder (minting accounts and trade data), the lists folder (follows and blocks), settings.json, and apikey.txt if other devices use this key. The db folder doesn't need backing up, since a bootstrap rebuilds it. QDN data can usually be fetched again from peers, unless your node is the only one hosting something you published.

Also asked as: back up my qortal node · node backup files · what to save from the qortal folder · backup qortal core data · important node files to keep

## Q: Is the qortal-backup folder sensitive?

A: Yes. MintingAccounts.json contains the private key of your minting key, and the trade-bot files hold the keys for trades in progress. Keep the folder private: don't post it, send it to anyone or store it anywhere public. Core itself calls this export sensitive, node-local data.

Also asked as: is qortal-backup private · mintingaccounts.json private key · share the qortal-backup folder · is my minting key in the backup folder · protect qortal-backup

## Q: How can I tell whether Qortal Core is running?

A: On a desktop, the Qortal tray icon is there while Core runs. Hub's Connection Mode shows Core running for a local node, and the sync icon's Core information shows its version and height. In a browser on that machine, localhost:12391/admin/status answers only when Core's API is up; on Linux and macOS, ./qort admin/status in the qortal folder does the same check.

Also asked as: is qortal core running · check if core is running · is my qortal node switched on · how to know qortal core started · core running check

## Q: How do I know when my node is fully synced?

A: Several signs agree once it is: the Core tray icon no longer says Synchronizing (guides describe it turning from red to blue), Hub's sync icon says Synchronized (100%), and admin/status shows syncPercent 100 with isSynchronizing false. For a final check, compare your node's block height with a block explorer such as exqlorer.

Also asked as: is my node fully synced · how to tell my node is synchronized · confirm node synchronized · qortal core sync complete · when is my node caught up

## Q: Who runs the Qortal public node?

A: Hub describes it as a privately operated node that has been made publicly accessible. It is convenient for getting started, but it is someone else's machine, it has limits compared with your own node, and you depend on it staying online. Running your own Core removes that dependence.

Also asked as: who operates the public node · public node owner · qortal public node run by · is the public node official · public gateway node operator

## Q: Why does Hub recommend using my local node?

A: Hub lists three advantages of your local node: full decentralized access, faster downloads and user-controlled data. With your own node you also don't depend on someone else's public node being up, and you can mint once you are a minter. You can still use the public node while your node catches up.

Also asked as: local node advantages hub · benefits of a local core · why use local node instead of public · hub recommends local node · local core faster downloads

## Q: What is inside the qortal.zip download?

A: Unzipping qortal.zip gives a folder called qortal with qortal.jar (Core itself), settings.json (a few starter settings), start.sh and stop.sh (to start and stop Core), qort (a helper for calling the API from a terminal) and log4j2.properties (logging settings). Core creates the rest as it runs: db for the blockchain, data for QDN, lists, qortal.log, and apikey.txt once an app asks for a key.

Also asked as: qortal.zip contents · files in qortal zip · what comes in qortal core zip · qortal zip start.sh stop.sh · unzipped qortal folder files

## Q: What is the qortal.jar file?

A: qortal.jar is Qortal Core itself, the program that Java runs. It sits in your Core folder: qortal in your home folder on Linux and macOS, or C:\Program Files\Qortal on Windows. Auto-update replaces it with a newer one. If you ever update by hand, stop Core first, swap the file and start Core again.

Also asked as: qortal jar file · what is qortal.jar · core jar file · qortal.jar meaning · replace the qortal jar

## Q: Do I need to install Java for Qortal Core on Windows?

A: No. The Windows installer brings its own 64-bit Java and Core uses that, so there is nothing else to install. A separate Java is only needed for the qortal.zip version used on Linux and macOS, and even there Hub can fetch one for you.

Also asked as: java for qortal windows · windows core needs java · install java windows qortal · qortal windows java included · does qortal.exe include java

## Q: What does the Qortal Core tray icon show?

A: Hover over it to see Core's state, its number of connections, the block height, the blocks remaining while syncing, and the build version. The state reads Synchronizing clock, Connecting (fewer than 3 peers), Synchronizing with a percentage, Minting or NOT minting. Guides describe the icon as red until Core is fully synced and blue once it is. Right-click for Check time accuracy, Synchronize clock (Windows only), Build version and Exit.

Also asked as: core tray icon meaning · hover qortal tray icon · core icon taskbar status · qortal system tray tooltip · core tray menu options

## Q: Should I accept the automation offer at the end of the Qortal Linux script?

A: The automation is crowetic's auto-fix script. It keeps Core running, updates Core and possibly its settings, recovers from common problems, and bootstraps the database if your node falls far behind the network, using autostart or cron entries. If you don't answer within 20 seconds it installs itself; type n to decline. You can add it later from the same scripts.

Also asked as: qortal script automation question · install qortal automation yes or no · auto-fix offer linux script · qortal automation prompt · skip qortal automation

## Q: Which Java should I install on a Mac for Qortal Core?

A: An OpenJDK build, version 11 or newer. The community guide suggests Eclipse Temurin from Adoptium (download the .pkg for your Mac) or Homebrew with brew install temurin --cask. Check it with java -version in Terminal. If you let Hub install Core, it can fetch its own Java copy instead.

Also asked as: java for qortal mac · mac java qortal core · temurin qortal mac · homebrew java qortal · openjdk mac qortal

## Q: Which Java version does Qortal Core need?

A: Java 11 or newer. Core is built for Java 11, and its start.sh refuses to run with anything older. Hub installs a Java 17 copy when it finds none, the qortal.dev Linux script installs Java 21 (or 17), and the Windows installer brings its own Java. Any of these works.

Also asked as: qortal core java version · what java for qortal core · java 11 or 17 qortal · minimum java version core · does core need java 21

## Q: How do I open the Core setup in Qortal Hub?

A: On Hub's login screen, use the gear button at the bottom right (Core controls) to open Set up Qortal Core. It also opens when you pick Local Node in Connection Mode while Core is not installed, and when another window offers to open node settings. There you can download, start and stop Core, set its folder and bootstrap the chain.

Also asked as: open core setup hub · hub core controls button · where is set up qortal core · hub node settings desktop · core controls gear hub

## Q: What does Local node installed mean in Hub?

A: Hub found Qortal Core on this computer, but it is not running while you use the public node. It asks whether to start it: Start, Later or Ignore. If you start it, Core syncs in the background and Hub tells you when you can switch to it.

Also asked as: hub local node installed message · local node installed start later · hub asks to start local core · local node installed prompt

## Q: Hub says Local node ready. What should I do?

A: It means your own Core has finished syncing. Click Switch to local and Hub stops using the public node and talks to your node instead. You can stay on the public node if you prefer, but your own node is the more independent choice.

Also asked as: local node ready hub · switch to local hub · hub core synced switch · local node ready message

## Q: My Qortal Core is in a different folder. How do I tell Hub?

A: Open Set up Qortal Core and find Core location. Click Choose (or Change) and pick the folder that contains qortal.jar; if it has none, Hub says chosen directory does not contain a qortal.jar. Hub then runs Core from that folder. Clear puts it back to the default location.

Also asked as: hub custom core folder · core location hub · core installed in another directory · hub choose qortal folder · chosen directory does not contain a qortal.jar

## Q: Where does Hub put Qortal Core on Linux and macOS?

A: In a folder called qortal in your home folder (~/qortal), with qortal.jar, settings.json, start.sh and stop.sh inside. If Hub had to fetch Java, that copy sits in ~/jdk-17.0.2. Core's own data folders (db, data, lists) are created inside ~/qortal as well.

Also asked as: hub core folder linux · where is the qortal folder on mac · home qortal folder · hub installed core location linux · jdk folder qortal hub

## Q: How long does Qortal Core take to start?

A: Core first loads its database and checks the blockchain, and only then opens its API; the log line is Starting API on port 12391, and Hub waits for it. The very first start takes longer because Core downloads and extracts the bootstrap first. On slow hardware a start can take a long time: crowetic's automation waits up to about 35 minutes before treating it as failed.

Also asked as: core takes long to start · qortal core startup time · how long until core is ready · core slow to start · waiting for qortal core to start

## Q: What does Core not fully started mean in Hub?

A: Hub can see Core, but Core hasn't finished starting, so Hub says The Qortal Core has yet to be fully started. Please wait. Leave it running; when it is done Hub shows Qortal Core is ready. On a first start this includes the bootstrap download, which can take a while.

Also asked as: core not fully started · hub core not ready yet · qortal core has yet to be fully started · hub waiting for core

## Q: What does admin/status tell me about my node?

A: admin/status is the node's quick health report (localhost:12391/admin/status on the node, or ./qort admin/status). height is your node's latest block, syncPercent how far it is synced, and isSynchronizing whether it is catching up right now. numberOfConnections counts blockchain peers and numberOfDataConnections QDN peers. isMintingPossible turns true when the node is synced, has enough up-to-date peers and has a minting account. It needs no API key.

Also asked as: admin status fields meaning · syncPercent isSynchronizing meaning · numberOfConnections qortal · isMintingPossible false · qortal core status json fields

## Q: How do I see which version of Qortal Core I am running?

A: In Hub, hover over the sync status icon to open Core information; it lists the Core version. On a desktop you can also right-click the Core tray icon and choose Build version. From a terminal, ./qort admin/info in the qortal folder shows it as buildVersion.

Also asked as: qortal core version check · which core version do i have · core build version · find qortal core version · hub shows core version

## Q: Who approves Qortal Core auto-updates?

A: The Qortal development group, on chain. A member of the dev group publishes an update transaction that names the exact build, and the group's admins (the Dev Admins) approve it until it passes the group's approval threshold. Only then do nodes start downloading and applying it, so no single person can push an update to every node.

Also asked as: who approves core updates · qortal update approval dev group · dev admins approve update · core auto update approval · who signs a qortal core update

## Q: How does Qortal Core know an auto-update is genuine?

A: The approved update transaction contains the build's commit and the SHA-256 hash of the update file. Core downloads the file from one of several mirrors, checks that its hash matches the approved one, and throws the file away if it doesn't; the log then says the downloaded JAR's hash doesn't match. Core also only takes an update that is newer than the version it is running.

Also asked as: auto update hash check · is the qortal auto update safe · core update verification · fake qortal update protection · update file hash qortal

## Q: How often does Qortal Core check for updates?

A: About every 20 minutes, Core looks on chain for a newly approved update. Nodes don't all switch at the same moment; the community wiki says it takes about 2 hours for the whole network to update. You don't need to do anything while auto-update is on.

Also asked as: core update check interval · how soon does core update · qortal core checks updates every · when will my node update · auto update timing core

## Q: Why did my Qortal node restart by itself?

A: Usually an auto-update: Core downloads the new version, a helper stops the node, swaps qortal.jar and starts it again, and the tray says Applying automatic update and restarting... A bootstrap (Applying bootstrap and restarting node) or a restart from the Q-Node app works the same way. If you use crowetic's automation, it can also restart Core when it finds the node stuck. Give it a few minutes to come back.

Also asked as: core restarted on its own · qortal node restarted itself · why did core restart · applying automatic update and restarting · unexpected qortal node restart

## Q: How do I turn off automatic Qortal Core updates?

A: Add "autoUpdateEnabled": false to Core's settings.json and restart Core. The community wiki does not recommend it: auto-update keeps all nodes on compatible versions and avoids forks. With it off you must install every new release yourself, or your node will sooner or later stop syncing with newer peers.

Also asked as: disable core auto update · autoUpdateEnabled false · stop qortal core updating itself · turn off qortal auto update · manual core updates only

## Q: What happens if my Qortal Core version is too old?

A: Newer nodes refuse to sync with peers below a minimum Core version (their minPeerVersion setting), and by default they don't even keep the connection. A node that falls several versions behind therefore finds fewer and fewer peers and stops syncing. Leave auto-update on, or update by hand soon after each release.

Also asked as: old core version problems · outdated qortal core · core too old to sync · minPeerVersion qortal · running an old qortal node

## Q: Does a Core auto-update change my settings or data?

A: No. An auto-update only replaces qortal.jar. Your settings.json, the db folder (blockchain), QDN data, lists, apikey.txt and minting accounts stay as they were, and Core starts again with them. Separate tools, such as crowetic's automation, may adjust settings.json, but Core's own update doesn't.

Also asked as: auto update keeps settings · core update deletes data · will an update reset settings.json · core update lose blockchain · update keeps my db

## Q: Where is the Qortal Core log file?

A: Core writes its log to qortal.log in the folder it runs from: ~/qortal/qortal.log on Linux and macOS, and C:\Program Files\Qortal\qortal.log on a standard Windows install. When it reaches 10 MB it is compressed into a dated file such as qortal.04-Nov.log.gz and a fresh qortal.log starts. Older installs wrote log.txt files instead.

Also asked as: qortal core log location · where is qortal.log · core log file path · find qortal node log · qortal log windows location

## Q: Which log lines show that Qortal Core started properly?

A: In qortal.log a healthy start goes roughly: Starting repository, Validating blockchain..., Chain height at start-up followed by a number, Starting networking on port 12392, Starting second network (QDN) on port 12394, and finally Starting API on port 12391. Once that last line appears, Hub and Q-Apps can talk to the node.

Also asked as: core started log line · starting api on port 12391 · qortal log startup lines · tell core is running from log · chain height at start-up

## Q: How can I tell from the log that Core is bootstrapping?

A: Look for lines such as Downloading full node bootstrap from (a bootstrap server), Extracting bootstrap..., Moving files to output directory... and Starting repository from bootstrap... If a download fails you see Bootstrapping failed. Retrying in a number of minutes; Core keeps retrying with longer waits each time. After that the normal startup lines follow and the node syncs the newest blocks.

Also asked as: bootstrap log lines · qortal log bootstrapping · downloading full node bootstrap log · extracting bootstrap log · is my node bootstrapping

## Q: How do I know if UPnP opened my Qortal ports?

A: Check qortal.log after Core starts. UPnP Mapped for P2P, port: 12392 means your router opened the port for Core. Unable to map P2P port: 12392 with UPnP, port in use? means it didn't, so forward TCP 12392 and 12394 to the node yourself if you want incoming connections. UPnP is on by default (the uPnPEnabled setting).

Also asked as: upnp worked qortal · upnp mapped for p2p · check upnp in qortal log · unable to map p2p port · did my router open the qortal port

## Q: Is it safe to share my Qortal Core log?

A: Share it only with people you trust to help. qortal.log lists peer IP addresses, your node's external IP address once Core learns it, and account addresses, for example of the accounts it mints for. It does not contain your seed phrase, but never send apikey.txt or anything from the qortal-backup folder along with it.

Also asked as: share qortal log safe · qortal log privacy · what is in the qortal log · send core log to support · does the qortal log show my ip

## Q: What does the Qortal Core splash screen show?

A: On a desktop, Core shows a splash window while it starts. On a first start or after a bootstrap it shows progress such as Downloading full node bootstrap... with a percentage, then Extracting bootstrap... When the splash closes, Core keeps running in the background with its tray icon, and it may still need to sync the newest blocks.

Also asked as: core splash screen · qortal splash downloading bootstrap · qortal logo window progress · core splash progress bar · bootstrap progress window

## Q: How do I restart Qortal Core?

A: Stop it, wait until it has fully ended, then start it again: ./stop.sh then ./start.sh in the qortal folder on Linux and macOS, or Exit from the tray icon and run Qortal again on Windows. With your own node you can also use restart in the Q-Node app, which asks you to approve it and can take up to 5 minutes.

Also asked as: restart core · restart qortal node · reboot qortal core · qortal core restart command · stop and start core again

## Q: What does the Core information panel in Hub show?

A: Hover over the sync status icon in Hub to see Core information: Core version, block height, connected peers, QDN (data) peers, Hub's Reticulum details (connected remote interfaces, P2P Hub peers and P2P Hub health), which node you are using, and the Hub version. It tells you at a glance whether your node is synced and well connected.

Also asked as: hub core information panel · core information hub · hub node info tooltip · where hub shows peers and height · hub sync icon hover

## Q: How do I make Qortal Core start at boot on Linux?

A: The easiest way is crowetic's automation, which adds a cron @reboot line for its start-qortal-core.sh script (and, on desktops, a login autostart entry). To do it yourself, run crontab -e and add an @reboot line that changes into your qortal folder and runs ./start.sh. The folder change matters, because cron does not start in your qortal folder.

Also asked as: qortal core start at boot linux · crontab reboot qortal · autostart qortal core linux · linux node start automatically · start-qortal-core.sh cron

## Q: How do I make Qortal Core start automatically with Windows?

A: Add Qortal to your startup apps, as the community wiki suggests, so Core comes back after Windows restarts for updates. Press Win+R, type shell:startup and press Enter, then put a shortcut to the Qortal app (the Core shortcut from the Start menu) in the folder that opens. Core then starts each time you log in.

Also asked as: autostart qortal windows · qortal core run at windows login · windows startup folder qortal · qortal core automatic after windows update restart · shell startup qortal shortcut

## Q: What does Qortal Core do the first time it starts?

A: It creates its folders, sees there is no blockchain database yet and downloads the bootstrap instead of syncing from block one. It loads a starting list of well-known peers, makes its own certificate for the API, and once the API is up it syncs the blocks made since the bootstrap. The first app that needs it then has Core create an API key in apikey.txt.

Also asked as: core first start · qortal core first run · new node first launch · what happens when core starts first time · fresh qortal core install start

## Q: What happens step by step during a bootstrap?

A: 1. Core downloads the bootstrap archive from a bootstrap server.
2. It closes its database and deletes the old db folder.
3. It extracts the archive and moves the new database into place as db.
4. It starts the database again, restores your minting accounts and trade data from qortal-backup, and opens the API.
5. It syncs the blocks made since the bootstrap was created.
If a download fails, Core waits and tries again.

Also asked as: bootstrap steps · what happens when a node bootstraps · bootstrap process qortal · how bootstrapping works · stages of a qortal bootstrap

## Q: What exactly does Bootstrap chain in Hub do?

A: It is one tool with two paths. If your local Core is running, Hub asks Core, with your API key, to bootstrap itself from the snapshot, then watches the log until the API is back. If that isn't possible or fails, Hub stops Core if needed, deletes the local chain database (the db folder) and starts Core, which then bootstraps on start. Wallet files are left alone either way.

Also asked as: hub bootstrap chain button · bootstrap chain hub what happens · hub bootstrap or clear chain · bootstrap from hub advanced · hub wipe chain db

## Q: How do I bootstrap a Windows node by hand?

A: 1. Right-click the Qortal tray icon, choose Exit and wait for Core to close.
2. Right-click Start, choose Run, type %localappdata%\qortal and press Enter.
3. Delete the db folder in the window that opens.
4. Start Core again from the Start menu. It downloads and applies a fresh bootstrap, then syncs the newest blocks.

Also asked as: bootstrap windows manually · delete db folder windows qortal · windows qortal bootstrap localappdata · manual bootstrap windows core

## Q: How do I bootstrap a Linux or Mac node from the terminal?

A: In a terminal run cd ~/qortal, then ./stop.sh, and wait for Qortal ended gracefully. Then rm -rf db deletes the database folder, and ./start.sh starts Core, which bootstraps by itself. Delete only the db folder: the rest of the qortal folder holds your settings, API key, lists and QDN data.

Also asked as: bootstrap linux terminal · rm -rf db qortal · bootstrap mac terminal qortal · delete db and start.sh · manual bootstrap linux core

## Q: Hub says my local node is not synchronized when I log in. What can I do?

A: Hub shows how many blocks behind your node is and asks you to wait until it is synchronized. You can wait, choose continue with public node to use the public node for now, or continue with Local anyway if you know your node is behind. Once the node has caught up, Hub says you are now synchronized and you may continue.

Also asked as: hub not synchronized at login · you are blocks behind hub · continue with public node hub · continue with local anyway · hub wait until synchronized

## Q: What do the maxPeers, minOutboundPeers and minBlockchainPeers settings do?

A: maxPeers is the most blockchain peer connections Core allows (32 by default). minOutboundPeers is how many connections Core tries to make out to others itself (16). minBlockchainPeers is how many peers with recent blocks it needs before it will sync or mint (3), and it must be at least 1. QDN data peers are counted separately, up to maxDataPeers (64).

Also asked as: maxPeers setting · minOutboundPeers meaning · minBlockchainPeers meaning · qortal peer settings defaults · how many peers does core connect to

## Q: How do I change the ports Qortal Core uses?

A: Set them in settings.json and restart Core: "apiPort" for the API (default 12391), "listenPort" for blockchain peers (12392) and "listenDataPort" for QDN data peers (12394). If you change the API port, also change the address Hub or GO use for this node. Running a second node on the same network is the usual reason to change the peer ports.

Also asked as: change qortal ports · apiPort setting · listenPort listenDataPort · qortal core custom port · change api port 12391

## Q: How do I use Hub with my Qortal node on another computer?

A: 1. Core on the node must accept API calls from your computer. The settings shipped with Core already do; if you turned the whitelist on, add your computer's address to apiWhitelist and restart Core.
2. In Hub open Connection Mode, go to Custom Nodes and choose Add custom node.
3. In Manual node setup enter a Name, the Node URL (the node's address with port 12391) and the API key from the node's apikey.txt.
4. Save it, pick it, and reload Hub when it asks.

Also asked as: hub remote node · hub custom node setup · connect hub to node on another pc · add custom node hub · hub use node on raspberry pi

## Q: Does Hub need my node's API key?

A: For your local node, Hub reads the key from Core's apikey.txt by itself, and asks Core to create one if there is none. For a custom node you type it into the API key (optional) field. Without it Hub can still read the chain and QDN, but actions that need the key, such as publishing, node admin actions and changing lists, are refused.

Also asked as: hub api key local node · does hub use the apikey · hub custom node api key optional · where hub gets the api key · hub apikey local core

## Q: How is my node's API key created?

A: Core doesn't make one by itself. The first app that needs it, usually Hub talking to your local node, calls Core's admin/apikey/generate, which works without a key only while none exists. Core then saves a fresh random key in apikey.txt, and from then on generating another key requires the current one.

Also asked as: create a qortal api key · generate apikey core · admin apikey generate · who makes the api key · first api key for a node

## Q: How do I change my node's API key if it leaked?

A: Make a new one, which makes the old one useless. In Hub you can use reset apikey: it deletes apikey.txt and has Core generate a new key. Without Hub, stop Core, delete apikey.txt, start Core and let your app create a new key, or call admin/apikey/generate with the current key, which replaces it. Then enter the new key everywhere else you use this node, such as GO and your scripts.

Also asked as: change qortal api key · rotate node api key · api key leaked qortal · new api key for my node · replace apikey.txt

## Q: What is the apiWhitelist setting?

A: It lists the addresses allowed to use the API at all. With the whitelist on, Core's default is only the node itself (::1 and 127.0.0.1), while "apiWhitelistEnabled": false lets any address connect; the settings.json shipped with Core sets exactly that. To allow only your home network, set "apiWhitelistEnabled": true and, for example, "apiWhitelist": ["::1", "127.0.0.1", "192.168.0.0/24"], then restart Core. Sensitive calls still need the API key either way.

Also asked as: apiWhitelist qortal · apiWhitelistEnabled false · allow lan api access core · who can connect to the core api · whitelist my phone qortal node

## Q: Why are there two settings.json files on Windows?

A: The Windows installer writes a tiny settings.json in C:\Program Files\Qortal that only holds userPath, the folder with your real settings. That real settings.json is in %LOCALAPPDATA%\Qortal, together with the db, data, lists and wallets folders it points to. Edit the AppData one; the wiki says the Program Files copy is for advanced users only.

Also asked as: two settings.json on windows · program files settings.json userPath · which settings.json to edit windows · qortal windows settings file confusion

## Q: Should I change Qortal Core's settings.json?

A: Usually not. The community wiki's advice is to leave it alone unless you have a specific reason, because Core's defaults are chosen to suit general use. If you do change something, restart Core afterwards, since settings only apply when Core starts.

Also asked as: edit settings.json or not · change qortal core settings · are default core settings good · do i need to edit settings.json · core settings advice

## Q: Do changes to settings.json take effect right away?

A: No. Core reads settings.json only when it starts, so stop Core, make your change and start it again. The community wiki gives exactly that order: stop, edit, start.

Also asked as: settings.json restart needed · apply a settings change core · core reload settings · edited settings not working · restart after settings change

## Q: How can I see the settings my node is actually using?

A: Open localhost:12391/admin/settings in a browser on the node, or run ./qort -p admin/settings in the qortal folder. It lists every setting with the value Core is using, including built-in defaults you never set. For a single one, add its name, for example admin/settings/maxPeers.

Also asked as: view current core settings · admin settings endpoint · show all settings of my node · check a setting value in core · core effective settings

## Q: What happens if a setting is not in settings.json?

A: Core uses its built-in default for it. settings.json only needs the settings you want to change, and a file containing just {} is valid; the Core README starts developers off with exactly that. If the file is missing entirely, though, Core stops with a Settings file not found error.

Also asked as: missing setting default · settings.json only changes · empty settings.json qortal · do i need every setting · core default values

## Q: What are the folders inside my qortal folder?

A: db holds the node's copy of the blockchain; data holds the QDN files the node hosts; lists holds its follow and block lists; qortal-backup holds exported minting accounts and trade-bot data; wallets holds encrypted caches for coin wallets that need them; uploads-temp holds unfinished uploads and is cleared at start. Next to them sit qortal.jar, settings.json, apikey.txt, QortalKeyStore.jks, the logs and the start and stop scripts. On Windows the data folders are in %LOCALAPPDATA%\Qortal.

Also asked as: qortal folder contents · what is in the qortal directory · db data lists folders qortal · qortal core folder layout · files in the qortal folder

## Q: What is in the qortal-backup folder?

A: Core's own copy of data that lives only on this node: MintingAccounts.json with the node's minting accounts, TradeBotStates.json with the trades it is running, and TradeBotStatesArchive.json with older ones, plus a few other node files. Core writes them when it shuts down, and loads the minting accounts and trades back in when it starts. That is why a bootstrap or a fresh database doesn't lose them.

Also asked as: qortal-backup folder · MintingAccounts.json · TradeBotStates.json · core exports minting accounts · qortal backup folder contents

## Q: Do I need to back up the db folder?

A: No. The db folder is only your node's copy of the public blockchain, and a bootstrap or a sync rebuilds it. Copying it can save time when you move a node, but copy or restore it only while Core is stopped.

Also asked as: backup db folder qortal · copy the blockchain database · save the qortal db · should i back up the blockchain · db folder backup needed

## Q: Which files should I copy when moving my node to a new computer?

A: Install Core on the new machine first. Then, with both Cores stopped, copy over the qortal-backup folder (minting accounts and trade data), the lists folder (follows and blocks) and settings.json if you changed it. Copy the data folder too if you want to keep hosted QDN files without fetching them again. Start Core and let it bootstrap; if you mint, you can instead simply add your minting key again from Hub on the new node.

Also asked as: move qortal node files · copy my node to a new pc · migrate qortal core · transfer the qortal folder to a new computer · new machine qortal node copy

## Q: What happens to my old node when I run the Linux install script again?

A: If Core is running and synced, the script keeps it as it is. Otherwise it moves your old qortal folder to ~/backups/qortal-<number>, installs a fresh Core, and copies back qortal-backup (minting and trade data), lists (follows and blocks), the data folder if it was in the default place, apikey.txt and a custom dataPath setting. Check your other custom settings afterwards.

Also asked as: rerun qortal linux script · linux script with an existing node · qortal script backs up old install · reinstall qortal with the linux script · backups qortal folder script

## Q: How do I uninstall Qortal Core?

A: Stop Core first. On Windows, remove Qortal from your installed apps, then delete %LOCALAPPDATA%\Qortal if you also want the node's data gone. On Linux and macOS, delete the qortal folder in your home folder (and jdk-17.0.2 if Hub fetched Java for it), and remove any auto-fix lines from your crontab. Your account isn't stored in Core, but keep qortal-backup if you mint or have trades open.

Also asked as: uninstall qortal core · remove the qortal node · delete qortal core completely · uninstall core on windows · remove the qortal folder linux

## Q: What is in the db folder?

A: It is Core's database: the node's own copy of the Qortal blockchain, stored as HSQLDB database files whose names start with blockchain. Don't edit or open it while Core runs. If it ever gets damaged, delete it with Core stopped and let a bootstrap rebuild it.

Also asked as: qortal db folder · what is the db folder · blockchain database files · core database folder contents · db blockchain files qortal

## Q: How do I install Qortal Core on a Raspberry Pi?

A: Use a 64-bit Raspberry Pi OS, or another 64-bit Linux, and install it like any Linux machine. The Linux (Script) command from qortal.dev Downloads installs Java, puts Core in ~/qortal and fetches the arm64 build of Hub. Or follow the qortal.zip steps with Java 11 or newer. Then start Core with ./start.sh and let it bootstrap.

Also asked as: install core raspberry pi · qortal core pi setup · raspberry pi qortal node install · pi qortal script · qortal on raspberry pi os

## Q: Do I need a Qortal account or QORT to run a node?

A: No. Qortal Core syncs the chain, shares data and serves its API without any account, name or QORT. You need an account only to use Hub or GO with it, and minting needs an account that has been accepted into the MINTER group.

Also asked as: run a node without an account · qort required to run core · qortal core without wallet · does a node need a name · run core no account

## Q: Does my node help the network even if I don't mint?

A: Yes. A node that doesn't mint still checks and passes on blocks and transactions, hosts and relays QDN data so apps and sites load faster for others, and gives other nodes more peers to connect to, especially with its ports open. The Minter Guide says every extra healthy node helps Qortal, whether or not it is minting.

Also asked as: non minting node helps network · run a node without minting · is a non-minter node useful · help qortal without minting · why run a node if not minting

## Q: Should Qortal Core run on the same computer as Hub?

A: Either works. Running Core and Hub together locally is the setup qortal.org calls the preferred one. Many minters instead keep Core on a small always-on machine and open Hub on their everyday computer only when needed, adding the node there as a custom node. What matters is that Core stays online and synced.

Also asked as: core and hub on the same computer · hub on one pc core on another · separate node machine for hub · best machine to run qortal core · core on a different machine than hub

## Q: Does Qortal Core slow down my computer?

A: It is built to stay in the background: start.sh and Hub start Java at the lowest CPU priority (nice), so your other programs come first, and by default Java may use at most half of the RAM. It works hardest during the first sync or a bootstrap and during its database maintenance every few days. Many minters prefer a separate small machine that runs all the time.

Also asked as: core slows my computer · qortal core cpu usage · is a qortal node heavy · core uses a lot of ram · qortal core performance impact

## Q: What is the Qortal Core API?

A: It is the local web interface that Qortal Core offers on port 12391. Hub, GO, Q-Apps and scripts send it requests, for example for the block height, a name, a QDN file or the node's status, and Core answers, mostly in JSON. Anyone who can reach it may read public chain data; calls that control the node need the API key. With apiDocumentationEnabled on, Core also serves a page that lists every call.

Also asked as: qortal core api meaning · what is the node api · core rest api qortal · how apps talk to qortal core · qortal api on port 12391

## Q: What does Connecting mean on the Qortal Core tray icon?

A: Core has fewer than 3 connected peers, the minimum it needs before it syncs or mints (minBlockchainPeers), so it is still finding them. After a start this usually clears as peers connect. If it stays on Connecting, check the internet connection, the computer's clock and the firewall.

Also asked as: core tray connecting · qortal stuck on connecting · tray icon says connecting · connecting fewer peers qortal

## Q: Does Hub use start.sh when it starts Qortal Core?

A: No. On Linux and macOS, Hub runs Java on qortal.jar directly from the Core folder, with its own options and settings.json, and writes the console output to run.log. Changes you make to start.sh, such as memory settings, only apply when you start Core with ./start.sh yourself. On Windows, Hub runs qortal.exe.

Also asked as: hub starts core without start.sh · hub java options core · start.sh changes ignored by hub · hub core memory settings · how hub launches qortal core

## Q: Which Linux systems does the Qortal install script support?

A: It recognizes the Debian family (Debian, Ubuntu, Mint, Raspberry Pi OS and similar), the Red Hat family (Fedora, RHEL, CentOS, Rocky, Alma), Arch and Manjaro, openSUSE, and Alpine. On other systems it asks you to install the parts yourself: Java 21 or newer, curl or wget, unzip, jq, zlib development headers, ImageMagick and FUSE2, which Hub's AppImage needs.

Also asked as: linux script supported distros · qortal script fedora arch · qortal install script distro · does the qortal script work on my linux · qortal linux script alpine suse

## Q: Can I run the Qortal Linux script on a server with no desktop?

A: Yes. Over SSH or without a desktop it skips the Hub test launch but still downloads Hub and creates its launchers for later. Core itself runs fine without a screen. With the automation on, a server starts Core at boot from cron instead of at login.

Also asked as: qortal script headless · linux script over ssh · qortal server install no gui · headless qortal node install · install qortal core via ssh

## Q: Can I run Qortal Core with Oracle Java?

A: Use an OpenJDK build instead, such as Eclipse Temurin or your Linux system's OpenJDK package. Core's own code notes that it is critical to use OpenJDK and not Oracle's Java SE: Core repacks the BouncyCastle security library, and Java SE then rejects it as a security provider.

Also asked as: oracle java qortal core · openjdk or oracle java qortal · java se qortal core problem · which java brand for qortal · temurin vs oracle qortal

## Q: How do I check which Java version I have?

A: Open a terminal (Command Prompt on Windows), type java -version and press Enter. The first line shows the version, for example openjdk version "17.0.2". Core needs 11 or newer. On Linux and macOS, start.sh does the same check and prints Passed Java version check, or tells you to install or upgrade Java.

Also asked as: check java version qortal · java -version command · is java installed for qortal · how to see my java version · find java version in terminal

## Q: Why does start.sh say Please su to non-root user before running?

A: Core's start script refuses to run as the root user for security reasons; Core doesn't need root. Log in as, or switch to, your normal user and run ./start.sh from that user's qortal folder. That user should own the qortal folder and its files.

Also asked as: qortal start.sh root error · please su to non-root user · run qortal core as root · qortal core refuses root · start.sh as root user

## Q: What is the qort command in the qortal folder?

A: qort is a small helper script shipped with Core for calling its API from a terminal. It sends your API key from apikey.txt automatically. For example, in the qortal folder ./qort admin/status shows the node's status, and ./qort -p blocks/last shows the latest block neatly formatted. Run ./qort with nothing after it to see its options.

Also asked as: qort script qortal · qortal qort command line · qort helper script usage · qort tool api · qortal command line helper

## Q: What is new-qortal.jar in my qortal folder?

A: It is a Core update that has been downloaded and checked but not yet swapped in. During the automatic restart, Core's update helper moves it over qortal.jar and starts the new version. If an update can't be applied, Core deletes the download and tries again on a later check.

Also asked as: new-qortal.jar file · new qortal jar meaning · downloaded core update file · new-qortal.jar left over

## Q: Does updating Qortal Core also update Hub or GO?

A: No. Core's auto-update only replaces Core on that machine. Qortal Hub and Qortal GO are separate apps with their own updates, so check those in the apps themselves. Hub's Core information shows the Core version and the Hub version as two separate lines.

Also asked as: core update hub update · does hub update with core · update qortal hub separately · core and hub versions separate · go update with core

## Q: What are run.log and run.pid in the qortal folder?

A: start.sh writes both. run.pid holds the process number of the running Core, which stop.sh uses to find and stop it; it is removed after a clean stop. run.log catches what Java prints to the console. Core only prints errors there, so run.log is where startup errors and crashes show up, while the normal running log is qortal.log.

Also asked as: run.log qortal · run.pid qortal · what is run.log · core run pid file · qortal run log errors

## Q: What are the qortal .log.gz files in my qortal folder?

A: They are older parts of Core's log. Each time qortal.log reaches 10 MB, Core compresses it into a file named after the date, like qortal.04-Nov.log.gz. They are only there for reading later; Core doesn't need them to run, and crowetic's recovery script deletes them when it resets a node.

Also asked as: qortal log gz files · old qortal logs · qortal.log.gz meaning · can i delete qortal log gz · compressed core logs

## Q: How do I change how much Qortal Core writes to its log?

A: Logging is set in log4j2.properties in the Core folder. The default level is info, and chatty libraries are already turned down. You can raise one part of Core to debug while a developer helps you, then restart Core; set it back afterwards, because debug logs grow fast.

Also asked as: core log level · log4j2.properties qortal · qortal debug logging · less logging qortal core · change qortal log settings

## Q: What does Synchronize clock in the Qortal Core tray menu do?

A: It appears on Windows only. It runs a small script that asks for administrator rights, sets the Windows Time service to use public internet time servers (pool.ntp.org) and sets it to start automatically, because Core needs an accurate clock. Check time accuracy, in the same menu, opens a time-check website so you can compare your clock.

Also asked as: synchronize clock qortal windows · core tray synchronize clock · fix windows time for qortal · check time accuracy qortal · qortal windows time ntp

## Q: Core says Database upgrade needed. Please restart the core. What do I do?

A: Do what it says: stop Core and start it again. Core shows this when its database still needs some internal tables built, which can happen right after a bootstrap, and it won't start fully until it has been restarted once.

Also asked as: database upgrade needed qortal · please restart the core to complete the upgrade · core database upgrade message · restart core upgrade process

## Q: Can I start Qortal Core with a different settings file?

A: Yes. Core reads settings.json from the folder it starts in, or the file you name after qortal.jar on the command line (java -jar qortal.jar mysettings.json). A settings file can also contain userPath, which tells Core to read the real settings.json from another folder; the Windows installer uses this to point at %LOCALAPPDATA%\Qortal.

Also asked as: core custom settings file · qortal settings file argument · java -jar qortal.jar settings.json · use another settings.json for core · userPath setting qortal

## Q: How do I open Qortal Core's API documentation?

A: Add "apiDocumentationEnabled": true to settings.json and restart Core, then open localhost:12391/api-documentation in a browser on the node machine. It lists the API calls with descriptions and examples and lets you try them. Admin calls still need your API key.

Also asked as: core api documentation · api-documentation qortal · qortal swagger api docs · enable api docs core · apiDocumentationEnabled

## Q: How often does crowetic's auto-fix script run?

A: It runs shortly after the machine starts (about 7 minutes after login on a desktop, or 399 seconds after boot on a server) and then at 01:01 on every third day of the month; the cron line for that is 1 1 */3 * *. Each run first updates the script itself.

Also asked as: auto-fix schedule · auto fix cron every 3 days · when does auto-fix run · qortal automation schedule · auto-fix at boot

## Q: How do I turn off crowetic's auto-fix automation?

A: Run crontab -e and delete the lines that run auto-fix-qortal.sh (and the @reboot start line too if you don't want Core started at boot), then remove its entry from ~/.config/autostart if there is one. Running the auto-fix script again later re-creates its schedules.

Also asked as: disable auto-fix qortal · remove qortal automation · stop auto-fix cron · turn off qortector auto fix · uninstall qortal automation

## Q: Where does crowetic's auto-fix write its logs?

A: On a headless node its cron runs write to ~/auto-fix-startup.log (the run after boot) and ~/log-auto-fix-cron.log (the regular runs). On a desktop it usually runs in a terminal window you can watch; let it finish once it has started.

Also asked as: auto-fix log file · log-auto-fix-cron.log · auto-fix-startup.log · qortal automation logs · where is auto fix output

## Q: Can I undo settings changes made by crowetic's auto-fix?

A: Yes. Before it merges its recommended values into settings.json, auto-fix saves a timestamped copy of your old file in qortal-backup/auto-fix-settings-backup inside the qortal folder, and latest-good.json points at the newest good copy. Stop Core, copy the backup over settings.json and start Core. When merging, it keeps the higher of two numbers and forces a few thread-priority settings.

Also asked as: auto-fix changed my settings · restore settings.json after auto-fix · auto-fix settings backup · auto-fix settings merge · latest-good.json qortal

## Q: What is the autoRestartEnabled setting in Qortal Core?

A: When set to true in settings.json, Core checks every 10 minutes and restarts itself if it has no connected peers at all. It is off by default. It is meant for a node that sometimes loses all its peers and doesn't recover on its own.

Also asked as: autoRestartEnabled · core auto restart with no peers · qortal restart when 0 peers · automatic node restart setting

## Q: What is QortalKeyStore.jks in the qortal folder?

A: It holds the certificate Core uses to serve its API over HTTPS. Core creates it by itself on first start and makes a new one if the file goes missing or gets damaged. It has nothing to do with your account, but keep it private like the rest of the node's files.

Also asked as: qortalkeystore.jks · qortal keystore file · core ssl certificate file · jks file qortal core · delete qortalkeystore

## Q: Does Qortal Core's API use HTTPS?

A: Yes. Current Core serves both HTTPS and plain HTTP on the same API port, 12391, using a certificate it makes for itself. Hub on the desktop talks to your local node over HTTPS and trusts that certificate. GO uses plain HTTP for a node on your home network.

Also asked as: core api https · qortal node https 12391 · does qortal api support ssl · https local node hub · qortal api http or https

## Q: What does Qortal Core save when it shuts down?

A: A clean stop shuts Core's parts down in order: syncing, the API, wallets, networking and the rest. On the way it logs Backing up local data and writes your minting accounts and trade-bot states to the qortal-backup folder, then closes the database and logs Shutdown complete! That is why stopping Core properly beats pulling the plug. Hub waits up to 2 minutes for Core to finish.

Also asked as: core shutdown backs up · what happens when core stops · qortal core shutdown steps · shutdown complete qortal log · core exit saves minting accounts

## Q: Can I sync my node from the genesis block instead of using a bootstrap?

A: Yes. Before the first start, add "bootstrap": false to settings.json. With no database and bootstrapping off, Core syncs from block one using its peers. Expect it to take far longer than a bootstrap; the community FAQ says a full sync can take up to a few days.

Also asked as: sync from genesis qortal · disable bootstrap core · bootstrap false setting · sync whole chain from peers · no bootstrap qortal node

## Q: Where does Qortal Core download its bootstrap from?

A: From one of the Qortal bootstrap servers, picked at random: bootstrap.qortal.org, or bootstrap2, bootstrap3 or bootstrap4.qortal.org. On a normal node the file is bootstrap-archive.7z (testnet nodes use a testnet- version). The list is the bootstrapHosts setting, so it can be changed in settings.json if ever needed.

Also asked as: bootstrap server qortal · bootstrap.qortal.org · where the bootstrap comes from · bootstrap-archive.7z · bootstrap download host

## Q: How does Qortal Core catch up when it is behind?

A: Core asks its up-to-date peers for the blocks it is missing and checks each one before adding it. Since Core 6, a node more than 200 blocks behind asks for 200 blocks at a time, which the developers describe as up to a 300% speed-up. It needs at least 3 peers with recent blocks before it syncs or mints.

Also asked as: how core syncs blocks · qortal sync process · node catching up on blocks · batch block sync qortal · how fast does qortal sync

## Q: What is the block archive in Qortal Core?

A: To keep the database smaller, Core moves older blocks out of the main database into compact archive files (the archiveEnabled setting, on by default). The node still keeps every block back to genesis and can still serve them; they are only stored more compactly. That is also why normal nodes download the bootstrap-archive file.

Also asked as: qortal block archive · archiveEnabled setting · core archives old blocks · blockchain archive flat files · does core prune old blocks

## Q: How do I control when Core runs database maintenance?

A: Core picks a random time between repositoryMaintenanceMinInterval and repositoryMaintenanceMaxInterval after it starts: 3 and 14 days by default, written in milliseconds in settings.json. Setting the maximum to 0 turns scheduled maintenance off. You can also start it on demand with a DELETE request to admin/repository and your API key while Core runs; it needs enough free disk space to rebuild the database and pauses the node for a while.

Also asked as: repositoryMaintenanceMinInterval · core maintenance interval setting · change db trim schedule · run repository maintenance now · qortal database maintenance settings

## Q: Which peers does a new Qortal node start with?

A: When its peer list is empty, Core adds a built-in list of well-known nodes, such as node1 to node15.qortal.org and a few community nodes, and connects to some of them. From there it learns about more peers from the nodes it talks to, so it doesn't rely on that list for long.

Also asked as: initial peers qortal · qortal seed nodes · node1.qortal.org peers · first peers of a new node · where core finds peers

## Q: Why does my node keep switching to different peers?

A: That is on purpose. Core stays connected to each blockchain peer for a random time between 2 and 6 hours (minPeerConnectionTime and maxPeerConnectionTime), then drops it and finds others. Rotating peers stops nodes from forming isolated islands and keeps the network well mixed. QDN data peers are only kept for up to 30 minutes.

Also asked as: peers keep changing qortal · core disconnects peers · peer connection time qortal · minPeerConnectionTime · why peers drop and reconnect

## Q: Can I clear my node's list of known peers?

A: Yes. The API has a call that removes all known peers from the node's database; with the qort helper it is ./qort -l DELETE peers/known in the qortal folder, and your API key is sent automatically. When Core next finds its peer list empty, for example after a restart, it adds its built-in starting peers again and rebuilds the list.

Also asked as: clear known peers qortal · delete peers known · reset the peer list core · qort delete peers known · remove all known peers

## Q: How do I tell Qortal Core my public IP address?

A: Core normally works it out itself from its peers or from UPnP. If it gets it wrong, Core 6 added a setting for it: put your public address in settings.json as "ourExternalIpAddress" (the address in quotes) and restart Core. It tells other nodes where yours can be reached.

Also asked as: ourExternalIpAddress · set external ip qortal · core public address setting · qortal node behind nat address · advertise my node ip

## Q: Can I stop Qortal Core from using UPnP?

A: Yes: add "uPnPEnabled": false to settings.json and restart Core. UPnP is on by default, and Core uses it at startup to ask your router to open its peer ports, 12392 and 12394. With it off, forward those TCP ports to the node yourself if you want incoming connections.

Also asked as: disable upnp qortal · uPnPEnabled false · turn off upnp core · qortal core without upnp

## Q: What is the Qortal testnet and which ports does it use?

A: The testnet is a separate Qortal network with its own chain, used for testing. A node joins it when settings.json has "isTestNet": true. Its ports are 62391 for the API, 62392 for peers, 62394 for QDN data and 62393 for the developer proxy. The scripts know it too: ./stop.sh --testnet and ./qort -t use the testnet API port.

Also asked as: qortal testnet · isTestNet setting · testnet ports 62391 · run the qortal test network · qortal testnet api port

## Q: How do I connect Hub to a remote node through an SSH tunnel?

A: 1. On your computer run ssh -L 12398:localhost:12391 you@192.168.1.20, using your own user and the node's address, and keep that terminal open. The first number can be any free port.
2. In Hub add a custom node with the Node URL 127.0.0.1 and port 12398, plus the node's API key from its apikey.txt.
3. Choose that node and log in as usual.
For a node outside your home network, its SSH port (usually 22) must be reachable.

Also asked as: ssh tunnel qortal hub · ssh -L 12391 qortal · hub remote node ssh · tunnel to a qortal node · qortal custom node localhost tunnel

## Q: What is localAuthBypassEnabled in Core settings?

A: When set to true, Core accepts requests from the same machine (loopback addresses such as 127.0.0.1) without the API key. It is off by default. Be careful with it: if a web server or proxy on that machine passes outside traffic to Core, those visitors look local too and skip the key. GO only trusts it for a node it reaches over 127.0.0.1, localhost or ::1.

Also asked as: localAuthBypassEnabled · skip api key on localhost · core local auth bypass · api key not needed on same computer · loopback auth bypass qortal

## Q: What does apiRestricted mean in Core's settings?

A: When it is on, Core refuses a group of API calls meant for testing and development, such as building certain raw transactions for you or signing one with a private key sent to the node. If the setting is missing it is on for the main network and off on testnet. The settings.json that comes with Core sets it to false.

Also asked as: apiRestricted setting · api restricted qortal · non-production api error · apiRestricted false meaning

## Q: Can I put the API key in the address instead of a header?

A: Yes. Core takes the key from the X-API-KEY header or from an apiKey parameter in the address, and Core's own stop.sh uses the address form. The header is the better habit, because addresses end up in browser history, logs and screenshots. The qort helper sends the header for you.

Also asked as: apikey query parameter · api key in the url qortal · x-api-key header · how to send the qortal api key · apiKey parameter core

## Q: How do I check that an API key is correct?

A: Call admin/apikey/test with the key in the X-API-KEY header: a correct key answers true. A wrong one is refused with API key invalid, and no key at all with Missing 'X-API-KEY' header. In the qortal folder, ./qort admin/apikey/test does this with the key from apikey.txt. Hub and GO run the same check on custom and private nodes.

Also asked as: test qortal api key · admin apikey test · is my api key valid · check node api key works · apikey test call

## Q: Why does Core say API key not generated?

A: Your node has no API key yet, so it refuses every call that needs one. Let Hub create it by using the node as your Local Node, or call admin/apikey/generate yourself; that works without a key only while none exists. The new key is saved in apikey.txt.

Also asked as: api key not generated · core has no api key yet · apikey.txt missing · qortal api key not created · generate an api key first

## Q: Can I keep the API key in settings.json?

A: Not any more. The apiKey setting is a legacy option from before November 2021. If an old settings.json still has one (at least 8 characters), Core copies it into apikey.txt and uses it; otherwise the key lives only in apikey.txt.

Also asked as: apiKey in settings.json · legacy api key setting · old qortal apikey setting · settings json api key

## Q: What is in the settings.json that comes with Qortal Core?

A: Very little. The Linux and macOS zip has four settings: balanceRecorderEnabled true, apiWhitelistEnabled false, allowConnectionsWithOlderPeerVersions false and apiRestricted false. The Windows installer's copy has apiDocumentationEnabled true, apiWhitelistEnabled false, apiRestricted false and allowConnectionsWithOlderPeerVersions false, plus the paths of your data folders. Every other setting uses Core's built-in default.

Also asked as: default settings.json qortal · shipped settings json core · settings.json in the qortal zip · what settings does core ship with

## Q: Can Qortal Core's settings.json contain comments?

A: Current Core skips any line that starts with #, and it also tolerates a comma right before a closing } or ]. Older Core versions and most guides expect strict JSON, so the safe habit is still plain JSON: no comments and no comma after the last setting.

Also asked as: comments in settings.json · hash comment settings json qortal · trailing comma settings.json · settings json comment lines

## Q: Where can I find the full list of Qortal Core settings?

A: In Core's source code: the file Settings.java in the Qortal/qortal repository on GitHub lists every setting with its default value and a short note. The community wiki's settings page explains the common ones, and on a running node admin/settings shows them all with their current values.

Also asked as: all core settings list · qortal settings reference · settings.java qortal · list of settings.json options

## Q: What is the wallets setting in Qortal Core?

A: Since Core 6 you can switch off individual foreign-coin wallets in Core (ARRR, BTC, DGB, DOGE, LTC and RVN) with the wallets setting, to save memory and bandwidth on a node that only serves data or mints. A wallet switched off at startup can still be started later through the API. Leave them on if you trade or use coin wallets through this node.

Also asked as: core wallets setting · disable coin wallets qortal · turn off ltc wallet in core · data only node wallets · qortal node foreign coin wallets off

## Q: How do I turn on Qortal Core's QDN gateway?

A: Set "gatewayEnabled": true in settings.json and restart Core. The gateway serves QDN websites and apps to ordinary web browsers, on port 80 by default (gatewayPort changes it). Public gateways usually sit behind a web server such as nginx with HTTPS. Anything visitors open through your gateway is fetched and stored on your node and uses your bandwidth.

Also asked as: gatewayEnabled · qortal gateway node setting · serve qdn websites to browsers · core gateway port 80 · public qdn gateway setup

## Q: Can I change Qortal Core's language?

A: Core's own texts, such as the tray menu and its pop-ups, follow your computer's language by default. To choose one, set "localeLang" in settings.json to a language code such as de or fr, and restart Core. The tray texts exist in 17 languages, including English, German, Spanish, French, Russian, Japanese and Chinese.

Also asked as: core language setting · localeLang qortal · qortal tray language · change core tray language

## Q: Can I run two copies of Qortal Core on one computer?

A: Yes, if they share nothing: give each its own folder (with its own settings.json, db and data) and its own ports for the API, blockchain peers and QDN peers (apiPort, listenPort, listenDataPort). Two copies pointed at the same database fail, with Core reporting Repository in use by another process? A testnet node already uses different ports from a mainnet node.

Also asked as: two qortal cores one pc · second core instance same machine · run mainnet and testnet core · multiple core instances · two qortal nodes on one computer

## Q: What does allowConnectionsWithOlderPeerVersions do?

A: It decides what happens with peers older than minPeerVersion. When true, they can still connect and sync from your node, and show in your peer list, but your node won't sync from them. When false, as in the settings.json shipped with Core, syncing is blocked both ways and they don't appear at all.

Also asked as: allowConnectionsWithOlderPeerVersions · older peer versions setting · connect to old core versions · minPeerVersion connections

## Q: What does apiLoggingEnabled do in Core's settings?

A: When set to true, Core writes every API request it receives to a file called API-requests.log, in the standard web-server log format with times in UTC. It is off by default. Turn it on only while you investigate something, because the file grows quickly and keeps a record of every request made to your node.

Also asked as: apiLoggingEnabled · log api requests qortal · API-requests.log · core api request log

## Q: What does the bindAddress setting do?

A: It sets which local address Core listens on for both its API and its peer connections. The default, ::, means every address on the machine, with 0.0.0.0 as a fallback where IPv6 isn't available. Changing it affects peers as well as the API, so to limit who can use the API use apiWhitelist instead.

Also asked as: bindAddress qortal · core listen address · qortal listen on all interfaces · bind address 0.0.0.0 core

## Q: What does tradebotSystrayEnabled do?

A: When set to true, Core shows a pop-up from its tray icon each time one of its trade-bot entries, a Trade Portal trade it is running, changes state. It is off by default and only matters on a desktop where Core's tray icon is visible.

Also asked as: tradebotSystrayEnabled · trade bot tray notifications · core trade popups · qortal trade bot systray

## Q: What does the repositoryBackupInterval setting do?

A: It makes Core back up its own database regularly; the value is the time between backups in milliseconds, and 0, the default, means off. Each backup replaces the previous one in a backup folder inside db, and when it is on Core also makes one before an auto-update or a bootstrap. If the database gets damaged, Core can try to recover from that backup.

Also asked as: repositoryBackupInterval · core automatic database backup · qortal db backup setting · back up the database regularly

## Q: What is the wallets folder in the qortal folder?

A: It is where Core keeps encrypted wallet caches for the foreign coins that need one, such as Pirate Chain (ARRR), so it doesn't have to rebuild them each time. You can move it with the walletsPath setting. It is not where your coins are: those are on their own blockchains, controlled by your keys.

Also asked as: wallets folder qortal · core wallets directory · walletsPath setting · pirate chain wallet cache qortal

## Q: Which memory settings does crowetic's automation give Qortal Core?

A: It swaps in a start.sh chosen for the machine's RAM. Up to about 6 GB it lets Java use up to 80% of the memory, from 6 to 16 GB up to 70%, and above 16 GB up to 40%. On a 32-bit ARM board it uses a fixed 1750 MB instead. Core's own start.sh uses 50%.

Also asked as: auto-fix memory settings · qortector start script ram · 4GB-start.sh qortal · maxrampercentage automation · core java memory by ram size

## Q: Can I run Qortal Core on Qubes or Whonix?

A: Yes, the community wiki has a Qubes guide. Install Java 11 or newer in the template (or a standalone qube) and Core in the app qube as on Linux. On Whonix, add "testNtpOffset": 0 to settings.json so Core works with Whonix's own time sync. Over Tor the bootstrap servers can fail to connect; a new Tor circuit, or a manual bootstrap, gets around that.

Also asked as: qortal qubes os · qortal whonix · core over tor · qortal core in an app qube · testNtpOffset whonix

## Q: Can several people use the same Qortal node?

A: Yes. Each person signs in with their own account in their own Hub or GO, pointed at the node, and the node never holds their account keys. Some things are shared, though: the node's follow and block lists apply to everyone using it, and anyone you give the API key to can control the node. Give out the key only to people you trust with that.

Also asked as: share my node with family · several accounts one node · multiple users same qortal core · use one node for many accounts · friends use my node

## Q: Can other Qortal nodes see my IP address?

A: Yes. Like any peer-to-peer network, the nodes yours connects to see its IP address, and peers pass addresses around so others can find yours. The chain doesn't record IP addresses, but anyone running a node yours talks to can see it. If you don't want your home address in peer lists, run the node somewhere else, such as a VPS, and connect to it from home.

Also asked as: qortal node ip address visible · peers see my ip · does qortal hide my ip · node ip privacy · my ip in qortal peers

## Q: Where can I learn more about running a Qortal node?

A: Start with the Running a Node page in the qortal.dev wiki, which covers installing Core on each system and bootstrapping. The community wiki at wiki.qortal.org has deeper pages on settings, port forwarding, SSH tunnels and Raspberry Pi. Inside Qortal, the Q-Minter guide has node recommendations and the Welcome to Qortal Q-App has a Nodes page.

Also asked as: qortal node guide · learn to run a qortal node · qortal core documentation · node setup guide qortal · qortal wiki running a node

## Q: Why does stop.sh say Stop command failed - not running?

A: stop.sh could not reach Core through its API and found no running Core process to signal, so as far as it can tell Core isn't running. Check whether it is (for example with localhost:12391/admin/status); if it started from another folder or as another user, stop it there.

Also asked as: stop command failed not running · stop.sh failed qortal · stop.sh not running with process id · cannot stop qortal core script

## Q: Why does Core say Unable to start networking?

A: Core couldn't open its peer port, so it shuts itself down again; desktops show a Networking failure message, and the log adds Can't create listen socket with the reason. The usual cause is another program, often a second copy of Core, already using port 12392 or the QDN port 12394. Stop the other one, or give this node different ports with listenPort and listenDataPort.

Also asked as: unable to start networking · core networking failure · can't create listen socket · qortal port 12392 in use · networking failure qortal

## Q: Why does Core say Unable to start API?

A: Core couldn't open its API on port 12391 and shuts down again; desktops show an API failure message. Most often another program, or a second copy of Core, is already using that port. Stop the other program, or set a different apiPort in settings.json and use that port in Hub and GO.

Also asked as: unable to start api · core api failure · qortal port 12391 in use · api failure dialog qortal · core cannot open api port

## Q: How do I see the peers my node is connected to from a terminal?

A: In the qortal folder run ./qort -p peers for the blockchain peers, with each one's address, Core version and last block height, and ./qort -p peers/data for the QDN data peers. The Q-Node app shows the same lists in tables, and Hub's Core information shows the counts.

Also asked as: list peers terminal qortal · qort peers command · show connected peers core · peers api qortal · qortal data peers list terminal

## Q: How do I see how long my node has been running?

A: Run ./qort admin/uptime in the qortal folder; it answers in milliseconds. admin/info also includes it, and the Q-Node app has a node uptime widget.

Also asked as: node uptime qortal · core uptime command · admin uptime qortal · how long has core been running · qortal node running time

## Q: How do I see what happened on the chain in the last 24 hours?

A: Ask your node: ./qort -p admin/summary in the qortal folder returns the past 24 hours of activity, with the number of blocks, the transactions counted by type, and names registered and assets issued. admin/summary/alltime gives the same since genesis.

Also asked as: chain activity last 24 hours · admin summary qortal · blocks in last day qortal · transactions last 24 hours core · qortal activity summary

## Q: Can Core tell me when it backs up or maintains its database?

A: Yes, on a desktop where its tray icon is visible. Set "showMaintenanceNotification": true to get a Performing scheduled maintenance... pop-up, "showBackupNotification": true for database backups, and "showCheckpointNotification": true for its regular saving of database changes. All three are off by default.

Also asked as: showMaintenanceNotification · core maintenance popup · database maintenance notification · showBackupNotification qortal · tray message database maintenance

## Q: What is the difference between qortal.zip and qortal.jar?

A: qortal.zip is the full package for a first install on Linux or macOS: it unpacks into a qortal folder with qortal.jar, the start and stop scripts, a starter settings.json, the qort helper and the logging settings. qortal.jar on its own is just the Core program, which is what you replace when updating by hand. Windows uses the qortal.exe installer instead.

Also asked as: qortal.zip vs qortal.jar · which core download zip or jar · do i need the zip or the jar · qortal jar download for an update · core zip or jar file

## Q: Do I need a full JDK or is a JRE enough for Qortal Core?

A: A Java runtime (JRE) is enough to run Core. The qortal.dev Linux script installs just the runtime packages, such as openjdk-21-jre, and falls back to the headless versions. You only need a full JDK, together with Maven, if you want to build Core from its source code.

Also asked as: jre or jdk for qortal · java runtime enough for core · openjdk jre qortal core · is a jdk needed for qortal · headless java qortal core

## Q: Does Hub's own Java copy change the Java on my computer?

A: No. On Linux and macOS, when Hub finds no Java it unpacks a Java 17 copy into ~/jdk-17.0.2 and uses it only to run Core. Your system's own Java, if you install one later, is left alone: Hub checks for its own copy first and otherwise uses the system java command.

Also asked as: hub java 17 system java · hub downloaded java folder · jdk-17.0.2 folder hub · does hub install java system wide · hub java only for core

## Q: start.sh says qortal running as pid, but Core doesn't answer. Why?

A: That line only means Java was started in the background. Core may still be loading or bootstrapping, or it may have stopped with an error. Give it some minutes, then look at the end of qortal.log to see what it is doing, and at run.log for startup errors such as a broken settings.json or a port already in use.

Also asked as: qortal running as pid but not working · core started but api not responding · start.sh pid no response · core not answering after start

## Q: How do I bootstrap my node from the terminal while Core is running?

A: In the qortal folder run ./qort admin/bootstrap; the helper sends your API key. Core answers true, then restarts itself to delete the old database, download a fresh bootstrap and sync from there, and the log shows Bootstrapping node... and Restarting node with:. Hub's Bootstrap chain and Q-Node's bootstrap use the same call.

Also asked as: qort admin bootstrap · bootstrap via the api · bootstrap core from the command line · admin bootstrap endpoint · trigger a bootstrap in the terminal

## Q: What do inbound and outbound peers mean?

A: Outbound peers are nodes yours connected to itself; Core aims for at least 16 of them (minOutboundPeers). Inbound peers are nodes that connected to yours, which only happens when others can reach your peer ports through UPnP or port forwarding. Q-Node's peer list shows this as each connection's direction. No inbound peers is fine for using Qortal, but open ports help the network.

Also asked as: inbound outbound peers qortal · peer direction meaning · incoming connections qortal node · outbound connections core · why no inbound peers

## Q: What does a peer's handshake status mean?

A: Before two nodes trust each other they go through a short handshake: they exchange hello messages with their versions and node IDs, then each proves itself with a challenge and response that includes a small proof of work. Only a peer whose handshake is COMPLETED is used for syncing and data; peers at an earlier stage are still connecting.

Also asked as: peer handshake status · handshake completed qortal peer · peer stuck in handshake · qortal handshake meaning

## Q: What does the ntpServers setting do?

A: It is the list of internet time servers Core asks for the exact time; by default these are the pool.ntp.org servers for each region of the world. Core relies on that time to judge blocks and transactions. Change the list only if those servers are blocked where you are. Whonix users set testNtpOffset to 0 instead.

Also asked as: ntpServers qortal · core time servers · change the ntp server qortal · qortal ntp setting · core clock servers list

## Q: Core says topOnly mode is no longer supported. What do I do?

A: Open settings.json, delete the "topOnly" line (an old setting for nodes that kept only recent blocks), and start Core again. Current Core refuses to start while that setting is there.

Also asked as: topOnly mode is no longer supported · topOnly setting error · core wont start topOnly · remove topOnly from settings

## Q: What do Core errors like minBlockchainPeers must be at least 1 mean?

A: Core checks a few values in settings.json when it starts and stops if one is wrong: minBlockchainPeers must be at least 1, a legacy apiKey must be at least 8 characters, and storagePolicy must be one of FOLLOWED_OR_VIEWED, FOLLOWED, VIEWED, ALL or NONE. Fix the value named in the message, or remove that line to use the default, and start Core again.

Also asked as: minBlockchainPeers must be at least 1 · apiKey must be at least 8 characters · storagePolicy must be one of · core settings validation error

## Q: Does Qortal Core restart itself after a crash?

A: Not by itself. Core restarts on purpose for updates and bootstraps, and the autoRestartEnabled setting restarts it when it has no peers, but if the Java process stops, nothing in Core starts it again. crowetic's automation checks after each boot and every third day, and starts Core again when it isn't running or responding.

Also asked as: core restart after a crash · qortal core watchdog · auto restart crashed core · node stopped by itself restart · keep qortal core running automatically

## Q: Should I run Qortal Core as its own user on Linux?

A: It is a good habit on servers. Core must not run as root (start.sh refuses), and the community guides for a VPS or a gateway node create a separate user, such as one named qortal, and install Core in that user's home folder. On a desktop, your normal user account is fine.

Also asked as: separate user for qortal core · qortal user linux · run core as a non root user · dedicated user for qortal node · adduser qortal

## Q: How do I open the qortal folder on a Mac?

A: In Finder choose Go, then Home, and open the folder named qortal. Or in Terminal type open ~/qortal and press Enter. For a Core installed by Hub or from the zip, that folder holds qortal.jar, settings.json, apikey.txt, the logs and the db and data folders.

Also asked as: find qortal folder mac · open ~/qortal in finder · mac qortal core folder · where is the qortal folder macos

## Q: What is qortal.exe on Windows?

A: qortal.exe is the Windows launcher for Core: it starts qortal.jar with the Java the installer brought along. It sits in C:\Program Files\Qortal next to qortal.jar, and the Start menu entry, Hub's Start Core button and Core's own restart after an update all go through it. The installer you download from qortal.dev is also called qortal.exe.

Also asked as: qortal.exe file · what is qortal.exe · windows core launcher · qortal exe in program files

## Q: I changed apiPort. How does Hub find my local node?

A: Hub's Local Node choice always looks for Core on port 12391. If you moved the API to another port, add the node under Custom Nodes instead, with the Node URL 127.0.0.1 and your new port, plus the API key from apikey.txt.

Also asked as: hub local node different port · changed api port hub cannot connect · hub local node port 12391 only · custom port local core hub · apiPort hub connection

## Q: Does Qortal Core run on Apple Silicon Macs?

A: Yes. Core is a Java program, so it runs on both Intel and Apple Silicon Macs. When Hub installs Core on an Apple Silicon Mac and finds no Java, it fetches the Apple Silicon (aarch64) build of Java 17 for it.

Also asked as: qortal core m1 mac · apple silicon qortal node · core on m2 m3 mac · arm mac qortal core · qortal macos aarch64

## Q: Can my node work as my own block explorer?

A: For simple lookups, yes. On the node, open these in a browser or run them with ./qort -p in the qortal folder: blocks/height for the latest height, blocks/last for the newest block, blocks/byheight/ followed by a number for any block, and transactions/signature/ followed by a signature for one transaction. Each answer comes from your own copy of the chain.

Also asked as: own block explorer qortal · look up block on my node · check transaction on my node · node api blocks height · qortal explorer local node

## Q: How do I check an address's QORT balance with my own node?

A: Open localhost:12391/addresses/balance/ followed by the address in a browser on the node, or run ./qort addresses/balance/ followed by the address in the qortal folder. The answer is the address's QORT balance from your node's copy of the chain, so make sure the node is synced first. addresses/ followed by the address gives more about the account.

Also asked as: balance via my node · addresses balance api · check qort balance terminal · node api account balance · qortal balance lookup local

## Q: Does the Windows Core installer change my clock settings?

A: It can. The installer checks the Windows Time service, and if it isn't already using the pool.ntp.org time servers it can set it to use them and to start automatically, because Core needs an accurate clock. Later, Synchronize clock in Core's tray menu does the same.

Also asked as: windows installer time settings · qortal installer windows time · installer ntp windows qortal · qortal changes windows clock · w32time qortal installer

## Q: Where are the Qortal launchers after running the Linux script?

A: The script adds a Qortal submenu to your desktop's applications menu, with a Qortal Hub launcher and a Qortal Core launcher, and puts a Qortal Hub shortcut on your Desktop. The Core launcher starts Core from ~/qortal. If the launchers show up under Internet instead, log out and back in.

Also asked as: qortal menu linux launchers · qortal core launcher linux · qortal hub desktop shortcut linux · where is qortal in my linux menu · qortal submenu applications

## Q: When does crowetic's auto-fix bootstrap my node?

A: In the current version, when your node is more than 2,500 blocks behind the public API node after a fresh check, or when its height hasn't moved since the last run and stays stuck through two more checks five minutes apart. Before bootstrapping it stops Core, copies and checks the db folder and keeps the original aside; if Core then fails to start, it puts the original database back. Older copies of the script used 1,500 blocks.

Also asked as: auto-fix bootstrap rules · when auto fix bootstraps · auto-fix blocks behind 2500 · auto fix height stalled · will auto-fix delete my db

## Q: How do I run crowetic's auto-fix without it updating itself?

A: Start it as AUTO_FIX_SELF_UPDATE=0 bash ~/auto-fix-qortal.sh. That keeps the installed script version, but everything else still runs: it can still update Core, merge settings, change schedules, restart Core or bootstrap. There is no dry-run mode, so only run it when you want real maintenance.

Also asked as: auto-fix no self update · AUTO_FIX_SELF_UPDATE · keep my auto-fix version · auto fix dry run · run auto-fix once safely

## Q: Is it safe to forward the Qortal peer ports on my router?

A: Yes, they are meant for that: 12392 and 12394 only talk Qortal's peer protocol, and every connection goes through a handshake before it is used. Forward only those two. Never forward the API port 12391, and don't put the node in the router's DMZ, which opens everything.

Also asked as: safe to forward 12392 · open port 12394 safe · qortal port forwarding security · risk of forwarding qortal ports · peer ports open router

## Q: Does a node behind CGNAT or a mobile connection still work?

A: Yes. Core makes its own outbound connections to peers, so it syncs and can mint without anyone connecting in. It just gets no inbound peers. For QDN, Core 6 can relay data through better-connected nodes for nodes that others can't reach directly.

Also asked as: qortal node cgnat · node behind carrier nat · qortal core no public ip · can't port forward qortal node · node on mobile internet

## Q: What is my node's ID?

A: Since Core 6, each node has its own identity, an Ed25519 key pair it makes for itself, and other nodes use its node ID to tell nodes apart even when an IP address or port changes. You can see it as nodeId in admin/info (./qort admin/info in the qortal folder). It is not linked to your account.

Also asked as: qortal node id · nodeId admin info · core node identity · nodeid field meaning · find my node id

## Q: How do I list my node's minting accounts from the terminal?

A: In the qortal folder run ./qort -p admin/mintingaccounts. For safety Core only shows public keys: each entry has the minting account and the recipient account it mints for. Hub's Minting panel shows the same list as Node minting accounts.

Also asked as: list minting accounts terminal · admin/mintingaccounts terminal list · check minting key on node terminal · qort minting accounts · which accounts mint on my node

## Q: What does Rebuilding all names... mean in the Core log?

A: It is a normal startup step. Each time a full node starts, Core rebuilds its table of registered names from the chain before it validates the blockchain and opens the API. Let it finish.

Also asked as: rebuilding all names log · core rebuilding names startup · qortal log rebuilding names · names rebuild at start

## Q: Hub says error downloading Java. What can I do?

A: Hub could not fetch its Java copy, which it gets from Qortal's own download servers. Check your internet connection and any firewall or proxy, then try Download Core again. Or install Java 11 or newer yourself, such as an OpenJDK package; Hub then finds and uses the system Java.

Also asked as: error downloading java hub · hub setting up java failed · error unzipping java · hub cannot install java · java download failed qortal

## Q: Why does Hub ask me to reload after adding a custom node?

A: Hub needs a fresh start of its window to switch everything over to the new node, so it shows Reload required: You've added a new node, an app refresh is required. Click Reload app.

Also asked as: hub reload after new node · reload required hub custom node · app refresh required new node · hub reload app button node

## Q: How do I edit or remove a custom node in Hub?

A: Open Connection Mode and look under Custom Nodes. Each saved node has a pencil button to edit its name, URL or API key, and a bin button to remove it. If you remove the node Hub is using right now, Hub switches back to your Local Node.

Also asked as: edit custom node hub · delete custom node hub · remove saved node hub · change custom node api key hub · hub custom nodes list

## Q: How do I check whether my node is on the testnet?

A: Run ./qort admin/info in the qortal folder, or open localhost:12391/admin/info on the node: isTestNet is true on the testnet and false on the main network. A testnet node also answers on port 62391 instead of 12391.

Also asked as: is my node on testnet · testnet or mainnet node · isTestNet admin info · check qortal network type · core mainnet testnet check

## Q: How do I see how much memory Qortal Core is using?

A: Run ./qort -p admin/systeminfo in the qortal folder. It shows Java's free, used, total and maximum memory in bytes, and the number of processors Core can use. The maximum is the limit set by the Java memory option, such as start.sh's 50% of RAM.

Also asked as: core memory usage · qortal ram used · admin systeminfo · how much ram does my node use now · java memory qortal node

## Q: What is crowetic's rebuilt-machine.sh script?

A: It is for a fresh Ubuntu or Ubuntu-based system. It upgrades the system, installs Core and Hub with the automation, and on a desktop also installs and configures the Cinnamon desktop, themes and launchers. It saves your previous settings in ~/backups first and reboots 30 seconds after finishing unless you start it with REBUILT_MACHINE_REBOOT=0. On a server it skips the desktop parts.

Also asked as: rebuilt-machine.sh · crowetic rebuild script · qortal fresh ubuntu setup script · rebuilt machine qortal · cinnamon qortal setup script

## Q: What is the balance recorder in Core's settings?

A: It is an optional part of Core, switched on by balanceRecorderEnabled, that records changes in account balances every 20 minutes. By default it keeps only the recordings that cover reward distributions (rewardRecordingOnly) and holds them in memory. The settings.json that comes in the Linux and macOS zip turns it on.

Also asked as: balanceRecorderEnabled · core balance recorder · qortal balance recording setting · rewardRecordingOnly

## Q: Can I put Qortal Core somewhere other than ~/qortal?

A: Yes, Core runs from whatever folder you unzip it into, since it uses its own folder for its files by default. Hub needs to be told: set Core location in Set up Qortal Core. Some helpers assume ~/qortal, though: crowetic's auto-fix maintains Core only in ~/qortal, and nodes with custom database paths need manual recovery.

Also asked as: install core in another folder · qortal core custom directory linux · move qortal folder · core not in home qortal · different path for qortal core

## Q: What does crowetic's auto-fix put into my settings.json?

A: It merges in crowetic's recommended settings file. That raises the peer limits well above Core's defaults (maxPeers and minOutboundPeers), enlarges network and database thread pools and the block cache, sets its own thread priorities, turns on the API documentation, and turns off the API whitelist and apiRestricted. With the whitelist off, other devices on your network can reach the API, so keep port 12391 closed on your router.

Also asked as: auto-fix settings changes · crowetic recommended settings · qortector settings.json values · auto fix maxPeers 108 · what settings does auto-fix add

## Q: Does crowetic's auto-fix work on macOS or Windows?

A: No, it is for Linux. It needs Linux's /proc, Bash, curl, flock, timeout, jq and unzip (or Java's jar tool), and it looks after Core in ~/qortal as the user who runs Core. On Windows and macOS, Core keeps itself updated through its auto-update, and you start it yourself.

Also asked as: auto-fix on mac · auto-fix on windows · qortal automation macos · auto fix requirements · is auto-fix linux only

## Q: What does Hub show while it installs and starts Core?

A: Set up Qortal Core shows two steps with progress bars: Download Core (Downloading Core, then Downloaded Core) and Start Core (Starting Core, then Core running). Under them Hub says what is happening, such as Downloading and preparing Qortal Core, or Core is running and syncing blockchain data. If something goes wrong, the step shows an error with a short message.

Also asked as: hub core setup progress · downloading core progress hub · hub starting core steps · set up qortal core steps · core running step hub

## Q: Why do I see two Qortal Java processes for a moment?

A: During an auto-update or a bootstrap restart, Core starts a small helper Java program (ApplyUpdate or ApplyBootstrap). The helper asks the old Core to stop, swaps in the new qortal.jar or clears the database, starts Core again and then exits. Leave both alone until the restart is done; if the helper is stopped halfway, start Core yourself afterwards.

Also asked as: two java processes qortal · applyupdate process · second qortal process during an update · extra java process core restart

## Q: Can I make Core write its qortal-backup files right now?

A: Yes. In the qortal folder run ./qort admin/repository/data; the helper sends your API key, and Core exports its node-local data, such as minting accounts and trade-bot states, to the JSON files in qortal-backup. Core also does this by itself whenever it shuts down cleanly, so you rarely need to.

Also asked as: export minting accounts now · admin repository data export · write qortal-backup manually · export trade bot states · refresh qortal-backup files

## Q: What does the admin/repository/reindex call do?

A: It rebuilds all transactions and balances from the archived blocks. Core's own description warns that it takes around a week, that the node won't work normally meanwhile, and that a failed run can leave the database inconsistent, needing another reindex or a bootstrap. For a node with database trouble, a bootstrap is the usual and much faster fix.

Also asked as: repository reindex qortal · reindex core database · admin reindex warning · rebuild balances from archive · qortal reindex one week

## Q: Can I read Qortal Core's log through the API?

A: Yes: admin/logs returns lines from Core's log, up to 500 at a time. For the latest lines, run ./qort 'admin/logs?tail=true&limit=50' in the qortal folder; keep the quotes, or the shell misreads the ? and &. On the node itself, tail -f qortal.log does the same live.

Also asked as: core logs api · admin logs tail · read qortal log remotely · qortal log endpoint · last log lines api

## Q: How do I run Qortal Core in the foreground to watch it?

A: In the qortal folder run java -jar qortal.jar; the Core README describes this as the basic way to run it, from the folder that holds settings.json. Core then runs in that terminal instead of the background, which helps you see startup problems, but without start.sh's memory options and nice setting. Stop it with ./stop.sh from another terminal.

Also asked as: run core in foreground · java -jar qortal.jar · start core without start.sh · see core errors in terminal · run qortal core directly
