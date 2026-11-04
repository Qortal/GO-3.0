# qortal-go — golden FAQ

Curated offline Q&A for Qortino (203 entries). Prefer these answers when relevant.

## Q: Which Android version do I need for Qortal GO?

A: Qortal GO (GO 3.0) needs Android 8.0 or newer. It is built for 64-bit phones and tablets (ARM64), so an old phone that only runs 32-bit apps cannot install it. NFC, a camera and a microphone are optional: GO installs without them, and only the features that need them are missing.

Also asked as: qortal go android version · go 3.0 minimum android · which phones run qortal go · qortal go phone requirements · does qortal go work on android 8 · go 3.0 supported phones

## Q: Where do I download Qortal GO?

A: Qortal GO comes as an APK file that you install yourself. The newest build is in three places:
qortal.dev → Downloads → Android (it downloads GO-3.0.apk).
Q-Share, under the name GO 3.0, if you already use Qortal.
The releases of the GO-3.0 project on Qortal's Gitea.
Once GO is installed, it updates itself from QDN.

Also asked as: download qortal go · qortal go apk download · get go 3.0 apk · where to download qortal go apk · qortal go play store · qortal go download link

## Q: How do I install the Qortal GO APK?

A: 1. Download the APK on your phone, for example from qortal.dev → Downloads → Android.
2. Open the downloaded file.
3. If Android blocks it, allow "Install unknown apps" for the browser or file app you used, then go back.
4. Tap Install. The app shows up as GO 3.0.
5. Open it and create or import your account.

Also asked as: install qortal go apk · how to install go 3.0 · qortal go install steps · sideload qortal go · install unknown apps qortal go

## Q: How do I update Qortal GO?

A: 1. Tap your avatar at the top right and open GO 3.0 Updates.
2. If no update shows yet, tap Check for updates.
3. Tap Install update. GO fetches the build from QDN and checks it.
4. Confirm the install in Android's window.
Your accounts, settings and chats are kept.

Also asked as: update qortal go · go 3.0 update · new version of qortal go · upgrade go 3.0 app · install go update · qortal go latest version update · how do I update GO

## Q: Will updating GO delete my accounts or chats?

A: No. Every GO 3.0 build is signed with the same key, so a new version installs over the old one and keeps your saved accounts, settings and chats. Only uninstalling GO removes its data from the phone.

Also asked as: update go keep data · go update lose account · install over qortal go · go 3.0 update data kept · update qortal go without losing chats

## Q: What is the public node in Qortal GO?

A: It is the shared gateway node ext-node.qortal.link that GO uses by default, so you can start at once without running Qortal Core yourself. It is quick, but it is shared and run by someone else: it does not take QDN uploads (posts, avatars, apps), and minting, blocking accounts and sending coins other than QORT also need your own node. Big downloads such as Qortino's model can work there but are unreliable, so your own node is highly recommended for them.

Also asked as: qortal go public node · go 3.0 default node · ext-node.qortal.link · using public node go · go shared gateway node

## Q: How do I connect Qortal GO to my own node?

A: 1. Tap your avatar and choose Node. Before you log in, use Login settings at the bottom right of the Enter Qortal screen.
2. Under Node connection, tap Add private node.
3. Enter a name, the Node URL (your node's address with its API port, 12391 by default) and its API key if it needs one.
4. Tap Save and use. GO switches to that node.

Also asked as: connect go to my node · qortal go private node · add private node go · use own node in qortal go · go 3.0 custom node · go node url setting

## Q: What can't I do in GO on the public node?

A: On the public node you can't publish on QDN (posts with media, avatars, apps), mint, block accounts yourself or send coins other than QORT; those need your own node. Q-Apps and websites also depend on what the public node has stored, so some load slowly, and Qortino's model download is unreliable there, so your own node is highly recommended for it. Reading Q-Apps, chat and QORT payments work.

Also asked as: public node limits qortal go · go 3.0 public node features · what needs own node in go · go phone public node restrictions · why use my own node with go

## Q: How do I create a new account in Qortal GO?

A: 1. On the Enter Qortal screen, tap Create account.
2. Choose a wallet password and type it twice; it protects the account on this phone.
3. Reveal your seedphrase and write it down on paper.
4. Tap Create account, then save the encrypted wallet backup GO offers (it goes to Documents/Qortal Go).
5. Tap Enter GO.
Creating an account is free.

Also asked as: create account qortal go · new wallet go 3.0 · sign up qortal go · make qortal account on phone · go 3.0 create account steps

## Q: How do I import my existing Qortal account into GO?

A: On the Enter Qortal screen, tap Import account and pick one:
Seedphrase: type it and choose a wallet password for this phone.
Backup file: pick your wallet backup file to keep the account in GO.
Authenticate now: use a backup file this once without saving it.
Check that the address is the one you expect before moving any funds.

Also asked as: import account qortal go · restore wallet go 3.0 · add hub account to go · go import seedphrase · go import account options

## Q: What is the wallet password in Qortal GO?

A: It is the password you choose for an account on this phone. GO uses it to encrypt the saved account, and asks for it to unlock, to confirm payments and to reveal keys. It is not your seedphrase, and nobody can reset it. If you forget it, remove the account and import it again with your seedphrase, choosing a new password; a backup file only opens with the password it was saved with.

Also asked as: go wallet password · qortal go password meaning · forgot go wallet password · go 3.0 account password · reset password qortal go

## Q: How do I turn on fingerprint unlock in GO?

A: 1. On the Enter Qortal screen, tap Login settings (the slider button at the bottom right).
2. Under Unlock with fingerprint, pick the account.
3. Enter that account's wallet password once.
4. Confirm with your fingerprint.
After that, tap the fingerprint on the unlock screen instead of typing the password.

Also asked as: fingerprint unlock qortal go · enable biometric go · go 3.0 fingerprint login · unlock with fingerprint go · go biometric setup · how to turn on fingerprint

## Q: How do I back up my wallet in GO?

A: On Home, tap Backup Wallet in Quick tools and download the wallet file. It is encrypted with your wallet password, or with a new password you choose for that backup. GO saves it under Documents/Qortal Go. Keep a copy off the phone too, along with your seedphrase written on paper.

Also asked as: backup wallet qortal go · go wallet backup file · download wallet file go · go 3.0 backup account · where is go wallet backup · how to backup my wallet · how do i backup my account · backup my qortal account

## Q: What is in GO's account menu?

A: Tap your avatar at the top right. The menu has Notifications, Wallets (opens Q-Wallets), Send QORT, Address book, Minting, Node, GO 3.0 Updates, Lock now and Logout. Qortal Card shows there too if you turn it on in Settings → System. Swipe the menu up or press back to close it.

Also asked as: go avatar menu · qortal go account menu · tap avatar top right go · go 3.0 menu items · close account menu go

## Q: Where are the Settings in Qortal GO?

A: On Home, tap the gear button on the Account Overview card. Settings opens full screen with the tabs Profile, Security, Blocked and System. Swipe sideways to move between tabs, and press back or the round close button to leave.

Also asked as: go settings · open settings qortal go · go 3.0 settings gear · account settings go · where is the settings gear go

## Q: What is on the Home screen of Qortal GO?

A: Home is a column of windows: Hotkeys and Qortino, Account Overview, Post to Torq, Quick tools, Featured Q-Apps, Status, Wallet Activity, Group Activity and the Torq Feed. You can turn some of them off in Settings → Profile → On Home, and long-press a window's background to move it.

Also asked as: qortal go home screen · go 3.0 home windows · what is on go home · go home page parts · go dashboard phone

## Q: Where do I see my QORT balance in GO?

A: On Home, the Status window shows your QORT Balance at the top. Tap Wallets in the account menu (or Quick tools) to open Q-Wallets, which shows QORT and your other coins.

Also asked as: qort balance qortal go · go 3.0 my balance · how much qort do i have go · go wallet balance · see balance on phone qortal

## Q: How do I get my first QORT in GO?

A: The Getting Started card on Home offers three ways to get your first 2 QORT:
Finish the onboarding on qortal.dev (Go to onboarding).
Ask for 2 QORT in the support chat (Open support chat).
Buy QORT with Q-Trade (Open Q-Trade).
A little QORT pays for fees and for registering your name.

Also asked as: first qort qortal go · get 2 qort go · free qort new account go · go getting started qort · buy first qort phone

## Q: How do I post to Torq from GO's Home?

A: 1. In the Post to Torq window, tap Compose.
2. Write your post and add images, GIFs, a poll, a video or files if you like.
3. Tap Publish and confirm the fee.
You need a registered Qortal name, and a node that takes uploads: your own node, since the public node doesn't. When it is published, open latest post shows it in Torq.

Also asked as: post to torq from go · go home composer torq · write torq post on phone · go 3.0 post to torq · home composer go

## Q: How do I open the Q-Apps library in GO?

A: Tap the Apps button among the round buttons at the bottom, or swipe sideways to Apps. If a Q-App is open, Apps shows that app first; tap Apps again for the library. The library has six tabs: Pinned, Official apps, Community apps, Categories, My apps and + private app, and each remembers where you scrolled.

Also asked as: q-apps library go · open apps library qortal go · go 3.0 app store · where is the q-apps library go · go library tabs

## Q: How do I search for a Q-App in GO?

A: Tap the search field in the top bar ("Search Q-Apps or enter qortal://") and type a name. Suggestions show apps and websites, each with an App or Website tag; tap one, or press the keyboard's Go key for the first.

Also asked as: search q-apps go · find an app qortal go · go top bar search · search websites qortal go · go 3.0 app search

## Q: How do I pin a Q-App in GO?

A: Tap the pin icon on the app in the library, or Pin to Tabs on its info page. GO adds it to a Library folder in Tabs, which also shows in the library's Pinned tab. Tap the pin again (Unpin from Tabs) to take it out.

Also asked as: pin app qortal go · pin to tabs go · save favourite app go · unpin app go · go library pin icon

## Q: What is the Tabs window in GO?

A: Tabs shows every Q-App and website you have open as cards with a picture of each page, like a browser's tab switcher, together with your folders. Tap a card to switch to it, × to close it, or Close all. The Tabs button in the top bar opens it and shows how many tabs are open.

Also asked as: tabs window qortal go · list of open tabs go · go tab switcher · tabs button top bar go · go 3.0 tabs

## Q: How do I close a Q-App in GO?

A: Open Tabs and tap × on the app's card, or Close all to close every tab. The library's Pinned tab also lists Open tabs with a close button.

Also asked as: close q-app go · quit app qortal go · close tab go · close all tabs go · stop running app go

## Q: What is the widgets screen in GO?

A: It is a screen to the left of Home (swipe right from Home) for widgets: small Q-Apps made for GO, such as a clock, the weather or news. It is on by default; turn it off in Settings → System → Widgets screen. While it is empty it shows just a round + to add one.

Also asked as: widgets screen qortal go · go widgets · screen left of home go · go 3.0 widgets page · turn off widgets screen go

## Q: How do I add a widget in GO?

A: Swipe right from Home to the widgets screen and tap + (or Add widget while arranging). The list shows widgets published on QDN and who made them; search it and tap one to add it. You can have up to 12 widgets.

Also asked as: add widget qortal go · go widget picker · add a widget go · how many widgets go · go widgets plus button

## Q: How do I switch between Home, Apps and Chat in GO?

A: Tap the round Home, Apps and Chat buttons at the bottom, or swipe sideways: the next section slides in like a page, with its real content, and each section keeps where you had scrolled. Inside a Q-App, swipe along the round buttons instead, since the app keeps its own swipes.

Also asked as: switch sections go · switch sections home apps chat go · go section swipe · go bottom buttons home apps chat · move between screens go

## Q: How do I change the language in Qortal GO?

A: Tap the Qortal logo at the top left to open Core & settings and tap Language; before you log in, use the globe button at the bottom right of the Enter Qortal screen. GO comes in 12 languages: English, Arabic, German, Spanish, Estonian, Finnish, French, Italian, Japanese, Portuguese, Russian and Chinese.

Also asked as: change language qortal go · languages in qortal go app · which languages does go support · go in german · switch go language

## Q: How do I open Qortino in GO?

A: On Home, tap Qortino, the character under your hotkeys. If you don't see him, turn on Qortino AI in Settings → Profile → On Home. The first time, Qortino asks you to assemble his model.

Also asked as: open qortino · where is qortino in go · start qortino ai · qortino button home · talk to qortino

## Q: How do I download Qortino's model?

A: 1. Open Qortino on Home and tap Assemble Qortino.
2. GO finds the model on QDN, the node fetches each part, and GO saves and checks them on the phone; the progress shows each step.
3. Tap Minimize to use GO meanwhile: the progress shows in GO's notifications and the Android notification bar.
It is a one-time download of about 2.5 GB (GO shows 2.3 GB). Your own node is highly recommended: the public node is not reliable for a download this big.

Also asked as: assemble qortino · download qortino model · install qortino ai · qortino setup steps · get qortino brain

## Q: Does Qortino send my questions anywhere?

A: No. Qortino runs entirely on your phone, with no cloud: your questions and answers are never sent anywhere. The one exception is a report you choose to send with the report button, which goes out as a Q-Mail.

Also asked as: qortino privacy · is qortino private · qortino cloud · does qortino upload my questions · does qortino upload my chats · is qortino safe to use · is qortino safe

## Q: How do I open a Q-App in GO?

A: Tap Apps for the library and tap Open on an app (Download first if your node doesn't have it yet), search for it in the top bar, or tap a hotkey or a Featured Q-Apps tile on Home. It opens in a tab, and Tabs shows everything you have open.

Also asked as: open q-app qortal go · start an app in go · launch q-app phone · go 3.0 open app · run a q-app go

## Q: Is there a Qortal GO app for iPhone?

A: No. Qortal GO is an Android app only. On an iPhone or iPad, the Downloads page on qortal.dev points you to a web app that runs in the browser instead.

Also asked as: qortal go ios · qortal go iphone · go 3.0 ipad · qortal app for iphone · qortal go apple app store

## Q: Why is the app called GO 3.0 on my phone?

A: GO 3.0 is the current Qortal GO app, and that is the name under its icon. It is built from the same code as Qortal Hub, the desktop app, with a phone layout and Android parts added. Its releases are numbered v0.0.1, v0.0.2 and so on, so you will see names like "GO 3.0 v0.0.19".

Also asked as: go 3.0 app name · qortal go called go 3.0 · go 3.0 meaning · go 3.0 icon name · go 3.0 same app as qortal go

## Q: Is Qortal GO open source?

A: Yes. GO 3.0 is built from the Qortal Hub code and keeps its GPL-3.0 licence. Its code is public in the GO-3.0 repository on Qortal's Gitea, where each release also carries the APK.

Also asked as: qortal go source code · go 3.0 open source · qortal go license · go 3.0 code gitea · qortal go gpl

## Q: Does Qortal GO use Google services or trackers?

A: No. GO contains no Google Play Services, Firebase or Chromecast code, makes no Google backup of its data, and has the WebView's usage reports and Safe Browsing switched off. The Exodus tracker scan finds none of the 432 trackers it knows. GO runs on phones without Google, such as GrapheneOS.

Also asked as: qortal go google play services · go 3.0 trackers · qortal go degoogled · does qortal go spy · go 3.0 without google · qortal go privacy trackers

## Q: Does Qortal GO work on GrapheneOS?

A: Yes. Since v0.0.14 GO is a release build, so login on GrapheneOS takes a second or two instead of 30 seconds or more. If "WebView JIT" is turned off for GO, chats and the chat database run slower, mostly right after GO starts, and GO shows a calm notice once with the two steps to change it. Allowing JIT is your choice: it makes GO faster, keeping it off adds hardening.

Also asked as: qortal go grapheneos · go 3.0 graphene · grapheneos qortal app · is go compatible with grapheneos · grapheneos support qortal go

## Q: What permissions does Qortal GO use and why?

A: Microphone: voice calls. Camera: the built-in QR scanner, which reads codes on the phone with no Google service. Notifications: messages, calls and downloads. NFC: the Qortal Card (testing), only while its screen waits for a tap. Install apps: GO's own updates, and Android still asks you to confirm each one. GO never asks for your location or for "Nearby devices".

Also asked as: qortal go permissions · why does go need microphone · go 3.0 camera permission · qortal go nfc permission · does qortal go use location · go 3.0 nearby devices

## Q: Why can't I take a screenshot on some GO screens?

A: GO blocks screenshots, screen recording and the recent-apps preview on its most sensitive screens: the unlock and lock screens, the seed phrase, private key and backup screens, and while a payment or Q-App approval is open. This keeps your keys out of screenshots and away from other apps. Write a seed phrase down on paper instead.

Also asked as: qortal go screenshot blocked · go 3.0 screenshot black · screen recording blocked qortal go · cannot screenshot seed phrase go · go recent apps preview blank

## Q: Does Qortal GO run a Qortal node on my phone?

A: No. GO connects to a Qortal Core node: the public node by default, or a node you run yourself. Login settings has a "Run a Lite Node" item, but Qortal Lite Nodes are still being built. Once they are live on the network, GO will let you run one from there.

Also asked as: is qortal go a node · go 3.0 lite node · run a lite node in qortal go · does qortal go run core · lite node coming soon go

## Q: Can I use Qortal GO without internet?

A: Mostly not: your balance, Q-Apps, QDN data and the blockchain all come from a Qortal node, so GO needs a connection to one. Qortino, GO's AI helper, is the exception. Once its model is assembled on the phone, it answers with no internet at all.

Also asked as: qortal go offline · go 3.0 no internet · does qortal go work offline · qortal go without network · go app offline use

## Q: Is Qortal GO free?

A: Yes, GO costs nothing to download, install or update, and creating an account is free. Actions written to the blockchain, such as registering a name, publishing or sending QORT, cost a small fee in QORT, the same as on Qortal Hub.

Also asked as: qortal go price · does qortal go cost money · go 3.0 free app · qortal go subscription · pay for qortal go

## Q: Does Qortal GO check for updates by itself?

A: Yes. GO looks for a newer build about half a minute after it starts, then every 6 hours, and again when you come back to it after a long break. When it finds one, your avatar gets a small update mark and GO 3.0 Updates in the account menu gets a badge. Nothing installs until you tap Install update and confirm.

Also asked as: qortal go auto update · go 3.0 update notification · automatic update check go · go update mark on avatar · how does go know new version

## Q: What is the GO 3.0 Updates screen?

A: It is GO's update window, under Node in the account menu (tap your avatar). It shows the version installed on this phone, a Check for updates button with when it last looked, and an Install update card when a newer build is out. Below, Versions on QDN lists every published build, newest first, with its size, date and release notes (Show changes), and Open in Q-Share for each.

Also asked as: go 3.0 updates screen · versions on qdn go · go updates window · go 3.0 updates menu · see all versions of qortal go

## Q: Where can I read what changed in a GO version?

A: Open GO 3.0 Updates from the account menu and tap Show changes under a version in Versions on QDN. The same notes are the description of that build's share in Q-Share: tap Open in Q-Share to see its share page.

Also asked as: qortal go release notes · go 3.0 changelog · whats new in qortal go · go update changes list · show changes go updates

## Q: Why does a GO update ask me to allow installs?

A: Android only installs apps from sources you have allowed. Tap Allow installs, turn on "Install unknown apps" for GO 3.0 in Android's settings, then come back to GO: the install carries on by itself.

Also asked as: go update permission needed · allow installs qortal go · install unknown apps go update · go 3.0 update permission · go update waiting permission

## Q: How do I check which version of GO I have?

A: Tap the Qortal logo at the top left to open Core & settings: GO version shows the version on your phone. GO 3.0 Updates in the account menu also shows the installed version next to the published ones.

Also asked as: qortal go version number · which go version installed · go 3.0 version check · find my go version · go version in settings

## Q: Where do GO updates come from?

A: From QDN. Each build is published with Q-Share under the registered name GO 3.0, and your node fetches it from peers when you tap Install update. GO only installs a file with GO's own package name, signed with the same key as the GO on your phone, and with a higher version number.

Also asked as: go update source qdn · go updates from q-share · who publishes go 3.0 updates · go 3.0 name on qdn · is go update safe

## Q: Can I install a GO APK that I downloaded with Q-Share inside GO?

A: No. GO saves an APK you download in a Q-App (to Documents/Qortal Go/Apps) but never opens or installs app packages itself. To update GO, use GO 3.0 Updates in the account menu, which checks the build first. To install any other APK, open it from your phone's file manager.

Also asked as: go does not open apk · install apk from q-share in go · go saved apk wont install · apk in qortal go apps folder · update go through q-share app

## Q: What happens if I uninstall Qortal GO?

A: Uninstalling deletes what GO keeps on the phone: saved accounts, settings, the chat database and Qortino's model. Your account itself lives on the Qortal blockchain, so after reinstalling you add it back with your seed phrase or wallet backup file. Make sure you have one of them before you uninstall.

Also asked as: uninstall qortal go · reinstall go 3.0 · remove go app data · fresh install qortal go · uninstall go lose account

## Q: How do I know my GO APK is genuine?

A: Get GO only from qortal.dev → Downloads, from Q-Share under the name GO 3.0, or from the GO-3.0 releases on Qortal's Gitea; each Gitea release lists the APK's SHA-256 checksum to compare. After that, GO's own updater only installs builds signed with the same key as yours. Never type your seed phrase into an APK from anywhere else.

Also asked as: is my qortal go apk real · fake qortal go apk · verify go 3.0 apk · go apk checksum sha256 · safe source for qortal go

## Q: How do I give feedback or suggest a feature for GO?

A: Join the GO 3.0 group in Q-Chat and tell the team there. GO links to it from Home: in the panel above Qortino, tap + (if the panel shows hotkeys, tap × first; your hotkeys stay saved) and choose Suggest a module, which opens the group's invite. For a wrong Qortino answer, use the report button under that answer instead.

Also asked as: qortal go feedback · suggest feature go 3.0 · give feedback about qortal go · report problem qortal go · suggest a module go

## Q: How do I switch GO back to the public node?

A: Tap your avatar, choose Node, and tap Public node under Node connection (or do the same in Login settings before you log in). Your saved private nodes stay in the list, so one tap switches back to them later.

Also asked as: switch to public node go · go back to public node qortal go · change node in qortal go · use public node again go · go 3.0 switch node

## Q: Do I need an API key to use my node with GO?

A: It depends on how GO reaches the node. A node on the phone's own address (127.0.0.1, such as an SSH tunnel) may work without one. A node on your home network or the internet needs its API key, and GO asks for it when it is missing or wrong. Enter it in the API key field of your saved private node. The public node never asks for a key.

Also asked as: qortal go api key · go node api key needed · api key private node go · where enter api key go · go 3.0 node apikey

## Q: What does Android's back button do in GO?

A: Back closes GO's own windows and panels first, newest first: Settings, Tabs, menus, viewers. With nothing open, it takes you to Home from Apps or Chat, and on Home it sends GO to the background. In a full-screen Q-App it leaves full screen first. The Q-App itself stays open in Tabs; use its own buttons to go back inside it.

Also asked as: back button qortal go · go android back · back gesture go 3.0 · go back closes window · back from q-app go

## Q: What does the Public node unavailable window in GO mean?

A: GO cannot reach the public node right now, so the Q-App or website you opened can't load. Tap Wait and GO keeps checking (Check now asks at once) and opens the app as soon as the node is back, when the window turns green with "Public node is back". Or tap Use a private node to open node settings.

Also asked as: public node unavailable go · go cant reach public node · public node down qortal go · public node is back go · use a private node button go

## Q: Can GO use my home node when I'm away from home?

A: Yes, if your phone can reach it. One way is a VPN such as Tailscale, using the node's VPN address as your private node. Another is an SSH tunnel that makes the node appear at 127.0.0.1 on the phone. Add that address as a private node, with its API key if it needs one. Never open Core's API port (12391) to the whole internet.

Also asked as: use home node from phone · qortal go tailscale node · ssh tunnel node qortal go · remote own node qortal go · access my node away from home go

## Q: Can I browse normal websites in GO?

A: GO shows Qortal websites, the ones published on QDN, in tabs just like Q-Apps; find them with the top bar search. Ordinary web links open in your phone's own browser instead, outside GO.

Also asked as: normal websites in qortal go · go web browser · open web link go · http link opens browser go · go 3.0 browse internet

## Q: Is fingerprint unlock in GO safe?

A: With fingerprint unlock, GO keeps your wallet password only on this phone, encrypted with a key held in the phone's Android Keystore, and asks for your fingerprint before it uses it. It never leaves the phone and is never uploaded. Any fingerprint enrolled on the phone can unlock GO, so only enrol your own. Sending QORT and Backup Wallet still ask for the typed password. You can turn fingerprint unlock off any time.

Also asked as: go fingerprint safe · where is my password stored go · biometric unlock security qortal go · go keystore password · fingerprint password uploaded go

## Q: Why doesn't fingerprint unlock work in GO?

A: GO needs a fingerprint sensor that Android reports; without one, Login settings says no sensor was detected. Fingerprint unlock is also set per account, so pick the account first in Login settings. If a scan fails or you cancel it, GO lets you type your password instead.

Also asked as: go fingerprint not working · no fingerprint sensor go · fingerprint unlock failed go · go fingerprint option missing · biometric failed qortal go

## Q: What are Login settings in GO?

A: Login settings is the slider button at the bottom right of the Enter Qortal screen. It holds fingerprint unlock for each saved account, the Node connection (the public node or your private nodes), the startup sound switch, and a Run a Lite Node item that is coming later.

Also asked as: go login settings · qortal go login options · slider button login screen go · go 3.0 enter qortal settings · settings before login go

## Q: How do I switch accounts in GO?

A: Tap your avatar and choose Logout, then pick another account on the Enter Qortal screen. On an unlock screen, Choose another account takes you back to the list. When you reopen GO it starts with the account at the top of the list; long-press an account and drag it to change the order.

Also asked as: switch account qortal go · change account go 3.0 · go log in other account · choose another account go · go account list order

## Q: Can I keep several accounts in Qortal GO?

A: Yes. Every account you create or import (with Save account in GO on) stays in the Enter Qortal list. You can search the list by address, name or note, give an account its own name and a note with the edit button, and long-press an account to move it up or down.

Also asked as: multiple accounts qortal go · several wallets go 3.0 · go account list · name an account in go · go account note

## Q: How do I remove an account from GO?

A: On the Enter Qortal screen, open the account, tap its edit button and choose Remove in Account details. This only takes it off this phone, with its saved name and avatar: the account and its QORT stay on the blockchain. Make sure you have its seedphrase or backup file first, or you cannot add it back.

Also asked as: delete account from qortal go · remove wallet go 3.0 · go remove saved account · forget account on phone go · account details remove go

## Q: How do I lock GO without logging out?

A: Tap your avatar and choose Lock now. GO locks at once and asks for your fingerprint or password to come back. You stay signed in: chats and active calls stay connected while it is locked.

Also asked as: lock now qortal go · lock go app · go 3.0 lock screen · lock wallet go · quick lock go

## Q: How does auto-lock work in GO?

A: GO locks itself when you have not used it for a while. Choose the time in Settings → System → Auto-Lock When Idle: Disabled, 10 min, 30 min (the default), 1 hour or 3 hours. Unlock with your fingerprint or password.

Also asked as: auto lock qortal go · go locks itself · auto-lock when idle go · change lock timeout go · go 3.0 idle lock

## Q: What is the difference between Lock now and Logout in GO?

A: Lock now keeps you signed in: chats and calls stay connected, and your fingerprint or password brings you back. Logout ends the session: GO's network stops, files received in chat are deleted from GO, and you pick an account again on the Enter Qortal screen. Your saved accounts stay on the phone either way.

Also asked as: lock vs logout go · go logout what happens · logout qortal go · go log out deletes files · lock or log out go 3.0

## Q: Why is GO stuck on the Qortal logo when it starts?

A: If GO has trouble starting, it now says "GO is having trouble starting" with a Restart button instead of leaving the logo up. Tap Restart; GO goes back to the fingerprint or password unlock. If it keeps happening, update GO through GO 3.0 Updates.

Also asked as: go stuck on logo · qortal go won't start · go is having trouble starting · go 3.0 endless logo · restart button go start

## Q: Do my GO Home and pinned apps sync with Qortal Hub?

A: No, they stay on the phone: hotkeys and Tabs folders are kept in GO for each account, and the Home order for the phone. To copy your Hub's pinned apps into GO once, tap Import Hub dashboard in Tabs; they land in a folder named Hub. GO never writes its folders back, so it can't overwrite Hub's pins.

Also asked as: go hub pinned apps sync · go hotkeys sync hub · hub pins on my phone · go folders on hub · pinned q-app backup go

## Q: What does the dot on the Qortal logo in GO mean?

A: The dot on the Qortal logo at the top left shows your node: green when it is fully synced, amber while it is still syncing, grey when GO has no sync information. Tap the logo for Core & settings, with the Core version, sync status, block height, peers, minting status and the GO version.

Also asked as: dot on qortal logo go · go core status dot · green dot top left go · go sync dot colour · go node sync status

## Q: Can I block someone in Qortal GO?

A: Yes, on your own node: open User Search (Quick tools on Home, or Address book in the account menu), look the account up and tap block. Settings → Blocked lists blocked names and addresses with Unblock. Blocking happens on the node, so on the public node it is not available; that node's operator decides who is blocked there.

Also asked as: block user qortal go · go block name address · unblock in go · go blocked accounts · blocking public node go

## Q: How do I look up another user's account in GO?

A: Tap User Search in Quick tools on Home, or Address book in the account menu, and enter a name or address. GO shows the account's address, public key, level, minting progress and recent payments.

Also asked as: user search qortal go · address book go · find user by name go · look up address go 3.0 · go search accounts

## Q: How do I rearrange the windows on GO's Home?

A: Long-press the background of any Home window (not a button or link). Every window folds into a short labelled strip; drag the one under your finger up or down, the others make room, and let go. The order is saved on this phone, and Settings → Profile → Reset order puts it back.

Also asked as: rearrange go home · move windows on go home · reorder home qortal go · go home long press drag · reset home order go

## Q: How do I hide parts of GO's Home screen?

A: Open Settings → Profile and use the switches under On Home: Qortino AI, Featured Q-Apps, Status, Group Activity and the Torq Feed. Turning off Qortino AI keeps your hotkeys. Account Overview, Post to Torq, Quick tools and Wallet Activity always stay.

Also asked as: hide home windows go · turn off featured apps go · on home switches go · remove qortino from home go · go home modules off

## Q: What is Account Overview on GO's Home?

A: It is your account card: avatar, name, online status and address, with buttons to show your receive QR code, copy the address and open Settings (the gear). Tap the name to see the full address, tap the avatar to change it, and tap the status to change it.

Also asked as: account overview go · go home account card · go profile card home · account overview buttons go · go home name and address

## Q: How do I see my full Qortal address in GO?

A: On Home, tap your name in Account Overview: GO shows your full address, sized to fit without cutting it off. Tap again to show the name. The copy button next to it copies the address, and Settings → Profile also lists it.

Also asked as: show my address go · go home tap name address · full address qortal go · copy my address go · where is my wallet address go

## Q: What is in the Profile tab of GO's Settings?

A: Your current name (with Register name if you have none) and your wallet address, then the On Home switches for Qortino AI, Featured Q-Apps, Status, Group Activity and the Torq Feed, with Reset order for the Home layout. To buy, sell or change a name, it points you to the Names Q-App.

Also asked as: profile settings go · go settings profile tab · current name settings go · on home switches profile · go profile tab

## Q: How do I change my avatar in GO?

A: On Home, tap your avatar in Account Overview to open Update avatar, choose an image and publish it. An avatar needs a registered Qortal name, costs a small fee, and is published on QDN, so it needs your own node: the public node does not take uploads.

Also asked as: change avatar qortal go · go profile picture · update avatar go 3.0 · set avatar on phone qortal · go avatar upload

## Q: How do I set my status to Busy or Offline in GO?

A: On Home, tap the status under your avatar in Account Overview and pick Online, Busy or Offline (Offline makes you appear offline). Idle is set by itself while you are away. With a Hub version that has status sync, your choice follows your account to your other devices.

Also asked as: set status qortal go · go online busy offline · appear offline go · change my status go 3.0 · go status pill home

## Q: What is in the System tab of GO's Settings?

A: Auto-Lock When Idle, Disable Startup Sound, then the phone options: Widgets screen, Bottom buttons, Immersive mode, Calls, Qortal Card (testing) and Dev Mode, and finally Reduce UI Animations.

Also asked as: system settings go · go settings system tab · go 3.0 system options · where is immersive mode setting · go dev mode setting

## Q: What is the Getting Started card on GO's Home?

A: New accounts see three steps above Qortino on Home: get your first 2 QORT, register your name, and load your avatar. GO moves on when a step is done and says "All set" at the end; then you can build your workspace there.

Also asked as: getting started go home · go onboarding steps · go new account steps · load your avatar step go · go 3.0 setup card

## Q: What are hotkeys on GO's Home?

A: Hotkeys are six shortcut slots in the window above Qortino on Home. Each holds a Q-App that opens with one tap. They are saved automatically for your account.

Also asked as: hotkeys qortal go · go home shortcuts · app shortcuts go 3.0 · hotkey slots go · go home quick launch apps

## Q: How do I add or change a hotkey in GO?

A: Tap Add app on an empty slot, or the slider button in the Hotkeys header, to open Select hotkeys. Pick a slot, then search Q-Apps or choose one from Recommended. To empty a slot, use its clear button.

Also asked as: add hotkey go · change hotkey qortal go · select hotkeys go · clear hotkey slot go · go hotkey picker

## Q: What can I put in the panel above Qortino on GO's Home?

A: Tap + in the empty panel to choose a module: Hotkeys (six app shortcuts), Music player (a small EarBump player with search) or Suggest a module, which opens the GO 3.0 group so you can ask for new ones. The × on a panel clears it; your hotkeys stay saved.

Also asked as: choose a module go · panel above qortino go · go workspace module · go home music player module · what lives above qortino

## Q: What is the Qortino card on GO's Home?

A: Qortino is the character under your hotkeys on Home. Tap him to open Qortino AI, GO's offline helper, and ask anything. To hide him, turn off Qortino AI in Settings → Profile → On Home; your hotkeys stay.

Also asked as: qortino on home go · qortino card home · tap qortino go · qortino mascot home · open qortino from home

## Q: What can a Torq post from GO's Home include?

A: Formatted text (bold, italic, underline, lists), up to 10 images, up to 4 GIFs, a poll with 2 to 6 choices, one video, and files or audio under 2 GB each. GO keeps the post itself under 5 MB, shrinking images to fit, because Quitter, which shares Torq's data, does not show bigger posts; if it still doesn't fit, it asks you to remove an image.

Also asked as: go composer limits · how many images torq post go · go torq post gifs files · go home post attachments · torq post from go 5 mb

## Q: How do I post a video from GO's Home?

A: Tap add video in the Post to Torq composer and pick a compression: High quality (720p), Medium (480p) or Max (360p, smallest). Give it a title, a category and a thumbnail, because the video is also published for Q-Tube. You can tap Publish while it still compresses; most of the video uploads meanwhile.

Also asked as: post video qortal go · go video compression · go home add video · video upload from phone torq · publish when ready video go

## Q: Why do I need a registered name to post from GO?

A: Posts are published on QDN under a registered Qortal name, so the composer asks you to register one first ("Register a Qortal name to publish on Torq"). Register it in Settings → Profile or with Getting Started on Home, then post.

Also asked as: go post needs name · register a qortal name to publish · cant post without name go · go composer name required · torq post name required phone

## Q: What is the Rev button on GO's Home?

A: With Torq chosen, the Post to Torq window has a Rev button above Compose. It opens Torq's own Rev editor (Revs are Torq's stories) and needs Torq 1.3 or newer. If Torq doesn't take the photo or video, update Torq, then pick it in the Rev editor.

Also asked as: rev button go home · make a rev from go · torq rev qortal go · go home rev story · rev editor go

## Q: Do photos I post from GO show my location?

A: No. GO removes the location and the camera and phone details from photos and videos you post or send. If a picture's format cannot be cleaned, GO refuses it and asks you to save it as JPEG or PNG first.

Also asked as: go removes location from photos · gps in photos qortal go · exif removed torq post go · photo location privacy go · go strips camera details

## Q: What is the Torq Feed on GO's Home?

A: It shows the newest Torq posts, without replies or reposts. General is the public feed; Following shows people you follow, once you are signed in with a registered name and follow accounts on Torq. Tap the Torq Feed title to open Torq itself.

Also asked as: torq feed go home · go home feed · general and following feed go · go home torq timeline · feed window qortal go

## Q: What are the Featured Q-Apps on GO's Home?

A: A tile grid of popular apps: Q-Tube, Torq (Quitter if you chose it), Q-Mail, SubWire, Q-Trade and Q-Chat; tap one to open it. Explore All Q-Apps opens the library. The eye button stops the moving previews (Reduce motion).

Also asked as: featured q-apps go home · go home app tiles · explore all q-apps go · featured tiles eye button go · go home featured grid

## Q: What does the Status window on GO's Home show?

A: Your QORT balance, how far your node is synced, your minter level, peers, QDN, and the Core and GO versions. Below that it shows the node you are using, with a Change node button, its type and its block height.

Also asked as: status window go home · go home node status · go balance sync minting · change node from home go · go home status module

## Q: How do I get back to the Q-Apps library when a Q-App is open in GO?

A: Tap the Apps button again: on an open app it shows the library, and on the library it brings back the app you used last. The app stays open in Tabs meanwhile.

Also asked as: back to library from app go · apps button again go · leave q-app to library go · go library while app open · switch app and library go

## Q: What are the Quick tools on GO's Home?

A: A row of shortcuts: User Search, Wallets (Q-Wallets), Minting, Backup Wallet, Q-Chat, Mute or Enable Notifications, Apps and QortalLand.

Also asked as: quick tools go home · go home tool buttons · backup wallet button go · user search button go · qortalland button go

## Q: What are the buttons in GO's top bar?

A: From left to right: the Qortal logo with a status dot (tap it for Core & settings: node details, Language, Theme and the GO version), the search field for Q-Apps, websites and qortal:// links, Tabs with the number of open tabs, and your avatar for the account menu. While a Q-App is open, tap the search field for its address with Share link, Copy link and Refresh.

Also asked as: go top bar buttons · qortal logo top left go · tabs button avatar go · search field top go · core and settings go

## Q: What do Open and Download mean in GO's Q-Apps library?

A: They show what your node has right now. Open means the node already holds the app, so it opens at once. Download means the node still has to fetch it from peers; while it does, the button shows the progress in percent. GO asks the node live for the apps on screen, because the node's own list can be out of date.

Also asked as: open or download button go · download q-app go · go app not installed · go library downloading percent · q-app ready on node go

## Q: How are Q-Apps sorted in GO's library?

A: By highest rated, which weighs the stars by how many votes an app has, so a single 5-star vote does not beat many good ones; apps without ratings come last. In Community apps you can sort by alphabetical, newest, oldest, most reviewed or recently updated instead, and filter by category and by installed or not installed.

Also asked as: sort q-apps go · go library highest rated · filter installed apps go · go community apps sort by · q-apps order library go

## Q: How do I rate a Q-App in GO?

A: Open the app's page from the library and tap a star under Rate this app. You need a registered name. The first rating of an app creates a poll on the blockchain (a small fee), later ratings vote in it, and you can't give the same rating twice. Changes show after a couple of minutes.

Also asked as: rate q-app go · rate this app qortal go · give stars to app go · already voted for this app · q-app rating fee go

## Q: What is the Official apps tab in GO's library?

A: It lists Qortal's official Q-Apps, such as Q-Tube, Q-Mail, Q-Trade, Q-Wallets, Q-Blog, Q-Share, Names, Q-Mintership, Q-Search and Q-Support, with a Featured row of the best-rated ones at the top.

Also asked as: official apps go · official q-apps list go · go library official tab · qortal official apps phone · which apps are official go

## Q: What is the Community apps tab in GO's library?

A: It holds every other Q-App published on QDN, as a compact list under Community apps (N), the number of apps. A Featured row of the ten best-rated sits on top while no filter is on. Use the category, status and sort filters to narrow the list.

Also asked as: community apps go · go community q-apps · all q-apps list go · community apps count go · go library community tab

## Q: What does a Q-App's info page in GO show?

A: Tap an app in the library (not its button) to see who published it, About, its rating with Rate this app, and Details: category, service, tags, size, whether it is ready on your node, and when it was published and updated. On phones the page also has Pin to Tabs.

Also asked as: q-app info page go · app details go · tap app in library go · app publisher and size go · go app page rating

## Q: What is the Pinned tab in GO's library?

A: It is your home screen for apps: your Tabs folders laid out as a grid, the same folders as in the Tabs window. A folder can be small or large; a large one shows its apps so you can tap them directly. Open tabs below lists what is running. Tap the pin on any app in the library to add it here.

Also asked as: pinned tab go · go pinned apps · go home screen of apps · pinned folders go library · open tabs in pinned go

## Q: How do I make and manage folders in GO's Pinned tab?

A: Tap New folder to add one. Long-press a folder for Open, Rename folder, Small or Large folder and Delete folder (GO asks first; open tabs stay open), or hold and drag it to a new place. Inside an open folder, hold an app to move it; drag it off the folder to close the folder, then drop the app on another one.

Also asked as: new folder pinned go · rename folder go · delete folder go · large folder small folder go · move app to folder go

## Q: How many Q-Apps can I keep open in GO?

A: Up to 30 tabs of Q-Apps and websites. At 30, GO says "Maximum number of tabs reached. Close one to open another." Your open tabs come back after you restart GO.

Also asked as: max tabs qortal go · go 3.0 open apps limit · too many tabs go · go tabs after restart · go 3.0 how many tabs

## Q: How do I reload or share the page of a Q-App in GO?

A: While a Q-App is open, tap its address in the top bar. You get Share link, Copy link and Refresh; the link points to the exact page you are on, such as a single Torq post. The address window closes by itself after you use one.

Also asked as: refresh q-app go · reload app qortal go · share link of q-app page · copy link q-app go · address bar go

## Q: Why is the Accept button greyed out for a moment in GO's approval window?

A: GO keeps Accept disabled for about a second so a stray tap can't approve anything, and for payments and signing it also wants the "I have read this request" tick. If the app sends more requests, they wait in line ("more requests are waiting") instead of replacing the open one. Screenshots are blocked while the window is open.

Also asked as: accept greyed out go · approval delay go · cant tap accept q-app · i have read this request go · more requests waiting go

## Q: How do I open Tabs in GO?

A: Tap Tabs in the top bar, next to your avatar. On Home, the Q-Apps library and the chat lists you can also pull down from the top of the page: let go past about a third of the way, or flick down, and Tabs stays open.

Also asked as: open tabs go · pull down for tabs go · show my open apps go · tabs gesture qortal go · go pull down tabs · how do I open tabs

## Q: How do I close the Tabs window in GO?

A: Slide it up. On the list of tabs a short swipe scrolls them and a long one closes the window; a swipe on the header, the folder row or the bottom handle closes it at once. Android back closes it too. Tabs always reopens on all tabs, not inside a folder.

Also asked as: close tabs window go · swipe up tabs go · tabs wont close go · dismiss tabs qortal go · small swipe big swipe tabs

## Q: What does Import Hub dashboard in GO's Tabs do?

A: It reads the pinned apps your Hub saved to QDN for this account and puts them into a folder named Hub in Tabs, replacing that folder if it already exists. It works one way: changes you make in GO don't go back to Hub.

Also asked as: import hub dashboard go · hub folder in tabs · bring hub pinned apps to phone · copy hub apps to go · go hub dashboard import

## Q: How do I move, resize or remove a widget in GO?

A: Hold a widget, or an empty spot, to start arranging. Drag a widget to move it; the others make room, and widgets of the same size swap. Drag its corner to resize it. Drop it on Remove at the bottom, or tap ×, to take it away. Tap Done when you are finished.

Also asked as: move widget go · resize widget qortal go · remove widget go · arrange widgets go · widget corner resize

## Q: Can a GO widget spend my QORT or post for me?

A: No. Widgets can show things and open apps, but they can't pay, publish, sign, decrypt, save files, send notifications or go full screen. For anything like that a widget can only open its full Q-App, where GO asks you as it does for any app.

Also asked as: widget safety go · can widgets pay · widget permissions go · go widget publish sign · are widgets safe go

## Q: What are the round buttons at the bottom of GO?

A: They are GO's three sections, Home, Apps and Chat, shown as round glass buttons with icons. With immersive mode on, Home, Chat and the library scroll on behind them; with it off, and always in a Q-App or website, the page ends above them so they never cover an app's own menu.

Also asked as: round buttons bottom go · go floating tab buttons · go bottom bar · round glass buttons go · go 3.0 navigation buttons

## Q: What is immersive mode in GO?

A: Immersive mode hides the top bar, the bottom buttons and Android's status bar so Q-Apps and websites fill the screen; Home, Chat and the Q-Apps library keep their bars. Choose Off, Auto or Manual in Settings → System → Immersive mode. New installs start on Auto.

Also asked as: immersive mode qortal go · immersive fill screen go · hide bars go · go 3.0 immersive · immersive setting go

## Q: What is the difference between Off, Auto and Manual immersive mode?

A: Off: the top and bottom bars always show. Auto: in a Q-App the bars slide away when you scroll down and come back when you scroll up. Manual: the bars stay hidden, and a small floating button shows them for a few seconds.

Also asked as: immersive auto manual off · go immersive auto · go immersive manual · immersive modes explained go · bars slide away scrolling go

## Q: How do I switch GO between dark and light theme?

A: Tap the Qortal logo at the top left to open Core & settings, then tap Theme to switch between dark and light. Before you log in, the sun or moon button at the bottom right of the Enter Qortal screen does the same.

Also asked as: dark mode qortal go · light mode go · go theme · change theme go 3.0 · go night mode

## Q: Which GO entries appear in Android's share sheet?

A: For photos and videos: Torq, which opens Home's Post to Torq composer with them, and Torq Rev, which opens Torq's Rev editor with one photo or video. For any file, link or text: GO Groups, GO DMs and GO Self-DM, which put it into a chat. If you chose Quitter on Home, a Quitter entry replaces the Torq ones.

Also asked as: go share sheet entries · share to qortal go · go in share menu · go share sheet list · go 3.0 share targets

## Q: How do I update GO if the Updates screen can't reach QDN?

A: Download the newest APK from qortal.dev → Downloads → Android, or from the GO-3.0 releases on Qortal's Gitea, and install it over your GO. It is signed with the same key, so your accounts and chats stay. This works only for a newer version: Android won't put an older one over a newer one.

Also asked as: update go without updater · go updater not working · install new go apk over old · manual update qortal go · go update from qortal.dev

## Q: Can a Q-App use my camera, microphone or location in GO?

A: No. GO gives the camera and microphone only to its own screens, the QR scanner and calls, and refuses location to everyone, since GO never uses it.

Also asked as: q-app camera access go · q-app microphone go · q-app location go · go permissions for q-apps · can apps track my location go

## Q: Do I need a private node every time I use Qortino?

A: No, not even to download it, but for the download it is highly recommended: the public node is not reliable for a file this big. Once the model is on the phone, Qortino runs offline: it works on any node, or with no internet at all.

Also asked as: qortino public node daily · use qortino on public node · qortino after assembling · qortino needs node always · switch back to public node qortino

## Q: Where are my Qortino chats saved?

A: On your phone only. Tap the history button at the top of Qortino to see your chats: start a New chat, or pin, rename or delete one. Uninstalling GO deletes them too.

Also asked as: qortino chat history · qortino new chat · delete qortino chat · rename qortino chat · pin qortino chat

## Q: Can I rely on Qortino in a medical emergency?

A: Use it as a calm helper, not as a doctor. For a life-threatening emergency Qortino first tells you to call emergency services if phones work (112 in Europe, 911 in North America), then gives hands-on first aid steps and the warning signs that need a doctor. It gives no prescription doses, and it can be confidently wrong, so check anything important.

Also asked as: qortino first aid · qortino medical advice · qortino doctor · qortino emergency help · qortino health questions

## Q: Can Qortino look things up on the internet or QDN?

A: No. Qortino answers offline only, from its own model and its curated answers; it does not search QDN or the web, and it never sends you to websites. For anything live, open the Q-App that holds it.

Also asked as: qortino internet search · qortino browse web · can qortino search qdn · qortino find apps online · qortino online lookup

## Q: Can I use GO while Qortino's model downloads?

A: Yes. Tap Minimize: the download carries on, and its progress shows in GO's notifications (the bell) and in the Android notification bar. Tap the Qortino row in the bell to open it again. If GO closes half way, the download carries on after you sign in again.

Also asked as: qortino download in background · minimize qortino download · close qortino while downloading · qortino download notification · where is qortino download progress

## Q: How do I turn on WebView JIT for GO on GrapheneOS?

A: 1. Open Android Settings > Apps > GO 3.0 > "Exploit protection".
2. Allow "WebView JIT".
GO uses the new setting the next time it starts. It is a GrapheneOS security setting, so leaving it off is fine too; GO just runs slower.

Also asked as: grapheneos webview jit go · enable jit qortal go · exploit protection go 3.0 · go 3.0 jit setting · webview jit off qortal go

## Q: Can I go back to an older version of GO?

A: Not on top of a newer one: Android does not install an older version over a newer one. That is why the Updates screen offers Install only for newer builds; older ones can only be opened in Q-Share. The only way back is to uninstall first, which deletes GO's data on the phone, so have your seed phrase or wallet backup ready.

Also asked as: downgrade qortal go · install older go version · go 3.0 downgrade · older go apk wont install · roll back go update

## Q: Why did GO refuse to install an update?

A: GO refuses a file that is not a genuine, newer GO: one signed with a different key, a different app, or a build that is not newer than yours. These checks stop fake updates. Check again later from GO 3.0 Updates, and never install a GO APK from a source you do not trust.

Also asked as: go update wrong signer · go update refused to install · go 3.0 not a go build · go update not newer error · go update refused

## Q: Why won't GO download an update from my node?

A: GO downloads updates only over HTTPS or from a node on the phone itself (127.0.0.1). If your private node uses plain HTTP across the network, switch to an HTTPS node, such as the public node, while you update. If the screen says it could not reach QDN, check the node connection and try again.

Also asked as: go update plain http node · go update insecure node · go update https only · go update private node fails · go update could not reach qdn

## Q: Can I keep using GO while an update downloads?

A: Yes. You can close the GO 3.0 Updates screen and the download carries on. Its steps are: fetching from the Qortal network, assembling the build, downloading, and then Android asks you to confirm. Fetching can take a while if the network is slow to deliver the build; if it times out, try again.

Also asked as: go update in background · close updates screen go · go update slow download · go update fetching from network · go update progress steps

## Q: What does Later do on a GO update?

A: Later hides the offer for that version. To see it again, open GO 3.0 Updates and tap Check for updates.

Also asked as: go update later button · dismiss update offer go · hide update card later · bring back dismissed update · go 3.0 update later

## Q: Where can I find older versions of Qortal GO?

A: Every GO 3.0 build is listed in GO 3.0 Updates under Versions on QDN, and each one opens in Q-Share. The Downloads page on qortal.dev also links to older Qortal Go releases on GitHub. Remember that an older build cannot be installed over a newer one.

Also asked as: old qortal go versions · older go 3.0 builds · qortal go previous release · qortal mobile old app · download old go apk

## Q: Is Qortal GO finished or still being built?

A: GO 3.0 is young and changes quickly: its versions are still numbered 0.0.x, and new builds come often with fixes and features. A few parts are marked as testing, such as the Qortal Card. Keep GO updated through GO 3.0 Updates, and keep your seed phrase backed up as with any wallet.

Also asked as: is qortal go beta · go 3.0 still in development · is qortal go stable · go 3.0 early version · qortal go testing features

## Q: Can GO remember more than one private node?

A: Yes. Saved private nodes keeps a list, each with its own name, URL, port and API key, so you never retype a key. Tap a node to switch to it, or use its buttons to edit or remove it.

Also asked as: several private nodes go · saved private nodes qortal go · multiple nodes go 3.0 · edit private node go · remove private node go

## Q: Why did GO say my apikey is invalid on the public node?

A: On the public node that message came from a busy node's error page, not from a real key problem. GO v0.0.18 fixed it: on the public node GO never asks for a key, so update GO through GO 3.0 Updates. On your own node, the message means the saved key is wrong; enter the node's key again.

Also asked as: your apikey is invalid go · go apikey dialog public node · go asks api key at login public node · invalid apikey message qortal go · apikey popup go 3.0

## Q: Why does Qortino sometimes say it is not sure?

A: On purpose: Qortino is told never to invent facts, doses, numbers, sources, apps or names. When it isn't sure, it says so and gives the safest established option instead of guessing.

Also asked as: qortino not sure · qortino says it doesnt know · qortino unsure answer · qortino safest option · qortino honest answer

## Q: What does Authenticate now mean when importing in GO?

A: It signs you in with a wallet backup file for this session only: GO uses the file and its password but does not keep the account on the phone. Next time you need the file again. Choose Backup file instead if you want GO to remember the account.

Also asked as: authenticate now go · go temp auth · login without saving account go · use backup file once go · go import not saved on device

## Q: How do I turn off fingerprint unlock in GO?

A: Open Login settings on the Enter Qortal screen, pick the account under Unlock with fingerprint and tap Remove fingerprint unlock. You then unlock that account with its wallet password.

Also asked as: disable fingerprint go · remove biometric qortal go · stop using fingerprint go · go remove fingerprint unlock · stop fingerprint go 3.0

## Q: What happens while GO is locked?

A: The lock covers every GO window, and Q-Apps cannot ask for anything until you unlock: their requests get "GO is locked. Unlock it and try again." A payment link you open while locked waits for the unlock. Chats and active calls stay connected.

Also asked as: go locked q-app request · go is locked unlock it · while locked qortal go · payment link while locked go · go lock covers windows

## Q: Why doesn't my password manager fill in my GO password?

A: On purpose: GO turns autofill off for the wallet password, so password managers are not offered it. Type the password, or turn on fingerprint unlock in Login settings so you don't have to.

Also asked as: go autofill password · password manager qortal go · go wallet password autofill off · bitwarden go password · autofill not offered go

## Q: How do I turn off the startup sound in GO?

A: Switch on Disable startup sound in Login settings on the Enter Qortal screen, or Disable Startup Sound in Settings → System after you log in.

Also asked as: go startup sound · mute intro sound qortal go · disable startup sound go · go 3.0 sound at start · turn off go intro audio

## Q: What does the Using public node line on GO's unlock screen mean?

A: It tells you which node GO will use when you unlock: Using public node, Using local node, or the name of your private node. To change it, open Login settings → Node connection before you log in.

Also asked as: using public node login go · using local node go · which node go login screen · go unlock screen node · using my node name login go

## Q: Should I change my node's API key after updating GO?

A: If you used GO with an API-keyed node before v0.0.15, change the node's key once. Older builds could save the key with Q-Trade buy orders, and on mobile data a carrier proxy could see it for a node at 127.0.0.1. Current builds keep the key away from Q-Apps and proxies. Then enter the new key in GO's private node settings.

Also asked as: rotate api key go · change node api key after update · go api key q-trade saved · api key carrier proxy go · old go version api key leak

## Q: What does the eye button in GO's Settings do?

A: It turns on Privacy Mode, which blurs your name, address, private key and blocked accounts in Settings, so you can share your screen safely. Tap it again to show them.

Also asked as: privacy mode go settings · go blur address · hide name screen sharing go · eye icon settings go · go privacy blur

## Q: What does Qortal GO (this app) mean in an approval window?

A: It means the request comes from GO itself, not from a Q-App: for example when you publish a post from Home or send a picture in chat, GO asks you to confirm the fee. Check the details as you would for any approval.

Also asked as: qortal go this app approval · approval requested by go itself · go own request approval · why does go ask approval · internal app request go

## Q: Which apps does GO recommend for hotkeys?

A: The Recommended list in Select hotkeys includes Q-Tube, Torq, Q-Blog, Q-Trade and Ear-Bump. For files and mail, search for the stable Q-Share and Q-Mail and put them in a slot. Any other Q-App can be found with the search too.

Also asked as: recommended hotkeys go · curated hotkeys qortal go · go hotkey suggestions · best apps for go hotkeys · recommended apps go home

## Q: How do I use the music player on GO's Home?

A: Choose Music player in the panel above Qortino. Search EarBump for a track or artist, press play, and it drops into the player. Your node prepares the track first, so it can take a moment, longer when few peers have it.

Also asked as: music player go home · earbump player go · play music qortal go · search earbump go · go home music module

## Q: Can I add a poll when I post from GO's Home?

A: Yes. In the Post to Torq composer, tap add poll and type 2 to 6 choices of up to 80 characters; people pick one. Turn on anonymous poll to encrypt the votes: people then see anonymous votes, counts and percentages. Polls only publish on Torq, not Quitter.

Also asked as: poll from go home composer · go add poll torq · anonymous poll go · go poll choices · go composer poll

## Q: How do I switch GO's Home composer between Torq and Quitter?

A: Open the composer with Compose and use the "publish to" switch at its top. Torq is the default, and your choice also sets Home's feed, the Featured tile and the share sheet entry. Quitter takes up to 2 images and no GIFs, polls or files; posts show in both apps either way, since they share the same data.

Also asked as: torq or quitter go home · go composer quitter switch · publish to quitter from go · go home default torq · change composer app go

## Q: Does GO's Torq Feed hide the people I hid in Torq?

A: Only if you saved your Torq settings to QDN. GO reads the hidden users list that Torq's Settings → Save to QDN publishes and leaves those people out of the feed. People you hid in Torq without saving to QDN still show in GO.

Also asked as: hidden users torq feed go · go feed shows hidden people · torq save to qdn hidden go · go home feed hide user · torq hidden list go

## Q: What does the Group Activity window on GO's Home show?

A: The latest messages from your groups, right on Home. If you don't need it, turn it off in Settings → Profile → On Home.

Also asked as: group activity go home · go home group messages · latest group messages go · turn off group activity go · group activity module go

## Q: How do I make qortal.link links open in GO instead of the browser?

A: Let GO open them: in Android Settings → Apps → GO 3.0 → Open by default, turn on the Qortal links GO lists there, the qortal.link gateway and its subdomains such as hub.qortal.link, go.qortal.link and ext-node.qortal.link. GO then turns such a link into the matching qortal:// page.

Also asked as: qortal.link gateway address go · gateway links qortal go · hub.qortal.link link phone · open by default qortal go · go app links android

## Q: What do the gold stars in GO's Q-Apps library mean?

A: They mark the Featured apps: the 10 best-rated apps of Community apps and of each category, counting only apps with at least 2 votes. The stars show each app's score and how many votes it has. Official apps has its own Featured row too.

Also asked as: gold stars q-apps go · featured apps library go · top rated apps go · go library featured row · best rated q-apps phone

## Q: How do I browse Q-Apps by category in GO?

A: Open Categories in the library and tap one. Its page lists the category's apps with their own search, and a Featured row when some of them have at least 2 votes. Back returns you to where you were.

Also asked as: q-app categories go · go library categories tab · browse apps by category phone · category page go · go app categories list

## Q: How do I rename a tab or change its address in GO?

A: In the Tabs window, long-press the tab and tap Tab options; in an open folder of the Pinned tab, long-press the app. The options are Rename tab, Change qortal:// address, Restore original name, Remove from folder, and the folders you can move it to (New folder & add makes one).

Also asked as: rename tab go · change qortal address tab go · restore original name go · remove from folder go · tab options go

## Q: What is the My apps tab in GO's library?

A: It lists the apps and websites you published under your registered name, with buttons to update them or to publish a new app or website. Publishing needs a registered name and your own node, and each name can have one app and one website.

Also asked as: my apps tab qortal go · my published apps go · publish app from go · go library my apps tab · update my q-app go

## Q: Why doesn't a long press let me move a window on GO's Home?

A: Press on an empty part of the window's background and hold for a moment: buttons, links and anything else you can tap don't start a move. Once every window folds into a short strip, drag yours up or down.

Also asked as: cant move home window go · long press home not working · home reorder long press button · drag home window go · home window wont fold

## Q: Why does a button in GO's Q-Apps library say checking the node?

A: GO is asking your node right now whether it really has that app, because the node's own list can be out of date. It checks only the apps on your screen, a few at a time, so the button turns into Open or Download within moments.

Also asked as: checking the node library go · library spinner instead of open · go app status checking · open download spinner go · q-app button spinner go

## Q: Do Q-Apps keep running when GO is in the background?

A: No. Open Q-App tabs pause while GO is in the background, so they don't drain the battery, and they carry on when you come back.

Also asked as: q-apps background go · apps pause background go · go battery q-apps · q-app keeps running phone · go app paused

## Q: I got my first QORT. Why is Getting Started still showing?

A: It waits for you: once the QORT has arrived it says QORT acquired, and you press Next when you are ready to register your name. After the name and the avatar step, it says All set and the space above Qortino is yours to fill.

Also asked as: getting started still showing go · qort acquired next go · go onboarding next button · first qort arrived go home · getting started card stuck go

## Q: Can I unlock GO without internet?

A: Yes. Your fingerprint or password unlock happens on the phone, so a node that can't be reached no longer blocks it. Once in, Qortino works offline, while balances, Q-Apps and chat wait for a connection. If you are online and your private node doesn't answer, GO says its URL is invalid; fix the node or switch to the public node.

Also asked as: unlock go offline · go login no internet · qortal go airplane mode login · password unlock offline go · go no network unlock

## Q: Can a Q-App go full screen in GO?

A: Yes. A Q-App can ask GO to hide its bars and fill the screen, for example for a video or a story. Press Android back to leave full screen; it also ends when you switch to another tab.

Also asked as: q-app full screen go · hide bars in app go · exit full screen go · go app fullscreen video · full screen story go

## Q: How do I see an app's details from the Tabs window in GO?

A: Long-press the app's card in Tabs. GO shows its description, publisher, rating and qortal:// link with Copy link, and a Tab options button for renaming, changing the address or moving it to a folder.

Also asked as: tab details go · long press tab go · copy qortal link from tabs · tab options button go · app publisher in tabs go

## Q: How do I add an open tab to a folder in GO?

A: Long-press the tab in Tabs, tap Tab options and pick a folder, or New folder & add to make one. In the library, the pin icon puts an app in the Library folder.

Also asked as: add tab to folder go · move tab into folder go · new folder and add go · save open app to folder · folder for open tab go

## Q: Why does Tabs show one card for several windows of the same app?

A: When an app is open in more than one window, Tabs groups them into one card with a small avatar for each window underneath. Tap an avatar to show that window's picture, tap the card to switch to it; × closes only the window shown.

Also asked as: same app windows one card go · small avatars under tab card · go tabs stacked windows · several windows one app go · window avatars tabs go

## Q: Can I open the same Q-App twice in GO?

A: Yes. Tapping an app's icon in a Pinned or Tabs folder opens it again in a new window, even when it is already open. Its card in Tabs still switches to the window that is open.

Also asked as: open app twice go · two windows same app go · new window q-app go · duplicate tab go · open again in new window

## Q: Are the page pictures in GO's Tabs saved anywhere?

A: No. GO takes the picture for each Tabs card itself and keeps it in memory only; it is never written to storage. No picture is taken while a protected screen, such as an approval or your seed phrase, is showing.

Also asked as: tabs screenshots stored go · tab pictures privacy go · go tab preview images · does go save screenshots of apps · tab card picture memory

## Q: What does edit mode in GO's Tabs window do?

A: Tap the edit button in Tabs to arrange things: drag apps onto folders, tap × to take an app out, or drag folders to reorder them. Inside a folder, drag apps to reorder them or tap × to remove them. Tap the button again when you are done.

Also asked as: edit tabs go · edit folders tabs window · rearrange tabs go · done editing tabs go · drag apps onto folders go

## Q: What happens when I delete a folder in GO?

A: GO asks first. Deleting removes the folder and the apps saved in it from Tabs and the Pinned tab; tabs that are open stay open.

Also asked as: delete folder qortal go · remove folder tabs go · go folder deleted apps · delete pinned folder go · folder delete confirm go

## Q: What happens when I tap a widget while arranging the widgets screen?

A: It opens the widget's menu: Open <app> opens the full Q-App in Apps, Reload reloads the widget, and Remove takes it off the screen. Outside arranging, a tap goes to the widget itself.

Also asked as: widget menu go · open widget app go · reload widget go · tap widget arranging · widget options go

## Q: Where do GO widgets come from?

A: Anyone can publish one: a widget is a Q-App published as an APP with the tag go-widget, or with an identifier starting with go-widget. GO lists every such app from QDN in Add a widget, and nothing runs until you add it.

Also asked as: who makes go widgets · go-widget tag · widget authors qortal go · widget q-apps qdn · go widget identifier

## Q: Why don't sideways swipes reach my GO widget?

A: Sideways swipes belong to GO: they move between the widgets screen, Home, Apps and Chat. A long press belongs to GO too, and picks the widget up to arrange it. Taps, typing and scrolling up and down go to the widget.

Also asked as: swipe inside widget go · widget carousel go · long press widget go · widget touches go · swipe widgets screen

## Q: Why does a widget reload when I come back to the widgets screen?

A: To save battery and memory, GO loads widgets the first time you open the widgets screen and unloads them about 3 minutes after you last saw it. They load again when you come back.

Also asked as: widgets unload after 3 minutes · widgets restart go · widget unloaded after minutes · go widget battery · widget starts again go

## Q: How does the floating button in Manual immersive mode work?

A: Tap it to bring the bars back for about 4 seconds; using the bars keeps them out longer, and a tap on the content puts them away. Drag the button along either edge to move it out of the way. It fades when left alone and shows a dot for new chats or bell items.

Also asked as: immersive floating button · show bars button go · immersive pill go · move floating button go · dot on floating button go

## Q: Why does the strip around the camera change colour in GO?

A: With immersive mode on, GO paints the strip around the camera in the page's own background colour, so it blends into each Q-App or website. When a photo or video fills the width, it takes the colour right under the strip, or black, never a colour from the picture.

Also asked as: camera strip colour go · top strip colour immersive · go notch colour · status area colour q-app · go top edge colour

## Q: Does immersive mode cover parts of a Q-App?

A: No. Q-Apps and websites are resized to fit, once per change, and never sit under a bar. Content also stays clear of the camera cut-out.

Also asked as: immersive covers app go · q-app resized immersive · bars over app content go · immersive mode layout go · camera cutout q-app go

## Q: Why does Qortino refuse some questions?

A: Qortino won't help with weapons, explosives, poisons or hurting people, or with anything that targets children. It declines in one sentence and offers a safe alternative instead.

Also asked as: qortino refuses · qortino wont answer · qortino declined question · qortino limits · qortino safety rules

## Q: What does Reduce UI Animations do in GO?

A: Settings → System → Reduce UI Animations cuts down motion throughout GO; leave it off for the normal animated look. On Home, the eye button on Featured Q-Apps stops just its moving previews.

Also asked as: reduce animations go · less motion qortal go · turn off animations go · go motion setting · reduce ui animations

## Q: Why does a GO widget ask to see my account?

A: Some widgets show your own data, so they may ask for your account or your balance the way any Q-App does, and GO asks you first. Widgets may only ask while the widgets screen is showing, and you can decline.

Also asked as: widget asks for account go · widget wants my balance · widget asks my address · widget approval go · decline widget request

## Q: Why does GO's top bar look see-through in some Q-Apps?

A: With immersive mode on, the top bar takes the Q-App's own background colour while it shows, so the search field, Tabs and your avatar float on the app. On a light page the controls switch so they stay readable.

Also asked as: top bar transparent q-app go · see-through top bar go · top bar colour q-app · go bar takes app colour · immersive top bar light page

## Q: Does GO write my data to Android's system log?

A: No. Published GO builds are release builds: debug tools can't attach to GO, and it doesn't write debug data to the phone's system log. A problem report only leaves the phone when you copy or save it yourself.

Also asked as: go system log privacy · go debug build · debug tools attach go · logcat qortal go · is go apk debuggable

## Q: Why doesn't GO's Settings have Developer, Help and Reticulum tabs?

A: Those tabs hold desktop Hub options that did nothing on a phone, so GO hides them and keeps Profile, Security, Blocked and System. GO's own phone options, Dev Mode included, are in System.

Also asked as: go settings missing tabs · developer tab go · reticulum tab missing go · help tab qortal go · desktop settings not in go

## Q: Does GO follow my phone's language?

A: No. GO starts in English and then keeps the language you pick in Core & settings or on the Enter Qortal screen, whatever your phone is set to.

Also asked as: go phone language · go starts in english · go system language · go language reset english · qortal go auto language

## Q: What do New, Installed and Older mean in GO 3.0 Updates?

A: In Versions on QDN, Installed marks the build on your phone, New a newer build you can install, and Older a build you can only open in Q-Share. If some versions could not be loaded yet, GO could not fetch their details from QDN; check again later.

Also asked as: go updates badges · installed badge go updates · older version badge go · versions on qdn badges · some versions could not be loaded

## Q: How do I open a post or load new posts in GO's Torq Feed?

A: Tap a post to open it in Torq. When newer posts arrive, the feed shows a button such as "3 new posts"; tap it to put them at the top. Show more opens up a long post right in the feed.

Also asked as: open post from go home feed · new posts button go feed · torq feed tap post go · load new posts go home · go feed show more

## Q: Are my tabs, folders and hotkeys separate for each account in GO?

A: Yes. Tabs folders, hotkeys and the open tabs GO brings back after a restart are kept for each account on this phone, so another account shows its own set. The Home order and screen options such as bottom buttons, immersive mode and widgets apply to the whole phone.

Also asked as: tabs per account go · folders per account qortal go · hotkeys per account go · switch account tabs go · go settings per phone

## Q: Do GO widgets follow my theme and language?

A: GO tells each widget its dark or light theme and its language, and tells it again when you change them, so widgets made for GO can follow along. How a widget looks beyond that is up to its maker.

Also asked as: widget dark mode go · widget language go · widgets light theme · go widget theme change · widget follows go settings

## Q: Does GO have widgets for my Android home screen?

A: No. GO's widgets live on its own widgets screen inside GO: swipe right from Home to reach them.

Also asked as: android home screen widget go · launcher widget qortal go · go widget on phone home screen · qortal widget android · go widgets outside app

## Q: Why are Qortino's answers usually short?

A: By design: Qortino keeps everyday answers short and gives step-by-step detail for health, safety and survival, or when you ask for it. Ask for more detail and it explains further. It uses metric units, numbered steps for instructions and bullets for lists.

Also asked as: qortino short answers · qortino longer answer · qortino more detail · qortino metric units · qortino step by step

## Q: Does GO have a guided tour like Qortal Hub?

A: No. The Hub tutorial is only available on desktop. In GO, new accounts get the Getting Started steps on Home instead: get your first 2 QORT, register your name and load your avatar.

Also asked as: go tutorial · hub tutorial on phone · go guided tour · learn go app · go intro walkthrough

## Q: How do I open QortalLand in GO?

A: Tap QortalLand in Quick tools on Home. QortalLand is Q-Chat's shared social space, where you meet other members, use moods and proximity voice, and challenge people to Chess, Checkers or Qonnect Four.

Also asked as: qortalland go · open qortal land phone · qortalland quick tools · go games chess checkers · qortal land on go

## Q: How can I check that Qortino's model is genuine?

A: Qortino's model is Qwen3 4B Instruct 2507 (Apache-2.0 licence), built straight from the official Qwen weights with nothing added and published with Q-Share under the name Qortino AI. It comes in 2 parts because QDN takes at most 2 GB per file. GO checks each part's SHA-256 checksum after download and deletes a part that doesn't match, and anyone can rebuild the parts and compare the checksums.

Also asked as: qortino model checksum · qortino sha256 · verify qortino download · where does qortino model come from · qortino model license

## Q: How do I copy or stop a Qortino answer?

A: While Qortino writes, the send button becomes Stop: tap it to end the answer. Under a finished answer, the copy button copies the whole answer. If an answer was cut short, Continue answer lets Qortino carry on.

Also asked as: copy qortino answer · stop qortino · qortino stop button · qortino copy full answer · cancel qortino reply

## Q: What are the links and app cards under some Qortino answers?

A: For Qortal questions, Qortino adds Qortal links and app cards under the answer, each showing the service and who published it, with an Open button that starts that Q-App or website in GO. Answers on other topics don't get them.

Also asked as: qortino app cards · qortino qortal links · open button qortino answer · qortino suggests app · qortino published as

## Q: What happens when I report a Qortino answer?

A: The Teach Qortino window asks what went wrong and how Qortino should answer next time. GO then sends your note, with the question and the answer, as a private Q-Mail to the name Qortino AI (subject "Teaching Qortino AI"). That is a QDN publish, so it costs a small fee and needs your own node. The reports help improve the answers Qortino ships with.

Also asked as: teach qortino · report qortino answer q-mail · qortino report fee · qortino feedback mail · teaching qortino ai

## Q: Is Qortino available in my language?

A: Qortino's buttons and messages follow GO's language, in all 12 of GO's languages. Its ready-made answers to common Qortal questions are written in English.

Also asked as: qortino language · qortino in spanish · qortino translated · qortino other languages · ask qortino in my language

## Q: Does Qortino remember what I said earlier in a chat?

A: Yes, within the same chat: follow-up questions use the conversation so far. In a long chat it drops the oldest turns to make room. Start a New chat from the history button for a fresh topic.

Also asked as: qortino remembers chat · qortino follow up question · qortino context · qortino forgets · qortino long chat

## Q: Does Qortino cost anything?

A: No. Assembling the model and asking questions are free, with nothing charged per question. The only fee is the small QDN publish fee if you send a report about an answer.

Also asked as: qortino free · qortino price · qortino subscription · pay for qortino · qortino fee

## Q: What does Reading your question mean in Qortino?

A: Before it writes, Qortino reads your question and the chat so far, and shows how far it has got in percent. A long first question or a long chat takes longest; later questions start faster because it reuses what it already read.

Also asked as: qortino reading your question · qortino getting ready · qortino percent before answer · qortino slow to begin answer · qortino thinking

## Q: What does Fully operational mean in GO's Status window?

A: It means GO reaches your node and the node is synced. Not operational means the node isn't answering or is still syncing; the line below shows how far it has synced, or Node unavailable. Peers counts the node's connections, QDN its data peers, and Node Height its latest block.

Also asked as: fully operational go status · not operational go home · node unavailable status window · synced percent go home · go status peers qdn

## Q: Why does GO show Unnamed account in my account list?

A: The account has no registered name yet, and you haven't given it a label. On the Enter Qortal screen, open it and tap the edit button: in Account details you can give it a name and a note to tell it apart in the list.

Also asked as: unnamed account go · account without name go · name my account in go list · go account label · account details name note

## Q: Why does Select hotkeys say Q-Apps unavailable?

A: GO could not load the list of Q-Apps from your node just then. Check the node connection (the dot on the Qortal logo) and open Select hotkeys again. "No Q-Apps match yet" only means your search found nothing; try another app name.

Also asked as: q-apps unavailable hotkeys · unable to load q-apps right now · hotkey list empty go · select hotkeys error go · no q-apps match yet

## Q: Why won't a track play in GO's Home music player?

A: Tracks play from QDN, so your node first gathers the track from peers. "No peers for remaining data" means no peer is sending the rest right now; try again later or pick another track. If playback stalls, press play to retry, and GO rebuilds the stream by itself when a track stalls.

Also asked as: music player no peers · earbump track wont play go · track stalled go home · no peers for remaining data · music player stuck preparing

## Q: Why does GO's Torq Feed say Feed load failed?

A: GO could not load the posts from your node in time. Tap Try Again, or Return to General for the public feed. The Following feed needs a registered name and accounts you follow, so it can stay empty while the General feed works.

Also asked as: feed load failed go · torq feed not loading go · following feed unavailable go · return to general feed · go home feed error
