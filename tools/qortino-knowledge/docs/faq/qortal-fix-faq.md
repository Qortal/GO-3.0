# qortal-fix — golden FAQ

Curated offline Q&A for Qortino (140 entries). Prefer these answers when relevant.

## Q: My Qortal node won't sync. What should I check?

A: Most sync problems come from too few peers, a wrong clock, a firewall, or a computer that sleeps.
1. Keep Qortal Core running and stop the computer from sleeping.
2. Check that the system clock is right and set to update automatically.
3. Allow TCP 12392 (blockchain peers) and 12394 (QDN data) in your firewall, and turn on UPnP or port forwarding in the router.
4. Make sure Core is up to date.
5. If the node is more than about 1,500 blocks behind, bootstrap it instead of waiting.

Also asked as: node won't sync · qortal core not syncing · node not synchronizing · my node is not syncing · core sync problem · qortal sync not working

## Q: My first Qortal sync has been running for hours. Is something wrong?

A: Usually not: the first sync gets the whole chain, which can take hours depending on your connection and hardware. Core starts from a bootstrap (a compressed copy of the chain), then syncs the blocks made since that copy, which is rebuilt every 12 hours. Keep the device awake and online until it finishes; it only happens once. The tray icon turns from red to blue when the node is synced.

Also asked as: first sync taking hours · initial sync very slow qortal · first time sync qortal core · how long first qortal sync · new node still syncing

## Q: My node is far behind the network. Should I bootstrap it?

A: If it is more than about 1,500 blocks behind, a bootstrap is usually faster than syncing block by block.
In Hub: open Set up Qortal Core (the Core controls gear on the sign-in screen), then Advanced, then Bootstrap chain.
By hand: stop Core, delete the db folder, and start Core again; it downloads a fresh bootstrap.
Your wallet is stored separately and is not touched. Afterwards the node still syncs the last few hours of blocks.

Also asked as: node far behind · node thousands of blocks behind · should i bootstrap · bootstrap or wait sync · node behind blocks qortal · catch up node faster

## Q: My node is stuck at the same block height. What do I do?

A: A height that stops moving for several minutes means the node has stalled, often after a network problem or a fork (a side branch of the chain).
1. Blocks come about once a minute, so wait a few minutes first.
2. Restart Core.
3. Compare your height with a block explorer such as exqlorer.com.
4. If it is still stuck or far off, bootstrap the node.
The QORTector auto-fix script works the same way: if the height has not moved since its last run and still does not move over about 3 more minutes, it forces a bootstrap.

Also asked as: node stuck at block height · block height not moving · qortal height frozen · node stopped syncing · stuck on same block · height not increasing node

## Q: My node's connections go up and then drop back to 0. Why?

A: This is usually a wrong system clock or a firewall. Other nodes refuse a node whose time is too far off, which is common on Windows.
1. Compare your computer's clock with an internet time source and turn on automatic time.
2. Allow TCP 12392 (and 12394 for QDN data) in your firewall. There is no need to turn the firewall off.
3. Restart Core.

Also asked as: connections drop to 0 · peers go to zero · node loses all peers · peer count keeps dropping · connections up then down qortal

## Q: Will bootstrapping or deleting the db folder lose my wallet or QORT?

A: No. The db folder only holds the node's copy of the blockchain, which Core downloads again. Your QORT is recorded on the blockchain itself, and Hub keeps wallet files separately, so they are left alone. Keep your backup file and seed phrase safe offline anyway.

Also asked as: bootstrap lose my wallet · delete db folder safe · will bootstrap delete my qort · deleting db folder wallet · is bootstrap safe for my account

## Q: My minting isn't working. What should I check?

A: Go through these in order:
1. You need your own node: minting is not possible on a public node.
2. The node must be fully synced; while it syncs, Hub shows Synchronizing.
3. Your account must be in the MINTER group, which needs an approved nomination.
4. The account's minting key must be on this node (Start minting in Hub's minting panel); a node holds at most 2 keys.
5. Core must run all the time, so the computer must not sleep.
Level progress is credited in batches of about 1,000 blocks, so it moves in steps.

Also asked as: minting not working · my node is not minting · minting stopped · hub says not minting · why am i not minting

## Q: My GO voice call won't connect. What should I check?

A: 1. You and the other person must be DM friends, as on the Hub; otherwise the call is declined.
2. They must be online on the network: a contact shown as offline cannot be called.
3. Calls get ready about half a minute after GO connects, so wait a moment after opening GO.
4. Check the Reticulum badge: with Hubs 0 nothing can connect.
If it still fails, send Copy diagnostics, which has a Calls section.

Also asked as: go call wont connect · voice call not working go · calls not ready go · cant call someone go · call fails qortal go

## Q: GO says my saved account "does not match its key". What happened?

A: The saved copy of that account on this phone is damaged: its key belongs to a different address, so GO refuses to use it. Older builds kept going and chat then failed with "author mismatch". Remove the account from GO and add it again with your seed phrase or a fresh backup file made in Hub. Your account and QORT on the chain are fine.

Also asked as: account does not match its key · author mismatch chat · signed author mismatch · local signer is not a group member · wallet key mismatch go

## Q: GO can't connect to my private node. What should I check?

A: Usually the phone cannot reach the node, or the node does not allow the phone.
1. In the avatar menu, tap Node and check the URL: http or https, the address and the port (12391 by default).
2. Use an address the phone can reach: the computer's home network address on the same Wi-Fi, a VPN address such as Tailscale, or 127.0.0.1 for an SSH tunnel on the phone.
3. The settings shipped with Core accept other devices; if the whitelist was turned on, add the phone's address range to "apiWhitelist" in the node's settings.json and restart Core.
4. Enter the node's API key from apikey.txt.

Also asked as: go cant connect private node · private node not working go · go home node connection · custom node go fails · go node settings not connecting

## Q: Notifications don't come when my phone's screen is off. What should I check?

A: Usually Android or the phone maker is stopping GO in the background, or Background sync is set too low.
1. In the notification settings (avatar menu, Notifications, then the gear), set Background sync to While charging or Always. Always works on battery too but uses noticeably more battery.
2. Let GO run in the background: when GO asks to keep Qortal Go reachable, tap Allow in background, or set its battery use to Unrestricted in Android settings.
3. Don't swipe GO away from your recent apps.
4. If GO shows "GO was stopped in the background", follow the steps it gives for your phone's brand.

Also asked as: notifications dont come screen off · no notifications when phone locked · go notifications not arriving · messages only arrive when i open go · missed messages screen off go

## Q: Chat stops syncing about a minute after I leave GO. Why?

A: Android freezes GO's hidden page about a minute after you leave, and the chat engine runs in that page. With Background sync Off, chat then waits and catches up when you open GO again. Set Background sync to While charging (the default) or Always in the notification settings. On battery, GO still finishes sending your waiting messages for up to 3 minutes after you leave.

Also asked as: chat stops when i leave go · go stops syncing in background · messages stop after leaving app · background sync off go · chat only syncs when open

## Q: Chat messages are not arriving in GO. What should I check?

A: Start with the Reticulum status badge next to the Qortal logo at the top.
1. Offline, or Hubs 0: the phone is not on the mesh yet. Check its internet and give it a minute.
2. Chat engine not ready: wait while it says starting; if it says failed, restart GO.
3. Messages only arrive while GO is open: set Background sync to While charging or Always and allow GO in the background.
4. Still stuck: send Copy diagnostics with your report.

Also asked as: chat messages not arriving go · go chat not receiving messages · messages not coming in go · go chat not updating · new messages missing go chat

## Q: My messages from GO don't show up on my Hub or for others. Why?

A: Messages travel peer to peer: another node, such as your Hub or a member's node, has to fetch each one from your phone while the phone is reachable. Watch the small icon by your message: a clock means sending, a crossed-out cloud means no node has fetched it yet, and a double tick means a node got it. Keep GO open, or in the background with Background sync on, until it shows delivered.

Also asked as: go messages not on hub · others dont see my go messages · posts from phone not showing · hub not getting go messages · group post not reaching members

## Q: GO stays offline on Reticulum even though my internet works. What can I do?

A: The phone has no working link to the community Reticulum hubs yet; the badge then shows Hubs 0, where 2 is typical.
1. Give it a minute: after a switch between Wi-Fi and mobile data GO reconnects by itself.
2. If it stays at 0, close and reopen GO once.
3. Avoid restarting it over and over: a hub can briefly block an address that keeps reconnecting.
4. If nothing helps, send Copy diagnostics with your report.

Also asked as: go wont connect to hubs · hubs stays at 0 · go not on the mesh · reticulum offline but internet works · go reticulum not connecting

## Q: A group shows no messages or its channels never load. What can I do?

A: The chat engine may still be fetching history, or the node cannot confirm that you are a member.
1. Leave the group open for a minute; GO asks peers again by itself.
2. Check your node connection, since membership checks go to the node.
3. Update GO: v0.0.19 fixed channels that stopped loading after long use.
4. If it stays empty, send Copy diagnostics.

Also asked as: group empty go · channels never load · group chat blank go · no messages in group · group not loading go · unable to finish loading reticulum chat channels

## Q: Qortino says it can only be assembled from a private node. Why?

A: Older GO versions said that. Now the model also comes through the public node, but a private node is still highly recommended: the public node is shared, cuts long downloads and can drop what it fetched. On the public node GO downloads the model in three smaller parts and keeps trying by itself, and parts that already arrived are kept.

Also asked as: qortino private node required · qortino needs private node · cant assemble qortino public node · qortino assemble blocked

## Q: My node seems to be on a fork. How do I get back on the main chain?

A: If your height or blocks differ from the explorer and do not fix themselves, the node has followed a side branch the network left.
The simple fix is a bootstrap: Bootstrap chain in Hub, or stop Core, delete the db folder and start it again.
Advanced users can roll back instead with Core's orphan API call, a lower height in steps of 1,000 to 2,000 blocks, and let it sync forward. Keep Core running while it rolls back.

Also asked as: node on a fork · node on wrong chain · my height higher than explorer · forked node qortal · node different block than network · fix fork qortal core

## Q: My node has very few peers. How can I get more?

A: Few peers usually means other nodes cannot connect in to yours.
1. Turn on UPnP in your router; for a single node that is often enough.
2. Without UPnP, give the node a fixed local address and forward TCP 12392 and 12394 to it.
3. Check that your firewall allows those two ports.
Keep port 12391 closed to the internet: that is the node's API. Some providers filter ports, so forwarding can be needed even with UPnP.

Also asked as: node few peers · low peer count qortal · not enough peers · get more peers qortal node · node only 2 peers · no incoming connections node

## Q: Can a wrong clock on my computer break Qortal?

A: Yes. Nodes refuse peers whose time is too far off, and Core refuses transactions until its clock is in sync, with errors like "no clock synchronization yet" or "clock not synchronized". Turn on automatic date and time, check the time zone, and restart Core.

Also asked as: wrong clock qortal · system time wrong node · clock not synchronized · no clock synchronization yet · time sync qortal core

## Q: What does "blockchain needs to synchronize first" mean?

A: Your node is not synced yet, so it refuses actions that need an up-to-date chain. Wait until Core has caught up (the tray icon turns blue, or Hub shows it as synchronized) and try again. If it stays behind, treat it as a node that won't sync, or bootstrap it.

Also asked as: blockchain needs to synchronize first · needs to sync first error · node not synced error · blockchain needs sync qortal

## Q: Core says "Repository in use by another process". What should I do?

A: Another copy of Qortal Core is already running and holding the database. Stop that one first, from the tray icon (Exit) or with ./stop.sh in the qortal folder, wait until it has ended, then start Core once.

Also asked as: repository in use by another process · core already running error · two qortal cores running · database locked qortal core

## Q: Hub says "error: Unable to start repository". How do I fix it?

A: Core could not open its chain database.
1. Make sure only one Core is running, then start it again.
2. If it keeps failing, use Bootstrap chain in Hub (Set up Qortal Core, Advanced). It bootstraps, or clears the local chain database and starts Core again.
Your wallet files are stored separately and are left alone.

Also asked as: unable to start repository · hub core repository error · core database won't open · error running qortal core repository

## Q: My bootstrap finished but the node still isn't synced. Is that normal?

A: Yes. A bootstrap is a snapshot rebuilt every 12 hours, so after it is applied the node still syncs the blocks made since then. Leave Core running; the tray icon turns from red to blue when it has caught up.

Also asked as: bootstrap done still not synced · after bootstrap still syncing · bootstrap finished node behind · still red after bootstrap

## Q: My bootstrap keeps failing or takes forever. What can I do?

A: The bootstrap servers fail now and then, and Core retries by itself; slow connections can also struggle. A bootstrap usually takes 15 to 60 minutes.
1. Leave it running and check that the disk has free space.
2. If it never completes, bootstrap by hand: download a bootstrap archive listed on the Qortal wiki's bootstrap page, extract it, and put the blockchain files into the db folder inside the qortal folder.

Also asked as: bootstrap failing · bootstrap stuck · bootstrap takes forever · bootstrap download fails qortal · bootstrap never finishes

## Q: Hub shows "Core not detected". What should I do?

A: Hub cannot find a Qortal Core running on this computer. Open Set up Qortal Core to download and start Core (it then syncs in the background), and use a public node meanwhile. If Core is installed in an unusual place, set its folder under Core location.

Also asked as: core not detected · hub cant find core · local node not found hub · hub no local core · please turn on your local node

## Q: Hub says "Core setup needs attention". What does that mean?

A: A step of the Core download, Java setup or start-up stopped. Tap Open setup to see which step failed, for example "error downloading Java" or "error unzipping Qortal Core". Check your internet connection and free disk space, then try that step again.

Also asked as: core setup needs attention · hub core setup error · error downloading java · error unzipping qortal core · unable to download or install the core

## Q: My manually installed Core won't start on Mac or Linux. Could it be Java?

A: That is a common cause: Qortal Core needs Java 11 or newer. Install a current Java (OpenJDK 11 or later), then run ./start.sh in the qortal folder again. Hub's own Core setup installs Java for you, so this mostly affects manual installs.

Also asked as: core wont start java · qortal needs java · java missing qortal core · start.sh fails java · which java for qortal

## Q: Windows SmartScreen blocks the Qortal installer. Is it safe to continue?

A: SmartScreen warns about software that Microsoft does not see often yet, which is normal for open-source apps, and Qortal's installer is code-signed. If you downloaded it from qortal.dev or qortal.org, click "More info" and then "Run anyway".

Also asked as: smartscreen blocks qortal · windows protected your pc qortal · smartscreen warning hub installer · run anyway qortal windows

## Q: macOS says Qortal can't be opened because it is from an unidentified developer. What do I do?

A: That is Gatekeeper being careful on first launch. In Finder, right-click the Qortal app, choose Open and confirm. Or open System Settings, Privacy & Security, and click "Open Anyway" next to Qortal. Only do this for a copy you downloaded from qortal.dev or qortal.org.

Also asked as: mac cant open qortal · gatekeeper blocks qortal · unidentified developer qortal hub · macos blocks qortal hub

## Q: My antivirus flags Qortal as suspicious. Is it a virus?

A: Usually it is a false positive: node software talks to many peers and writes a lot of blockchain data, which some scanners dislike. If you got Qortal from qortal.dev, qortal.org or the official Qortal GitHub, add the Qortal folder to your antivirus exclusions. Never use builds from unofficial sources.

Also asked as: antivirus flags qortal · qortal virus warning · antivirus blocks qortal core · false positive qortal hub

## Q: Hub says my local node's API key is invalid. How do I fix it?

A: Hub's saved key no longer matches your local Core's key file, for example after a reinstall. Use reset apikey in that dialog: Hub deletes apikey.txt and makes a new key. Any other device that uses this node, such as GO, then needs the new key in its node settings.

Also asked as: hub invalid apikey · your apikey is invalid hub · reset apikey hub · local node api key wrong · hub api key not working

## Q: A Q-App loading page says "Waiting for data from peers...". What can I do?

A: Your node knows the app or file exists but has not yet found a node that holds all of its pieces. Keep the page open for a while; when peers have it, the page shows how many are available and the download moves on. If nothing changes, the nodes that hold it may be offline: try again later. Apps and files you open on your own node stay there for next time.

Also asked as: waiting for data from peers · q-app waiting for peers · missing data unable to locate all files · loading page waiting peers · no peers have the data

## Q: A loading page says "This resource has not been published to the network". Why?

A: Your node found no publish at that name, service and identifier. Check the link: the name and identifier must match exactly (identifiers are case-sensitive), and the type must be right, such as APP or WEBSITE. It can also mean the publish has not been confirmed on the chain yet, so try again in a few minutes.

Also asked as: resource has not been published · not published to the network · qortal link not found · resource not found qortal · no q-app resource found for this link

## Q: I edited settings.json and now Core won't start. What did I break?

A: Usually the JSON format. The file needs a curly brace at the start and end, straight double quotes around each setting name and text value, a colon after each name, and a comma between settings but not after the last one. Numbers and true/false need no quotes. Fix the file, or take out the setting you added, and start Core again. Changes only apply when Core starts.

Also asked as: settings.json broke core · core wont start after editing settings · settings.json syntax · json error qortal settings

## Q: What should I send when I ask for help with my node?

A: The node's status and the end of its log help most. On Linux and macOS, in a terminal in the qortal folder:
1. ./qort admin/status shows whether the node is syncing and its height.
2. tail -f qortal.log shows the live log (older installs wrote log.txt files).
Say which Core version you run and what you already tried. Never send your seed phrase, backup file or API key.

Also asked as: help with my node what to send · node status command · qortal log for support · check node status terminal · qortal.log tail

## Q: My node didn't auto-update and is on an old Core version. How do I update it?

A: Core updates itself once the developer group approves a release, unless "autoUpdateEnabled": false is set in settings.json, so check that first. An update takes about 2 hours to reach the whole network.
To update by hand on Linux or macOS: stop Core with ./stop.sh, delete qortal.jar, download the latest qortal.jar from the official Qortal releases, and run ./start.sh.
On Windows, run the newest installer from qortal.dev and keep the blockchain data.

Also asked as: core not auto updating · node on old version · qortal core outdated · update qortal.jar manually · autoupdateenabled

## Q: My transaction was refused. What do the usual reasons mean?

A: Core says why in the error. The common ones:
1. Insufficient balance: you need enough QORT for the amount plus the fee.
2. Clock not synchronized, or timestamp too old or too new: fix the device's clock.
3. Too many unconfirmed transactions pending: wait a few minutes for earlier ones to confirm.
4. Node's blockchain currently busy: try again in a moment.

Also asked as: transaction refused · transaction invalid qortal · insufficient balance transaction · too many unconfirmed transactions · timestamp too old qortal

## Q: I added a custom node in Hub but nothing changed. Why?

A: Hub only switches after a reload, so it shows "Reload required" when you add a node. Tap Reload app. Then check the sign-in screen: it should say "Using" with your node's name. If it still shows the old node, open Connection Mode, select the custom node and save.

Also asked as: added node nothing changed hub · reload required hub · hub still using old node · custom node not used hub · hub new node refresh

## Q: Hub says "url invalid: incorrect url or node not running". What should I check?

A: Hub could not reach a node at that address.
1. Check the whole address, including http or https and the port, for example 127.0.0.1 with port 12391 for a node on the same computer.
2. Make sure that node's Core is running.
3. For a node on another computer: the settings shipped with Core already accept other devices; if the whitelist was turned on, add your device's address to "apiWhitelist" in that node's settings.json (or use an SSH tunnel) and restart Core. Then enter the node's API key.

Also asked as: url invalid hub · incorrect url or node not running · hub cant reach custom node · custom node url wrong · remote node not connecting hub

## Q: Hub's Bootstrap chain says it could not bootstrap, clear chain data, or start Core. What now?

A: Hub's own tool did not get through, so do it by hand.
1. Stop Core: Exit from the tray icon, or ./stop.sh in the qortal folder, and wait until it has ended.
2. Delete the db folder: in the qortal folder in your home folder on Linux and macOS, or in AppData, Local, Qortal on Windows.
3. Start Core again; it downloads a fresh bootstrap.
Wallet files are not in the db folder.

Also asked as: could not bootstrap clear chain data or start core · bootstrap chain failed hub · hub bootstrap error · unable to bootstrap hub

## Q: Hub says "Qortal Hub is locked". How do I get back in?

A: The app locked itself after being idle, or someone chose Lock now. You are still signed in: enter your Qortal account password to unlock (GO can also use your fingerprint). Chats and calls stay connected while it is locked. After a wrong password you may have to wait a few seconds before the next try. Auto-Lock When Idle in the settings sets how long it waits.

Also asked as: qortal hub is locked · hub locked screen · unlock hub password · hub asks password again · app locked after idle

## Q: Qortal Hub says blocking users is unavailable on a public node. Why?

A: Blocking is done by the node you use, so on a public node its operator decides who is blocked, not you. Switch Hub to your own node (local Core or a custom node) and you can block names and addresses in the settings' Blocked tab. In Torq you can also hide people, but that only hides them inside Torq.

Also asked as: hub blocking unavailable public node · cant block user in hub · hub block button greyed out · block list hub public node

## Q: Qortal Hub won't start on Linux from the AppImage. What do I do?

A: The AppImage must be allowed to run as a program first. Right-click the file, open Properties, Permissions, and tick "Allow executing file as program". Or in a terminal in that folder run chmod +x on the file, then start it with ./ and its name.

Also asked as: appimage wont start · hub linux not opening · qortal hub appimage permission · make appimage executable · linux hub double click nothing

## Q: My password doesn't work after I imported a backup file. Why?

A: A backup file can be saved with a new password: the backup window offers "new password for this backup" or keeping the current one. Try the password you chose when that file was made. If you have your seed phrase, you can also import the account with it and set a new password.

Also asked as: password not working after import · backup file password wrong · imported account wrong password · which password for backup file

## Q: GO says "That password is not correct" and makes me wait. What can I do?

A: Each saved account has its own wallet password, and after wrong tries GO makes you wait a few seconds. Check the keyboard language and caps, and that you picked the right account. If you have forgotten it, restore the account with your seed phrase and set a new password. Nobody can reset it for you.

Also asked as: password not correct go · wrong password wait seconds · go lock screen password wrong · please wait seconds and try again

## Q: GO says the saved account looks incomplete or damaged. What do I do?

A: The copy of that account stored on this phone is missing part of its locked wallet data. Choose another account, or remove this one and restore it from your backup file or seed phrase. Restoring makes a fresh copy; your QORT and names are on the chain and are not affected.

Also asked as: saved account incomplete or damaged · missing its encrypted seed · invalid wallet security data · account could not be found go

## Q: Importing my backup file into GO fails. Why?

A: GO says "This backup file does not contain a valid account" when the file is not a Qortal wallet backup or is incomplete. Pick the .json backup file made with Backup wallet or Download account, not a copy of the seed phrase or another file. If the file cannot be read, copy it to the phone's own storage and try again, or import with your seed phrase.

Also asked as: backup file not valid · does not contain a valid account · import backup fails go · file reading has failed · cant import json backup

## Q: GO can't import my seed phrase. What could be wrong?

A: GO does not check the words against a list: a phrase with a typo still imports, but as a different, empty account, and "Unable to import this seedphrase" only shows if building the account fails. If the imported account has the wrong address or no funds, remove it and import again, checking each word's spelling and the order. Type it yourself on your own phone; never paste it into a chat or a website.

Also asked as: cant import seed phrase · unable to import this seedphrase · seed phrase not accepted · restore with seed phrase fails go · seed phrase imports wrong account · imported seed phrase empty account

## Q: My call was declined because they don't have me as a friend. What do I do?

A: Calls only work between DM friends, in both directions. Open the DM, tap Add friend, and ask the other person to add you back. GO tells you when calling is available: "Calls unlock when they add you back".

Also asked as: does not have you as a friend · add friend before calling · call declined friend · calls unlock when they add you back

## Q: GO takes 30 seconds or more to log in. How do I make it faster?

A: Update GO. Builds before v0.0.14 were debug builds, which run very slowly on some phones, GrapheneOS above all, and the fingerprint path did the slow step twice. Release builds since v0.0.14 unlock in about a second on most phones. If it is still slow, send the Unlock section from Copy diagnostics with your report.

Also asked as: go login slow · unlock takes long go · slow login grapheneos · go 30 seconds to unlock · fingerprint unlock slow

## Q: A Q-App opens but stays blank. What can I do?

A: Often the node has not finished getting the app's files, or the app itself is broken.
1. Wait a moment, then use Refresh in the address bar.
2. Close the tab and open the app again.
3. Try later, or on your own node: the public node drops apps within hours.
4. If it is blank everywhere, tell the app's publisher; a faulty build, such as index.html not at the top of the zip, looks exactly like this.

Also asked as: q-app blank screen · q-app opens empty · app shows nothing go · white screen q-app · q-app not loading content

## Q: A private Q-App won't open. What can I check?

A: The node has to fetch the app's encrypted files and the group's key, and a public node often cannot.
1. Check that you are a member of the group the app is shared with.
2. "couldn't download this private app" or "couldn't download the group's key" means the node could not get the data: try again later, or use your own node.
3. Update GO if it shows "Failed to execute 'atob'": since v0.0.17 GO builds private apps on the phone, so they open on the public node too.

Also asked as: couldn't download this private app · failed to execute atob · private app error go · private app group key error · private q-app blank or error

## Q: An approval window says "Unknown Q-App". Should I accept it?

A: Not unless you just asked for exactly that yourself. GO shows Unknown Q-App when it cannot tell which app sent the request. Decline it, then repeat the action from the app you trust.

Also asked as: unknown q-app request · approval from unknown app · who sent this request · unknown app approval go

## Q: A video in GO stalls at a low percentage. What can I do?

A: Your node needs the whole video before it plays, and it gets the pieces from other nodes; a very low percentage often means only the first small piece has arrived. Keep it open a while. The public node drops files within hours and has to fetch them again, so long videos are slow there; your own node keeps them. If it never moves, no node holding the rest is online right now.

Also asked as: video stuck percent · video stuck at 0.6 · q-tube video not loading go · video download stalls · 0 pending peers video

## Q: A big download from a Q-App shows no progress for minutes. Is it stuck?

A: Probably not. First your node gathers the file from other nodes (GO's card at the top says "Gathering from QDN" with a percentage), then the app reads it and GO saves it, which on mobile data can take minutes. Hide keeps it going in the notifications, and the bell shows the file when it is ready.

Also asked as: download no progress · q-share download nothing happening · download stuck gathering · big file download slow go · download card stuck

## Q: Where does GO put files that Q-Apps save?

A: In the phone's Documents folder, under Qortal Go; the "Saved to" message names the exact folder. Tap that message to open the file with another app or share it. App packages (APKs) are saved there too, but GO never opens or installs them.

Also asked as: where are saved files go · go saved file location · saved to documents qortal go · find file q-app saved

## Q: GO's top bar and bottom buttons disappeared. How do I get them back?

A: That is Immersive mode. In Auto, scroll up a little or go back to the top and the bars return; in Manual, tap the small floating button, which brings them back for a few seconds. To keep them always, set Immersive mode to Off in Home settings, System. A swipe down from the top shows the phone's status bar for a moment.

Also asked as: bars disappeared go · top bar gone · bottom buttons hidden · immersive mode off · status bar hidden go

## Q: I can't hear anything in a GO call, or the sound comes from the wrong place. What do I do?

A: Open the audio route sheet in the call ("Play call audio on") and pick Phone, Speaker, Bluetooth or Headset. One-to-one calls start on the earpiece, so hold the phone to your ear, or choose Speaker; group calls use the speaker. Also check that neither side is muted. If the call ends at once, the other person's microphone may be unavailable.

Also asked as: no sound in call go · call audio wrong speaker · cant hear caller go · call audio earpiece speaker · other person cant hear me go

## Q: How do I send a useful problem report from GO?

A: Tap the Reticulum status badge next to the Qortal logo at the top, then Copy diagnostics, or Save as .md file to attach a file. Send it with a short note on what went wrong and when. Addresses, names, IDs and IP addresses in it are replaced with stand-in names.

Also asked as: copy diagnostics go · send bug report go · save diagnostics md file · go problem report · diagnostics reticulum badge

## Q: GO's notification says "Chat paused". What does that mean?

A: GO's chat engine is frozen in the background, so nothing syncs until you open the app. Open GO and it reconnects and catches up. To keep chat going in the background, set Background sync to While charging or Always and allow GO to run in the background.

Also asked as: chat paused open go to sync · go notification chat paused · status notification paused · go chat paused message

## Q: GO says it paused its background connection after 6 hours on battery. Why?

A: On Android 15 and newer, after 6 hours in a row off screen and unplugged, GO pauses its background connection itself to save power (in the While charging and Off modes). Open GO to reconnect; plugging in or opening GO resets the count. Background sync set to Always never takes this pause.

Also asked as: paused after 6 hours on battery · go paused background connection · go paused overnight · 6 hour limit go background

## Q: A chat shows "error loading content: Invalid Data". What is it?

A: One message could not be drawn, usually because some of its data is damaged. GO tries again by itself and redraws it when its data changes. If the box stays, leave the chat and open it again, and update GO if you use v0.0.16 or older.

Also asked as: error loading content invalid data · invalid data box chat · message shows invalid data · broken message box go

## Q: GO asks me to "Keep Qortal Go reachable". What should I do?

A: GO is asking to be freed from Android's battery limits so calls and messages arrive reliably. Tap Allow in background and confirm Android's dialog, or Open settings to set it yourself (unrestricted battery use, and "Pause app activity if unused" off). Not now asks again in 14 days; Never show this again stops the prompt.

Also asked as: keep qortal go reachable · allow in background prompt · go battery restrictions prompt · disable battery restrictions go

## Q: GO uses a lot of battery. What can I change?

A: Background sync set to Always keeps chat running whenever GO is in the background, which uses noticeably more battery. While charging (the default) only keeps it running on the charger, and Off lets chat pause about a minute after you leave and catch up when you return. Open Q-Apps are paused in the background either way.

Also asked as: go battery drain · go uses too much battery · background sync battery · reduce go battery use

## Q: Some older messages are missing in GO. Can I get them back?

A: Phones only serve each other the last 29 days of group history, so older pages come from Hubs. Scroll up in the chat and GO loads older pages from peers that have them. Messages also disappear when they expire: DMs expire after a month by default, and channels can set their own expiry.

Also asked as: old messages missing go · chat history missing · older messages not loading · messages before last month gone

## Q: My group only shows the General channel. Where are the others?

A: Channel lists come from snapshots signed by the group's admins, which your phone fetches from peers. Until one arrives you may see only the built-in channels, and GO asks again by itself. Some channels are only visible to certain members, and some groups simply have no others.

Also asked as: only general channel · channels missing group · group channels not showing · where are the other channels

## Q: Joining a group failed. Why?

A: Joining is a blockchain transaction, so it needs a small QORT fee and a working node connection. Core also refuses if you are banned from that group, already a member, or already have a join request waiting. For a closed group, your request waits until an admin accepts it.

Also asked as: unable to join this group · join group failed · cant join group qortal · failed to join the group

## Q: I joined a private group but it says I'm not part of the encrypted group. Why?

A: A private group's Threads (and its chat when Reticulum chat is off) are encrypted with a group key that admins publish, and each key only covers the members at the time it was made. Wait until an admin re-encrypts the key; after that it takes a few minutes to spread.

Also asked as: not part of the encrypted group · cant read private group · private group messages hidden · wait until admin re-encrypts

## Q: A private group says there is no group key yet. What now?

A: The group's first encryption key is still being created, or no admin has published one. Wait a few minutes; GO checks again every 2 minutes. If you are an admin and there is no key, publish one from the group's Admin keys panel.

Also asked as: no group key yet · group secret key missing · encryption key being created · no secret key published yet

## Q: As a group admin I'm told the member list changed and to re-encrypt the key. What do I do?

A: New members cannot read the private group until the key includes them. Open Admin keys from the group's menu and re-encrypt the group key; it costs a small amount of QORT. It takes a couple of minutes to spread, so refresh the group after about 5 minutes.

Also asked as: re-encrypt the secret key · member list changed re-encrypt · re-encrypt group key admin · new members cant read group

## Q: A group action says "awaiting confirmation". How long does that take?

A: Joining, leaving, creating a group and member changes are blockchain transactions, so they wait until a block includes them, usually a couple of minutes. Until then the old state can still show; member changes are marked Pending.

Also asked as: awaiting confirmation group · joined group awaiting confirmation · group change not showing · left group still showing

## Q: Qortino's download stopped or failed. What can I do?

A: The model comes from other nodes, and sometimes none is sending the rest, or too few host it.
1. Keep GO open and your node online, and try again later.
2. Parts that already arrived and passed the check are kept, so a retry only fetches what is missing.
3. If it says the model is not on QDN yet, your node cannot see it yet; try again a little later.

Also asked as: qortino download stalled · qortino download failed · no peer is sending the rest · qdn could not deliver the model · qortino assembling stuck

## Q: Qortino gave me a wrong answer. What should I do?

A: Qortino can be confidently wrong, so double-check anything important. Use the report button under the answer to flag it, which helps improve Qortino's answers.

Also asked as: qortino wrong answer · qortino made a mistake · report qortino answer · qortino incorrect

## Q: Why doesn't Qortino know today's prices or news?

A: Qortino works offline from what it knows and from a curated set of Qortal answers, so it has no live data such as prices, balances or news. For those, open the right Q-App, for example Q-Trade for prices or your wallet for balances.

Also asked as: qortino prices news · qortino live data · qortino offline knowledge · qortino not up to date

## Q: Q-Trade or Q-Wallets says "foreign blockchain or ElectrumX network issue". What does it mean?

A: Your Qortal node could not reach the servers it uses for that coin's network (ElectrumX servers for coins such as Litecoin). Usually it is a temporary network problem, not a problem with your coins. Wait a few minutes and try again.

Also asked as: foreign blockchain or electrumx network issue · electrumx error · litecoin network issue qortal · ltc balance error electrumx

## Q: Qortal Hub says "Reticulum chat is disabled". How do I turn it on?

A: Hub's Reticulum group chat setting is off. Turn on "Reticulum group chat" in the System tab of Hub's settings. Group chat in Hub 3.0 and GO runs over Reticulum.

Also asked as: reticulum chat is disabled · hub reticulum group chat off · turn on reticulum chat hub · hub chat disabled

## Q: I can't tap the last items of long lists in GO. Why?

A: Android's navigation buttons, or GO's round Home, Apps and Chat buttons, covered the bottom of some lists. Update GO: v0.0.18 makes the round buttons step aside for the channel list and in-chat search, and v0.0.19 ends GO's view above Android's 3 navigation buttons.

Also asked as: cant tap bottom of list · last channel not tappable · bottom items under buttons · 3 button navigation covers list

## Q: Why does Qortino's download stop near 1 GB on the public node?

A: The public node cuts long downloads near 1 GB and sometimes drops files it fetched, so a big download through it can stop part way. GO keeps what already arrived and carries on by itself, and on the public node it downloads the model in three parts under 1 GB. Your own node avoids all this and is highly recommended for Qortino.

Also asked as: qortino download stops at 1 gb · qortino download fails public node · qortino 0 peers public node · qortino download keeps restarting · qortino stuck saving to this phone

## Q: Hub says "Core maintenance tools are unavailable". Why?

A: Hub turns off Stop Core and Bootstrap chain while Core is still starting up, including while it downloads or applies a bootstrap, so they cannot interrupt it. Wait until Core is running; the tools under Advanced in Set up Qortal Core become available again.

Also asked as: core maintenance tools unavailable · bootstrap chain button greyed out · stop core button disabled hub · cant bootstrap in hub

## Q: Hub says the chosen folder "does not contain a qortal.jar". What now?

A: Hub's custom Core location must point to the folder that holds qortal.jar. On Linux and macOS that is usually the qortal folder in your home folder. In Set up Qortal Core, under Core location, use Change to pick the right folder, or Clear to go back to the default.

Also asked as: does not contain a qortal.jar · hub cant find qortal.jar · wrong core folder hub · custom core path error

## Q: I lowered my node's peer settings and now it won't sync or mint. Why?

A: Too few peers can stall syncing and minting. minBlockchainPeers is how many peers at a height your node needs before it syncs a block, and 1 never mints, because your own node does not count. About 10 is a safe value and 3 is about the lowest that works. For low data use, the wiki suggests maxPeers 7 with minBlockchainPeers 3.

Also asked as: minblockchainpeers too low · changed maxpeers now not syncing · peer settings broke node · minblockchainpeers 1

## Q: My node falls one or two blocks behind now and then. Is that a problem?

A: No. Nodes regularly trim old AT (smart contract) state, which takes about the time of a block or two, so many nodes are briefly a block or two behind. It only needs attention if the gap keeps growing.

Also asked as: node 2 blocks behind · node slightly behind sometimes · one block behind qortal · node lags a couple of blocks

## Q: My node stopped working for a few minutes after running for days. Why?

A: That is probably automatic database maintenance (trimming), which runs at a random time 3 to 14 days after Core starts. Core stops answering for about 3 to 10 minutes while it works, depending on the hardware. Let it finish. Restarting Core every day means maintenance never runs.

Also asked as: node pauses for maintenance · database trimming qortal · repository maintenance core · node unresponsive after days

## Q: What does the QORTector auto-fix script do?

A: It is crowetic's maintenance script for QORTector-style nodes. Each run it checks the internet, picks a start script for your amount of RAM, compares your Core version with the latest release and updates it if needed, and merges recommended values into settings.json. It also compares your block height with two public nodes; if your node is more than 2,500 blocks behind (older copies of the script used 1,500), or its height has not moved since the last run, it bootstraps. Let it finish once it starts.

Also asked as: auto-fix-qortal.sh · qortector auto fix script · what does auto fix do · crowetic auto fix script

## Q: What does refresh-qortal.sh do? Will it delete anything?

A: It is a full reset of the node software, not of your account. It force-stops every Java program on the machine, deletes the db folder, qortal.jar and old log files, downloads the latest qortal.jar and starts Core, which then bootstraps. settings.json and apikey.txt stay. Close any other Java programs first.

Also asked as: refresh-qortal.sh · refresh qortal script · what does refresh script delete · qortector refresh script

## Q: Core says "API call unauthorized". What does that mean?

A: That call needs the node's API key, and none or the wrong one was sent. Use the key from apikey.txt in the Core folder: Hub and GO send it from their node settings, and API tools send it as the X-API-KEY header. If the key was reset, update it everywhere you use this node.

Also asked as: api call unauthorized · api key invalid core · 403 qortal api · unauthorized qortal node api

## Q: I changed Hub's Reticulum settings but nothing happened. Why?

A: Reticulum reads its settings when it starts. After saving the Reticulum config or switching Community transport, restart Reticulum or Qortal Hub. Community transport also needs Managed Reticulum config turned on, and UPnP or a forwarded Reticulum port to help relay for others.

Also asked as: hub reticulum settings not applied · reticulum config saved restart · community transport not working · reticulum transport setting hub

## Q: Qortal Hub stopped showing desktop notifications. How do I get them back?

A: Desktop alerts are probably muted. In Hub's settings, check that "Reduce app notifications" and "disable all push notifications" are off. For one Q-App, open its notification settings and make sure Disable OS push is off. Also check that your computer's own notification settings allow Qortal Hub.

Also asked as: hub no desktop notifications · hub notifications stopped · reduce app notifications · disable push notifications hub · hub alerts not showing

## Q: GO says "the wallet signed as" another address. What should I do?

A: Signing came back from the wrong address or did not answer. Log out, then unlock the account again. If it keeps happening, remove the account from GO and add it again with your seed phrase or a fresh backup file.

Also asked as: the wallet signed as · signer returned no address · signer returned no response · log out and unlock the wallet again

## Q: A Qortal item says "Name is blocked so content cannot be served". Why?

A: The node you use has that publisher's name on its block list, so it will not serve their data. On your own node, open the settings' Blocked tab and unblock the name if it was a mistake. On a public node, its operator's list applies and you cannot change it.

Also asked as: name is blocked so content cannot be served · publisher is blocked · content blocked qdn · blocked name cant open

## Q: One Q-App keeps sending me approval windows. How do I stop them?

A: GO queues each request instead of replacing the open one, and shows how many more are waiting. Answer them one by one, or tap Decline all from this app if you did not expect them. Some apps ask once per item, such as each like or file.

Also asked as: too many approval windows · approval requests keep popping up · decline all from this app · stop approval spam q-app

## Q: A link in a Q-App won't open my dialer, the Play Store or another app. Why?

A: For safety, GO keeps Q-Apps inside the Qortal node: they cannot open other apps through intent:, market:, tel: and similar links. Copy the number or address and open it yourself.

Also asked as: q-app link wont open other app · tel link not working go · market link q-app · intent link blocked go

## Q: GO says a file was "Not saved". How do I keep it?

A: The file was downloaded but the save was declined or did not finish. Open Notifications from the avatar menu: the file waits there with a Save button for about 30 minutes. Tap Save to keep it.

Also asked as: file not saved go · not saved tap save to keep it · declined save file · save downloaded file later

## Q: GO says it needs storage permission to save files. Why?

A: On Android 8 and 9, saving into Documents needs the storage permission. Allow it when GO asks, or turn it on in Android Settings, Apps, GO, Permissions, then save again.

Also asked as: storage permission go · go needs storage permission · cant save files android 9 · save fails old android

## Q: GO says no app on this phone can open the file. What now?

A: Android found no installed app for that kind of file. Save it to the device and open it later with a suitable app, or share it to an app that can read it. Web pages are only shown as plain text inside GO, on purpose.

Also asked as: no app can open this file · file wont open go · open with fails · cant open downloaded file

## Q: A chat attachment says "this file could not be opened". Why?

A: It may still be downloading, or it is no longer on this phone, because received files are removed when you log out. Wait for the download to finish and try again; if it is gone, ask the sender to send it again.

Also asked as: this file could not be opened · it may still be downloading · file no longer stored on this device · chat attachment open error

## Q: Dev Mode says it couldn't open my zip as a Q-App. What's wrong?

A: Dev Mode needs a .zip with index.html at its top level, not inside a folder. Zip the contents of your build folder (such as dist) rather than the folder itself, keep it under 64 MB, and pick it again.

Also asked as: dev mode couldn't open zip · is index.html in it · dev mode zip error · zip too large dev mode · dev mode not a zip

## Q: I can't find the Dev Mode button in GO. Where is it?

A: Turn it on first: Home settings, System, Dev Mode. The Dev Mode button then shows next to New folder in the library's Pinned tab.

Also asked as: dev mode button missing · where is dev mode go · enable dev mode go · try q-app zip on phone

## Q: My GO widget is stuck on the loading page. What can I do?

A: A widget is a small Q-App, so the first time it needs the node to have its files, and the public node drops apps within hours. After the first load GO keeps the widget's files on the phone, so later it opens at once. Tap the widget and choose Reload, or remove it and add it again.

Also asked as: widget stuck loading · widget not loading go · widget shows loading page · widget loading forever · unable to load this widget

## Q: The widget list is empty when I tap the plus button. Why?

A: The list comes from QDN: apps tagged go-widget, or with an identifier starting with go-widget. If your node has not got that data yet, the list stays short or empty. Try again in a few minutes, or on your own node.

Also asked as: widget list empty · no widgets to add · plus shows no widgets · go widgets not found

## Q: My Home, Apps and Chat buttons are in the wrong order. How do I fix it?

A: Open Home settings, System, Bottom buttons: drag the round buttons into the order you want, or tap Reset. The sideways swipe between sections follows the same order.

Also asked as: bottom buttons wrong order · reset bottom buttons · home apps chat order · rearrange bottom buttons go

## Q: Swiping between Home, Apps and Chat doesn't work inside a Q-App. Why?

A: Swipes inside Q-Apps, websites, carousels and open chats belong to them. Swipe sideways on the round Home, Apps and Chat buttons or the strip at the bottom, or just tap a button.

Also asked as: swipe between sections not working · cant swipe out of q-app · swipe home apps chat · section swipe inside app

## Q: I pinned an app in the library but can't find it. Where did it go?

A: On phones the pin adds the app to a Library folder in Tabs. Open Tabs, by pulling down on Home or tapping the Tabs button, and look in the Library folder.

Also asked as: pinned app missing · library pin where · pin goes to tabs folder · cant find pinned app go

## Q: Avatars and app icons in GO look old or don't load. Why?

A: GO keeps avatars and icons on the phone so they show quickly, even on a slow node, and re-checks each one about once a day. A new avatar can therefore take up to a day to appear. A missing picture usually means the node could not fetch it yet.

Also asked as: avatar not updating · old profile picture showing · app icons not loading go · avatar cache go

## Q: Hub says it was unable to stop the Core. How do I stop it?

A: Stop it outside Hub: on Windows right-click the Qortal tray icon and choose Exit; on Linux and macOS run ./stop.sh in the qortal folder and wait for the message that Qortal ended. Give it a minute, since Core saves its data while it shuts down.

Also asked as: unable to stop the core · hub cant stop core · stop core failed · core wont stop

## Q: I swiped away a notification in GO's bell. Can I see it again?

A: Yes. Open Notifications from the avatar menu and tap Notification history: it keeps the last 30 days (up to 300 items), including ones you swiped away or cleared with Clear all. Tap an entry to open it.

Also asked as: swiped away notification · notification history go · clear all notifications back · find old notification

## Q: GO says "Android paused GO's background connection". What now?

A: Android itself stopped GO's background service, which it does to some apps after a time limit. Open GO and it reconnects. If it happens often, set GO's battery use to Unrestricted and keep Background sync on While charging or Always.

Also asked as: android paused go background connection · go paused notification · background connection stopped android · fgs timeout go

## Q: The badge says online but shows only 1 online. Am I connected?

A: Not necessarily: the online count includes your own account. Check Hubs in the badge; if it is 0, the phone is not on the mesh yet.

Also asked as: only 1 online · reticulum online 1 online · online but no hubs · badge online one account

## Q: Several old messages notify at once when I open GO. Why?

A: GO was frozen or offline, so the messages waited and arrived as GO caught up. GO still notifies you about DMs and mentions you have not read elsewhere, and several at once make only one sound. Background sync on While charging or Always makes this happen less.

Also asked as: many notifications at once · notifications burst when opening go · late messages notify · catch up notifications go

## Q: GO says "Composer failed to load. Close and reopen this chat." What do I do?

A: The message box did not start properly. Close the chat and open it again; if it keeps happening, restart GO.

Also asked as: composer failed to load · message box not loading · cant type in chat go · close and reopen this chat

## Q: My group invite link doesn't work. Why?

A: GO says "This doesn't look like a valid Qortal group invite link" when the pasted text is not a complete invite link. Ask for the link again (copy invite link in the group) and paste all of it. For a closed group, the link sends a request that an admin must accept.

Also asked as: invite link not working · not a valid qortal group invite link · group link invalid · invite link error go

## Q: I can't see someone's messages any more. Did I hide them?

A: Maybe: hidden people stay out of that group's chat until you unhide them, or until the time you picked (1 hour, 24 hours) runs out. Open their user card from the member list and choose unhide. They may also have left the group, or their messages expired.

Also asked as: cant see someones messages · user messages hidden · unhide user chat · hidden user group

## Q: My Hub keeps ringing after I answered the call on GO. Is that normal?

A: It can happen when the same account is signed in on both: the other device may keep ringing for a while after you answer. Just ignore it there; the call you answered carries on. Calls between two GO phones are still being improved.

Also asked as: hub still ringing after answer · both devices ring call · call rings on hub and go · other device keeps ringing

## Q: Qortino says a downloaded part was damaged. What now?

A: Each part is checked after download, and one did not match, so GO deleted it. Tap Assemble Qortino again: it fetches that part again and keeps the parts that were fine.

Also asked as: qortino part damaged · qortino checksum error · downloaded part was damaged · qortino sha256 failed

## Q: Qortino says saving the model to this phone failed. What should I check?

A: Check the free space on the phone and your node connection, then try again. Parts already saved and checked are kept.

Also asked as: saving the model failed · qortino save failed · qortino download error phone · qortino could not save

## Q: Qortino says the model files are missing. What happened?

A: The model's files are no longer where GO saved them, for example after a storage cleanup. Close Qortino and assemble it again.

Also asked as: qortino model files missing · qortino assemble again · qortino files deleted · model missing qortino

## Q: Qortino says no reply came back. What should I do?

A: Try a shorter question, or close Qortino and open it again. If it says it could not start at all, close and reopen it once more, and assemble it again if it reports missing files.

Also asked as: qortino no reply came back · qortino not answering · qortino empty reply · qortino could not write a reply

## Q: Qortino stopped in the middle of an answer. How do I get the rest?

A: If the answer was cut short, tap "Continue answer" under it and Qortino carries on. If you pressed Stop, ask the question again.

Also asked as: qortino stopped mid answer · qortino answer cut off · continue answer qortino · qortino incomplete reply

## Q: Can I stop Qortino assembling and finish it later?

A: Yes. Tap Cancel; GO says assembling was cancelled. Parts that already finished and passed the check stay on the phone, so the next Assemble picks up from there.

Also asked as: cancel qortino assembling · pause qortino download · assembling was cancelled · resume qortino download

## Q: My QORTector shows no Qortal tray icon. Is Core running?

A: Probably yes. A QORTector's auto-start script starts Core at power-on without the tray icon; the icon only shows if you stop Core and start it again yourself. To check, open a terminal and run cd qortal, then ./qort admin/status.

Also asked as: qortector no tray icon · no qortal icon qortector · is core running qortector · tray icon missing pi

## Q: A trade says it is "too soon to broadcast foreign blockchain transaction". What now?

A: Part of a cross-chain trade can only be sent after a set time on the other coin's chain (its lock time). Nothing is wrong; leave your node running and the trade continues once that time has passed.

Also asked as: too soon to broadcast foreign blockchain transaction · locktime trade error · trade too soon error · foreign transaction too soon

## Q: Core says "peer didn't reply within the allowed time". What does that mean?

A: Your node asked another node for data and it did not answer in time, usually because that peer is slow or went offline. Try again; the node asks other peers as well.

Also asked as: peer didn't reply within the allowed time · qdn no reply error · peer timeout qortal · no reply from peer

## Q: GO's screen goes black for a moment every few minutes. Why?

A: That was a bug in older GO versions: an idle-time animation pause replayed animations that had already finished. Update GO; v0.0.16 fixed it.

Also asked as: go screen flashes black · black flash go · screen goes black and back · go blinks black

## Q: A file someone offered me in a DM says the offer has expired. What do I do?

A: Direct file offers only stay open for a while, and this one ran out before the file was fetched. Ask the sender to send the file again, and keep GO open while it downloads.

Also asked as: file transfer offer has expired · file offer expired dm · cant download dm file · expired file in chat

## Q: GO says it blocked a request to the node because its address was not safe. Why?

A: A Q-App asked the node for an address GO considers unsafe, which could reach parts of the node it should not. GO refused it to protect you. Nothing is wrong with your account; tell the app's developer.

Also asked as: blocked a request to the node · address was not safe · unsafe node path · q-app request blocked go

## Q: Qortal Hub disappears when I close it but keeps running. Why?

A: Closing the window was set to Minimize to Tray (or you chose it when Hub asked), so Hub keeps running in the system tray (the Dock on a Mac). Open it again from the tray icon, or choose Quit Completely. To change what closing does, use "When closing the window" in Hub's settings.

Also asked as: hub keeps running after close · minimize to tray hub · hub still in tray · quit qortal hub completely

## Q: GO says only some of my payments were sent. What should I do?

A: When one request pays several people, GO sends them one by one, and it stopped at a failure: the message says how many went through. Check your wallet history to see which ones were sent before you pay again, so nobody is paid twice.

Also asked as: payments were sent then the next one failed · only some payments sent · multi payment failed · partial payment go

## Q: GO shows 0 online and connecting until I restart it. Why?

A: In older GO versions, if Android reloaded GO's screen right after sign-in, the new screen never heard from Reticulum. Update GO; since v0.0.16 the screen asks again by itself. On an old version, restarting GO fixes it.

Also asked as: 0 online connecting · go stuck connecting · online count zero go · reticulum connecting forever

## Q: The first tap after a swipe does nothing in GO. Why?

A: That was a bug in older GO versions: a swipe left an invisible scroll behind and the next tap was swallowed. Update GO; v0.0.16 fixed it.

Also asked as: first tap after swipe not working · tap ignored after swipe go · go tap does nothing · need to tap twice go

## Q: The Tabs window closes when I try to scroll it. How do I scroll?

A: On the Tabs window a short swipe up scrolls the tabs and a long one closes the window. Use short swipes to scroll, and update GO if yours is older than v0.0.16.

Also asked as: tabs window closes when scrolling · cant scroll tabs go · tabs closes on swipe · scroll tabs list go

## Q: Hub or GO says "invalid qortal link". What is wrong with it?

A: The link is not in a form Qortal can open, or it points somewhere a Q-App is not allowed to open. A working link looks like qortal://APP/Name, or qortal://SERVICE/name/identifier. Ask the sender for the full link again.

Also asked as: invalid qortal link · qortal link not working · qortal link error · bad qortal link

## Q: Hub asks whether to overwrite my QDN-saved pinned apps. What should I answer?

A: Hub could not download the pinned-app list you saved to QDN before, so it cannot tell whether that list is newer. Answer no if you want to keep the saved list, and try again later when your node has it; answer yes only if the pins on this computer are the ones you want. GO does not offer this backup, so a phone cannot overwrite Hub's pins.

Also asked as: overwrite pinned apps hub · unable to download your existing qdn-saved pinned apps · hub pinned apps backup · pinned q-apps overwrite question

## Q: GO uses a lot of mobile data. What can I change?

A: GO's data use comes from Reticulum chat traffic and from the Q-Apps, videos and files you open. On mobile data GO keeps a light phone profile; it relays group traffic for others only while charging on Wi-Fi. Open Q-Apps pause in the background, and Background sync set to Off or While charging limits background traffic. Received and Sent in the Reticulum badge show how much GO has used since Reticulum started.

Also asked as: go uses a lot of data · go mobile data usage · reduce go data use · go data in background

## Q: GO is slow for a while right after it starts. Why?

A: At start GO opens its chat database, connects to Reticulum and catches up on new messages, which takes some work, and it settles after a short while. On GrapheneOS with WebView JIT off for GO, this start-up phase is much slower; allowing WebView JIT makes it faster. Updating GO helps too: v0.0.19 made start-up lighter.

Also asked as: go slow after start · go laggy at startup · go slow first minute · go sluggish when opened

## Q: My Core log says "Blockchain too divergent with peer". Is my node on a fork?

A: Core writes this when the last block it shares with that peer is more than 240 blocks back, so the two are on very different branches and it stops trying that peer. Seen now and then, it is about the peer. If it shows for most peers and your height stops moving, your node is probably the one on a fork: bootstrap it.

Also asked as: blockchain too divergent with peer · too divergent log qortal · node log divergent · core log fork message

## Q: My Core log says "Failed to synchronize with peer ... cooling off". Is that a problem?

A: Usually not. Syncing with that one peer failed (the reason is in brackets), so Core leaves it alone for a while and syncs from others. It only matters if your height stops moving; then see the steps for a node that won't sync.

Also asked as: failed to synchronize with peer cooling off · cooling off log qortal · sync failed with peer log · core log failed to synchronize

## Q: My Core log says "Higher weight chain found in peers, so not signing a block this round". Is minting broken?

A: No, that is normal. A peer has a better chain than yours, so your minter waits up to 30 seconds to sync to it instead of minting on the weaker one. After that it carries on by itself.

Also asked as: higher weight chain found in peers · not signing a block this round · minting skipped log · block minter not signing

## Q: My Core log says "NO LONGER MINTING". What should I do?

A: Core's minter stopped after a database error. Core checks every 10 minutes and restarts the minter by itself (the log then says "Restarting block minter"). If the message keeps coming back, restart Core, and bootstrap if the database errors continue.

Also asked as: no longer minting log · repository issue while running block minter · block minter stopped · restarting block minter

## Q: GO shows a "GO runtime error" window. What should I do?

A: Part of the app hit an error after login, and GO shows it instead of leaving a white screen. Tap Reload app; your lock and account stay as they were. If the window has no buttons, close GO fully and open it again. If it keeps coming back, update GO, and send Copy diagnostics with your report (it lists recent app errors).

Also asked as: go runtime error · runtime fault after login · go error window reload app · go crashed error message
