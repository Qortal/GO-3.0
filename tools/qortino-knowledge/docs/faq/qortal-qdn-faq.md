# qortal-qdn — golden FAQ

Curated offline Q&A for Qortino (211 entries). Prefer these answers when relevant.

## Q: Is QDN data stored on the blockchain?

A: Mostly not. Each publish is a small transaction on the blockchain that records your name, the service, the identifier and a SHA-256 hash of the data. The files themselves are kept off-chain, on the disks of the Qortal nodes that host them. Only very small data, up to 239 bytes, fits inside the transaction itself.

Also asked as: is qdn data on the blockchain · where is qdn data kept · qdn on chain or off chain · does qdn put files in blocks · are qdn files on the blockchain · is qdn on chain · qdn data stored where

## Q: Can anyone see what I publish on QDN?

A: Yes, when you use a public service: anyone whose node can fetch it can open it. The record of the publish, meaning your name, the service, the identifier, the size and the time, is also on the public blockchain. For things only some people should read, use a private service (its name ends in _PRIVATE), which is encrypted for the people you choose. Even then, the record that you published something stays public.

Also asked as: is qdn public · who can see my qdn files · are qdn publishes public · can people see what i upload on qortal · can everyone see my qdn uploads · is what i publish on qdn public · qdn privacy

## Q: Which nodes store a QDN resource?

A: First the node you published from, which keeps the original copy. Then every node that follows your name downloads your publishes on its own. With the default settings, any node that opens a resource also keeps a copy and shares it with others. The more nodes hold it, the faster it loads and the safer it is.

Also asked as: who hosts qdn data · which nodes keep my qdn files · where is my qdn content hosted · who stores qdn resources · which nodes host qdn data · who keeps qdn files · qdn hosting who

## Q: What do I need before I can publish on QDN?

A: A registered name, since every resource sits under a name you own.
A little QORT for the fee, about 0.01 QORT per publish.
A node that takes your uploads: your own node, or a private node you have the API key for.
Free disk space on that node, a bit more than twice the file's size.
The content in the right form for its service, for example a zip with index.html for a website.

Also asked as: requirements to publish on qdn · what do i need to publish qdn · before publishing on qortal · qdn publish prerequisites · what do i need to publish on qdn · publish requirements qdn · qdn publish checklist

## Q: How much does it cost to publish on QDN?

A: About 0.01 QORT per publish, the network's standard transaction fee. It is the same for a short text and a large video, because only a small record goes on the blockchain; nodes store the file itself. Each resource is its own publish, so an app that publishes five files charges five fees, and every update costs one more. The approval window always shows the exact fee.

Also asked as: qdn publish fee · how much to publish a video on qortal · cost of publishing on qdn · qdn fees · price to upload on qdn · qdn publishing fee · fee to publish on qdn · publishing fee in qort

## Q: Can I delete something I published on QDN?

A: Not completely. You can replace it: publish a new version to the same name, service and identifier, such as a short delete marker, and apps then show it as deleted. Nodes drop the old files during cleanup, but the record of your earlier publish stays on the blockchain, and anyone who saved a copy keeps it. The replacement costs the normal fee.

Also asked as: delete a qdn resource · remove my file from qdn · how to unpublish on qortal · can i delete my website on qdn · delete a published video qortal · delete from qdn · how do i delete something on qdn · erase data from qdn

## Q: Can someone else delete my QDN content?

A: No. Only the account that owns the name can publish a replacement. A node operator can remove copies from their own node or block your name there, but that only changes what their node holds and shows. Your content stays available from every other node that hosts it.

Also asked as: can someone delete my qdn files · can my content be removed from qdn · can admins delete my website · who can take down qdn data · can someone delete my content · can my qdn content be deleted by others · can someone censor my qdn content

## Q: Does QDN data expire?

A: No, there is no expiry date. A resource stays available as long as at least one reachable node holds it. Copies disappear only when a node runs short of space, its storage policy doesn't keep that data, its operator blocks the name, or the publisher replaces the resource.

Also asked as: is there an expiry date on qdn · how long does qdn keep files · qdn data lifetime · will my qdn files disappear · qdn data expire · does qdn delete old data · is qdn content kept forever

## Q: Why does a Q-App take long to open the first time?

A: The first time, your node has to find the app on other nodes, download every chunk and build it before it can show anything. After that the app sits on your node, so it opens much faster, unless your node later removes it to free space. On a public node this first wait happens more often, because it drops apps within hours.

Also asked as: q-app slow the first time · why is the app loading so long · first open slow qortal app · qdn loading takes long · q-app takes long to open first time · why is the first open of a q-app slow · q-app takes forever to open

## Q: How do I publish a website in Qortal Hub?

A: 1. Build the site as plain files with index.html at the top level, then zip the files themselves, not the folder around them.
2. In Hub, open the Q-Apps library and go to the My apps tab.
3. Choose publish website, pick your name, and add a title, description, category and tags.
4. Select the zip, press Publish and approve the fee.
5. Wait a few minutes for the network to pick it up.
You need your own node, a registered name and a little QORT.

Also asked as: publish a website in hub · upload my website to qortal hub · my apps publish website · steps to publish a website on qdn · publish website hub · how to publish a website in hub · put my site on qortal

## Q: Do I need to run Qortal Core to use QDN?

A: Not to look around: Hub and GO can use a public node to open Q-Apps, websites and files. To publish, follow or block names, or host data, you need a node you control: Qortal Core on your own computer, or a private node you have the API key for.

Also asked as: need a node for qdn · use qdn without running core · browse qdn on the public node · do i need my own node to publish · do i need qortal core for qdn · use qdn on the public node · qdn without my own node

## Q: What is a QDN resource?

A: A resource is one published item on QDN. It can be a few characters of text, one file, or a whole folder of files such as a website. Each resource is found by three things: the publisher's registered name, a service (the type of content, such as VIDEO or WEBSITE) and an optional identifier. Publishing again to the same three replaces it.

Also asked as: qdn resource meaning · what is a resource on qortal · what counts as a qdn resource · qdn resource · what is a resource on qdn · qdn resource name service identifier

## Q: What is a service on QDN?

A: A service is the type of content a resource holds, such as IMAGE, VIDEO, AUDIO, DOCUMENT, FILE, JSON, WEBSITE or APP. Each service has its own rules: some take one file, some a whole folder, and some have a size limit (IMAGE 10 MB, THUMBNAIL 500 KB, JSON 25 KB, APP 50 MB). Apps read the service to know how to show your data, so pick the one that fits.

Also asked as: qdn service type · what does service mean on qdn · qdn services explained · qdn service · what are qdn services · service types on qdn · service field when publishing qdn

## Q: Which QDN service should I use for my file?

A: Photos: IMAGE (up to 10 MB). Small pictures and avatars: THUMBNAIL (500 KB).
Videos: VIDEO. Music and other sound: AUDIO.
PDFs and text documents: DOCUMENT. Any other file, such as a zip: FILE.
Small structured data: JSON (25 KB).
A website: WEBSITE. A Q-App: APP (50 MB).
Most of the time the Q-App you publish with, such as Q-Tube or Q-Share, picks the service for you.

Also asked as: which service for a video qdn · what service do i choose on qdn · qdn service for a pdf · qdn service for a zip file · best service to publish a file qdn · which qdn service for my file · what service should i use on qdn · pick a qdn service

## Q: How does QDN stop someone from changing my files?

A: Every publish is signed by your account and records SHA-256 hashes on the blockchain: one for the data and one for a small file that lists the hash of every piece. Nodes check every piece they receive against those hashes and refuse any that don't match. Only the account that owns the name can publish a new version, so nobody else can replace your files.

Also asked as: can someone change my qdn files · is qdn tamper proof · how is qdn data verified · qdn hash check · can my qdn files be changed by someone · qdn file tampering · can someone edit my qdn website

## Q: Does my node host things I only looked at?

A: Yes, with the default storage policy, FOLLOWED_OR_VIEWED. When you open a website, app, video or file, your node downloads it, keeps it and can serve it to other people. It stays until your node needs the space or you block that name. A node set to the FOLLOWED policy keeps only names it follows.

Also asked as: does viewing qdn content host it · my node keeps what i open · viewed content stored on node · followed or viewed policy meaning · does my node host what i view · do i host what i open on qdn · do i host videos i watch

## Q: How do I limit how much disk space QDN uses?

A: Set maxStorageCapacity in Qortal Core's settings.json to the most bytes QDN may use, for example 100000000000 for about 100 GB, and restart Core. Without it, Core counts the drive's free space plus the QDN data it already holds as its limit. It stops fetching new data at 80% of the limit and starts removing data at 90%.

Also asked as: set a maximum for qdn data · maxStorageCapacity setting · qdn using too much disk · cap hosted data size · limit qdn disk space · qdn storage limit setting · qdn disk space limit

## Q: What happens when my node's QDN storage is full?

A: At 80% of its storage limit, your node stops fetching new QDN data in the background. At 90%, it deletes small batches of chunks at random, so that not every node drops the same pieces. It never deletes the original copies of files you uploaded from that node. The limit is the drive's free space plus the QDN data already stored, or maxStorageCapacity if you set a lower one.

Also asked as: qdn storage full · node disk full of qdn data · what does my node delete when full · qdn cleanup when storage full · qdn storage is full · node storage full what happens · storage limit reached qdn

## Q: Will my node delete my own uploads to save space?

A: No. When you publish, your node marks those files as the original copy, and the space cleanup skips them, because they may be the only copy on the network. Older versions are still removed after you publish a newer one. Keep your own backup of anything important anyway.

Also asked as: will qdn delete my uploads · are my published files deleted when full · original copy qdn · does my node keep my own data · does my node delete my uploads · are my own qdn files kept · own uploads safe when storage full

## Q: Does following a name download everything they publish?

A: Yes. Your node downloads all of that name's QDN content and keeps fetching new publishes as they appear. Some names hold many gigabytes, so check first: in Q-Share, the Follow button's tooltip shows the name's current download size and number of files. Following helps the creator too, because the more nodes follow a name, the faster its content loads for everyone.

Also asked as: follow name downloads everything · how much space does following take · following a name storage · does follow download all files · following a name downloads all their content · how much does following a name download · follow name download size

## Q: Which apps have a Follow button for QDN names?

A: Q-Apps such as Q-Share and Q-Tube show a Follow button next to a publisher. It adds the name to your node's followedNames list, which tells Qortal Core to host that name's data, and both apps use the same list. Following someone on Torq is a different, social follow: Torq publishes it to QDN so it shows in your feed.

Also asked as: follow button qortal apps · follow someone in q-share · follow a channel in q-tube · where do i follow a name · how do i follow a name on qdn · follow a name button · how to follow a publisher qdn

## Q: Can I follow names while I'm on the public node?

A: No. Follows are saved on the node itself, and Hub and GO refuse list changes on a public node, so Follow buttons in Q-Apps don't work there. Connect to your own node to follow names and host their data.

Also asked as: follow on the public node · follow button not working in go · cant follow names qortal go · public node follow error · follow names on the public node · cant follow on public node · follow button public node go

## Q: Does following a name for hosting cost QORT?

A: No. A hosting follow, made with the Follow button in apps such as Q-Share or Q-Tube, is a setting on your own node, not a blockchain transaction, so there is no fee. It costs disk space and bandwidth instead, because your node downloads and serves that name's content. A Torq follow is different: Torq publishes it, so it costs the normal publish fee.

Also asked as: is following free on qortal · follow name fee · cost to follow a name · do i pay to follow on qdn · does following a name cost qort · following fee qdn · hosting follow fee

## Q: Does the public node keep QDN data for me?

A: Not for long. The public node serves many people and drops apps and files within hours, so the first open after a while often has to fetch everything from peers again. Your own node keeps what you open and follow, so it loads much faster the next time.

Also asked as: public node qdn data · why are apps slow on the public node · public node drops data · qdn on the public node · does the public node keep my data · public node keeps qdn data · apps reload slowly on public node

## Q: Why can I see a QDN resource in search but not open it?

A: Search results come from the blockchain record of each publish, which every node has. The files are separate: they must come from a node that still holds them. If no node hosting it is online and reachable, your node keeps asking and shows "Waiting for data from peers..." until one appears.

Also asked as: resource in search but wont open · qdn file listed but not loading · search shows a video that cant play · found on qdn but not available · qdn resource found in search but wont open · search result wont open qdn · listed but missing data qdn

## Q: What is a QDN chunk?

A: A chunk is a piece of a published file. Before upload, Qortal Core compresses and encrypts the data, then cuts it into chunks of 512 KB, each with its own hash. Nodes share a file chunk by chunk and check every piece. Data small enough to fit in one chunk is kept whole.

Also asked as: qdn chunk size · what is a chunk on qortal · why does qdn split files · 512 kb chunks qdn · qdn chunks · how big is a qdn chunk · qdn file pieces

## Q: Why does a QDN loading page show 0 / 2 files?

A: Until your node has a resource's metadata file, which lists its chunks, it can only count two things: that file and the data. So it shows 0 / 2 while it looks for peers. Once the metadata arrives, the real count appears, such as 3 / 14. If it stays at 0 / 2 for a long time, no reachable node is sending that resource right now.

Also asked as: 0 / 2 files loading · stuck at 0/2 files · loading page 0 of 2 · qdn 0 2 files meaning · 0 / 2 files · loading page 0/2 files · q-app stuck downloading 0 / 2

## Q: Can a node operator read private QDN data they host?

A: No. Data in a _PRIVATE service is encrypted by the app on your device before it reaches any node, using the public keys of the people allowed to read it. Hosting nodes store and pass on only that encrypted form. Only someone holding one of the matching private keys can decrypt it.

Also asked as: can nodes read private qdn data · who can decrypt private qdn · is hosting private data safe · private qdn files readable by host · can node operators read private qdn data · can the host read my private qdn files · can a node see my private files

## Q: What is the VIDEO service on QDN?

A: VIDEO holds one video file. It has no size limit of its own, so the general limit of 2 GiB per publish applies. Q-Tube, for example, publishes each video as a VIDEO resource plus a DOCUMENT that describes it, with identifiers starting qtube_vid_. VIDEO_PRIVATE is the encrypted version for chosen viewers.

Also asked as: qdn video service · publish a video on qdn · video size limit qdn · what is VIDEO on qortal · qdn video · video service on qdn · VIDEO_PRIVATE service

## Q: Why must my node download a whole video before it plays?

A: QDN stores a video zipped, encrypted and cut into chunks, so your node needs every chunk before it can put the file back together. Q-Tube and similar apps show a percentage while your node gathers them. Videos that many nodes host arrive faster, and once your node holds a video, it starts at once the next time.

Also asked as: video loading percentage qdn · can qdn stream video · qdn video buffering · video wont start until downloaded · why does a qdn video download before playing · qdn video must download first · streaming video on qdn

## Q: Why does Qortal Core reject my publish for the service I chose?

A: Each service checks what you send. Core refuses data over the service's size limit, a folder sent to a single-file service, JSON that isn't valid, a website without an index file, a GIF collection with anything other than .gif files, and encrypted data in a public service or plain data in a private one. Choose the service that matches your content.

Also asked as: qdn publish rejected wrong service · service validation error qdn · EXCEEDS_SIZE_LIMIT error · MISSING_INDEX_FILE error · INVALID_FILE_EXTENSION qdn · qdn rejected my publish · why was my qdn publish rejected · qdn publish invalid content

## Q: What is the maximum size of one QDN publish?

A: 2 GiB, measured after Qortal Core zips and encrypts the data; Hub and GO refuse files over about 2 GB. That limit covers services with no smaller cap of their own, such as VIDEO, AUDIO, FILE and DOCUMENT. Hub's own publish form takes website zips up to 400 MB and app zips up to 50 MB.

Also asked as: qdn 2gb limit · max file size on qdn · largest video i can publish · biggest file on qdn · qdn general size limit · maximum qdn publish size · qdn max size · 2 gb per file qortal

## Q: Why can't I publish from GO on the public node?

A: Publishing means uploading the file to a node, and the public node GO uses by default refuses uploads without its API key, which only its operator has. So QDN publishes from GO, such as posts with media, avatars or Q-App uploads, need your own node or a private node you have the API key for. You can switch nodes in GO's node settings.

Also asked as: cant publish on the public node · go publish fails on public node · missing x-api-key header publish · public node does not take uploads · why cant i post media from go · publish from go public node · go cant publish · publish needs my own node

## Q: What does "Your node needs its API key to publish" mean?

A: Qortal Core only accepts uploads from apps that send its API key. GO shows this message when your node refused a publish for that reason. Tap Open node settings in the publish window and enter your node's API key; Core keeps it in the apikey.txt file in its folder.

Also asked as: your node needs its api key to publish · publish api key error · go publish api key · node refused publish key · node needs api key to publish · api key to publish go · open node settings publish

## Q: Does a bigger file cost more to publish on QDN?

A: No. The fee depends on the size of the transaction, not the file, and a publish transaction is always small because it holds only a hash of the data. So a 1 GB video costs the same fee as a short note. What a big file costs is upload time and disk space on the nodes that host it.

Also asked as: bigger file higher fee qdn · is the qdn fee based on size · fee per mb on qdn · large video publish fee · does qdn fee depend on file size · big file publish fee qdn · does qdn charge by size

## Q: Do I pay again when I update a QDN resource?

A: Yes. An update is a new publish to the same name, service and identifier, so it is a new transaction with the usual fee of about 0.01 QORT. Changing only the title or description is a new publish too. So is deleting, which really means publishing a replacement.

Also asked as: fee to update on qdn · pay again to update my website · does editing on qdn cost · update resource fee qortal · update fee qdn · do i pay to update on qdn · republish fee qdn

## Q: Can I publish to QDN under someone else's name?

A: No. Qortal Core accepts a publish only when the account signing it owns the name it uses. If you own several names, you can use any of them, and the approval window shows which name the resource goes under.

Also asked as: publish under another name qdn · use someone elses name on qdn · invalid name owner error · which name does my publish use · publish with someone elses name · publish under another persons name · publish as a different name

## Q: What happens step by step when I publish on QDN?

A: 1. The app sends your file to your node, in parts if it is large.
2. Qortal Core zips it, encrypts it and cuts it into 512 KB chunks, each with a hash.
3. Hub or GO signs the publish transaction with your key, and your node broadcasts it.
4. Other nodes add the record to their index. Those that follow your name, or open the resource, fetch the chunks and pass them on.

Also asked as: how does qdn publishing work · what happens when i publish on qdn · publish process qortal · qdn upload steps · qdn publish process · how does publishing on qdn work · how a publish reaches the network

## Q: How long until others can see what I published on QDN?

A: Usually a few minutes. Your publish is a transaction that has to reach other nodes, and then those nodes fetch the files from yours or another host. Hub asks you to wait a couple of minutes for the network to pick up the change. Keep your node online meanwhile, since at first it may hold the only copy.

Also asked as: publish not showing yet qdn · how long until my upload appears · qdn propagation time · my new publish is not visible · how long until my publish shows · when do others see my qdn publish · when will others see my website

## Q: Why should I keep my node online after publishing?

A: Right after a publish, your node may be the only one holding the files. If it goes offline before other nodes have fetched them, nobody can load the resource until it comes back. Once followers and viewers hold copies, the content no longer depends on your node.

Also asked as: keep node online after upload · publish then turn off my pc · qdn first copy only on my node · my upload is unavailable after shutdown · keep my node on after publishing · turn off node after publishing · node offline after publishing

## Q: What should I do if a QDN publish timed out?

A: First check whether it went through: look for the resource in the app, or wait a few minutes and search again. Publishing again straight away can publish it twice and charge the fee twice. If it really isn't there, publish again.

Also asked as: publish timed out · did my publish go through · retry publish fee twice · publish error but maybe published · my qdn publish timed out · qdn publish timed out what now · qdn publish timeout

## Q: Why does publishing say "Not enough space on your hard drive"?

A: Before a big upload, Hub and GO ask the node whether it has room. Qortal Core wants a little more than twice the file's size free, because it holds the uploaded parts and the joined, processed file at the same time. Free up space on the node's drive, or publish from a node with more room.

Also asked as: not enough space on your hard drive · qdn publish disk space · insufficient disk space upload · publish fails for space · not enough space publish · disk space to publish on qdn · how much free space to publish

## Q: What does the QDN publish approval window show?

A: It asks "allow this app to publish to QDN?" and shows the service, the identifier, the name the resource goes under and the fee. For several files at once it lists each one with the total fee. It also says when the data will be encrypted, and if the app adds a fee of its own, you must tick "accept app fee" before you can approve.

Also asked as: publish approval window · allow this app to publish to qdn · what am i approving when publishing · qdn publish permission popup · qdn publish approval · publish approval popup · publish confirmation details

## Q: Can a Q-App publish to QDN without asking me?

A: Normally no: Hub and GO show an approval window for every publish, with its service, name and fee. An app can ask for session permissions, and if you accept them ("I trust this app and understand these permissions will auto-execute"), some actions, publishing included, can run without asking for the rest of that session. Accept that only for apps you trust.

Also asked as: can apps publish without permission · auto publish session permission · q-app publish without asking · session permissions publish qdn · app publishes without asking · q-app publish session permission · stop an app publishing automatically

## Q: Why does a publish say my QORT balance is insufficient?

A: Every publish needs its fee, about 0.01 QORT, in your balance, and a multi-file publish needs one fee per file plus any app fee. Hub and GO check this before they ask for approval. Add QORT to your account and try again.

Also asked as: insufficient qort balance publish · your qort balance is insufficient · not enough qort to publish · publish fails because of balance · qort balance insufficient publish · insufficient balance qdn publish · need qort for the qdn fee

## Q: What happens to the old version after I update a QDN resource?

A: Nodes serve only the newest version. Once a node sees your newer publish, it deletes the older version's files in its next cleanup and stops fetching them. The blockchain still keeps the record of each earlier publish, with its time, size and hash, but the old files fade from the network.

Also asked as: old version after a qdn update · does qdn keep old versions · previous version deleted on qdn · what happens to replaced qdn files · what happens to old versions on qdn · old qdn version after update · qdn replaced version

## Q: Can I get an old version back after updating on QDN?

A: Not from QDN in the usual way, because nodes delete the files of replaced versions. To roll back, publish the old files again to the same name, service and identifier, which costs the normal fee. So keep your own copy of everything you publish.

Also asked as: restore an old version on qdn · roll back a qdn update · undo a qdn update · get back the previous version of my website · get old version back qdn · restore previous qdn version · revert a publish on qdn

## Q: Why does a Q-App or website open faster the second time?

A: After the first open, your node keeps the chunks and a ready-built copy of the app or website, so the next visit is quick. That built copy expires after 7 days, and the next visit rebuilds it from the chunks your node still holds, which takes a moment. If the chunks are gone too, the node fetches them from peers again.

Also asked as: qdn site faster second time · why is a q-app slow again after a week · built copy qdn cache · qdn cache 7 days · why is a q-app faster the second time · qdn site opens faster second time · app opens quicker after first time

## Q: What happens to my QDN content if I stop running my node?

A: Whatever other nodes host stays available from them: the followers of your name and people who opened your content. Anything that only your node held can't be loaded until your node comes back. Your publishes stay recorded on the blockchain, and when your node returns, it serves its original copies again.

Also asked as: stop running my node qdn content · turn off my node what happens to my website · my node offline qdn data · shut down node lose qdn data · stop running my node qdn · my node off qdn content · qdn data when my pc is off

## Q: What happens to my QDN content if I lose my seed phrase?

A: Your public content stays on QDN as long as nodes host it, but you can no longer update or replace it, because only the account that owns the name can publish. Private data encrypted for your account can't be decrypted by anyone, you included. This can't be undone, so keep your seed phrase backed up safely.

Also asked as: lost seed phrase qdn data · lost my account what happens to my website · can i update qdn after losing my seed · private qdn data with a lost key · lose seed phrase qdn content · qdn content after losing seed phrase · qdn content without my account

## Q: How do I keep my QDN content available for the long term?

A: Keep a node online that holds your publishes, and follow your own name on a second node if you can. Ask people who value your content to follow your name, since every follower adds a copy. Keep the original files too: if your content ever vanishes from QDN, publish them again to the same name, service and identifier.

Also asked as: keep qdn content alive · make my qdn data last · qdn content survive long term · backup my qdn website · keep qdn content available · long term qdn content · my qdn content disappeared how to restore

## Q: What happens when I block a name's QDN data?

A: Your node stops downloading and serving that name's QDN content, even if you follow the name, and with the default storage policy it also deletes what it already holds. Pages from that name then say the name is blocked so content cannot be served. Other people's nodes are not affected, and you can unblock the name later.

Also asked as: block a name qdn data · block qdn data meaning · what does blocking a name do · hide someones qdn content · block a name on qdn · blocking a name qdn data · block name stops hosting

## Q: Is content on QDN moderated?

A: There is no central moderator. Anyone who owns a registered name can publish; Qortal Core checks only that the publisher owns the name and that the data fits the service's rules. Each node operator decides what their node stores and serves and can block names, and some Q-Apps let you hide publishers you don't want to see. So your own node and its block list are how you choose what you see and host.

Also asked as: who moderates qdn · is qdn content checked · qdn content rules · can bad content be published on qdn · is qdn moderated · qdn content moderation · qdn moderation

## Q: Can I publish anonymously on QDN?

A: Not fully. Every publish is signed by your account and sits under a registered name, so it is linked to that name and its address on the public blockchain for good. You can use a name that doesn't reveal who you are, but everything published under it stays linked to that name and account.

Also asked as: anonymous publishing qdn · publish without revealing identity qortal · is my qdn publish linked to me · qdn privacy of publisher · publish anonymously qdn · can i publish anonymously · who can see i published this

## Q: What do QDN resource statuses mean?

A: Published: it exists, but your node hasn't downloaded it yet.
Downloading: your node is fetching its chunks from peers.
Downloaded: all files are on your node, not built yet.
Building: your node is putting the files together.
Ready: built and ready to open.
Missing data: your node couldn't get all the files yet; try again later.
Not published: no such resource exists.
Blocked: the name is on your node's block list.

Also asked as: qdn resource status meaning · published downloading ready status · qdn status list · what does status ready mean · qdn statuses · qdn status meanings · resource statuses qdn · resource status on qortal

## Q: How do I search for content on QDN?

A: There is no single search engine. Each Q-App searches your node's index for its own kind of content: Q-Tube for videos, Q-Share for files, the Q-Apps library for apps and websites. The index comes from the publish records every node has, so a result can show up even when its files aren't available right now.

Also asked as: search qdn · find content on qdn · qdn search engine · how to find files on qortal · how to search qdn · search for qdn content · look for videos and files on qdn

## Q: What does "Unable to Load. Please try again later." mean?

A: The loading page tried to build the resource 10 times without success and stopped, saying "The resource could not be loaded after multiple attempts." Usually some chunks were still missing or the build failed. Wait a while, then reload the page or open the app again.

Also asked as: unable to load please try again later · resource could not be loaded after multiple attempts · qdn build failed · app failed to load on qortal · unable to load qdn · unable to load please try again · qdn load error after attempts

## Q: Is QDN part of Qortal Core?

A: Yes. Qortal Core, the node software, runs both the blockchain and QDN, so there is nothing extra to install. Since Core 6, QDN traffic runs on its own connections and port, 12394, next to the blockchain's peers. Hub and GO talk to Core to show and publish QDN content.

Also asked as: is qdn a separate program · does qortal core run qdn · qdn and qortal core · do i need extra software for qdn · is qdn part of core · qdn in qortal core · qdn built into the node

## Q: What must a QDN website zip contain?

A: An index file at the top level of the zip: index.html, index.htm, default.html, default.htm, home.html or home.htm. Qortal Core rejects a website without one. Zip the files themselves rather than the folder that holds them, keep links between files relative, and remember that file names are case-sensitive.

Also asked as: website zip requirements qdn · index.html at the root qdn · missing index file website · how to zip my website for qortal · qdn website zip · what goes in a website zip · qdn website index file

## Q: What is the address of my QDN website?

A: It is qortal://WEBSITE/ followed by your registered name, for example qortal://WEBSITE/QortalDemo. A page inside it adds its path, as in qortal://WEBSITE/QortalDemo/about.html. People open it by entering the link in the search bar of Hub or GO, or by tapping it in a chat.

Also asked as: my qdn website address · link to my qortal website · qortal://WEBSITE my name · how do people open my website · qdn website address · what is my website link · url of my qdn site

## Q: How do I update my website on QDN?

A: Change your files, zip them again with index.html at the top, and publish them as a website under the same name; in Hub's My apps tab, use update on your published website. The new version replaces the old one for everyone within a few minutes. The whole zip is uploaded again, and the usual fee applies.

Also asked as: update my qortal website · change my website on qdn · republish a website in hub · edit my qdn site · update website qdn · how to update my website on qdn · publish a new version of my website

## Q: Do I need to keep my computer on for my QDN website to stay up?

A: Only while your node holds the only copy. Once others follow your name or have opened your site, their nodes serve it too, even while yours is off. Keeping your node online, or asking a friend to follow your name, keeps the site reachable in quiet times.

Also asked as: keep computer on for qdn website · website offline when my node is off · does my qortal site need my pc running · qdn website uptime · keep my computer on for my website · does my website need my node online · website down when node off

## Q: Can people without Qortal see my QDN website?

A: Only through a gateway: a Qortal node whose operator has turned on Qortal Core's gateway mode serves QDN websites to ordinary web browsers. Gateway mode is off by default. Otherwise visitors need Qortal Hub or Qortal GO.

Also asked as: view a qdn website in a normal browser · qortal website without hub · share my qdn site with non qortal users · qdn gateway for browsers · can people without qortal see my website · view qdn website without qortal · can chrome open qortal websites

## Q: How do people find my QDN website?

A: The Q-Apps library in Hub and GO lists every name's main app and website, with the title, description and category you gave when publishing. You can also share your site's link, qortal://WEBSITE/ followed by your name. Sites made with Qortal Web Builder can also be listed in the Qortal Web app.

Also asked as: where can people see my qortal website · list my website in the q-apps library · website discovery on qortal · promote my qdn site · find my qdn website · how to find qdn websites · where do qdn websites show up

## Q: Why does my website still show the old version after an update?

A: Each node switches to the new version only after it has received your new publish and fetched the new files, which usually takes a few minutes. Until then it may still show the copy it already built. Wait a little and reload; if you see Not Found or a loading page instead, the new version is still on its way.

Also asked as: website still shows old version · qdn update not showing · old version of my site after publish · website update not visible qdn · website shows old version · old website version after update · refresh qdn website new version

## Q: What are the parts of a qortal:// link?

A: qortal://SERVICE/name/identifier/path. SERVICE is the type, such as WEBSITE, APP or THUMBNAIL; name is the publisher's registered name; identifier picks one resource when a name has several; path is a page or file inside it. The identifier and path can be left out, as in qortal://APP/Q-Tube, and the word default stands for no identifier.

Also asked as: qortal link format · parts of a qortal link · qortal service name identifier path · how is a qortal link built · qortal link parts · qortal:// link syntax

## Q: How do I open a qortal:// link in Qortal Hub?

A: Type or paste it into the search bar at the top of Hub, which says "Search Q-Apps or enter qortal://", and press Enter. qortal:// links in Q-Chat messages and inside Q-Apps open with a click. Either way the resource opens in Hub's apps view.

Also asked as: open a qortal link in hub · paste a qortal link in hub · hub search bar qortal link · how to use a qortal:// link · open qortal link hub · how to open a qortal link on pc · enter a qortal link on desktop

## Q: How do I open a qortal:// link in Qortal GO?

A: Tap it in a chat message or an app, or paste it into GO's top search bar, which says "Search apps or enter qortal:// link", and choose Open as Qortal link. On Android, tapping a qortal:// link in another app, such as a browser or a messenger, opens GO as well.

Also asked as: open a qortal link in go · qortal link on android · paste a qortal link in go · go top bar qortal link · open qortal link go · how to open a qortal link on phone · tap a qortal link to open go

## Q: Do I get paid for hosting QDN data?

A: No. Hosting QDN data is voluntary: your node keeps what you follow and open, and shares it, without payment. Qortal Core has no data market yet; QORT is earned by minting, not by hosting.

Also asked as: paid for hosting qdn · earn qort hosting data · hosting rewards qortal · does hosting qdn give qort · paid for hosting · hosting rewards qdn · qdn data market

## Q: How do I publish something private on QDN?

A: Use a Q-App that offers private or encrypted publishing, such as Q-Mail for mail. The app encrypts the data on your device for the people you choose and publishes it to a _PRIVATE service, such as FILE_PRIVATE or DOCUMENT_PRIVATE. The approval window shows that the data is encrypted. The publish itself, with your name and the identifier, is still public.

Also asked as: publish a private file on qdn · encrypt a file on qdn · share something privately on qortal · private publish qdn · publish private qdn · how to publish privately · encrypted upload qortal

## Q: Who can open a private QDN resource?

A: Only the people it was encrypted for, and you, because Hub and GO always add your own key. The app encrypts the data with a fresh random key and then locks that key separately for each chosen person's public key, so each of them can open it with their own private key. Everyone else, hosting nodes included, sees only scrambled data.

Also asked as: who can decrypt a private qdn file · who can read private qdn data · private resource recipients · qdn encrypted for whom · who can open private qdn data · private qdn resource access · open a private qdn resource

## Q: Why does a Q-App open on one node but not on another?

A: Each node holds different QDN data, depending on what it follows, what its users have opened and how full it is. Your own node may already have an app that a public node dropped, or the other way round. If an app won't load on one node, wait while it fetches from peers, or try it from your own node.

Also asked as: app works on pc not on phone · q-app loads on my node not the public node · different nodes have different qdn data · app opens in hub but not in go · q-app opens on one node not another · app works on one node only · qdn data differs between nodes

## Q: Does QDN data make the blockchain bigger?

A: Only a little. Each publish adds one small transaction with the name, service, identifier and hashes, but the files themselves stay off-chain on the nodes that host them. How much QDN data a node stores depends on what it follows and opens, not on everything ever published.

Also asked as: does qdn bloat the blockchain · qdn and blockchain size · are files added to the chain · qdn chain growth · qdn blockchain size · does qdn make the chain bigger · blockchain size and qdn publishes

## Q: Does my phone store QDN data?

A: Not as a node. GO doesn't run Qortal Core, so it doesn't host QDN data for others; it shows what the node it is connected to fetches. GO keeps only a few things itself, such as the files of your widgets and the files you choose to save.

Also asked as: does go store qdn data on my phone · qortal go hosting data · phone qdn storage · is my phone a qdn node · does my phone host qdn data · phone stores qdn data · go keeps qdn files

## Q: Why is my Qortal data folder so big?

A: It holds the QDN data your node hosts: everything from names you follow, what you and others using that node have opened, the original copies of your own publishes, and built copies of apps and websites. Following big publishers, or the ALL policy, makes it grow fast. Set maxStorageCapacity to cap it, or follow fewer names.

Also asked as: qortal data folder too big · qdn data folder size · why is qortal using so much disk · data folder keeps growing · data folder big qortal · why is my data folder large · reduce the qortal data folder

## Q: Can I delete my node's data folder to free space?

A: You can, with Qortal Core stopped, but you lose all the QDN data it held, including the original copies of what you published from it, which may be the only ones on the network. Your node then downloads the names you follow again. To keep usage down safely, set maxStorageCapacity instead.

Also asked as: delete the qortal data folder · remove qdn data to free space · is it safe to delete the data folder · clear qdn storage manually · delete data folder · can i delete the data folder · wipe qdn data on my node

## Q: Can one Q-App read data published by another?

A: Yes. Public QDN data belongs to the name that published it, not to an app, so any app can read it if it knows the service and identifiers used. That's how Torq shows the same posts as Quitter.

Also asked as: can apps share qdn data · q-app reads another apps data · does an app own my qdn data · same data in two q-apps · can a q-app read another apps data · apps share data on qdn · qdn data shared between apps

## Q: Do Q-Apps update automatically?

A: Yes. A Q-App is a QDN resource, so when its publisher publishes a new version, nodes switch to it, and you get it the next time the app loads. There is no install step, and only the owner of the app's name can publish an update.

Also asked as: do q-apps update themselves · how do q-apps get updates · new version of a q-app · update a q-app · q-apps update automatically · do q-apps auto update · who can update a q-app

## Q: How do I know my QDN publish worked?

A: Hub says it was successfully published, and GO's publish window shows Published to QDN. Then give it a few minutes and look for it in the app you used, or open its qortal:// link: if it loads, it's on QDN. A Not Found page soon after publishing usually means the network hasn't caught up yet.

Also asked as: did my qdn publish work · check that my publish succeeded · confirm an upload on qdn · how to verify a publish on qortal · did my publish work · check my qdn publish worked · is my file published

## Q: Why can't my syncing node see new QDN content?

A: Your node learns what exists on QDN from the blockchain, so until it has synced up to now, it doesn't know about the newest publishes and shows them as Not Found. It also waits until it has enough up-to-date peers before fetching QDN data. Let the sync finish, then try again.

Also asked as: qdn not working while syncing · syncing node cant open new apps · new publishes not found on my node · qdn during sync · syncing node qdn · qdn content while node syncs · node behind and qdn content missing

## Q: How do I know a QDN item really comes from who it says?

A: Look at the registered name it was published under: only the owner of that name can publish there. Anyone can copy a title, an identifier, or text that claims to come from someone else, but only under their own name. Good apps show the publisher's name from the publish itself, not from what the content claims.

Also asked as: is this qdn content really from them · fake qdn content with the same title · verify the publisher on qdn · impersonation on qdn · is qdn content really from the publisher · check who published qdn content · can someone fake my qdn content

## Q: Can my QDN website load images or fonts from other websites?

A: No. In Hub and GO, QDN websites and Q-Apps can load only what comes through the node, so images, fonts or scripts from ordinary web servers don't load. Put everything the site needs inside its zip, or load it from QDN with qortal:// links.

Also asked as: qdn website external images · load web fonts on a qdn site · cdn on a qdn website · outside web content in a qdn site · qdn website external fonts · external content on qdn website · why dont external images load on my qdn site

## Q: Can a QDN website run PHP or a database?

A: No. A QDN website is static: HTML, CSS, JavaScript, images and other files that the visitor's Hub or GO shows as they are. Nothing runs on a server, so PHP, server databases and server-side forms don't work. A Q-App can still use the Qortal API through qortalRequest, for example to sign in with a Qortal account, take payments or store data on QDN.

Also asked as: php on a qdn website · server side code on a qortal site · database for a qdn website · dynamic website on qdn · php qdn website · can qdn websites use php · can qdn run a web server

## Q: Why won't my website zip publish?

A: Check three things. index.html, or another index file, must be at the top level of the zip, not inside a folder. The zip must be a normal .zip: some archive programs write older formats that don't work, while 7-Zip in zip format and Windows' own archiver are known to work. And Hub's website form takes zips up to 400 MB.

Also asked as: website zip wont publish · zip rejected for qdn website · missing index file error website · which zip program for qortal · website zip will not publish · why does my website zip fail · publish website zip error

## Q: Can I publish on QDN for free?

A: Not any more. Publishing once had a free option that used a proof-of-work calculation instead of a fee, but since 2023 every publish has to pay the fee, about 0.01 QORT, which goes to the minters. Keeping your content hosted afterwards costs nothing.

Also asked as: free publishing on qdn · publish without a fee qortal · proof of work publish qdn · free qdn hosting fee · publish for free qdn · is qdn publishing free · mempow publish

## Q: Why doesn't Qortal store files on the blockchain itself?

A: Because every node would then have to hold every file. QORA, the project Qortal grew from, stored data on its chain, which would have bloated it beyond what normal computers can hold and put everyone's uploads, unwanted ones included, on every node. QDN keeps only small records and hashes on the chain, while each node hosts just what it follows or opens.

Also asked as: why is qdn data off chain · why not put files on the blockchain · qora on chain data hosting · on chain storage problems · why are files not on the blockchain · why qdn is off chain · why qdn stores only hashes

## Q: What does "Data unavailable. Please try again later." mean?

A: Your node tried several times to collect the resource's files from peers and gave up for now, so it shows this instead of the item. It isn't an error with your account. Try again later; if it keeps happening, no reachable node is hosting that content right now.

Also asked as: data unavailable please try again later · qdn data unavailable · image shows data unavailable · qortal data unavailable error · data unavailable · data unavailable try again later · file data unavailable qdn

## Q: How is QDN like a torrent network?

A: Like torrents, nodes share data they have downloaded, in chunks, with other peers, so popular content spreads by itself. Unlike torrents, every item sits under a registered name and is recorded on the blockchain with its hashes, only the name's owner can update it, everything is encrypted, and your node hosts only what you follow or open.

Also asked as: qdn vs torrents · is qdn like bittorrent · qdn peer to peer like torrent · difference between qdn and torrents · qdn like torrent · is qdn a torrent network · qdn seeding

## Q: How can I help QDN work better?

A: Run your own node and leave it on, follow the names whose content you value so your node keeps a copy, keep relay mode on so data can pass through you, and give your node enough disk space. Each of these adds copies or paths, which makes content load faster for everyone.

Also asked as: help the qortal data network · support qdn hosting · make qdn faster for everyone · how to contribute to qdn · help host qdn content

## Q: Does QDN scan files for viruses?

A: No. Qortal Core checks only that the data matches its publish record and fits the service's rules, not what a file contains. Anyone with a name can publish, so treat downloaded files like any file from the internet and open them with care.

Also asked as: qdn virus scan · can qdn files contain malware · is a qdn download safe · malware on qdn · does qortal check files

## Q: Can I publish a file on QDN without a Q-App?

A: Hub's own publish form in the My apps tab handles only apps and websites. For files, videos, images and other kinds of content, use a Q-App made for them, such as Q-Share for files or Q-Tube for videos; the app picks the right service and identifier for you.

Also asked as: publish a file in hub without an app · hub publish only apps and websites · how to upload a file to qdn from hub · publish video without q-app · hub publish form file types

## Q: Which Q-App should I use to publish on QDN?

A: Files and documents: Q-Share.
Videos: Q-Tube.
Posts with pictures, polls and short videos: Torq.
Blogs: Q-Blog.
A website without coding: Qortal Web Builder, or your own zip through Hub's My apps tab.
Mail with attachments: Q-Mail.

Also asked as: which app to publish on qdn · best q-app to upload files · where to publish a video on qortal · app for publishing a website qortal · how to publish different content qdn

## Q: How many services does QDN have?

A: Qortal Core has over 40 public services and 10 private ones, whose names end in _PRIVATE. Most people meet only a few: IMAGE, THUMBNAIL, VIDEO, AUDIO, FILE, DOCUMENT, JSON, WEBSITE and APP. The others are used by particular Q-Apps, for example STORE and PRODUCT for shops or BLOG_POST for blogs.

Also asked as: how many qdn services · list of qdn services · all qdn service types · how many services are on qdn · count of qdn services · number of services on qdn

## Q: What is the difference between single-file and multi-file QDN services?

A: Most services hold exactly one file or piece of data, such as one IMAGE, one VIDEO or one JSON text, and Qortal Core refuses more. A few can hold a whole folder: WEBSITE, APP, FILES, GIF_REPOSITORY, GAME, BLOG, DATABASE, SNAPSHOT and GIT_REPOSITORY. To read one file out of a multi-file resource, an app has to give that file's path inside it.

Also asked as: single file vs multi file qdn · which qdn services take folders · multi-file resource qdn · can i publish a folder on qdn · multi file qdn services · single file qdn services · qdn folder publish

## Q: What is an ARBITRARY transaction on Qortal?

A: It is the blockchain transaction type behind every QDN publish. It carries your name, the service, the identifier, a hash of the data (or the data itself when it is tiny) and the fee, and it is signed by your account. Nodes read these transactions to know what exists on QDN and which version of each resource is the newest.

Also asked as: arbitrary transaction qortal · what is an arbitrary tx · qdn transaction type · arbitrary transaction · qdn arbitrary transaction · arbitrary transaction meaning

## Q: Where does my node keep QDN files?

A: Qortal Core keeps QDN files in a folder called data inside its own folder, apart from the blockchain database in the db folder. Temporary files and the built copies of apps and websites sit under data/_temp. You can move the store with the dataPath setting in Core's settings.json.

Also asked as: qdn data folder location · where are qdn files on disk · qortal data folder · where does core store qdn · where are qdn files stored on my computer · qdn data folder · qdn storage folder

## Q: What QDN storage policies can a node use?

A: FOLLOWED_OR_VIEWED (the default): keeps names you follow and anything you open.
FOLLOWED: keeps only names you follow; other things you open are removed later.
VIEWED: keeps what you open but downloads nothing in advance.
ALL: tries to download and keep everything published.
NONE: keeps nothing.
Data from blocked names is never kept, whatever the policy.

Also asked as: qdn storage policy options · storagePolicy settings qortal · what is storage policy all · node storage policy qdn · qdn storage policies · storage policy qdn · list of storage policies

## Q: How do I change my node's QDN storage policy?

A: Close Qortal Core, open its settings.json and add a line such as "storagePolicy": "FOLLOWED", then start Core again. The value must be spelled exactly: FOLLOWED_OR_VIEWED, FOLLOWED, VIEWED, ALL or NONE. Core reports an error for any other value.

Also asked as: change storage policy qortal · set storagePolicy in settings.json · host only followed names · stop my node hosting viewed data · how to change qdn storage policy · change my storage policy · qdn storage setting

## Q: Where are my QDN follows stored?

A: Hosting follows, the ones made with the Follow button in apps like Q-Share and Q-Tube, are kept on your node, not on the blockchain and not in your account. Qortal Core keeps them in a small file in its lists folder. So every account that uses that node shares the same follows, and they don't come with you to another node or to the public node.

Also asked as: where are follows saved · followedNames list location · are qortal follows on the blockchain · do follows move to another node · where are my follows stored · where is the followedNames list · follow list stored where

## Q: What happens to hosted data when I unfollow a name?

A: Your node stops downloading that name's new publishes. With the default FOLLOWED_OR_VIEWED policy, what it already holds stays until storage cleanup needs the space. With the FOLLOWED policy, the cleanup removes that name's data on one of its next passes.

Also asked as: unfollow name delete data · stop hosting a name · unfollow qdn what happens · remove followed data · unfollow a name qdn · what happens when i unfollow · does unfollowing delete files

## Q: What is relay mode on QDN?

A: Relay mode lets your node pass QDN requests and chunks between other peers, even for data it doesn't host. Relayed chunks go into a temporary relay cache, not into your hosted data. It is on by default (relayModeEnabled in settings.json) and helps data reach nodes that can't connect to each other directly.

Also asked as: qdn relay mode · relayModeEnabled setting · does my node relay qdn data · relay qdn chunks · what is relay mode · qdn relay · relay mode qortal

## Q: How does my node find a QDN file?

A: It asks its connected data peers which of them hold the resource's chunks. When one does, your node can connect to it directly and download the chunks, checking each against its hash. If there is no direct path, requests can be relayed through other nodes. Content with many hosts arrives fastest.

Also asked as: how does qdn download work · how qdn finds files · qdn download from peers · where does my node get qdn data · how does my node get qdn files · how qdn downloads from peers · qdn fetch from peers

## Q: What are QDN data peers?

A: Since Qortal Core 6, QDN has its own peer connections, separate from the ones used for blocks. Data peers are the nodes yours is connected to for swapping QDN files. Hub and GO show how many under "QDN (data) peers" in the core information panel. With few data peers, QDN content can be slow to load.

Also asked as: qdn data peers meaning · qdn (data) peers in hub · data peers count low · qdn peers vs connected peers · qdn data peers · what does qdn data peers mean · qdn data network

## Q: Does my node need an open port to share QDN data?

A: It helps, but it isn't required. QDN uses its own data port, 12394, and Qortal Core tries to open it on your router by UPnP when it starts. Nodes that others can't reach directly, publishers included, can still get and share data through relays via better-connected nodes.

Also asked as: qdn port 12394 · port forwarding for qdn · open port for qdn hosting · qdn behind a router · open port for qdn · qdn port forwarding needed · do i need port forwarding to host qdn

## Q: Can I turn off QDN on my node?

A: Yes. Set "qdnEnabled": false in Qortal Core's settings.json and restart Core. The node then stores, serves and publishes no QDN data, so Q-Apps, websites and files won't load through it. The blockchain side keeps working.

Also asked as: disable qdn on node · qdnEnabled false · turn off qortal data network · node without qdn · turn off qdn · disable qdn · stop qdn hosting completely

## Q: Can I move my QDN data to another drive?

A: Yes. Close Qortal Core, move its data folder to the new drive, set "dataPath" in settings.json to the folder's new full path, and start Core again. If you point dataPath at an empty folder instead, your node starts with no QDN data and downloads what it hosts again.

Also asked as: move qdn data folder · dataPath setting qortal · qdn data on another drive · change qdn storage location · move qdn data to another drive · qdn data on external drive · store qdn on an external disk

## Q: Does every node know about every QDN resource?

A: Every synced node knows that each resource exists, because every publish is a transaction in the blockchain. Over time, nodes also fetch each resource's small metadata file with its title, description and tags. The files themselves are downloaded only for names a node follows, things it opens, or everything if its policy is ALL.

Also asked as: does my node know all qdn data · qdn index on every node · qdn search index · how does qdn search work · does every node have every qdn resource · do all nodes know all qdn content · node knows every qdn resource

## Q: Why are titles missing on some QDN items?

A: Titles, descriptions and tags live in a small metadata file published with the data. Until your node has fetched that file, apps can show only the name and identifier. Nodes fetch metadata in the background, so titles usually fill in later; a public node may lack them for older items.

Also asked as: qdn title missing · blank cards with no title · no title on qdn resource · missing description qdn · qdn titles missing · why no titles on qdn items · why blank titles in app list

## Q: What is a QDN metadata file?

A: It is a small JSON file published with most resources. It holds the title, description, tags and category, the list of chunk hashes, the file names inside the resource and its MIME type. Its hash is stored in the publish transaction, so it can't be changed afterwards.

Also asked as: qdn metadata file · metadata.json on qdn · where are qdn titles stored · what is the qdn metadata file · qdn metadata · qdn chunk list file

## Q: How long can a QDN title, description and tags be?

A: Title: up to 80 bytes, which is 80 plain letters; accented letters and other scripts use more than one byte each. Description: up to 240 bytes. Tags: up to 5, each at most 20 characters. Qortal Core cuts a title or description that is too long, and drops a tag that is too long rather than shortening it.

Also asked as: qdn title length limit · qdn description max length · how many tags on qdn · qdn tag length · qdn title limit · qdn tags limit · title description tags length qdn · metadata limits qdn

## Q: What categories can a QDN resource have?

A: A resource can carry one optional category from Qortal Core's list of about 50, such as Art and Design, Books and Reference, Cryptocurrency and Blockchain, Entertainment, Gaming, Music, News, Self-Sufficiency and Homesteading, Software, Tools, Video, Other and Uncategorized. Hub's publish form and the Q-Apps library use these categories to sort apps and websites.

Also asked as: qdn categories list · category when publishing qdn · app categories qortal · qdn resource category · qdn categories · what categories exist on qdn · which category for my app

## Q: Is public QDN data encrypted?

A: In a way. Qortal Core encrypts every upload with a fresh random key before cutting it into chunks, and the chunks stay encrypted on every node that stores them. But for public services that key is part of the public transaction, so any node can open the data, and your node keeps an unencrypted built copy of apps and sites you opened recently, for speed. To keep something private, use a _PRIVATE service, which your app encrypts for chosen people before upload.

Also asked as: is qdn data encrypted · qdn encryption for public data · are my public qdn files encrypted · are qdn chunks encrypted · is public data on qdn encrypted · qdn public data encryption · qdn aes key

## Q: What is the AUDIO service on QDN?

A: AUDIO holds one sound file, such as a song or a recording. Like VIDEO, it has no size limit of its own beyond the general 2 GiB per publish. Q-Apps such as Q-Mail, Q-Fund and Q-Shop use it for audio, and AUDIO_PRIVATE is the encrypted version.

Also asked as: qdn audio service · publish music on qdn · audio size limit qdn · AUDIO_PRIVATE service · qdn audio · audio service on qdn · upload a song to qortal

## Q: What is the difference between AUDIO, VOICE and PODCAST on QDN?

A: All three hold one sound file. AUDIO and PODCAST have no size limit of their own beyond the general 2 GiB per publish. VOICE is meant for voice recordings and is capped at 10 MB, as is its encrypted twin VOICE_PRIVATE.

Also asked as: voice service qdn · podcast service qdn · audio vs voice qdn · VOICE 10 mb limit · voice vs podcast qdn · qdn voice service limit · publish a podcast on qortal

## Q: What are the QCHAT services on QDN?

A: They are services set aside for files shared in Q-Chat: QCHAT_IMAGE (up to 500 KB), QCHAT_ATTACHMENT (up to 1 MB), and QCHAT_AUDIO and QCHAT_VOICE (up to 10 MB each). QCHAT_ATTACHMENT_PRIVATE (1 MB) is the encrypted form. QCHAT_ATTACHMENT takes only zip, pdf, txt, odt, ods, doc, docx, xls, xlsx, ppt and pptx files.

Also asked as: QCHAT_IMAGE service · QCHAT_ATTACHMENT file types · q-chat attachment service qdn · qchat services on qdn · qchat services · q-chat attachment file types · chat attachment size limit qdn

## Q: What is the ATTACHMENT service on QDN?

A: ATTACHMENT holds one file attached to something else, such as a mail, and is capped at 50 MB. ATTACHMENT_PRIVATE is the encrypted form with the same cap. Q-Mail uses it for mail attachments, so only the recipients can open them.

Also asked as: attachment service qdn · ATTACHMENT_PRIVATE service · q-mail attachment qdn · attachment 50 mb qdn · qdn attachment service · attachment size limit qdn · file attached to a mail qdn

## Q: What is the FILES service on QDN?

A: FILES holds a bundle of several files, or a folder, as one resource, unlike FILE, which takes a single file. It has no size limit of its own beyond the general 2 GiB per publish. To get one file out of the bundle, an app asks for that file's path inside it.

Also asked as: FILES service qdn · file bundle on qdn · FILE vs FILES · publish several files as one qdn · what is FILES on qdn · qdn multiple files one resource

## Q: What is DOCUMENT_PRIVATE used for?

A: DOCUMENT_PRIVATE holds one encrypted document. Hub and GO use it for things only certain people may read: a private group's secret key, encrypted for each member, and your saved settings and pinned apps, encrypted for yourself. Q-Mail keeps its saved mail state in it too. Its service number is 801, and it has no size limit of its own beyond the general 2 GiB.

Also asked as: DOCUMENT_PRIVATE service · private document qdn · encrypted document on qdn · what uses document_private · DOCUMENT_PRIVATE · what is DOCUMENT_PRIVATE · qdn private document

## Q: What are BLOG and BLOG_POST on QDN?

A: BLOG_POST holds one post, and BLOG can hold a whole blog as a folder of files. Blogging apps use them, and so do others: Q-Mintership, for example, publishes its forum messages as BLOG_POST. Neither has a size limit of its own beyond the general 2 GiB.

Also asked as: BLOG_POST service · blog service qdn · publish a blog on qortal · blog post on qdn · blog post service qdn · qdn blog service · q-mintership forum service

## Q: What is the COMMENT service on QDN?

A: COMMENT holds one comment of up to 500 KB, published under the commenter's name. It differs from BLOG_COMMENT, which blogging apps use for comments on posts (also 500 KB), and from CHAIN_COMMENT, which is tiny (239 bytes) and kept fully on-chain.

Also asked as: COMMENT service qdn · comment size limit qdn · comments on qdn · COMMENT vs CHAIN_COMMENT · qdn comment service · comment service on qdn · qdn comment 500 kb

## Q: What is the PLAYLIST service on QDN?

A: PLAYLIST holds one list that groups other resources, such as the videos of a series. Q-Tube uses it for playlists, with identifiers starting qtube_playlist_. The videos themselves are separate VIDEO publishes.

Also asked as: PLAYLIST service qdn · q-tube playlist on qdn · series playlist qortal · qtube_playlist identifier · qdn playlist service · playlists on qdn · qdn playlists

## Q: What are STORE and PRODUCT on QDN?

A: They are services for shops. Q-Shop publishes a shop as a STORE resource and its items as PRODUCT resources under the seller's name, and keeps other shop data in DOCUMENT and DOCUMENT_PRIVATE. OFFER and COUPON also exist for shop offers and coupons.

Also asked as: STORE service qdn · PRODUCT service qdn · q-shop qdn services · shop data on qdn · qdn shop services · store and product services · OFFER and COUPON qdn

## Q: What other services does QDN have?

A: Besides the common ones, Qortal Core also has PLUGIN, EXTENSION, ITEM, DATABASE, SNAPSHOT, GIT_REPOSITORY, METADATA, ARBITRARY_DATA and CHAIN_DATA (239 bytes, kept on-chain). They are for more specialised uses. DATABASE, SNAPSHOT, GIT_REPOSITORY and ARBITRARY_DATA can hold folders; the others hold one file.

Also asked as: other qdn services · rare qdn services · PLUGIN EXTENSION DATABASE qdn · GIT_REPOSITORY service · more qdn services · rarely used qdn services · less common qdn services

## Q: What is CHAIN_DATA on QDN?

A: CHAIN_DATA holds a tiny piece of data, up to 239 bytes, stored entirely inside the blockchain transaction, like CHAIN_COMMENT. Because nothing has to be fetched from peers, every synced node has it at once.

Also asked as: CHAIN_DATA service · on-chain data service qdn · 239 bytes chain data · chain_data · tiny data on the blockchain qortal

## Q: How do I publish a file bigger than 2 GB on QDN?

A: Split it into parts of 2 GB or less and publish each part as its own resource, with identifiers that show the order. Whoever downloads them joins the parts again afterwards. GO's offline helper Qortino is published this way, in two parts, because QDN takes at most 2 GiB per file.

Also asked as: publish file over 2gb qdn · split a large file for qdn · bigger than 2 gb qortal · qdn 2gb limit workaround · file bigger than 2gb qdn · publish a file over 2 gb · upload a huge file to qdn

## Q: What does GO's Publishing to QDN window show?

A: When a Q-App publishes a big file (5 MB or more), or a publish takes over 8 seconds, GO shows its own Publishing to QDN window. It shows each file's progress, the speed and the time left. You can minimize it into a small bubble and keep using the app; tap the bubble to see it again. It tells you when everything is published, or why a publish failed.

Also asked as: what is the publish bubble in go · minimize a qdn upload in go · go upload window time left · qdn upload progress in go · go publishing window · publishing to qdn window in go · use another app while go publishes

## Q: What do Processing and Retrying mean while publishing to QDN?

A: Processing means every part of the file is on your node, and the node is putting it together and preparing the transaction for signing. Retrying means your node did not answer, so GO tries again shortly. If the node refuses a publish outright, for example for a missing API key, it stops at once and says why.

Also asked as: publish processing meaning · publish retrying in go · your node did not answer trying again · stuck on processing publish · publish processing · publish retrying · qdn publish status meanings

## Q: Does QDN compress my files?

A: Yes. Qortal Core zips everything it stores off-chain before encrypting it and cutting it into chunks. Tiny data that fits fully on-chain is stored without compression.

Also asked as: does qdn compress files · qdn zip compression · are uploads compressed on qortal · qdn compression · are qdn files compressed · qdn file compression

## Q: Can I publish the same file twice on QDN?

A: Yes, as two separate resources with different identifiers, names or services. Each is its own publish with its own fee, and nodes store each copy separately. Publishing again to the same name, service and identifier doesn't add a copy: it replaces the old version.

Also asked as: publish the same file twice qdn · duplicate publish on qdn · two copies of a file on qdn · publish a file twice · same file two identifiers qdn · republish same file with new identifier

## Q: What is an app fee on a QDN publish?

A: Some Q-Apps ask for a small payment to an address they name, along with a publish. The approval window then shows the app fee on top of the publish fee, and you must tick "accept app fee" to go ahead. The payment is sent after the publish succeeds; if it fails, you are told the publish went through but the app fee was not sent.

Also asked as: app fee on qdn publish · accept app fee · why does an app charge an extra fee · app fee not sent · app fee publish · what is an app fee · q-app publish payment

## Q: Why did only some of my files publish to QDN?

A: When an app publishes several files at once, each is its own publish, so some can fail while others succeed. GO's publish window then says "Some files did not publish" and marks each file. Retry only the failed ones, and check first that they really are missing, so you don't pay twice.

Also asked as: some files did not publish · some resources have failed to publish · partial publish qdn · only some files uploaded · some files failed to publish · only some of my files published · multi file publish failed

## Q: Why can't I publish right after registering a name?

A: The name you publish under must already be registered on the blockchain, and a new registration only counts once it is in a block. Until then, a publish fails with "Name not found". Wait a minute or two and try again, and check that the publish uses a name your account owns, spelled exactly.

Also asked as: publish fails after registering name · new name cant publish yet · qdn error name not found · just registered name publish error · publish right after registering a name · name not found after registering · registered name not found when publishing

## Q: Does updating a QDN resource upload the whole file again?

A: Yes. Every update is a complete new version: you send the whole file, or the whole website or app zip, again. Qortal Core doesn't upload only the changed parts, and other nodes then fetch the new version in full.

Also asked as: qdn update uploads everything · update only the changed files qdn · does qdn upload the whole zip again · partial update on qdn · does an update upload everything again · qdn update whole file · website update upload size

## Q: Why does an app say a QDN item was deleted by its publisher?

A: The publisher replaced the item with a delete marker, for example the single letter D, at the same name, service and identifier. Apps such as Q-Share and Torq read that as deleted and hide the item. The earlier publish is still recorded on the blockchain, but nodes stop serving its old files.

Also asked as: deleted by its publisher · qdn delete marker · what does D mean on qdn · share was deleted in q-share · deleted by publisher qdn · item deleted by its publisher · deleted post on qdn

## Q: Can I remove QDN data from my own node?

A: Yes. A Q-App that manages hosted data can remove copies your node holds; the Qortal wiki points to the Host-Monitor-Plus Q-App for viewing and managing what your node shares. Hub and GO ask "allow this app to delete N hosted resources?" first. Blocking a name also removes its data from your node. This only affects your node, other nodes keep their copies, and it isn't possible on a public node.

Also asked as: delete hosted data from my node · remove cached qdn files · free space from qdn hosted data · clear qdn data on my node · remove qdn data from my node · delete hosted data · delete a local copy of qdn data

## Q: What is hosted data on Qortal?

A: Hosted data is the QDN content your node currently stores and serves to others: your own uploads, the names you follow and things you opened. A Q-App can show you the list, but Hub and GO ask "allow this app to get a list of your hosted data?" first, and it doesn't work on a public node.

Also asked as: what is hosted data · list my hosted qdn data · see what my node hosts · hosted resources on qortal · hosted data qortal · what is my hosted data · which qdn files does my node store

## Q: Does blocking a name remove its content for everyone?

A: No. Blocking changes only your own node: it stops fetching, holding and showing that name's data. Every other node decides for itself. That is how QDN avoids a central switch that could remove content for everyone.

Also asked as: does blocking remove content for everyone · block a name network wide · global block on qdn · can qortal ban content · does blocking a name affect everyone · block name for everyone qdn · does my block affect other users

## Q: What is the difference between blocking a name and blocking an address?

A: Blocking a name is about QDN: your node stops fetching and showing that name's published data. Blocking an address is about transactions: your node stops processing things such as chat messages from that address. Hub and GO let you block either one or both.

Also asked as: block name vs block address · blocked addresses vs blocked names · block txs vs block qdn data · block name or address · blocking an address vs a name · difference between blocking a name and an address

## Q: Can I unblock a name and get its QDN content back?

A: Yes. Remove the name from your blocked list, and your node fetches and serves that name's data again, following your storage policy. Anything your node deleted while the name was blocked has to be downloaded again, from nodes that still host it.

Also asked as: unblock name qdn content · get blocked content back · unblock publisher qortal · undo block qdn data · unblock a name qdn · unblock qdn content · content after unblocking

## Q: Can I see the history of a QDN resource?

A: Partly. Every publish to a resource is a transaction kept on the blockchain, so the times, sizes and hashes of all its versions stay on record, and search tools can list them. The files of older versions, though, are deleted by nodes once a newer version exists.

Also asked as: qdn resource history · list all versions of a qdn resource · old publishes on qdn · qdn version records · qdn version history · history of a qdn resource · see previous publishes of a resource

## Q: What does the Published status mean on QDN?

A: Your node knows the resource exists, from its publish on the blockchain, but hasn't downloaded any of its files yet. Opening it, or following the name, makes your node start fetching it. In the Q-Apps library, such apps show a Download button instead of Open.

Also asked as: published status qdn · status published but not downloaded · qdn resource published meaning · app shows published status · what does published status mean · published status meaning · published not yet downloaded

## Q: What does "Building resource..." mean on a QDN loading page?

A: Your node has every file of the resource and is building it: joining the chunks, decrypting them and unpacking the result so it can be shown. "Files downloaded, preparing..." is the step just before. It is usually quick, large apps and websites take longer, and the page reloads by itself when it's ready.

Also asked as: building resource qdn · files downloaded preparing · qdn building status · stuck on building resource · building resource · qdn building resource meaning · what does building mean qdn

## Q: What does "peers available" mean on a QDN loading page?

A: While your node downloads a resource, the loading page shows how many peers are taking part in that transfer. More peers usually means a faster download. If no count shows, your node hasn't found anyone with the data yet.

Also asked as: peers available on loading page · qdn peers available meaning · how many peers have this file · peers available · loading page peers available · loading page peer count

## Q: What is the difference between Downloaded and Ready on QDN?

A: Downloaded means every file of the resource is on your node, but it hasn't been built yet. Ready means it has been built, joined, decrypted and unpacked into a copy that can be shown at once. A Downloaded resource becomes Ready the next time it is opened, after a short build.

Also asked as: downloaded vs ready qdn · status downloaded meaning · qdn ready status · difference between downloaded and ready · downloaded vs ready · downloaded status qdn · resource downloaded but not ready

## Q: What does Gathering from QDN mean in GO?

A: When you save a QDN file in GO, it first shows "Looking for the file on QDN...", then "Gathering from QDN" with a percentage and a count of chunks while your node collects them from peers. After that the file downloads from your node to the phone and is saved. A count that doesn't move means no peer is sending the file right now.

Also asked as: gathering from qdn go · looking for the file on qdn · go download gathering chunks · qdn download stages in go · gathering from qdn · what is gathering from qdn · gathering from qdn percent

## Q: How big can a website be on QDN?

A: Hub's website form takes a zip of up to 400 MB, and Qortal Core allows up to 2 GiB per publish. Smaller is better, though: every visitor's node has to fetch the whole site before showing it.

Also asked as: website size limit qdn · max website zip size · 400 mb website limit in hub · how big can my qortal site be · qdn website size · website size on qdn · large website on qdn

## Q: Can I use my own domain name for a QDN website?

A: Yes, with a node you run. Point the domain at that node with DNS A or CNAME records, then turn on Qortal Core's domain map in settings.json: "domainMapEnabled": true and a domainMap list of domain and name pairs. The node then serves that name's website for the domain, on port 80 by default. The site itself still lives on QDN under your name.

Also asked as: custom domain for a qdn website · domain map qortal · my own domain for a qortal site · dns domain for qdn website · own domain qdn website · custom domain qortal website · domainMapEnabled setting

## Q: Can my QDN website link to other QDN sites and images?

A: Yes, with qortal:// links. qortal://WEBSITE/QortalDemo opens another site's home page, and qortal://WEBSITE/QortalDemo/page.html one of its pages. You can also use a qortal:// link as an image source, for example qortal://THUMBNAIL/QortalDemo/qortal_avatar for that name's avatar. Hub and GO open such links inside Qortal.

Also asked as: link to another qdn website · qortal links in my website · show an image from another name qdn · link between qdn sites · link to other qdn sites · qortal links in a website · img src qortal link

## Q: Can I publish a website from Qortal GO?

A: Yes, if GO is connected to your own node or to a private node you have the API key for: the My apps tab in GO's Q-Apps library has the same publish website form as Hub. On the public node it doesn't work, because the public node doesn't take uploads.

Also asked as: publish website from go · publish site on my phone qortal · go my apps publish website · upload website with qortal go · publish website go · publish a website on my phone · phone website publish qdn

## Q: Can I share a qortal:// link with people outside Qortal?

A: You can send it anywhere, but it opens only for people who have Qortal Hub or Qortal GO. On Android, a tapped qortal:// link opens GO directly. Web links on the qortal.link gateway hosts can open in GO too (Android may ask which app to use), and GO turns them into the same qortal:// link.

Also asked as: share a qortal link outside qortal · send a qortal link to a friend · qortal.link web link opens go · qortal link in a messenger · share qortal link · send qortal link outside qortal · does a qortal link work in a browser

## Q: Why does my qortal:// link to a + app open a blank tab?

A: Write app names that contain a plus, such as POS+, with the plus itself: qortal://APP/POS+. Written as %2B, Hub opens a blank tab, because it doesn't decode the app name. Spaces and special characters later in the link should be encoded, a space as %20, the way Hub's own copy link does it.

Also asked as: qortal link plus sign blank tab · Q-Share+ link not working · %2B in a qortal link · app name with a plus in a link · qortal link blank tab · plus sign in qortal link · qortal link encoding

## Q: What does default mean in a qortal:// link?

A: default stands for no identifier. So qortal://WEBSITE/QortalDemo/default is the same as qortal://WEBSITE/QortalDemo, the name's main website. It helps when you add a path and want it clear that there is no identifier, as in qortal://WEBSITE/QortalDemo/default/page.html.

Also asked as: default in a qortal link · qortal link with default · qortal website default path · default qortal link · qortal link default · default identifier in link

## Q: Can a qortal:// link point to an image or a single file?

A: Yes. Any resource can be linked: qortal://THUMBNAIL/QortalDemo/qortal_avatar points to that name's avatar, and a link with IMAGE, VIDEO, FILE or DOCUMENT plus the name and identifier points to that item. Websites can use the same links as image sources, so pictures load straight from QDN.

Also asked as: qortal link to an image · link to a qdn file · qortal link to a video · qortal thumbnail link · qortal link to a file · qortal link to image · link a single qdn resource

## Q: What other kinds of qortal:// links are there?

A: Besides links to resources, Hub and GO understand group links such as qortal://use-group/action-join/groupid-<number>, which offer to join that group, and qortal://use-embed/ links, which show a poll, image or file inside a chat message. GO also opens payment links such as qortal://pay?recipient=<name or address>&amount=5, with the Send screen filled in for you to confirm; Hub 3.0.3 doesn't open payment links.

Also asked as: types of qortal links · qortal pay link · qortal use-group link · qortal payment link format · kinds of qortal links · qortal link types · use-group join link · qortal join group link

## Q: What is a qortal://use-embed link?

A: It is a link that Hub and GO show as an embedded item in a chat message: a poll, an image or an attachment stored on QDN. Apps create it and copy it for you to paste. For an encrypted image or file, the link itself carries the decryption key, so anyone who gets the link can open the item.

Also asked as: qortal use-embed link · embed link in q-chat · use-embed image link · embedded poll link qortal · use-embed link · qortal embed link · encrypted embed link key

## Q: Can a qortal:// link take my QORT?

A: Not by itself. A qortal:// link only opens a resource, an app or a filled-in form. A payment link opens the Send screen with the recipient and amount filled in, and nothing is sent until you confirm. Check the details first, because a sent payment can't be undone.

Also asked as: are qortal links safe · can a qortal link steal qort · qortal link security · tapping a payment link on qortal · is a qortal link safe · qortal payment link safe · malicious qortal link

## Q: Can I link to a page inside a Q-App?

A: Yes. Add the path after the app name, as in qortal://APP/Torq/post/ followed by the post's identifier; the app opens on that page if it supports such links. Many apps' own Copy link buttons build these links for you.

Also asked as: link to a page inside a q-app · deep link into a q-app · qortal link to app page · share a page of a q-app · qortal link to a page in an app · link inside a q-app · qortal app path link

## Q: Why does my node use bandwidth when I'm not doing anything?

A: Your node works in the background: it downloads new publishes from names you follow, fetches small metadata files for QDN items, sends chunks to other nodes that ask for data you host, and relays data for others. To cut this down, follow fewer names, set a storage limit, or change the storage policy.

Also asked as: node uses bandwidth idle · qdn traffic in the background · why is my node uploading · qdn bandwidth usage · node bandwidth idle · why does my node use bandwidth · node downloading by itself

## Q: Can I encrypt QDN data for several people at once?

A: Yes. An app can give several public keys when it encrypts, and each of those people can then open the same resource. Q-Mail does this for group threads and Bcc copies, encrypting to every recipient's key.

Also asked as: encrypt for several people qdn · multiple recipients private qdn · share an encrypted file with many people · qdn encryption public keys list · encrypt for several people · private file for several people qdn · private data for many users

## Q: Can I keep private files on QDN that only I can open?

A: Yes. An app can encrypt data for your own key alone and publish it to a _PRIVATE service, so only your account can decrypt it. Hub and GO do this when you save your pinned apps to QDN, and Q-Mail when it saves its mail state. Others can still see that the resource exists, just not what's in it.

Also asked as: private backup on qdn · store my own files privately on qdn · encrypt for myself qortal · qdn private storage · private files only i can open · encrypt qdn data for myself · save settings encrypted on qdn

## Q: Are private QDN resources hosted like public ones?

A: Yes. Nodes that follow the publisher or open the resource store and share its chunks the same way. The data is encrypted, so the hosting nodes can't read it; only the chosen recipients can.

Also asked as: are private qdn files hosted · who hosts private qdn data · private data on other nodes · do followers store my private qdn data · private qdn resources hosted · are private resources hosted · hosting encrypted qdn resources

## Q: What is group-encrypted data on QDN?

A: It is data encrypted with a private group's shared key, so any member can open it and outsiders can't. The group's admins publish that key, the group secret key, encrypted for each member, as a DOCUMENT_PRIVATE resource on QDN. Hub and GO use it for a private group's Threads, and for its chat only when Reticulum chat is turned off; private Q-Apps are shared with a group this way too.

Also asked as: group encrypted data qdn · private group data on qdn · encrypt for a group qortal · group key qdn data · group encrypted qdn · group encryption qdn data · who can read group encrypted data

## Q: Why does a QDN item show an old created date after I updated it?

A: QDN keeps two times for each resource: created, from its very first publish, and updated, from the newest one. An update changes only the updated time, so apps that sort by created date keep showing your item where it first appeared.

Also asked as: qdn created date after update · created vs updated qdn · update date not changing qdn · qdn resource dates · why does my update show the old date · qdn updated time

## Q: Why do QDN identifiers look like random strings?

A: Apps usually build identifiers from a short app prefix plus a random part, such as qshare_file_ followed by the title and a random code, so every item gets its own address and the app can find its own data by the prefix. Some apps, like those built on qapp-core, also turn words into hashed identifiers for privacy.

Also asked as: qdn identifier random letters · why is the identifier so long · random code in qdn identifier · qdn identifier format · what is qshare_file_ identifier · identifier gibberish qdn

## Q: Can I change the identifier of something I published?

A: No. The identifier is part of the resource's address. To use a new one, publish the content again under the new identifier, which makes a separate resource with its own fee, and if you want the old one gone, replace it with a delete marker.

Also asked as: rename a qdn identifier · change identifier after publishing · move a resource to a new identifier · edit identifier on qdn · change identifier qdn · rename identifier · wrong identifier published

## Q: Can I move QDN content to a different name?

A: Not directly. Content belongs to the name it was published under. You can publish it again under another name you own, as new resources with their own fees, or transfer the whole name, which moves control of everything published under it.

Also asked as: move qdn content to another name · transfer my files to a new name · change the name of my published content · republish under another name · move qdn content to a different name · move content between names · qdn content to a new name

## Q: Why does a QDN loading page reload by itself?

A: The loading page checks the resource's status every few seconds while your node downloads and builds it. As soon as the status is Ready, the page reloads itself and the app or site appears in its place.

Also asked as: qdn loading page reloads · loading page refreshes itself · page refreshes when ready · qdn loading page keeps reloading · loading page reloads by itself · qdn page reloads itself · retrieving content from the qortal data network

## Q: Why does my QDN publish take so long?

A: Three steps take time: uploading the file to your node, the node zipping, encrypting and chunking it, and then other nodes fetching it. A big file over a slow link to your node can take many minutes, and GO's publish window shows the speed and the time left. Let it finish before you close the app.

Also asked as: qdn publish is slow · why is uploading taking so long · publish taking forever · long upload time on qdn · qdn publish takes long · why is my publish so slow · speed up a qdn publish

## Q: Can I see who hosts my QDN content?

A: Not by name. Hosting follows are private settings on each node, so there is no public list of who hosts your content. While a resource downloads, the loading page shows how many peers are sending it, which gives a rough idea. Torq follows, which are published, are a different thing.

Also asked as: who hosts my qdn content · see who follows my name for hosting · how many nodes have my files · list of nodes hosting my data · see who hosts my content · who hosts my qdn data · who is seeding my qdn data

## Q: What are the private QDN services and their size limits?

A: QCHAT_ATTACHMENT_PRIVATE 1 MB, ATTACHMENT_PRIVATE 50 MB, FILE_PRIVATE, IMAGE_PRIVATE 10 MB, VIDEO_PRIVATE, AUDIO_PRIVATE, VOICE_PRIVATE 10 MB, DOCUMENT_PRIVATE, MAIL_PRIVATE 5 MB and MESSAGE_PRIVATE 1 MB. Those without a figure have no cap of their own beyond the general 2 GiB per publish. All of them accept only data the app has encrypted.

Also asked as: list of private qdn services · _PRIVATE services limits · MAIL_PRIVATE 5 mb · FILE_PRIVATE service · private qdn services · private services size limits · encrypted services on qdn

## Q: What files can a GIF_REPOSITORY contain?

A: Only .gif files, at least one, with no folders inside, up to 25 MB in total. Qortal Core refuses a GIF collection that holds anything else.

Also asked as: gif repository rules · publish a gif collection on qdn · GIF_REPOSITORY limit · gif pack on qortal · what is allowed in a gif repository · why was my gif collection rejected

## Q: What does Build failed mean on QDN?

A: Your node had the files but couldn't put the resource together, for example because some data didn't check out. The status says "Build failed. Please try again later". Wait a while, then open it again.

Also asked as: build failed qdn · build failed please try again later · qdn resource failed to build · build failed · qdn build failed meaning · app build failed on qortal

## Q: Does bootstrapping my node delete my QDN data?

A: No. A bootstrap replaces the blockchain database in the db folder. The QDN files in the data folder stay where they are.

Also asked as: bootstrap deletes qdn data · does bootstrap remove my hosted files · qdn data after a bootstrap · bootstrap qdn data · does bootstrap delete qdn files · bootstrap keeps the data folder

## Q: Can I copy files straight out of my node's data folder?

A: Not usefully. The data folder holds QDN data as compressed, encrypted chunks, filed by transaction and hash, not as the original files. To get a file back, download or save it through a Q-App, Hub or GO.

Also asked as: open files in the qortal data folder · where are the real files in qdn data · copy qdn files from disk · data folder chunks unreadable · copy files from data folder · files in data folder qortal · extract files from qortal data

## Q: Does QDN have folders?

A: Not in the way a disk does. Every item is just a name, a service and an identifier, and apps group items by giving their identifiers a shared start, such as qshare_file_. Only multi-file services like WEBSITE, APP and FILES hold real folders, inside one resource.

Also asked as: qdn folders · can i make folders on qdn · qdn directory structure · organize qdn files in folders · folders on qdn · does qdn support folders · folders in the qortal data network

## Q: What happens to my data if a Q-App stops being available?

A: Your data stays: it is published under your name, not inside the app, and lasts as long as nodes host it. Any app that understands the same services and identifiers can still read it. The app itself is a QDN resource too, so it comes back if a node still hosts it or its publisher publishes it again.

Also asked as: q-app disappeared what about my data · app gone what happens to my files · q-app no longer works data lost · my data if an app is removed · data if a q-app disappears · q-app removed my data · app unavailable qdn data

## Q: What are lists on a Qortal node?

A: Lists are small files your node keeps for its own settings, such as followedNames for the names it hosts and blockedNames for the names it blocks. Q-Apps can read and change them with your approval. They live only on that node, in Core's lists folder, and a public node doesn't let apps use them.

Also asked as: qortal node lists · followedNames and blockedNames lists · what is the lists folder · node lists for q-apps · node lists qortal · what are node lists · local lists on qortal

## Q: Why does an app ask to access my list?

A: Lists such as followedNames and blockedNames are kept on your node, and Hub and GO ask before an app reads or changes one: "allow this app to access the list?". Q-Share asks, for example, to show your Following feed or to follow a name. For apps you trust, you can tick "always allow lists to be retrieved automatically".

Also asked as: allow this app to access the list · why does q-share ask for my list · followedNames permission · list permission popup · app wants to access my list · list access permission · always allow lists to be retrieved

## Q: Why doesn't my app or website show in the Q-Apps library yet?

A: The library lists each name's main app and website, the ones published without an identifier, and Hub and GO refresh that list about every 20 minutes. Give it some time after publishing. A resource published with an identifier doesn't appear there at all.

Also asked as: my app is not in the q-apps library · website not showing in the library · published app missing from library · library not updated with my new app · my website not in q-apps library · app not showing in library yet · q-apps library refresh

## Q: Is there a limit on how much I can publish on QDN?

A: There is no quota per name or account. Each publish has its own size limit, 2 GiB at most, and costs a fee, and your content takes up space on every node that hosts it.

Also asked as: qdn publish quota · how much can i upload to qdn · limit on number of publishes · qdn storage quota per name · limit on publishing qdn · how much can i publish on qdn · unlimited publishing on qdn

## Q: Can I publish under my name from two devices?

A: Yes. Any device signed in to the account that owns the name can publish under it, from Hub or from GO with a node that takes uploads. If both publish to the same name, service and identifier, the newer publish wins.

Also asked as: publish from two devices · same name on hub and go · publish from phone and pc · two devices one qortal name · publish from two devices same name · two devices publish qdn · which publish wins with two devices

## Q: Should my node use the ALL storage policy?

A: Only with plenty of disk space and bandwidth. ALL makes your node download and keep everything published on QDN by every name, which adds copies for everyone but fills storage quickly; Core still stops fetching at 80% of its limit. For most nodes, the default FOLLOWED_OR_VIEWED, plus following the names you care about, is enough.

Also asked as: storage policy all · host everything on qdn · should i use the ALL policy · download all qdn data · all storage policy · should i host everything on qdn · full qdn mirror node

## Q: Can I use QDN as cloud storage for my files?

A: Partly. You can publish files, encrypted for yourself if you like, and reach them through any node that holds them. But QDN keeps a file only while some node hosts it, and the record of every publish is public, so it isn't a backup service: keep your own copies too.

Also asked as: qdn as cloud storage · store my backups on qdn · qortal cloud drive · use qdn as an online drive · qdn cloud storage · use qdn for backups · is qdn a backup service

## Q: Does each node keep whole QDN files or just pieces?

A: A node that hosts a resource normally keeps all of its chunks, so it can serve the whole thing. When a node runs short of space, it deletes chunks at random, so some nodes end up holding only parts. Your node can collect different chunks from different peers and checks each one against its hash.

Also asked as: do nodes store whole qdn files · partial qdn files on nodes · chunks spread across nodes · qdn pieces like torrents · nodes keep whole files or pieces · do nodes keep all chunks · node keeps only some chunks

## Q: Why is there a .qortal folder in my website files?

A: Qortal Core adds a small hidden .qortal folder to multi-file resources such as websites and apps, for its own bookkeeping. It doesn't count towards the size limit, and you don't need to add, edit or remove it.

Also asked as: .qortal folder · hidden qortal folder in my website · what is the .qortal directory · qortal folder in website · why is there a .qortal folder · qortal metadata folder

## Q: Does QDN keep the original file name?

A: Yes, when the app sends one: a publish can carry a file name, and the metadata lists the file names inside a resource and its file type. So downloads usually come back with their names. If an app published data without one, you choose a name when you save it.

Also asked as: qdn keeps the file name · original filename on qdn · download name of a qdn file · qdn mime type · qdn original file name · does qdn keep file names · file type kept on qdn

## Q: Does following a name protect its data from cleanup?

A: Not fully. When storage passes 90% of its limit, your node deletes chunks at random from everything except your own uploads, followed names included. It downloads followed names again only once usage is back under 80%.

Also asked as: followed data deleted when storage is full · does following keep data safe · follow name protects data · cleanup deletes followed names · following protects data · does following stop cleanup · followed content removed when node full

## Q: Does following someone on Torq make my node host their content?

A: No. A Torq follow is a social follow that Torq publishes, so their posts show in your Following feed. Hosting is a separate setting: to have your node keep someone's QDN data, follow their name with the Follow button in an app such as Q-Share or Q-Tube.

Also asked as: torq follow host data · does a torq follow download posts · torq follow vs node follow · follow on torq hosting · torq follow hosting · does torq follow host content · torq following and storage

## Q: Why do some names with spaces or symbols fail to open on QDN?

A: Names can contain spaces, a plus, a slash and letters from many languages, and some apps and links don't encode them properly, so the address breaks. Hub's own copy link writes a space as %20. If content from such a name won't open in one app, the app's handling of the name is usually the cause, not the data.

Also asked as: name with spaces breaks qdn link · special characters in a name qdn · name with a slash wont load · qortal name with a plus sign · names with spaces qdn · name with symbols wont open · non latin name qdn app error

## Q: How does Qortal Core 6 make QDN downloads faster?

A: Core 6 moved QDN onto its own network connections, separate from block syncing. It also remembers how fast each peer has sent data before and prefers peers that keep up, and it builds Q-Apps faster by decrypting while it unpacks.

Also asked as: core 6 qdn speed · qdn faster in core 6 · qdn transfer speed improvements · core v6 qdn changes · core 6 qdn faster · qdn download speed core 6 · why is qdn faster now

## Q: How many QDN data peers can my node have?

A: By default Qortal Core keeps up to 64 slots for QDN data peers, set with maxDataPeers in settings.json. A peer connected for QDN data is also dropped after about 30 minutes, so data connections keep changing.

Also asked as: maxDataPeers setting · number of qdn data peers · how many data peers on qortal · qdn peer limit · qdn data peers limit · how many qdn data peers · data peer connection time

## Q: Can I host QDN data without minting?

A: Yes. Hosting and minting are separate: any node with QDN turned on stores what it follows and opens, whether it mints or not. Minting needs minting rights; hosting needs only disk space and bandwidth.

Also asked as: host qdn without minting · do i need to mint to host data · non minter qdn hosting · hosting and minting qortal · hosting without minting · host qdn data without minting · qdn node that does not mint

## Q: Can I turn off QDN relay mode?

A: Yes. Close Qortal Core, add "relayModeEnabled": false to its settings.json and start Core again. Your node then passes on only data it hosts itself. Relaying is optional, but it helps data reach nodes that can't connect directly, including publishers without port forwarding.

Also asked as: disable qdn relay · relayModeEnabled false · stop relaying qdn data · turn off relay mode qortal · turn off relay mode · disable relay mode qdn · opt out of qdn relay

## Q: Can my internet provider see what QDN data my node handles?

A: They can see that your node exchanges encrypted data with other Qortal nodes, but not what it is at a glance. For public data, though, the decryption keys are on the public blockchain, so someone who runs Qortal and looks hard enough could match and decrypt it. Private data stays unreadable to them. A VPN hides the traffic from your provider, but then the VPN provider sees it.

Also asked as: can my isp see qdn data · isp spying on qortal traffic · is qdn traffic private · vpn for qortal qdn · isp see qdn traffic · can my isp see my qortal data · can someone see what my node relays

## Q: Can I put my WordPress site on QDN?

A: Only as a static copy. Export the site to plain HTML, CSS and JavaScript (WordPress plugins such as Simply Static can do this), zip it with index.html at the top and publish it as a website. Anything that needs the WordPress server, such as comments, forms, shops or logins, won't work, and some sites convert better than others.

Also asked as: wordpress on qdn · convert my website to static for qortal · move my existing site to qortal · static copy of a website for qdn · wordpress qortal · put wordpress site on qortal · httrack qortal website

## Q: Do private Q-Apps get updates like other Q-Apps?

A: Yes, when the group admin who published it publishes a new zip to the same identifier; it is encrypted for the group again and replaces the old version. Members get the new version the next time they open it, and in GO, Refresh builds the app again from the latest copy.

Also asked as: update a private q-app · private app new version · republish private app · private q-app refresh · private app update group

## Q: Is a QDN publish usable before it is in a block?

A: Yes. As soon as nodes receive your unconfirmed publish transaction, they know the resource exists and can fetch it, so it can open before a block includes it. That is why a publish can show up within minutes.

Also asked as: unconfirmed qdn publish · do i wait for a block after publishing · qdn publish confirmation · publish available before confirmed · publish before block · qdn publish before confirmation · unconfirmed arbitrary transaction

## Q: What is the difference between a public and a private QDN gateway?

A: A public gateway lets ordinary browsers reach anything published on QDN. A private gateway is set up for one resource only, such as a single website mapped to its own domain, so people can visit that site through it but can't use it to reach other QDN content.

Also asked as: public vs private gateway · private gateway for one website · gateway for a single name · qdn gateway types · public gateway vs private gateway · private qdn gateway · company website gateway qortal

## Q: Where do I see the apps and websites I published?

A: In the Q-Apps library's My apps tab in Hub or GO. It lists your published apps and your published websites for your names, with buttons to update them or publish something new.

Also asked as: my published apps · my published websites · see what i published in hub · my apps tab published · where are my published apps · apps i published · list of my qdn apps

## Q: Does my node share QDN data while my computer sleeps?

A: No. Qortal Core has to be running for your node to share data, so while the computer sleeps or is off, other nodes can't get anything from it. The Hub window itself doesn't need to be open, only Core.

Also asked as: node sleeping qdn hosting · computer asleep host data · does qdn work when pc is off · keep hub open to host · does my node host while my computer sleeps · computer sleep qdn sharing · core running to share data

## Q: Can I make a public QDN resource private later?

A: Not the copy that is already out. You can publish an encrypted version to a _PRIVATE service and replace the public one with a delete marker, so nodes stop serving it. But anyone who opened or saved the public version may still have it, and the record of the public publish stays on the blockchain.

Also asked as: make public file private qdn · change public to private qdn · hide a public qdn resource · convert public publish to private · make public resource private · public to private qdn later · regret public publish qdn

## Q: Can I change who can open a private QDN resource?

A: Only by publishing it again. To add or remove people, the app encrypts the data again for the new list of keys and publishes it as a new version; nodes then drop the old version. Someone you remove can't open the new version, but whatever they already opened or saved, they keep.

Also asked as: add someone to a private qdn file · remove access to private qdn data · revoke access private resource · share private file with new person · change who can open private qdn · who can open my private file change · change recipients private qdn

## Q: Why does a page say "QDN is disabled in settings"?

A: The node you use has QDN switched off with "qdnEnabled": false in its settings.json, so it doesn't load or publish any QDN content. If it's your node, change the value to true, or remove the line, and restart Qortal Core.

Also asked as: qdn is disabled in settings · qdn disabled error · turn qdn back on · qdnEnabled true · qdn disabled in settings · qdn is disabled · node says qdn disabled

## Q: Why does sharing several files cost more than publishing one website zip?

A: Each QDN resource is one publish with one fee. A website or app zip, however many files it holds, is a single resource, so it costs one fee. Q-Share publishes every shared file as its own FILE resource plus a document describing the share, so a share with three files costs four fees.

Also asked as: several files several fees qdn · q-share fee per file · why multiple fees for one share · zip one fee qdn · q-share several fees · one fee for a website zip · website one fee many files

## Q: What is the IMAGE service on QDN?

A: IMAGE holds one picture of up to 10 MB. The community GIF library, for example, keeps its GIFs as IMAGE resources, and Torq publishes the cover picture of an attached video or file as one. For bigger pictures use FILE, and for small avatars and previews THUMBNAIL (500 KB). IMAGE_PRIVATE is the encrypted version.

Also asked as: qdn image service · publish a picture on qdn · IMAGE size limit 10 mb · image vs file qdn · image service qdn · qdn image · photos on qdn

## Q: How do I see how much disk space QDN uses on my node?

A: Check the size of the data folder inside Qortal Core's folder. Core also writes a line with "Total used" and "Total capacity" for its QDN storage to its log about every 10 minutes, which shows how close it is to its limit.

Also asked as: qdn disk usage · how big is my qdn storage · check hosted data size · total used total capacity log · how much space does qdn use · qdn space used on my node · qortal data folder size check

## Q: What is a data node on Qortal?

A: Every Qortal node is a data node by default: it stores and shares the QDN data it follows or opens, and relays data for others, unless its operator turns QDN off. There is no separate data node program; Qortal Core does both jobs.

Also asked as: qortal data node · is my node a data node · data node meaning · separate data node software · data node · what is a qortal data node · every node hosts qdn

## Q: What does "Downloading from network..." mean on a QDN loading page?

A: Your node is collecting the resource's chunks from peers right now. The count under it, such as 5 / 14 files, shows how many pieces have arrived, and a peer count shows how many nodes are sending. The page switches to the app or site by itself once everything is in and built.

Also asked as: downloading from network qdn · loading page downloading from network · qdn downloading status · downloading files count loading page · downloading from network meaning

## Q: Can I see how big a QDN item is before I download it?

A: Yes. The publish record holds the resource's size, so apps such as Q-Share can show file sizes in their lists before you download anything, and Q-Share's Follow button shows the total size of a name's content.

Also asked as: qdn file size before download · size of a qdn resource · how big is this qdn file · see download size qdn · qdn resource size shown

## Q: What happens if a node sends me corrupted QDN data?

A: Your node checks every chunk against its hash. A chunk that doesn't match is thrown away, and that peer is skipped for that file for about 10 minutes while your node gets the piece from someone else. So a bad peer can slow a download down, but it can't slip in changed data.

Also asked as: corrupted qdn data · bad chunk from a peer · qdn hash mismatch · peer sent invalid qdn data · damaged qdn download

## Q: Can I make a QDN website that only some people can see?

A: Not as a normal WEBSITE: anyone can open those. For something only certain people should use, a private group's admin can publish a private Q-App, which is encrypted for the group so only members can open it. Qortal Web Builder can also limit a site to a group's members, but that is only a gate: the site's files stay public on QDN.

Also asked as: private qdn website · members only website qortal · password protect qdn site · website only for my group · hide my qdn website from public
