# qortal-security — golden FAQ

Curated offline Q&A for Qortino (139 entries). Prefer these answers when relevant.

## Q: What is a private key?

A: A private key is the secret that controls your Qortal account. It is made from your seedphrase, and it signs (approves) everything your account does: payments, name registrations, publishes and messages. Anyone who has it can do all of that as you, so never share it with anyone. GO and Hub keep it encrypted on your device with your wallet password and sign on the device, so your Qortal private key is never sent to the node.

Also asked as: what is private key · private key meaning · explain private key · what is a qortal private key · private key explained · what does a private key do · whats a private key · what's my private key

## Q: What is the difference between a private key and a public key?

A: They are a matched pair. The private key is secret: it signs for your account, and whoever holds it controls the account. The public key is made from it and is meant to be shared: the network uses it to check your signatures, and others use it to encrypt messages that only your private key can open. Your address is a shorter code made from the public key. Share the public key and address freely; never share the private key or the seedphrase.

Also asked as: private key vs public key · public key vs private key · difference between public and private key · private and public key explained · public private key pair qortal

## Q: Why must I never share my private key?

A: Whoever has your private key controls your account. They can send all your QORT, sell or change your names, publish and chat as you, and read messages that were encrypted for you. The network only checks the signature, so nobody can stop them, and a payment they send cannot be undone. No real helper, admin or Q-App ever needs your private key.

Also asked as: never share private key · should i share my private key · can i give someone my private key · is it safe to share my private key · support wants my private key

## Q: What should I do if someone saw my seedphrase or private key?

A: Act as if they can take everything, and be quick:
1. Create a new account and save its backup file and seedphrase.
2. Send your QORT from the old account to the new address.
3. Move coins in the built-in LTC, BTC and other wallets too: they come from the same seed.
4. Stop using the old account.
Nobody can freeze or reverse a payment once a thief has sent it.

Also asked as: seedphrase leaked · private key leaked · someone saw my seed phrase · i shared my seedphrase · seed phrase compromised · gave away my private key · typed my seedphrase into a website · entered seed phrase on a fake site

## Q: Can a Q-App read my seedphrase or private key?

A: No. Q-Apps cannot read your seedphrase, private key or wallet password. They can only ask GO or Hub to do something for you, such as send coins or publish, and the approval window shows you the request first. The real risk is approving the wrong thing, so read each request before you accept. One thing to know: an app that uses your ARRR wallet makes GO send the ARRR seed to the node, and GO warns you before it does.

Also asked as: q-app steal private key · can apps see my seedphrase · q-app access my keys · do q-apps get my private key · can a qortal app take my wallet · can i trust a q-app · are q-apps safe

## Q: What is a seedphrase?

A: A seedphrase is the list of 14 random words GO shows while it creates your account. GO turns those words into your private key, so the words alone can restore the account, with its QORT, names and built-in coin wallets, on any device. That makes them worth as much as the account: write them on paper, keep them offline, and never share them. Some guides call them the recovery phrase or Secret Key phrases.

Also asked as: what is seed phrase · seedphrase meaning · what is a recovery phrase · secret key phrases · explain seed phrase · what is my seedphrase for

## Q: Can I see my seedphrase again later in GO?

A: No. GO shows the seedphrase only while it creates the account, and it never stores the words. The account saved on your phone and your backup file hold an encrypted key, not the phrase. If you did not write the words down, your backup file with its password is your way back. GO can still show your private key (Settings, Security), but it cannot show the words.

Also asked as: show seedphrase again · view my seed phrase later · where is my seedphrase in go · export seedphrase later · does go store my seedphrase · find my seed phrase · see my seed phrase again

## Q: I did not save my seedphrase. What should I do?

A: You are fine as long as you have your backup file and its password: together they restore the account. Keep at least two copies of the file, apart from the password. If you also have no backup file, or are not sure of the password, make a new account now, back it up properly, and move your QORT to it while you can still unlock the old one.

Also asked as: did not write down seedphrase · never saved my seed phrase · skipped the seedphrase · forgot to write seed phrase · lost seedphrase but have backup file · restore without my seedphrase · lost my seed phrase

## Q: What is the difference between my seedphrase, backup file and password?

A: Seedphrase: 14 words that restore your account on their own.
Backup file: an encrypted copy of your account key (a .json file) that restores it together with its password.
Wallet password: locks the account saved on your device and the backup file; on its own it restores nothing.
So you need the seedphrase, or the backup file and its password. Lose both and nobody can bring the account back.

Also asked as: seedphrase vs backup file · backup file vs password · seed phrase backup file password difference · what restores my qortal account · seedphrase backup password explained

## Q: What happens if I type my seedphrase wrong when restoring?

A: GO cannot tell a wrong seedphrase from a right one: every phrase opens some account. One wrong word, letter or space gives you a different, empty account, with no warning. So after restoring, check that the address matches your old one. If it does not, remove that account and type the phrase again, carefully.

Also asked as: mistyped seedphrase · wrong seed phrase restore · restored account is empty · different address after restore · seedphrase typo · restore shows zero balance

## Q: Should I give Qortino my seedphrase or private key?

A: No. Never type your seedphrase, private key or wallet password into any chat, Qortino included. Qortino does not need them and cannot unlock or recover accounts. To restore an account, use Import account on the Enter Qortal screen.

Also asked as: tell qortino my seedphrase · qortino private key · can qortino recover my account · type seedphrase into qortino · qortino restore wallet

## Q: What is a Qortal backup file?

A: It is a small .json file, named qortal_backup_ followed by your address, that holds your account key encrypted with a password. With the file and that password you can restore the account on any device, in GO or Hub. GO saves it in your phone's Documents folder, under Qortal Go. The file never changes as you use the account, so one good copy keeps working; keep it private, and keep the password somewhere else.

Also asked as: what is a backup file · qortal backup file meaning · wallet backup file explained · qortal_backup json file · what is my wallet file · account backup file

## Q: Is my backup file safe if someone gets it?

A: It is encrypted with your wallet password, so the file alone does not open the account. But whoever has it can keep trying passwords on their own computer for as long as they like, so a long password you use nowhere else is what really protects it. Never send the file to anyone. If it leaked and your password is weak, move your QORT to a new account.

Also asked as: someone has my backup file · backup file stolen · is my backup file encrypted · can someone open my backup file · backup file leaked · is my backup file safe

## Q: Can I open my backup file without its password?

A: No. A backup file opens only with the exact password it was saved with, and nobody can reset or get around it. If you lost that password, your seedphrase is the other way back: Import account, Seedphrase, and choose a new password. With neither, the account cannot be recovered.

Also asked as: backup file without password · forgot my backup file password · lost backup password · open wallet file without password · reset backup file password

## Q: What should I do if I lose my phone or it is stolen?

A: Your account is not on the phone alone; it lives on the Qortal network.
1. Restore it on another device with your seedphrase, or your backup file and its password.
2. If someone could get into GO on the lost phone (a weak or known password, or their fingerprint saved on it), create a new account at once and move your QORT and coin balances to it.

Also asked as: lost my phone · phone stolen qortal · lost phone with go on it · stolen phone wallet · phone lost what about my qort · my phone broke

## Q: What should I check before I accept a Q-App request?

A: 1. Who is asking: Requested by shows the app's icon and name. It should be the app you are using right now.
2. What it wants: the question at the top, such as allow this app to send coins?
3. The details: recipient (name and full address), amount, coin, and every fee line, including any App fee.
4. Whether you started it: decline any request you did not ask for.
Declining is always safe; an accepted payment cannot be undone.

Also asked as: check before accepting a q-app request · is this approval safe · q-app approval window what to check · should i accept this q-app request · before tapping accept qortal · approval window safety tips

## Q: What does "allow this app to authenticate?" mean?

A: The app is asking who you are. If you accept, it learns your Qortal address and public key, and while that tab stays open it may also read your wallet addresses, balances and transactions without asking again. It does not get your private key or seedphrase. Sending coins and publishing still need their own approval.

Also asked as: allow this app to authenticate · q-app authenticate request · what happens when i authenticate a q-app · should i authenticate this app · can a q-app see my balance · authenticate meaning

## Q: Someone asked for my backup file or wallet password. Is that a scam?

A: Yes. Nobody needs your backup file or password to help you, and nobody from Qortal will ever ask. With the file and the password they can take everything in the account. Real help is given with words; never send the file, the password, your seedphrase or your private key.

Also asked as: someone wants my backup file · asked for my wallet password · send me your backup file · helper wants my password · share backup file with support

## Q: Someone sent me a link to verify or sync my wallet. Is it safe?

A: No, it is a phishing trick. Your wallet never needs verifying or syncing through a website, and no real page needs your seedphrase, private key, backup file or password. Type them only into GO's own Import account screen, when you restore an account yourself. Free QORT or airdrop links that ask for them are the same trick.

Also asked as: verify my wallet link · sync wallet link scam · connect wallet website qortal · validate my qortal wallet · claim free qort link · phishing link qortal · qortal phishing

## Q: Someone sent me an APK file in chat. Should I install it?

A: No. GO never opens or installs an app package it receives or downloads, and you should not install one from a stranger either: it could be anything, including a fake GO made to steal your seedphrase. Update GO only through GO 3.0 Updates, which installs only builds signed with GO's own key.

Also asked as: apk file in chat · install apk from a message · someone sent me an app file · update go from a link · apk from a stranger · should i install this apk

## Q: What are the warning signs of a Qortal scam?

A: Stop and check when someone:
- asks for your seedphrase, private key, backup file or password;
- messages you first, claiming to be support, an admin or a developer;
- rushes you, or promises to multiply your QORT;
- sends a link to verify your wallet, or an APK to install;
- asks you to approve a request you did not start.
Any one of these is reason to stop and ask in a public Qortal group.

Also asked as: signs of a qortal scam · how to spot a scam on qortal · scam warning signs qortal · common qortal scams · is this a scam

## Q: Who can read my direct messages in GO?

A: Only you and the person you are writing to. In GO and Hub 3.0, direct messages travel over Reticulum, encrypted between your devices, and they are not written to the blockchain. Qortal developers, node operators and the hubs that pass traffic along cannot read them. The messages are kept on the devices in the conversation, so keep your phone locked.

Also asked as: who can read my dms · are dms encrypted in go · can qortal developers read my messages · private messages encrypted qortal · can the node read my messages · direct message privacy · can a group admin read my dms · who can read my messages

## Q: Can anyone read the messages in a public group?

A: Yes. Anyone can join an open (public) group and read what is posted there, so treat it like speaking in a public square. Closed groups, shown with a lock in Find groups, only let in members an admin accepts, and their chat is for members. Never post private details, or anything about your seedphrase or backup, in a public group.

Also asked as: public group messages visible · who can read public group chat · is group chat private · open group privacy · can strangers read my group messages

## Q: Is it safe to use GO on the public node?

A: For everyday use, yes. GO signs on your phone and sends the public node only the signed transaction, so the node never gets your Qortal private key and cannot move your QORT. GO also refuses to send it any foreign coin's private key. The trade-off is that someone else runs it: it sees what your phone asks for, decides what it blocks, and some things need your own node.

Also asked as: public node safe · is the public node safe to use · can the public node steal my qort · public node security · trust the public node

## Q: What should I do right after I create my account?

A: 1. Save the backup file and copy it off the phone, for example to a USB stick.
2. Write the 14-word seedphrase on paper and keep it offline.
3. Keep your wallet password somewhere safe, apart from the file.
4. Write down your address, so you can check a restore later.
5. Turn on fingerprint unlock if you like, and leave Auto-Lock When Idle on.
Do this before you receive QORT or register a name.

Also asked as: after creating my qortal account · new account security steps · first steps after creating a wallet · secure my new account · just created my account what now

## Q: What should I do if I think my account was hacked?

A: 1. Open Wallet Activity on Home, Transaction history, and see where the QORT went and when.
2. Think whether you accepted a payment in a Q-App: accepted approvals go through.
3. Check you are in the right account: a mistyped seedphrase opens a different, empty one.
4. If you did not send it, assume your seedphrase, private key or backup file and password leaked: create a new account, back it up and move what is left at once.
Nobody can reverse a sent payment.

Also asked as: account hacked qortal · my qort is gone · qort disappeared from my wallet · someone stole my qort · unknown payment from my account · i think i was hacked

## Q: What if I lose my backup file?

A: 1. If you have your seedphrase, you are fine: it restores the account on its own.
2. If the account is still saved in GO or Hub and you know its password, save a fresh backup now: Home, Quick tools, Backup Wallet.
3. If neither is true, the account cannot be recovered, and nobody can do it for you.

Also asked as: lost my backup file · backup file deleted · lost my wallet file · backup file gone what now · no backup file anymore

## Q: I forgot my wallet password. What can I do?

A: Nobody can reset it, but you may still get back in:
- With your seedphrase: on the account's unlock screen tap the pencil (Account details), Remove, then Import account, Seedphrase, and choose a new password. Do this only with your seedphrase written down and checked.
- With a backup file: it opens only with the password it was saved with, so try each one you might have used.
- With fingerprint unlock on: GO may still open, but sending QORT and Backup Wallet need the typed password.
Without the seedphrase or a working password, the account is lost.

Also asked as: forgot my password · forgot wallet password · lost my wallet password · cant remember my password go · forgot qortal password · password forgotten qortal

## Q: Why do Q-Apps keep asking me to approve things?

A: Because a Q-App cannot use your account on its own. Whenever it wants to do something as you, such as pay, publish, post a chat message or read your wallet, GO or Hub shows an approval window and waits for your Accept. That is your protection: read each one, accept what you started, and decline anything you did not expect.

Also asked as: why do q-apps ask for approval · q-app approval popups · why must i accept q-app requests · approval window keeps popping up · what is a q-app approval window

## Q: Where do I find my private key in GO?

A: On Home, tap the gear on the Account Overview card to open Settings, then the Security tab. Enter your wallet password and tap Decrypt: the key appears, and Copy key copies it. GO blocks screenshots on this screen and drops the key again when you close Settings or GO locks. Only open it when you really need it, with nobody watching and no screen sharing on.

Also asked as: show my private key go · reveal private key · see my private key · where is my private key · copy private key qortal go · decrypt private key go · get my private key · export my private key

## Q: Where can I see my public key?

A: Open Address book from your avatar menu; it opens User search. Search your own name or address and it shows the account's address and public key. You can look up anyone else's public key the same way. Both are public, so showing them is safe.

Also asked as: find my public key · show my public key · public key in go · look up a public key · copy my public key

## Q: Is my private key the same as my seedphrase?

A: No. Your seedphrase is a list of words, and GO turns it into your private key, a long string of letters and numbers. Both control the same account, so both must stay secret. To restore an account in GO or Hub you use the seedphrase or a backup file, not the private key.

Also asked as: private key vs seedphrase · seed phrase and private key difference · is seedphrase my private key · seedphrase private key same thing

## Q: Can I restore my account from a private key in GO?

A: No. GO and Hub add an existing account in three ways: Seedphrase, Backup file, or Authenticate now (a backup file used without saving it). There is no field for a private key. Keep your seedphrase, or your backup file and its password, safe: those are what bring the account back.

Also asked as: import private key go · restore with private key · log in with private key · add account with private key · private key import hub

## Q: Can I change my private key or seedphrase?

A: No. Your address is made from your keys, and your keys come from your seed, so an account can never get a different private key or seedphrase. If either may have leaked, the fix is a new account: create one, back it up, and move your QORT to it. A new wallet password only changes the lock on the copy saved on your device, not the key itself.

Also asked as: change private key · change my seedphrase · new seed phrase same account · reset my private key · rotate private key qortal · private key leaked can i change it · change my seed phrase

## Q: Is it safe to use a node that someone else runs?

A: For QORT it is fairly safe: GO signs on your phone, so that node never gets your Qortal private key and cannot move your QORT. But it sees what your phone asks it for, and it decides what it blocks. Coins are different: sending or trading LTC, BTC, DOGE, DGB, RVN or ARRR hands that coin's private key to the node, and whoever runs it could keep it and spend those coins. GO asks you to tick that you run the node yourself, so only tick it for a node you really do run.

Also asked as: someone else's node · use a friend's node · node given to me by a stranger · trust another person's qortal node · custom node run by someone else

## Q: Why won't GO send LTC or other coins on the public node?

A: Sending a foreign coin means handing that coin's private key to the node, and a key must never go to a shared public node. So GO stops with "Blocked: ... is a public Qortal node" and nothing is sent. Connect GO to a node you run yourself to send LTC, BTC, DOGE, DGB, RVN or ARRR.

Also asked as: cannot send ltc on public node · blocked is a public qortal node · send btc public node blocked · foreign coin blocked public node · non-qort coin through the gateway

## Q: Do my LTC, BTC and other coin wallets in GO need their own backup?

A: No. GO makes the built-in BTC, LTC, DOGE, DGB, RVN and ARRR wallets from your Qortal seed, so your seedphrase or backup file restores them too. It also means that anyone with your seedphrase, or your backup file and its password, can take those coins as well, so guard them just as carefully.

Also asked as: backup litecoin wallet go · ltc wallet seedphrase · restore btc wallet qortal · foreign coin wallet backup · separate backup for ltc wallet

## Q: What does signing a transaction mean?

A: Signing is how your account says yes. GO uses your private key to make a signature for one exact action, such as a payment, and the network checks it with your public key. The signature fits only that action and does not reveal your private key, so it cannot be turned into a different payment.

Also asked as: sign transaction meaning · what is a signature on qortal · signed transaction explained · what does signing do qortal · digital signature qortal

## Q: How many words is a Qortal seedphrase?

A: An account made in GO or Hub gets 14 words. Write all 14 in order, exactly as shown. When you restore, GO uses the phrase exactly as typed, so a missing, extra or misspelt word opens a different account.

Also asked as: how many words seed phrase · seedphrase word count · 14 word recovery phrase · how long is a qortal seedphrase · number of words in seedphrase

## Q: Is saving my seedphrase optional?

A: GO calls it optional and recommends the encrypted backup file as the main way back. Each one restores your account: the seedphrase on its own, or the backup file together with its password. Keeping both is safest, because if one is lost the other still works.

Also asked as: seedphrase required or optional · seedphrase optional · is seed phrase required · should i save my seedphrase · skip saving seedphrase

## Q: What does the Export button on the seedphrase screen do?

A: It saves your seedphrase as a plain text file, qortal_seedphrase.txt, in the Qortal Go folder in your phone's Documents. That file is not encrypted: anyone or any app that can read your files can read your seedphrase. If you use it, copy the words to paper, then delete the file from the phone.

Also asked as: export seedphrase file · qortal_seedphrase.txt · seedphrase text file · is the seedphrase export encrypted · seed phrase export button

## Q: How do I check that I restored the right account?

A: Compare the address: it starts with Q and never changes for an account. Check it against a note you kept, a payment you made, or the name of your backup file, which ends with your address (qortal_backup_<address>.json). Your registered name and balance showing up again is a good sign too.

Also asked as: verify restored account · check address after restore · is this my old account · confirm right qortal account · restored account address check

## Q: Do capital letters and spaces matter in my seedphrase?

A: Yes. GO uses the phrase exactly as you type it, so every letter, capital and space inside it counts. Spaces before the first word or after the last are ignored. Type the words in order with one space between them, exactly as you wrote them down.

Also asked as: seedphrase case sensitive · spaces in seed phrase · seedphrase capital letters · extra space in seedphrase · seed phrase spelling matters

## Q: Can I keep my seedphrase in email or cloud notes?

A: No. Email, cloud notes and synced files can be read by anyone who gets into that account or service, and your seedphrase is all a thief needs. Write it by hand on paper, keep it offline in a safe place, and think about a second copy somewhere else.

Also asked as: seedphrase in email · seed phrase in cloud notes · store seedphrase online · save seedphrase in google drive · seedphrase in notes app

## Q: When does GO ask for my seedphrase?

A: Only when you choose Import account, then Seedphrase, to add an account yourself. GO never needs it to unlock, to approve a Q-App request or to fix a problem. If a Q-App, website, message or person asks you to type your seedphrase, it is an attempt to steal your account: close it.

Also asked as: go asks for my seedphrase · where do i enter my seedphrase · q-app wants my seedphrase · website asks for seedphrase · app asking for seed phrase

## Q: Does my seedphrase work in both GO and Hub?

A: Yes. A Qortal seedphrase opens the same account in GO, in Hub and on any other device. The account lives on the Qortal network, not in one app; each app only saves its own locked copy. A backup file works the same way: it opens in GO or Hub.

Also asked as: seedphrase in hub and go · use seed phrase on desktop hub · same seedphrase on another device · backup file works in hub and go

## Q: Why won't GO let me in until I save the backup?

A: When you create an account, GO keeps Enter GO greyed out until you tap Backup wallet and the file is saved. It makes sure you leave with a way back in, because nobody can restore the account for you later. Once it is saved, Enter GO turns on, and Download another copy saves a second one.

Also asked as: enter go button greyed out · must back up before entering go · cant tap enter go · back up your encrypted wallet before entering go · enter go disabled after creating account

## Q: Where should I keep my backup file?

A: In more than one place, and not only on the device that holds the account. USB sticks kept offline are a good choice, and since the file is encrypted, a trusted family member can keep a copy for you. Store the password separately from the file, never in the same place.

Also asked as: store backup file safely · best place for my backup file · backup file on usb stick · keep wallet backup offline · how to store my backup file

## Q: Can I keep my backup file in email or cloud storage?

A: You can, because it is encrypted, and the Qortal wiki even mentions emailing it to yourself. The catch: anyone who gets into that email or cloud account can then try to guess your password at leisure. If you do it, use a long, unique password and never store the password there too. Offline copies on USB sticks are safer.

Also asked as: backup file in email · backup file in google drive · store wallet backup in the cloud · email backup file to myself · backup file online storage

## Q: Do I need a new backup after I receive QORT or register a name?

A: No. Your balance, names and history live on the blockchain, not in the file. The backup holds only your encrypted account key, which never changes, so an old backup still restores everything. You only need a new one if you want it locked with a different password.

Also asked as: update backup after receiving qort · backup again after registering a name · does my backup file change · backup file out of date · new backup after transactions

## Q: Does my backup file include my chats, settings or Tabs?

A: No. The file holds only your account key. Everything on the blockchain, such as your QORT and names, comes back with it. Things GO keeps only on the phone, such as Tabs folders and most settings, are not in the file.

Also asked as: backup file include chats · backup my go settings · backup tabs folders · does backup save my messages · what is not in the backup file

## Q: How do I change my wallet password in GO?

A: There is no change-password button, but you can do it like this:
1. On Home, open Quick tools, Backup Wallet. Enter the current password, untick keeping the current password, set the new one and save the file.
2. Check the new file is in Documents, Qortal Go.
3. Remove the account (pencil on its unlock screen, Account details, Remove).
4. Import account, Backup file: pick the new file and unlock with the new password.
Turn fingerprint unlock on again after. Older backup files keep the old password.

Also asked as: change wallet password go · new password for my account · update my qortal password · set a new wallet password · change go password

## Q: Is my wallet password the same on every device?

A: Not necessarily. The password locks each saved copy, not the account itself. When you restore from your seedphrase you choose a new one; when you import a backup file, the account keeps that file's password. So your phone and your computer can use different passwords for the same account, while its keys are the same on both.

Also asked as: same password on every device · different password in hub and go · password on my new phone · wallet password per device

## Q: How strong should my wallet password be?

A: GO sets no minimum length, so it is up to you. The password is what protects your backup file if someone ever copies it, so make it long (a few unrelated words works well) and don't use it for anything else. Write it down and keep it apart from the backup file.

Also asked as: strong wallet password · minimum password length go · good password for qortal · wallet password requirements · how long should my wallet password be

## Q: Can I send QORT with my fingerprint instead of my password?

A: No. Send QORT asks for your wallet password every time, even with fingerprint unlock on. GO then shows the amount, the recipient's name with the full address, and the fee, and sends only after you confirm. Payments a Q-App asks for are confirmed in its approval window instead, which is one more reason to lock GO when you put the phone down.

Also asked as: send qort with fingerprint · fingerprint for payments go · why password to send qort · send qort asks for my password · confirm wallet password payment

## Q: Is fingerprint unlock a backup of my account?

A: No. It only saves you typing the password on this phone. If the phone is lost or reset, or GO is uninstalled, it is gone, and you need your seedphrase or backup file again. If you forget the password, fingerprint unlock may still open GO on that phone, but Send QORT, Backup Wallet and showing your private key all ask for the typed password.

Also asked as: fingerprint unlock as backup · fingerprint instead of seedphrase · do i still need my password with fingerprint · forgot password but fingerprint works · fingerprint replaces password

## Q: Can someone else's fingerprint unlock my GO?

A: Yes, if it is saved on the phone. GO uses Android's own fingerprint check, which accepts any fingerprint (or other biometric) enrolled in the phone's settings. So turn on fingerprint unlock only if every fingerprint saved on the phone is yours; otherwise use your wallet password.

Also asked as: other person fingerprint unlock go · family fingerprint opens go · whose fingerprint works in go · any fingerprint unlocks my wallet · fingerprint added by someone else

## Q: Can a thief get into GO on my phone?

A: Not easily. The account saved on the phone is encrypted with your wallet password, and GO locks itself when idle (Settings, System, Auto-Lock When Idle) and then asks for your password or fingerprint. The weak points are a short password, someone else's fingerprint saved on the phone, and GO left unlocked. Use a strong password, keep auto-lock on, and tap Lock now when you put the phone down.

Also asked as: thief open go · someone steals my phone wallet · stolen phone qortal account safe · is go safe if my phone is stolen · can they open my qortal account

## Q: Should I remove my account before I give away my old phone?

A: Yes. First check the account opens on your new device. Then on the old phone: remove the account in GO (Account details, Remove), delete any backup or seedphrase files from Documents, Qortal Go, and uninstall GO or reset the phone. A phone that still holds your account gives its next owner something to try passwords on.

Also asked as: give away old phone qortal · sell my phone with go on it · wipe go before selling phone · old phone remove account

## Q: Will my QORT and names come back when I restore my account?

A: Yes, if it is the same account. QORT, names and everything else on the blockchain belong to the account, not to the device, so they show up as soon as GO reaches a node. If the balance is zero or your name is missing, you most likely opened a different account, often from a mistyped seedphrase: check the address.

Also asked as: restore brings back my qort · names after restore · balance after restoring account · do i get my names back · restored account qort missing

## Q: Is my private key stored on the blockchain?

A: No. The blockchain holds your address and, after your first transaction, your public key, never your private key. The private key exists only in your wallet: the encrypted copy saved in GO or Hub, your backup file, and what your seedphrase can rebuild.

Also asked as: private key on the blockchain · is my key public on chain · where is my private key kept · blockchain stores my private key

## Q: Can someone work out my private key from my address or public key?

A: No. Your public key and address are made from the private key in a way that only works one way, which is why they are safe to share. Your signatures prove you hold the private key without revealing it.

Also asked as: get private key from public key · private key from my address · reverse a public key · can my address reveal my private key

## Q: What happens if I lose my private key?

A: You can't really lose it on its own: it is rebuilt from your seedphrase, and it is inside your backup file. Restore the account with either and the same private key comes back. If you have lost both the seedphrase and the backup file (or its password), the key is gone with them, and nobody can recover the account.

Also asked as: lost my private key · forgot my private key · private key gone · recover private key qortal

## Q: How safe is my private key on my phone?

A: GO saves your account on the phone encrypted with your wallet password. While you are signed in, GO can sign with the key, which is why the lock matters: keep Auto-Lock When Idle on and use Lock now. GO also blocks screenshots on the screen that shows the key, and keeps its data out of Android cloud backup.

Also asked as: private key safe on my phone · is my key encrypted in go · where does go keep my private key · private key stored on device

## Q: How can I test my backup without risk?

A: Log out, then on the Enter Qortal screen use Import account, Authenticate now, and pick your backup file: it opens the account for that session without saving another copy. If it opens and shows your address, the file and password work. To test the seedphrase, restore it on a spare device, check the address, then remove it again.

Also asked as: test my backup file · check my backup file works · verify backup password · test restore safely

## Q: Should I keep my seedphrase, backup file and password together?

A: No. Keep the backup file and its password apart, because together they open your account. The seedphrase opens it on its own, so keep it on paper, offline, somewhere safe. Spread out like this, a thief who finds only the file cannot use it, and a fire or loss in one place does not take everything.

Also asked as: keep seedphrase and backup together · store seedphrase with backup file · backup file and password same place · where to keep password and backup

## Q: Should I tick "always authenticate automatically"?

A: Only for an app you use often and trust. The tick is remembered for that app's name, so from then on it gets your address and the read-only wallet access every time it opens, without asking. The other always allow boxes, such as chat messages from this app or your balance, work the same way. Payments and publishes have no such box and always ask.

Also asked as: always authenticate automatically · tick always authenticate · should i let a q-app authenticate automatically · stop authenticate popups · always allow box safe

## Q: Should I accept session permissions from a Q-App?

A: Only if you trust the app. The window lists actions, such as publishing, joining groups or reading your wallet, that will then run without asking while that tab stays open, and you must tick "I trust this app and understand these permissions will auto-execute". Decline if it asks for more than it needs. Sending coins can never be granted this way, and closing the tab ends the permissions.

Also asked as: session permissions request · app is requesting session permissions · i trust this app and understand these permissions will auto-execute · should i grant session permissions · q-app session permissions safe · session permissions

## Q: What should I check when a Q-App asks to send coins?

A: Check the recipient line: GO shows the name and the full address it will pay, so compare it with who you mean to pay. Then check the amount, the coin and the fee. You must tick "I have read this request" before Accept works. A sent payment cannot be undone, so if anything looks off, decline.

Also asked as: allow this app to send coins · q-app payment request · app wants to send my qort · send coins approval check · allow this app to transfer the following asset

## Q: What does "allow this app to sign a transaction?" mean?

A: The app has built a transaction and wants your key to sign it. The window shows its type (Tx type), its details and "read the transaction carefully before accepting!". A signed transaction does whatever its type does, including moving QORT, so accept only if you understand every line and expected it from that app.

Also asked as: allow this app to sign a transaction · allow this app to sign and process a transaction · q-app sign transaction request · read the transaction carefully before accepting · tx type in approval window

## Q: What happens if I tap Decline on a Q-App request?

A: Nothing happens: nothing is signed, sent or published, and the app is just told you declined. Declining is always safe, so use it whenever you are unsure. If the request was genuine, you can do the action again in the app later.

Also asked as: decline a q-app request · what does decline do on a q-app request · is it safe to decline an approval · tap decline approval window

## Q: Can a Q-App take my QORT without asking?

A: No. Every payment a Q-App asks for opens an approval window that needs your Accept, after you tick "I have read this request". There is no always allow box for payments, and session permissions cannot include sending coins. So a payment only happens if someone accepted it, which is why GO should be locked when you are not using it.

Also asked as: q-app spend my qort without asking · can an app send my qort automatically · app took my qort · automatic payment q-app · does a q-app need permission to pay · can a q-app steal my qort

## Q: Can a fake Q-App pretend to be another app in the approval window?

A: Not by changing the name GO shows. Requested by comes from the tab the request came from, never from the app's own text, and GO strips hidden characters that could disguise a name. But anyone can publish an app under a name that looks similar, so read the name letter by letter. If GO cannot tell which app asked, it says Unknown Q-App.

Also asked as: fake app in approval window · q-app pretending to be another app · spoofed app name approval · is requested by trustworthy · copycat q-app approval

## Q: What should I do if I accepted a Q-App request by mistake?

A: A payment, name sale or publish you accepted cannot be undone. Session permissions end when you close that app's tab, so close it. An always allow tick stays for that app, so stop using the app if you no longer trust it. Approving requests never gives an app your seedphrase or private key, so the account itself stays yours.

Also asked as: accepted request by mistake · approved the wrong q-app request · undo an approval · cancel an accepted payment · accidentally accepted · approved a scam payment

## Q: Someone says they are a Qortal admin or developer and offers to help. What should I do?

A: Be careful, especially if they messaged you first. Look their name up in Address book (User search) and check the address against one you already know. Real admins and developers never need your seedphrase, backup file, password, private key or a payment to help you. Keep help in public groups, where others can see it.

Also asked as: fake qortal admin · fake qortal developer · someone pretending to be the qortal team · admin messaged me first · impersonator qortal dev · fake admin messaged me

## Q: How can I check that a name belongs to the person I think?

A: Open Address book (User search) and look the name up: it shows the address behind it. Compare that address with one you already trust, for example from an earlier payment or the person's own posts. A similar-looking name can belong to someone else entirely; the address is what counts.

Also asked as: verify a qortal name · check who owns a name · is this the real person on qortal · confirm a name's address · impersonator name check

## Q: Can someone register a name that looks like mine or a well-known one?

A: Yes. Any name nobody has taken yet can be registered by anyone, so impostors use names that differ by a letter, a number or a space. GO refuses payment recipients whose names hide invisible characters, but visible lookalikes still work. Check the address, not just the name, before you pay or trust someone.

Also asked as: lookalike qortal name · someone copied my name · similar name impersonation · fake name looks like an admin · name with one letter different

## Q: What happens when I tap a web link in a chat in GO?

A: A web link opens in your phone's browser, outside GO, and GO hands that site nothing from your wallet. Links that point back at GO itself or at this phone (localhost, 127.0.0.1) are refused. A qortal:// link opens a Q-App or site inside GO instead. Be wary of links from people you don't know, and never type your secrets into a page a link opened.

Also asked as: web link in chat go · tap a link in a message · chat link opens browser · is it safe to tap links in qortal chat

## Q: Someone promises to double my QORT if I send some first. Is it real?

A: No, it is a scam. Once you send QORT nobody can reverse it, and the promised return never comes. The same goes for anyone saying you must pay to unlock, release or withdraw your QORT: QORT in your account is always yours to send, and the only cost is the small network fee GO shows you.

Also asked as: double my qort · send qort to get more back · qort giveaway send first · qort investment scam · pay a fee to unlock my qort · get my qort back from a scammer

## Q: Can someone recover my lost account for a fee?

A: No. Without the seedphrase, or the backup file and its password, nobody can get into a Qortal account: not developers, not admins, not any "recovery service". People who offer this for a fee, or ask for whatever parts of your wallet you still have, are scammers.

Also asked as: account recovery service · recover lost qortal account for a fee · hacker can recover my wallet · pay to recover my seedphrase · recovery scam qortal

## Q: Is it safe to let someone help me by sharing my screen or controlling my device?

A: Be very careful. Someone who can see or control your screen while GO is unlocked can read whatever you open and tap Accept for you. Never open your seedphrase, private key or backup screens while sharing. Real helpers can guide you with words; if they insist on remote control or on seeing those screens, stop.

Also asked as: remote access help qortal · share my screen with a helper · let someone control my phone · remote desktop qortal help

## Q: How do I know a payment to me really arrived?

A: Check your own wallet, not a screenshot. Your balance, and Wallet Activity on Home with its Transaction history, show what really arrived. A screenshot or message is easy to fake. A real payment confirms in the next block, about a minute later.

Also asked as: check payment received · fake payment screenshot · did they really pay me · verify qort received

## Q: Someone says my account will be closed or frozen unless I act now. Is that real?

A: No. Nobody can close, freeze or delete a Qortal account: it is your keys, it lives on the blockchain, and no company is in charge of it. Messages that rush you to act, pay or "verify" are a pressure trick. Ignore them and never share your secrets.

Also asked as: account will be closed message · qortal account frozen · urgent message wallet suspended · account deleted unless you act

## Q: Do I need to approve anything to receive QORT?

A: No. To receive QORT you only give your address or name; the sender signs the payment and it arrives on its own. If someone says you must accept a request, sign something or pay a fee to receive money, it is a trick to get you to approve a payment out of your account.

Also asked as: approve to receive qort · sign something to get paid · receive qort need approval · app asks approval to receive a payment

## Q: Is a Q-App that looks like an official one always genuine?

A: No. Anyone can publish an app under their own name, and a copy can look exactly like the original. What tells them apart is the publisher's name, which GO shows on the app and in Requested by when it asks for something. Open well-known apps from the Official apps tab in GO's library or from links you trust, and be wary of a familiar app under an unfamiliar name.

Also asked as: fake copy of a q-app · copycat q-app · is this the real q-app · q-app published by someone else

## Q: Is it safe to share my screen while I use Qortal?

A: Yes, if you keep your secrets off the screen. Never open your seedphrase, private key, backup or password screens while sharing, recording or streaming: anyone watching, or anyone who sees the video later, could take your account. In GO those screens show up black in recordings and shares, but on a computer Hub cannot hide them. The eye button in Settings (Privacy Mode) blurs your address and key there.

Also asked as: share screen qortal safe · screen sharing with my wallet open · video call showing my wallet · stream my screen qortal · screen share seedphrase · is it safe to share my screen

## Q: Can a Q-App send my data to outside servers?

A: Not in GO. Q-Apps there are limited to your node: what an app loads, fetches and connects to stays on the node, and it cannot open other apps on your phone. So it cannot quietly report to an outside server. It can still publish or send messages, but only through approval windows you see or permissions you granted, so read what you accept.

Also asked as: q-app sends data outside · q-app tracking me · can apps phone home on qortal · q-app connect to internet servers · q-app privacy outside websites

## Q: Is Qortal anonymous?

A: Not fully. Your account needs no ID, but everything on the chain is public and tied to your address and name. To stay more private:
- Use separate accounts for things you want kept apart.
- Pick a name that does not reveal who you are, and leave personal details out of posts.
- Use Private (Reticulum only) calls so callers cannot see your IP address.
- Run your own node, so no one else's node sees what you ask for.

Also asked as: qortal anonymity · can people find out who i am on qortal · how to stay private on qortal · qortal privacy tips · keep my qortal activity private

## Q: Do Qortal Hub and GO collect my personal data?

A: No. The Qortal privacy policy for Hub and GO says they do not collect or send personal data to outside servers; your wallet and permission settings stay on your device. What you do on the network, such as payments and publishes, is still public on the blockchain.

Also asked as: does qortal collect my data · qortal privacy policy · does go send my data anywhere · qortal hub data collection

## Q: What can the public node's operator see?

A: Whatever your phone asks it for: lookups of your address and balance, the Q-Apps, sites and data you open, and the transactions you send through it, which are public on the chain anyway. Like any server, it also sees your IP address. It does not see your private key or seedphrase. With your own node, all of this stays at home.

Also asked as: what does the public node see · public node privacy · can the node see what i do · node operator sees my activity

## Q: Why is my own node better for privacy?

A: Your requests go to a machine you control instead of someone else's; Hub sums it up as "Your data stays local". You also decide who is blocked, foreign coin keys go only to your own node when you trade or send them, and you can mint. The public node is quicker to start with, but it is shared and run by someone else.

Also asked as: own node privacy · private node vs public node privacy · local node more private · why run my own node for privacy

## Q: Why must I keep my node's API key secret?

A: The API key unlocks your node's admin controls. With it, a program that can reach the node can stop, restart or bootstrap it, change its peers, and add or remove minting accounts. Treat it like a password: never post it or give it to a stranger, and never open the node's API port to the internet. If it may have leaked, replace it with a new key and enter that in GO.

Also asked as: node api key secret · share my api key · what can someone do with my api key · qortal api key security · apikey.txt safe

## Q: Is it safe to reach my node over plain HTTP or public Wi-Fi?

A: Not on public Wi-Fi. Over plain HTTP, everything between GO and the node, including the API key, can be read by others on that network; on your own home Wi-Fi it is a common setup. Away from home, reach your node through Tailscale or an SSH tunnel. GO also refuses to send coin private keys over plain HTTP (except to the phone itself or over Tailscale) and downloads updates only over HTTPS or from a node on the phone.

Also asked as: plain http node safe · node over public wifi · is my api key encrypted · connect go to my node on cafe wifi · http node security

## Q: Should I send a small test payment first?

A: For a large payment to a new address, it is a good habit: send a small amount, ask the person to confirm it arrived (or check it yourself for your own cold wallet), then send the rest. Payments cannot be reversed, and GO shows the full address in its confirmation, so compare that too. A test costs one extra small fee.

Also asked as: small test payment first · test send qort · send a little qort first · test transaction to new address

## Q: Is it safe to hand someone my phone while GO is unlocked?

A: Lock GO first: tap your avatar, then Lock now. While GO is unlocked, whoever holds the phone can read your chats and tap Accept on Q-App requests, including payments. Send QORT still asks for your password, but approvals do not. Chats and calls stay connected while GO is locked.

Also asked as: lend my phone with go open · someone using my unlocked phone · hand phone to a friend go unlocked · kids using my phone qortal

## Q: Is my wallet password my private key?

A: No. Your private key is a long secret GO makes from your seedphrase. Your wallet password only locks the copy of that key saved on your device and in your backup file. Changing the password changes the lock, not the key, and the password on its own is no use without the device or the file.

Also asked as: wallet password vs private key · is my password the private key · password same as private key · private key or wallet password

## Q: Are the files and pictures I send in chat encrypted?

A: Yes, on the way. In GO and Hub 3.0 they go from device to device over encrypted Reticulum links, not through a server, so nobody in between can read them. In a DM only you and the other person get them; in a group, every member can. The receiving phone keeps them in GO's private storage until they are saved or the person logs out.

Also asked as: chat files encrypted · are photos in chat private · file transfer encryption go · who can see files i send in chat

## Q: How do I keep my account safe in Qortal Hub on my computer?

A: - Set Auto-Lock When Idle in Hub's settings, and lock Hub when you step away.
- Keep backup copies on USB sticks too, not only on that computer.
- Remember Hub cannot hide your seedphrase or private key from screenshots or screen sharing.
- Download Hub and Core only from official sources.
- Read every approval window before you accept.

Also asked as: qortal hub security on computer · keep my wallet safe on desktop · hub account safety tips · secure qortal hub pc

## Q: What is the trade proxy warning when I buy QORT on the public node?

A: On the public node, a buy order paid with a foreign coin is finished by the Qortal trade proxy account. GO encrypts that coin's private key and sends it to that account, and whoever controls the account could spend that coin. GO tells you this and waits for you to tick that you understand. To keep the key to yourself, trade on your own node.

Also asked as: qortal trade proxy account · i understand the trade proxy receives my private key · buy qort public node private key · trade proxy warning go

## Q: Why does GO warn me when my node is on 127.0.0.1 or Tailscale?

A: On a phone, 127.0.0.1 is whatever app is listening on that port, such as an SSH tunnel, and GO cannot tell whose it is. So before a coin's private key goes there, GO asks you to confirm your own node or tunnel is running right now. With a Tailscale address the key travels unencrypted and stays private only while Tailscale is connected. Go on only when you are sure.

Also asked as: private key sent to an address on this phone · tailscale private key warning · localhost node private key warning · 127.0.0.1 node warning go

## Q: Why does GO block my private key on a connection that is not encrypted?

A: If your node's address uses plain HTTP instead of HTTPS, and the node is not on this phone or on Tailscale, anything sent to it can be read on the way. GO will not let a coin's private key travel like that, so it stops and nothing is sent. Give your node an HTTPS address, use a VPN such as Tailscale, or use a node on this device.

Also asked as: connection is not encrypted private key · plain http node private key blocked · use https vpn tailscale or a node on this device · private key would cross the network in plain text

## Q: Why is my seedphrase hidden on the create account screen?

A: GO keeps the words hidden until you tap Reveal, so nobody glancing at your screen sees them, and it blocks screenshots and screen recording there. After Reveal, the same button copies the words. Anything you copy can be pasted into other apps, so writing the words on paper is the safer way to keep them.

Also asked as: seedphrase hidden reveal button · reveal seedphrase go · copy seedphrase button · cant see seed phrase when creating account

## Q: Can I make up my own seedphrase?

A: Don't. GO picks the words at random with the phone's secure random generator. Any phrase typed at Import opens some account, so a phrase a person makes up, like a favourite quote, is far easier for someone else to guess. Use the one GO gives you.

Also asked as: create my own seedphrase · choose my own seed phrase · custom seedphrase words · pick my own seedphrase

## Q: Is there a printable sheet for writing my seedphrase?

A: Yes. The Welcome to Qortal Q-App has a "My Secret Keys" sheet with 14 numbered lines on its Getting Started page. Save or print it, write your words by hand, and keep the paper offline in a safe place.

Also asked as: seedphrase template · my secret keys template · print seed phrase sheet · recovery phrase paper template

## Q: What can someone learn from my backup file?

A: Which account it is. The file name ends with your address, and the address is inside it in plain text, so anyone who sees the file knows it is yours and can look that account up. Your key is in there too, but encrypted with your password. Don't edit the file: GO checks it, and a changed file may no longer open.

Also asked as: what is inside my backup file · backup file shows my address · is my address in the backup file · backup file contents

## Q: What does "already stored on this device" mean when I import an account?

A: The account you tried to import is already in your account list on this phone, so GO did not add it again. Go back to the list and open it there. If you wanted to replace it, for example to give it a new password, remove it first and then import.

Also asked as: account already stored on this device · these accounts are already stored · import says already stored · duplicate account import go

## Q: Can I import several backup files at once?

A: Yes. In Import account, Backup file, you can pick more than one file. GO adds every account it finds, says how many it imported and skips any already on the phone. Each account then unlocks with the password its own file was saved with.

Also asked as: import multiple backup files · several backup files go · add many accounts at once · import more than one wallet file

## Q: Can I rename my backup file?

A: Yes. GO reads the account from inside the file, so the name does not matter to it. Keeping the address in the name, as GO does (qortal_backup_<address>.json), helps you tell files apart. Keep the .json ending so GO lets you pick the file.

Also asked as: rename backup file · change backup file name · does the backup file name matter · renamed wallet file

## Q: What does Save account in GO mean when I create an account?

A: It is the tick box on the create password screen, on by default. With it on, GO keeps the new account on this phone, locked with your password, so it is in your list next time. Turn it off on a phone that is not yours: then nothing is kept, and the backup file or seedphrase is your only way back in, so save them.

Also asked as: save account in go checkbox · store account in go · dont save the account on this phone · account not saved after creating

## Q: Can someone get past GO's lock by restarting the app?

A: No. GO's lock survives a reload, a crash recovery and an app restart: until a real unlock with your password or fingerprint, GO shows the lock screen again. After a fresh start it always goes through the normal fingerprint or password login.

Also asked as: bypass go lock by restarting · reload skips the lock screen · force close go to unlock · go lock after a crash

## Q: Should I write down my private key as a backup?

A: There is little point: GO and Hub restore accounts from a seedphrase or a backup file, not from a private key. A written key is just one more thing a thief could find. Back up the seedphrase and the backup file instead, and reveal the key (Settings, Security) only when you really need it.

Also asked as: write down my private key · save private key as backup · keep a copy of my private key · private key paper backup

## Q: Is it safe to use Qortal on a shared or borrowed device?

A: Only with care. Use Import account, Authenticate now with your backup file, so the account is not saved there. Log out when you are done, and don't leave your backup file on that device. Never type your seedphrase on a device you do not trust.

Also asked as: use qortal on a shared computer · borrowed phone qortal · log in on someone else's device · public computer qortal account

## Q: Why doesn't the approval window react to my taps?

A: While an approval is open, GO ignores taps that pass through another app's window drawn on top of it, such as a chat bubble or screen filter, so a hidden overlay cannot trick you into accepting. On Android 12 and later GO also hides those overlays. On older phones, close or pause the overlay app and tap again.

Also asked as: approval window taps not working · cant tap accept because of an overlay · screen filter blocks accept · chat bubble covering approval window

## Q: What does "allow this app to get your wallet information?" mean?

A: The app wants one of your coin wallets, shown as coin: QORT, LTC or another. Accepting gives it that wallet's address and public key; for BTC, LTC, DOGE, DGB and RVN that public key lets it see all of that wallet's addresses and history. It cannot spend from it. The always allow box makes this automatic for that app and coin.

Also asked as: allow this app to get your wallet information · q-app wallet info request · app wants my ltc address · always allow wallet to be retrieved automatically

## Q: What does "allow this app to make the following payments and publishes?" mean?

A: The app wants to send one or more payments and publish one or more things in a single step. The window lists each payment (who and how much), each publish and the total amount, and you must tick "I have read this request". Check every recipient and the total, because all of it goes through with one Accept.

Also asked as: allow this app to make the following payments and publishes · payments and publishes approval · q-app several payments at once · total amount in approval window

## Q: What should I check when a Q-App asks to update my group?

A: Look at the new owner line first. An update can change the group's settings and its owner, so a wrong name there hands your group to someone else. Accept only if you asked for exactly that change in an app you trust; the fee is shown too.

Also asked as: allow this app to update this group · update group new owner · q-app change group owner · group update approval

## Q: What should I check when a Q-App asks to buy, sell or change a name?

A: Read the name and price lines. Buy shows the name and how many QORT it costs. Sell shows which of your names and the asking price; once someone buys it, the name and the data published under it are theirs. Update shows the previous and the new name. Each costs a fee, so decline anything you did not set up yourself.

Also asked as: allow this app to buy a name · allow this app to update this name · sell name transaction approval · q-app wants to sell my name · name change approval · allow this app to register this name

## Q: What does "allow this app to perform the admin action" mean?

A: The app wants to control your own node: stop, restart or bootstrap it, add or remove peers, force a sync, or add or remove a minting account. The window names the action and any value. Accept only in a node tool you opened yourself for that job. These actions are refused on a public node.

Also asked as: allow this app to perform the admin action · q-app admin action on my node · app wants to restart my node · admin action approval stop node

## Q: What does "allow this app to delete hosted resources?" mean?

A: Your node keeps copies of QDN data it hosts for the network. A Q-App can ask to list that hosted data, or to delete some of it from your node; the window says how many items. Accept only in a storage tool you trust. Neither works on a public node.

Also asked as: allow this app to delete hosted resources · delete hosted data approval · q-app delete my hosted files · allow this app to get a list of your hosted data

## Q: Is it safe when a Q-App wants to save a file to my phone?

A: GO first asks "would you like to download:" with the file name, and saves the file in Documents, Qortal Go. Web pages such as .html and .svg are saved as text so they cannot run, and GO never opens or installs an app package (APK) it downloads. Still, open saved files only from apps and people you trust.

Also asked as: would you like to download from a q-app · q-app download file approval · app saves a file to my phone · q-app save file safe

## Q: What does "allow this app to send this chat message?" mean?

A: The app wants to post a message as you, to the person or group shown, with the start of the text. Check who it goes to and what it says. Ticking always allow chat messages from this app lets it send messages as you from then on without asking, so keep that for apps you fully trust.

Also asked as: allow this app to send this chat message · q-app sends a chat message as me · always allow chat messages from this app · app message approval

## Q: What does "would you like to deploy this AT?" mean?

A: An AT is a small program that runs on the Qortal chain, used for things like trades. Deploying one creates it and puts the amount shown into it, plus the fee, and you must tick "I have read this request". Accept only if you meant to start exactly that, in an app you trust.

Also asked as: would you like to deploy this at · deploy at approval · q-app deploy automated transaction · at amount approval window

## Q: Can a chat message hack my account?

A: Reading a message does not give anyone your keys. GO cleans message content before showing it, does not load pictures from outside servers, and refuses links that point back into GO. The real dangers are links to fake sites, files you choose to install, and people talking you into approving requests or sharing secrets.

Also asked as: can a message hack me · malicious chat message · is opening a message dangerous · virus in qortal chat

## Q: Does the desktop Hub block screenshots of my seedphrase or private key?

A: No. The protection that turns sensitive screens black in screenshots and recordings is only in the Android app. On a computer, anything Hub shows, including a revealed seedphrase or private key, can be captured by screenshots, screen recorders and screen sharing. Show those only when nobody, and no recording, can see your screen.

Also asked as: hub screenshot seedphrase · screen protection on desktop hub · can screenshots capture hub · hub screen recording private key

## Q: Can my phone's assistant or other apps read GO's sensitive screens?

A: GO blocks assistant screen reading, screenshots, recordings and the recent-apps picture on its sensitive screens: unlock and lock, seedphrase, private key and backup screens, and payment and approval windows. It also hides its content from services that are not accessibility tools. Chats and Q-Apps are not covered, so treat what you show there as visible.

Also asked as: assistant reads my screen go · other apps see go screen · screen reading seedphrase · phone assistant private key screen

## Q: Will my keyboard remember my seedphrase?

A: GO turns off keyboard suggestions and learning in the seedphrase field, so a keyboard that follows that setting does not store the words. A keyboard app that ignores it, or sends what you type online, could still see them, so use a keyboard you trust when you restore an account.

Also asked as: keyboard learns my seedphrase · keyboard suggestions seed phrase · typing seedphrase keyboard safe · does my keyboard save the seed words

## Q: How can my family get to my QORT if something happens to me?

A: Only through the same keys you use: nobody, Qortal included, can hand your account to your family. One way is to give a trusted person a copy of your backup file (it is encrypted, so it is safe for them to hold), and keep the password or the seedphrase where they can reach it when needed, for example with your will. Add a short note on how to restore it in GO or Hub.

Also asked as: inheritance qortal · family access to my qort · if i die what happens to my qort · leave qort to my family

## Q: Why should I keep GO and Hub up to date?

A: Updates bring security fixes as well as features. GO v0.0.15, for example, was a security and privacy release: it closed a flaw that could let outside code run as GO, added screen protection and kept location data out of shared photos. Update GO through the GO 3.0 Updates screen. Hub updates itself: it checks the official releases when it starts and once a day, downloads a new version in the background and installs it when you quit.

Also asked as: update for security · keep qortal apps updated · security updates go · why update go and hub

## Q: What does "could not confirm the public key" mean?

A: Before GO encrypts something for a person, it checks that the public key the node gave it really belongs to that address. If it does not match, GO stops and nothing is encrypted or sent, so a wrong or tampered key cannot be used to read what you meant for them. Try again later, or from another node.

Also asked as: could not confirm the public key · public key mismatch error · nothing was encrypted or sent · public key could not be confirmed

## Q: Why does my seedphrase read like a strange sentence?

A: GO picks 14 random words to fit a fixed pattern of word types, such as adverb, verb, noun and adjective, so the phrase reads like an odd sentence. That makes it easier to write down and read back, but the words themselves are random, so it will not make sense. Copy it exactly as shown.

Also asked as: seedphrase strange sentence · seed phrase words make no sense · seedphrase grammar pattern · why seedphrase looks like a sentence

## Q: What does "the node address could not be checked, so your private key was not sent" mean?

A: Before a coin's private key leaves the phone, GO reads the node's address to check it is allowed: not a public node, and encrypted or local. This time it could not read the address, so it played safe and sent nothing. Check the node URL in your node settings and try again.

Also asked as: node address could not be checked · private key was not sent · blocked node address could not be checked · foreign key invalid node

## Q: Does Qortal have two-factor authentication?

A: Not in the usual sense: there is no login server to send codes from. Your protection is your keys. The wallet password locks the copy on each device and your backup file, GO adds fingerprint unlock and Auto-Lock When Idle, and every payment needs your password or your Accept in an approval window.

Also asked as: qortal 2fa · two factor authentication qortal · sms code login qortal · authenticator app for qortal

## Q: Can I use fingerprint unlock in Qortal Hub on my computer?

A: No. Fingerprint unlock is only in the Android app; on the desktop Hub you unlock with your wallet password. Hub can still lock itself when idle, so set Auto-Lock When Idle in its settings.

Also asked as: hub fingerprint unlock · biometric unlock desktop hub · fingerprint login on computer qortal · windows hello qortal hub

## Q: What should I check when a Q-App asks to add an admin, kick or ban someone?

A: Check the name shown and the group. Making someone an admin gives them power over the group's members, so a wrong name there is a real risk; kick and ban remove a member. Each is a transaction with a fee, so accept only changes you meant to make, in an app you trust.

Also asked as: allow this app to add user as an admin · allow this app to kick from the group · allow this app to ban from the group · q-app group admin request

## Q: What should I check when a Q-App asks me to vote on a poll?

A: Check the poll name and the option shown, because that is the vote your account casts. Votes on Qortal polls are public, so anyone can see how your account voted. A vote is a transaction with a small fee, so only accept polls you meant to vote in.

Also asked as: you are being requested to vote on the poll below · q-app poll vote approval · vote on poll request · create poll approval

## Q: Can a Q-App or the node see the other accounts saved in GO?

A: A Q-App only ever deals with the account you are logged into, and only learns it when you authenticate. GO also stopped sending the node every saved address at once for the account list. Still, if you use two accounts from the same phone and node, that node sees requests for both.

Also asked as: q-app see my other accounts · node sees all my accounts · other wallets saved in go private · apps know my second account

## Q: How is my backup file encrypted?

A: Your password is run through a deliberately slow key step (SHA-512 and bcrypt, with a random salt), and the result encrypts your account key with AES. A separate check value (the wallet integrity check) tells GO whether the password is right and the file undamaged. The slow step makes each password guess costly, but a short password can still be guessed, so use a long one.

Also asked as: backup file encryption · how is my wallet encrypted · what encryption does the qortal wallet use · wallet integrity check meaning

## Q: What do balance and wallet transaction requests from a Q-App share?

A: A balance request shows the app how much of one coin you hold; a wallet transactions request shows it that wallet's payment history. Neither lets it spend anything. The always allow box makes that read automatic for that app and coin, so tick it only for apps you trust with that information. ARRR has no always box: GO asks while the app is open and warns you, because your ARRR seed has to go to your node.

Also asked as: allow this app to fetch your balance · allow this app to retrieve your wallet transactions · q-app wants my balance · always allow balance to be retrieved automatically

## Q: Do GO's diagnostics or logs contain my password or seedphrase?

A: No. GO never stores your seedphrase words, and the unlock timings in its diagnostics keep no passwords or addresses. Copy diagnostics also swaps addresses, names, IDs and IP addresses for stand-ins before you share it. Even so, never paste your seedphrase or password into a report or chat yourself.

Also asked as: diagnostics contain my password · logs show my seedphrase · is it safe to send go diagnostics · copy diagnostics privacy
