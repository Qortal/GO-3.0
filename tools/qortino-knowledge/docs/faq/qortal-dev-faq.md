# qortal-dev — golden FAQ

Curated offline Q&A for Qortino (257 entries). Prefer these answers when relevant.

## Q: How does Qortal Hub run a Q-App?

A: Hub opens the app in a frame at your node's address /render/APP/<name>, so the node itself serves the files it holds from QDN. Hub adds theme, lang and identifier to that address. The node adds a small script, q-apps.js, which gives the page qortalRequest. Read-only requests are answered by the node; anything that needs the user, such as the account, a publish or a payment, goes up to Hub, which asks for approval. Qortal GO runs Q-Apps the same way inside its Android WebView.

Also asked as: how hub runs a q-app frame · q-app iframe render address · what serves my q-app files · how go renders q-apps webview · q-app render path node

## Q: What do the _qdn variables in a Q-App hold?

A: The node defines them on every page it renders: _qdnContext (render, or gateway on a gateway), _qdnTheme (light or dark), _qdnLang (the language code), _qdnService, _qdnName and _qdnIdentifier (which resource this is), _qdnPath (the file shown), _qdnBase (the /render/<service>/<name> prefix) and _qdnBaseWithPath. Read these instead of parsing the address yourself.

Also asked as: _qdnName _qdnBase variables · list of _qdn variables q-app · _qdnIdentifier _qdnService meaning · _qdnLang variable q-app · _qdnPath _qdnBaseWithPath values

## Q: What basename should my Q-App's router use?

A: Use the prefix the node puts in window._qdnBase, for example /render/APP/<name>, exactly as given (just drop a trailing slash). Don't decode it: the router compares it with the page address, where a space stays %20. When you read the app name (_qdnName) or path parts as text, decode them with decodeURIComponent, never URLSearchParams, which turns a + into a space. Then the same routes work in Hub and GO, and deep links open the right page.

Also asked as: q-app router basename · react router basename _qdnBase · client routes under render app · spa basename hub q-app · router prefix /render/APP

## Q: What is q-apps.js?

A: q-apps.js is the script the node adds to every Q-App and QDN website page. It defines qortalRequest and qortalRequestWithTimeout, answers read-only actions by calling the node's API, and passes every other action up to Hub or GO. It also turns clicks on qortal:// links into LINK_TO_QDN_RESOURCE, rewrites qortal:// image sources, blocks plain web links, and tells Hub which path is showing for Back and Copy link.

Also asked as: q-apps.js script role · what does q-apps.js do · where does qortalRequest come from · core q-apps.js injected script · qortalRequest script source file

## Q: Why don't web links work inside my Q-App?

A: q-apps.js blocks clicks on ordinary web links (http and https addresses), and Hub and GO keep the frame on the node, so a Q-App can't send people to the outside web. Use qortal:// links for QDN content. For an outside address, show it as text the user can copy, and say why.

Also asked as: q-app http links blocked · external links in q-app do nothing · open website from q-app · https link not working hub app · q-app outside website link

## Q: Do all Q-Apps share the same browser storage?

A: Yes. Every Q-App and website rendered from one node has the same browser origin, so localStorage, sessionStorage and IndexedDB are shared between them. Prefix every key with your app's name, for example myapp.settings, and never keep private keys, seeds or secrets there. Two versions of an app that use the same keys will mix their settings.

Also asked as: q-app localStorage shared · indexeddb shared between q-apps · storage keys clash q-apps · q-apps same origin storage · localStorage prefix q-app

## Q: Can my Q-App call an outside web API?

A: No. Hub and GO give every Q-App frame a content security policy that keeps its requests on the node: fetches, scripts, styles, images, fonts and media may come only from the node, data: and blob:. A call to an outside server is blocked, and it would leak the user's IP address anyway. Put the data on QDN or ship it inside your zip.

Also asked as: q-app fetch external api · call web service from q-app · q-app content security policy · csp blocks fetch q-app · q-app fetch blocked by csp · third party api from q-app

## Q: What is the Loading page that shows before my Q-App opens?

A: When the node doesn't have all of an app's files yet, it shows its own Loading - Qortal Network page while it downloads and builds them from peers, then reloads into your app once the status is READY. The first open after a publish, or on a node that doesn't host your name, can take a while. GO also checks the app's address itself every few seconds and opens it as soon as the node serves it.

Also asked as: loading qortal network page · q-app stuck on loading page · node loading page before q-app opens · downloading from network q-app · first open q-app slow loading

## Q: How long does qortalRequest wait before it times out?

A: q-apps.js gives each action its own limit: most get 30 seconds; FETCH_QDN_RESOURCE and SEND_CHAT_MESSAGE 60 seconds; SEND_COIN, JOIN_GROUP, polls, trades and DEPLOY_AT 5 minutes; GET_WALLET_BALANCE 2 minutes; publishes, GET_USER_ACCOUNT, SAVE_FILE, SIGN_TRANSACTION and DECRYPT_DATA up to an hour. Hub and GO also stop waiting after 30 seconds for most requests they handle themselves, except publishes. When a limit runs out, the call fails with a timeout error.

Also asked as: qortalRequest timeout values · default timeout per action · how long qortalRequest waits · the request timed out qortalRequest · fetch qdn resource timeout

## Q: What if a payment request times out while the approval is still open?

A: Hub and GO stop waiting for an approval request after 30 seconds, although the approval window stays open for about a minute, and if the user accepts later the action still happens. So treat a timeout on SEND_COIN or any other write as unknown, not failed. Check first, for example with SEARCH_TRANSACTIONS for the payment, and only then offer Retry.

Also asked as: send_coin timed out but paid · qortalRequest timeout approval still open · payment timeout did it send · request timed out after 30000 ms · retry payment after timeout q-app

## Q: What shape do qortalRequest errors have?

A: It depends on who answered. Hub and GO usually reject with an object holding error and message, for example User declined request. A q-apps.js timeout rejects with a plain string, and errors from the node's API come as the node's JSON error object. Read e.message, then e.error, then the value itself, and show a short plain sentence to the user.

Also asked as: qortalRequest error object · qortalRequest error message field · catch error qortalRequest format · qortalRequest rejects with string · read qortalRequest error

## Q: Why is the decline error from Hub in another language?

A: Hub and GO translate their error messages into the user's language, so User declined request can arrive in any of their 12 languages. Don't match the English text alone. Treat a rejection right after an approval as a likely cancel: show nothing alarming and leave the button usable.

Also asked as: user declined request translated · decline error language q-app · detect decline qortalRequest · approval declined error text · user cancel error other language

## Q: What happens if my app calls an action Hub doesn't know?

A: Nothing answers it: Hub and GO ignore actions they don't handle, so the call only fails when q-apps.js times out, after 30 seconds for most actions. Check the spelling, and ask SHOW_ACTIONS for the list the user's Hub or GO supports before you rely on a newer action.

Also asked as: unknown qortalRequest action · qortalRequest action not supported · qortalRequest never answers · unsupported action hub q-app · misspelled qortalRequest action

## Q: How can my app list the qortalRequest actions this Hub supports?

A: Call qortalRequest with the action SHOW_ACTIONS. It returns the list of every action the running Hub or GO handles, without asking the user. Use it to hide features the user's version can't do.

Also asked as: SHOW_ACTIONS qortalRequest list · list supported qortalRequest actions · which actions does this hub support q-app · feature detect qortalRequest action · qortalRequest capabilities list

## Q: Which older qortalRequest actions are missing in Hub 3.0?

A: Some actions in older docs came from the old Qortal UI and aren't in Hub 3.0's list: GET_FRIENDS_LIST, GET_PROFILE_DATA, SET_PROFILE_DATA, OPEN_PROFILE, SET_TAB_NOTIFICATIONS, SEND_LOCAL_NOTIFICATION and NOTIFICATIONS_PERMISSION. Calls to them get no answer. Use OPEN_USER_LOOKUP to show a person, and NOTIFICATION_PERMISSION with NOTIFICATION_ADD for notifications.

Also asked as: OPEN_PROFILE not working hub · SET_TAB_NOTIFICATIONS not working · GET_FRIENDS_LIST missing hub · SEND_LOCAL_NOTIFICATION hub · old qortal ui actions hub 3.0 · How do I open a peer profile · OPEN_PROFILE · open user profile hub · What is SET_TAB_NOTIFICATIONS · SET_TAB_NOTIFICATIONS

## Q: How does my app know the user is on a public node?

A: Call IS_USING_PUBLIC_NODE. It returns true when Hub or GO is connected to a public node and false on the user's own node. Use it to explain features a public node can't do, instead of showing an error.

Also asked as: IS_USING_PUBLIC_NODE in q-app code · detect public node q-app · public node check qortalRequest · own node or public node app code · q-app knows public node

## Q: Which qortalRequest actions fail on a public node?

A: Hub and GO refuse these on a public node: GET_LIST_ITEMS, ADD_LIST_ITEMS and DELETE_LIST_ITEM, GET_HOSTED_DATA and DELETE_HOSTED_DATA, ADMIN_ACTION, the foreign server and foreign fee settings, sending any coin other than QORT, and ARRR wallet reads; the error says the action can't be done through a public node. Publishes fail there too, because the public node takes no uploads without its API key. Handle these quietly and explain what the user's own node would add.

Also asked as: q-app actions refused public node · qortalRequest fails on public node · which q-app actions need own node · list items fail public node · foreign coin send public node

## Q: Can my app change what the approval window says?

A: No. Hub and GO write the question, such as Allow this app to publish to QDN?, and fill in the details themselves from your request: service, identifier and name, or recipient, amount and fee, or the first characters of a chat message. The app name and icon under Requested by come from Hub's own record of the tab, never from your request. Make your own screen explain the why before you call.

Also asked as: customize approval text q-app · approval window wording app · change requested by name · approval dialog app name source · what app controls in approval

## Q: What is SESSION_PERMISSIONS?

A: SESSION_PERMISSIONS lets an app ask once for a list of actions, in a permissions array, that may then run without approvals while that tab is open. The user sees the list and has to tick I trust this app and understand these permissions will auto-execute. Ask only for what you need, and only when the user is about to do something that needs it.

Also asked as: SESSION_PERMISSIONS qortalRequest · ask permissions once for session · q-app session permissions · stop repeated approval popups · grant permissions this session

## Q: What does GET_PRIMARY_NAME return?

A: GET_PRIMARY_NAME takes an address and returns that account's primary name as text, or an empty string when it has none. It needs no approval, so it's a cheap way to show a name beside an address. Cache the answers, since the same names come up again and again in lists.

Also asked as: GET_PRIMARY_NAME qortalRequest · primary name of an address q-app · show name for address qortalRequest · address to name lookup q-app · GET_PRIMARY_NAME empty string

## Q: Which name does a publish use if my app leaves out name?

A: Hub then publishes under the account's primary name. If the account has no registered name, the request fails with User has no Qortal name. When a user owns several names, pass name yourself and let them choose; it must be one of their names.

Also asked as: publish without name field · PUBLISH_QDN_RESOURCE no name · which name hub publishes under · user has no qortal name error · default publish name q-app

## Q: How do I show a person's details in Hub from my app?

A: Call OPEN_USER_LOOKUP with user set to a name or an address. Hub opens its user lookup panel for that person. It needs no approval.

Also asked as: OPEN_USER_LOOKUP qortalRequest · open user profile from q-app · show user details hub from app · open address lookup q-app · user lookup panel qortalRequest

## Q: How do I get the user's own QORT balance?

A: Call GET_WALLET_BALANCE with coin set to QORT. The user is asked Allow this app to fetch your QORT balance?, with a box to always allow it, and the answer is a number. To read the balance of any address without asking, use GET_BALANCE with that address instead.

Also asked as: GET_WALLET_BALANCE qortalRequest · user balance from q-app · wallet balance approval q-app · show my qort balance q-app · balance approval popup q-app

## Q: How do I search only one publisher's resources?

A: Pass name together with exactMatchNames set to true in SEARCH_QDN_RESOURCES. Without exactMatchNames, name is matched partially, so a search for one name can also return names that merely contain it.

Also asked as: exactMatchNames search field · search one name only qdn · SEARCH_QDN_RESOURCES exact name · partial name match search q-app · only this publisher qdn search

## Q: What does limit 0 mean in a QDN search?

A: To Core, limit 0 means no limit: every matching resource comes back, which can be huge and slow. Ask for pages of about 20 and load more as the user scrolls.

Also asked as: limit 0 search qdn · unlimited search results q-app · SEARCH_QDN_RESOURCES limit zero · search returns everything q-app · limit 0 slow app

## Q: How do I page through QDN search results?

A: Use limit for the page size and offset for how many to skip: offset 0 for the first page, 20 for the next with limit 20, and so on. Set reverse to true to get the newest first. Stop when a page comes back shorter than limit.

Also asked as: paging qdn search q-app · offset limit SEARCH_QDN_RESOURCES · load more results q-app · newest first qdn search · reverse true search field

## Q: When should I set includeMetadata in a search?

A: Only when you show titles, descriptions or tags. It makes each result carry its metadata, but the node takes longer to answer. For a list of identifiers you'll open anyway, leave it out.

Also asked as: includeMetadata search field · search with metadata slow q-app · titles in qdn search results · includeMetadata true cost · metadata in qdn search

## Q: How do I hide content from blocked names?

A: Set excludeBlocked to true in SEARCH_QDN_RESOURCES or LIST_QDN_RESOURCES, and the node leaves out resources from names it has blocked. Most apps should always send it.

Also asked as: excludeBlocked search field · hide blocked names search q-app · excludeBlocked in search request · excludeBlocked true search · filter blocked publishers search

## Q: What fields does a QDN search result have?

A: Each row has name, service, identifier, size, created and updated (times in milliseconds). With includeMetadata it also has metadata: title, description, tags, category, categoryName and mimeType when they exist. Some versions wrap the list in an object, so make sure you end up with an array.

Also asked as: search result fields qdn · SEARCH_QDN_RESOURCES response · created updated search result · size field qdn result · metadata in search row q-app

## Q: How should my app react to each GET_QDN_RESOURCE_STATUS value?

A: READY means the data can be fetched. PUBLISHED, DOWNLOADING, DOWNLOADED and BUILDING mean the node is still getting it, so show progress and wait. MISSING_DATA and BUILD_FAILED mean try again later. NOT_PUBLISHED means it doesn't exist, BLOCKED means the name is blocked on this node, and UNSUPPORTED means the request isn't supported.

Also asked as: handle resource status in code · GET_QDN_RESOURCE_STATUS READY · status MISSING_DATA what to do app · q-app wait for READY status · react to qdn status q-app

## Q: How do I make the node start downloading a resource?

A: Call GET_QDN_RESOURCE_STATUS with build set to true. The node starts fetching and building the resource in the background, and you can call the status again until it says READY.

Also asked as: build true status request · GET_QDN_RESOURCE_STATUS build · start download qdn resource q-app · prefetch resource node q-app · ask node to fetch data from app

## Q: How should my app show a resource the node hasn't downloaded yet?

A: Show Fetching from peers... with the progress from GET_QDN_RESOURCE_STATUS, and try again after 2, 4, 8 and 16 seconds. Don't tell the user to check their node: the data simply isn't there yet. Never show a broken image.

Also asked as: resource not downloaded yet ui · fetching from peers message q-app · retry qdn fetch q-app · data not on node yet app · qdn resource loading state

## Q: Why should my app encode names in its own node requests?

A: Names can contain spaces, + and other characters, and q-apps.js puts some names into addresses as they are, for example in SEARCH_NAMES, GET_QDN_RESOURCE_STATUS and GET_QDN_RESOURCE_PROPERTIES. In your own fetch calls, encode every name and path part with encodeURIComponent. Test with names that have a space, a + or non-English letters.

Also asked as: encode name in url q-app · name with space qdn fetch · plus sign in name request · encodeURIComponent name qortal · special characters names app

## Q: Can I trust the publisher name written inside fetched JSON?

A: No. Anyone can publish under your app's identifiers with their own name, and a JSON body can claim any author. Trust the name and identifier from the search row or request, key your caches by both, and ignore author fields inside the body.

Also asked as: trust name inside json body · fake author in qdn json · json claims different author · identifier copied by other name · verify author qdn data

## Q: How do I check that a payment reached an address?

A: Use SEARCH_TRANSACTIONS with txType set to PAYMENT, address set to the receiving address and confirmationStatus CONFIRMED, newest first. Match the amount, sender and time you expect, because payments carry no order number of their own. Keep your own record of what you're waiting for.

Also asked as: detect payment received q-app · SEARCH_TRANSACTIONS payment · confirm customer paid qortal app · watch address for payment q-app · payment confirmed check app

## Q: Should my app cache QDN search results?

A: Yes, for the session: reuse results for 1 to 3 minutes, and drop the affected entries right after the user publishes something. That keeps lists fast without showing stale data for long.

Also asked as: cache qdn search results · search cache ttl q-app · how long cache qdn data · invalidate cache after publish · session cache searches q-app

## Q: How should I load thumbnails in a long list?

A: Load each image only when its row scrolls into view, with an IntersectionObserver, and show the THUMBNAIL rather than the full IMAGE in lists. Some UI components start loading their image as soon as they mount, so check that yours really waits.

Also asked as: lazy load thumbnails q-app · images in long list slow · avatars load when visible q-app · intersection observer thumbnails · thumbnail not full image list

## Q: Which optional fields can PUBLISH_QDN_RESOURCE take?

A: Besides service, the data (data64, base64 or file) and usually name and identifier, Hub accepts filename, title, description, category, tags (an array) or tag1 to tag5, encrypt with publicKeys, appFee with appFeeRecipient, and isMultiFileZip for a zip that should become a multi-file APP or WEBSITE. Unknown keys are ignored.

Also asked as: PUBLISH_QDN_RESOURCE optional fields · publish request fields list · title description category publish · publish options qortalRequest · what can i set when publishing from app

## Q: How can my app charge a fee when users publish?

A: Add appFee (in QORT) and appFeeRecipient to PUBLISH_QDN_RESOURCE or PUBLISH_MULTIPLE_QDN_RESOURCES. Hub pays it after the publish succeeds. The approval shows the app fee with an Accept app fee box, ticked at first, and the user must also tick the confirmation; the fee is paid only if Accept app fee stays ticked. Say in your app what the fee is for.

Also asked as: add app fee to publish q-app · appFee appFeeRecipient fields · charge users for publishing app · q-app publish fee to developer · appFee in PUBLISH_QDN_RESOURCE

## Q: How does Hub report publish progress to my app?

A: While it uploads, Hub posts PUBLISH_STATUS messages to your app's window with publishLocation (name, identifier, service), chunks sent, totalChunks, retry, filename and processed. processed is true once the node has taken the publish. Listen for message events and show the progress per file.

Also asked as: PUBLISH_STATUS postMessage event · publish progress q-app · upload progress chunks hub · publishLocation totalChunks fields · show publishing percent app

## Q: How should my app handle users who can't publish from the public node?

A: The public node takes no uploads without its API key, so publishes from users on it are refused, and GO tells them Your node needs its API key to publish, with a way to open node settings. Check IS_USING_PUBLIC_NODE before the user fills in a long form, and explain that publishing needs their own node, while reading still works.

Also asked as: public node no uploads q-app · publish refused api key q-app users · IS_USING_PUBLIC_NODE before publish · go users cannot publish app · publish disabled public node q-app

## Q: How long can a publish take before Hub gives up?

A: Hub waits up to an hour for one PUBLISH_QDN_RESOURCE and 30 minutes per resource for PUBLISH_MULTIPLE_QDN_RESOURCES, because big uploads and the proof-of-work on slow machines take time. So never give up on a publish after 30 seconds; show progress instead.

Also asked as: publish timeout length q-app · publish takes long hub · PUBLISH_QDN_RESOURCE timeout · batch publish timeout · publish waiting time q-app

## Q: What happens when some files in PUBLISH_MULTIPLE_QDN_RESOURCES fail?

A: Hub publishes the others, then rejects with Some resources have failed to publish and a list, unsuccessfulPublishes, giving each failed file's reason, identifier, service and name. Retry only those, not the whole batch.

Also asked as: batch publish partly failed · unsuccessfulPublishes field · unsuccessfulPublishes list retry · PUBLISH_MULTIPLE_QDN_RESOURCES error · retry failed files batch

## Q: How do I encrypt every file in a batch publish?

A: Set encrypt to true and publicKeys (the readers' public keys) at the top of PUBLISH_MULTIPLE_QDN_RESOURCES. Every encrypted resource must use a service ending in _PRIVATE; give one resource disableEncrypt set to true to leave it public, for example its thumbnail. Q-Mail publishes mail this way.

Also asked as: encrypt batch publish · PUBLISH_MULTIPLE encrypt publicKeys · disableEncrypt resource field · encrypted multiple resources · private batch publish q-app

## Q: Are the title and tags of an encrypted publish private?

A: No. Only the data is encrypted. The name, service, identifier, title, description and tags stay public plain text that anyone can search, so never put private details in them.

Also asked as: encrypted publish metadata public · title of private resource visible · tags not encrypted qdn · identifier visible private data · what is public in private publish

## Q: How does encrypt work in PUBLISH_QDN_RESOURCE?

A: Set encrypt to true and publicKeys to the list of readers' public keys, and use a _PRIVATE service. Hub encrypts the data before upload so those keys, and the publisher, can read it. Without publicKeys it fails with Encrypting data requires public keys. Older docs show recipientPublicKey; current Hub uses publicKeys.

Also asked as: encrypt true publicKeys publish · encrypted publish single resource · encryption requires public keys · recipientPublicKey publish field · publish encrypted for user

## Q: How can my app keep a user's settings privately on QDN?

A: Publish them as DOCUMENT_PRIVATE under the user's name with a fixed identifier for your app, encrypt set to true and publicKeys holding only the user's own public key. Read it back with FETCH_QDN_RESOURCE and DECRYPT_DATA. Q-Mail keeps its mail state this way, and the latest publish replaces the old one.

Also asked as: private settings on qdn · save user settings encrypted · DOCUMENT_PRIVATE settings app · sync settings across devices q-app · encrypted app state qdn

## Q: How do I publish a zip as an APP or WEBSITE from my app?

A: Call PUBLISH_QDN_RESOURCE with service APP or WEBSITE, the zip as file, and isMultiFileZip set to true; add title and description as usual. The node then unpacks it into a multi-file resource. Without isMultiFileZip the zip is stored as one file, and a WEBSITE fails with MISSING_INDEX_FILE. Older Hubs may not support this, so tell users to update if it fails.

Also asked as: publish zip as app from code · isMultiFileZip publish field · multi-file publish qortalRequest · publish website zip from code · publish app zip PUBLISH_QDN_RESOURCE · Can I publish multi-file WEBSITE or APP from inside a Q-App via qortalRequest · publish multi-file from q-app · PUBLISH WEBSITE from code

## Q: Can I publish under an identifier from Hub's publish screen?

A: No. My apps, then Publish app or Publish website, publishes the name's default APP or WEBSITE; it has no identifier field, which is why it says only one App and Website is allowed per Name. To publish another APP under the same name, such as a GO widget, publish from code with an identifier.

Also asked as: publish screen identifier · identifier field publish screen · hub publish form no identifier · publish app with identifier hub · publish go-widget identifier hub

## Q: What happens if my app publishes without an identifier?

A: Hub publishes it as default, the one resource for that name and service with no identifier. A second publish without an identifier replaces it, so app data should always have its own identifier; leave it out only for the main item, such as the name's website.

Also asked as: publish no identifier q-app · identifier left out default · overwrites default resource · PUBLISH_QDN_RESOURCE identifier missing · default identifier publish

## Q: Why does my app's own publish dialog disappear in GO?

A: For a file of 5 MB or more, or a publish that takes over 8 seconds, GO hides your app's progress window and shows its own Publishing to QDN window instead, which can shrink to a bubble so the user keeps using your app. When the publish ends, your window comes back if it's still open, for example to show a failure with Retry. PUBLISH_STATUS messages still reach your app as usual.

Also asked as: my publish dialog hidden go · app progress window gone go · go takes over publish progress · go publish bubble hides app dialog · publishing status dialog missing go

## Q: How do I warn the user before they close my app mid-task?

A: Call LOCK_TAB with lockMessage, for example while an upload runs; the user is asked once to allow it. If they then close the tab, Hub shows Close Tab Confirmation with your message, and they can cancel. Call UNLOCK_TAB when the work is done.

Also asked as: LOCK_TAB qortalRequest · UNLOCK_TAB after task · warn before closing tab q-app · close tab confirmation app · lockMessage field

## Q: Which fields does SEND_COIN need?

A: coin (such as QORT), amount, and the receiver in destinationAddress or recipient. For a foreign coin you may add fee, a fee per byte; leave it out to use the default. The user always gets an approval with a confirmation tick.

Also asked as: SEND_COIN fields · send coin request parameters · destinationAddress amount coin fields · SEND_COIN recipient field · payment request from q-app fields

## Q: Can SEND_COIN pay a registered name?

A: Yes, for QORT. Hub looks the name up before it asks, shows the name with its full address in the approval, and pays that address; nothing is looked up again after the user accepts. Foreign coins need a real address for that chain.

Also asked as: SEND_COIN to a name · SEND_COIN recipient name resolve · send qort to name from app · recipient name SEND_COIN · name resolved before payment

## Q: What amount format does SEND_COIN take?

A: A plain decimal amount in whole coins of the coin you send, such as 1 or 0.25 (QORT, or LTC for a Litecoin send), with at most 8 decimal places, not the 1/100,000,000 units some read APIs return. Forms like 1e3 or 0x10 are refused, and the approval shows the exact amount that will be sent.

Also asked as: SEND_COIN amount units · amount in qort or 1e8 send coin · decimal amount payment q-app · SEND_COIN 1e3 refused · how to write amount send coin

## Q: Which formats do Qortal payment links accept?

A: qortal://pay?recipient=<address or name>&amount=<QORT> is the one to use. GO also reads qortal://send, qort:<address>?amount= and qortal://<address>. The receiver may be called recipient, to, address or r, and the amount amount, qty, qort or value; the amount is optional. Write the amount with a dot and URL-encode names, so a space becomes %20.

Also asked as: qortal://pay link parameter names · qortal://pay parameters · qortal://send to amount · qort: payment uri format · payment link recipient aliases

## Q: Which fields does SEND_CHAT_MESSAGE need?

A: message, plus groupId for a group chat or destinationAddress (or recipient) for a private chat; without either it fails with Please provide a recipient or groupId. The account needs at least 4 QORT, and the user approves each message unless they ticked always allow for your app.

Also asked as: SEND_CHAT_MESSAGE fields · send chat from q-app parameters · groupId message chat app · destinationAddress chat message · chat message request fields

## Q: Are chat messages sent from my app encrypted?

A: A private message is encrypted to the recipient's public key. A group message sent with SEND_CHAT_MESSAGE is sent unencrypted, so treat it as public to anyone who can read that group's chat.

Also asked as: SEND_CHAT_MESSAGE encrypted · app chat message privacy · group message from app encrypted · private message encryption q-app · is app dm encrypted

## Q: How can my app send users notifications?

A: First call NOTIFICATION_PERMISSION; the user sees <your app> notifications with Allow this app to send you GO notifications? and Allow or Don't allow. Then add rules with NOTIFICATION_ADD. Hub and GO watch for new QDN publishes that match a rule and notify the user, so your app doesn't have to stay open. NOTIFICATION_ADD without the permission fails.

Also asked as: q-app notifications · NOTIFICATION_PERMISSION request q-app · NOTIFICATION_ADD rules · notify users of new posts app · go notifications from q-app

## Q: How do I show a PDF in Hub's reader from my app?

A: Call SHOW_PDF_READER with blob set to the PDF as a Blob of type application/pdf. Hub or GO opens its own reader. It fails with Missing blob, or blob type must be application/pdf, when the blob is missing or has another type.

Also asked as: SHOW_PDF_READER request blob · open pdf in hub reader from app · pdf viewer qortalRequest · show pdf q-app code · blob type application/pdf

## Q: Why is a PDF blank inside my Q-App?

A: An iframe or embed showing a PDF stays blank: Hub's window has no PDF plugin and GO's WebView has no PDF viewer. Use SHOW_PDF_READER, or bundle pdf.js in your app; Torq does that and runs pdf.js's worker on the main thread, because a lazily loaded worker file fails to load.

Also asked as: pdf blank in q-app · iframe pdf not showing hub · embed pdf go webview · pdf viewer missing q-app · pdf.js in q-app

## Q: How do I save a big QDN file without loading it into memory?

A: Call SAVE_FILE with filename and location set to the resource's service, name and identifier, plus mimeType if you know it. Hub then streams it from the node straight to disk: the desktop shows a Save As window, and GO saves it natively. Nothing large passes through your page.

Also asked as: SAVE_FILE with location field · save large file from qdn · stream download q-app · SAVE_FILE without blob · download video file app

## Q: When should SAVE_FILE use a blob and when a location?

A: In the desktop Hub, a blob under about 100 MB saves to Downloads in one step. In GO, and for files over 100 MB, save by location so the file streams from the node. Either way, a user who declines the save prompt isn't an error.

Also asked as: SAVE_FILE blob or location · save file 100 mb · choose save method q-app · SAVE_FILE desktop vs go · download large files app

## Q: How do I open an app at a page without opening a second tab?

A: Call OPEN_NEW_TAB with qortalLink, such as qortal://APP/<name>/<path>, and navigateIfAlreadyOpen set to true. If that app is already open, Hub switches to its tab and moves it to the path; otherwise it opens a new tab.

Also asked as: navigateIfAlreadyOpen field · OPEN_NEW_TAB reuse tab · open app page existing tab · avoid duplicate tabs q-app · OPEN_NEW_TAB qortalLink path

## Q: How does my app ask GO for full screen?

A: Call qortalRequest with action SET_FULL_SCREEN and enabled set to true, and set it to false when you're done. On GO phones the bars hide for your tab; elsewhere it's simply acknowledged. When full screen ends for another reason (Android back, leaving or closing the tab), GO sends your page FULL_SCREEN_CHANGED with enabled false, so close your viewer then. Widgets can't use it.

Also asked as: SET_FULL_SCREEN qortalRequest · full screen request q-app code · FULL_SCREEN_CHANGED message · hide go bars from q-app code · set full screen enabled field

## Q: How does my Q-App notice when the user switches Hub's theme?

A: Hub doesn't reload your app when the user flips light and dark; it posts a THEME_CHANGED message to your page with theme set to light or dark. Listen for message events and restyle. At start, read _qdnTheme or the theme query parameter.

Also asked as: THEME_CHANGED message · hub theme switch q-app · dark light change without reload · listen for theme change q-app · q-app theme follows hub live

## Q: How does my Q-App follow the user's language?

A: Hub opens your app with lang set to the user's language code, and the node also puts it in _qdnLang. When the user changes language, Hub posts LANGUAGE_CHANGED with language. Fall back to English for languages you don't have.

Also asked as: q-app language from hub · lang parameter q-app · _qdnLang language code · LANGUAGE_CHANGED message · translate q-app to hub language

## Q: How do I stop a wrong-colour flash when my Q-App loads?

A: Put a small script at the very top of the head in index.html that reads _qdnTheme (or the theme query parameter) and sets the page's background and colour scheme at once, before your bundle loads. Then the first paint already has the right colours, and your app takes over from there.

Also asked as: white flash q-app load · wrong background on start q-app · boot script theme q-app · flash of wrong theme hub · paint background before app loads

## Q: Why shouldn't my Q-App use 100vh?

A: Size the app to the frame Hub or GO gives it, not to 100vh, or parts end up hidden. A phone held sideways gives an app in Hub a frame only about 266 px tall, so plan a compact landscape layout with a low top bar.

Also asked as: 100vh in q-app · q-app height hub frame · app cut off bottom hub · landscape phone q-app height · size app to frame

## Q: How should Back work inside my Q-App?

A: Use your router's own history for Back, never window.history directly, because all of Hub's tabs share the window's history. A plain history.back() can leave your app or jump to another tab.

Also asked as: back button q-app history · window.history back q-app · router back hub tabs · safe back q-app · history back goes to other tab

## Q: How should my Q-App lay out on phones?

A: Design for 360 to 430 px first: one column, nothing scrolling sideways, text at least 14 px, a bottom bar with at most five items, dialogs full screen or as bottom sheets, and tap targets of at least 44 px. Nothing should work on hover only. Use the phone layout below 600 px wide, since Hub also runs apps in narrow panes.

Also asked as: design q-app for phone screens · mobile layout q-app go · bottom navigation q-app · full screen dialogs phone q-app · q-app touch design rules

## Q: How do I publish my Q-App from Hub?

A: Open the Q-Apps library, go to My apps and choose Publish app. Pick the name, keep the type APP, fill in title, description, category and up to five tags, choose your .zip (50 MB at most), and press Publish. Hub shows the fee to confirm, publishes, then opens your app.

Also asked as: publish q-app hub steps · publish app button my apps tab · hub publish app screen · publish app zip hub · how to put my app on qdn

## Q: How do I update my published Q-App?

A: In the Q-Apps library, open My apps: Your published apps lists them, each with Update. That opens the publish form for that name with the old title, description, category and tags filled in. Choose the new zip and publish; it replaces the old version at the same name.

Also asked as: update published q-app · upload new zip for my app · republish app hub · your published apps update · replace app zip hub

## Q: How do I start a new Q-App project quickly?

A: The create-qortal-app package from npm sets up a project from a template, such as react-default-template, after you give the app a name. You need Node.js, an editor and Qortal Hub. Its development server runs on port 5173, ready to open in Hub's Dev Mode.

Also asked as: create-qortal-app · new q-app template · start q-app project · q-app starter react · scaffold qortal app

## Q: How do I turn on Dev Mode in Qortal Hub?

A: Open Hub's settings, go to the Developer tab and turn on Enable Dev Mode. A Dev Mode button then appears in the left sidebar; you may need to move the mouse to the left edge to see it.

Also asked as: enable dev mode hub · hub dev mode setting · developer tab hub settings · where is dev mode in hub · turn on hub developer tools

## Q: What can I open from Hub's Dev Mode?

A: Server opens your development server through the node, Zip previews a zip file, and Directory zips a folder and previews it, all with the real qortalRequest and your account. Q-Sandbox opens the Q-Sandbox app, and API opens your node's API documentation page.

Also asked as: hub dev mode options · dev mode server zip directory · q-sandbox dev mode · dev mode api button · hub developer tools options

## Q: How do I run my development server inside Hub?

A: In Dev Mode, choose Server, enter the domain (127.0.0.1 or localhost) and your port, such as 5173, and press Add. The app opens in a Hub tab through your node's dev proxy, with the real qortalRequest, your account and Hub's theme. If changes don't show, use the refresh button.

Also asked as: dev server in hub · hub dev mode server port · localhost 5173 hub · add custom framework hub · test vite app in hub

## Q: Why does Hub's Dev Mode tell me to use my local node?

A: Hub's Dev Mode needs the node on your own computer: the dev proxy runs on the node's machine and reaches your development server there, and building a zip preview needs the node's API key, which a public node never accepts. So Hub stops with a request to log out and use Local node. GO's Dev Mode works differently and runs on the public node too.

Also asked as: dev mode local node error · please use your local node for dev mode · dev mode public node hub · hub preview api key · dev mode needs own node

## Q: How do I test my exact zip in Hub before publishing?

A: In Dev Mode choose Zip and pick the file. Hub previews it under your name without publishing anything, served the way the node would serve the published app. The tab's refresh reads the same file again, so you can rebuild and refresh.

Also asked as: preview zip before publish hub · test zip in hub dev mode · dev mode zip preview · try zip without publishing · preview q-app zip hub

## Q: How do I see my Q-App's console in Hub?

A: In the desktop Hub, open View, then Toggle Developer Tools. The console and network tabs show your app's errors and requests; check that nothing fails and that it doesn't fire request storms.

Also asked as: hub developer tools console · q-app console errors hub · toggle developer tools hub · debug q-app in hub · hub devtools q-app

## Q: How do I publish a GO widget?

A: Publish it as service APP under your name with identifier go-widget-<slug> (lowercase letters, digits and dashes) and the tag go-widget, a short title of up to about 24 characters and a one-sentence description. From code, use PUBLISH_QDN_RESOURCE with the zip as file and isMultiFileZip set to true, index.html at the zip's top. GO's picker shows that title and description, with your name's avatar as the icon.

Also asked as: publish go widget · go-widget identifier publish · release widget for go · widget publish settings · go-widget tag publish code

## Q: How does my page know it is running as a GO widget?

A: goWidget=1 is always in the address on GO's widgets screen. Read it when the page starts and draw your widget view from the very first frame, so a full app never flashes in the small frame.

Also asked as: detect go widget mode · goWidget parameter check · widget view first frame · is my app a widget now · goWidget=1 detect code

## Q: Which pixel sizes must my GO widget handle?

A: On a 375 px wide phone, anything from 79 by 92 (1 by 2 cells) to 351 by 716 (4 by 14), because users resize widgets at any time. Check at least 79 by 92, 170 by 144, 351 by 248 and 351 by 716. Use vw, vh, min() and clamp() (the frame is your viewport) or listen to resize, and hide details that don't fit.

Also asked as: widget pixel sizes · widget smallest size 79 92 · widget sizes to test · responsive widget go · widget fits any size

## Q: How does my widget ask GO for a size?

A: Call GO_WIDGET_SET_SIZE once at start with width small (1 column), half (2) or full (4) and height in CSS px; GO rounds up to whole rows and remembers it. It only applies until the user resizes the widget; after that the answer's applied is false and the user's size stays. Never call it in a loop.

Also asked as: GO_WIDGET_SET_SIZE · widget natural size request · widget width half full small · widget height request px · widget size applied false

## Q: Which messages does GO send to a widget?

A: GO_WIDGET_VISIBILITY with payload.visible when the widgets screen comes into view or leaves it (or GO goes to the background), THEME_CHANGED with theme, and LANGUAGE_CHANGED with language. All three are also sent right after your widget loads.

Also asked as: GO_WIDGET_VISIBILITY · widget messages go · widget THEME_CHANGED LANGUAGE_CHANGED · widget language changed · widget visible payload

## Q: What must my widget do while it isn't visible?

A: Pause timers, animations and polling when GO_WIDGET_VISIBILITY says visible false, and also when document.visibilityState is hidden; start again when it's visible. When showing, poll no more than every 30 seconds, and once a minute is better.

Also asked as: pause widget timers · widget battery polling · widget hidden stop animation · widget visibility pause · how often widget refresh

## Q: Which requests are refused in GO widgets?

A: Everything else, including SEND_COIN, both publishes, SIGN_TRANSACTION, every ENCRYPT and DECRYPT action, SEND_CHAT_MESSAGE, SAVE_FILE, the NOTIFICATION actions, SET_FULL_SCREEN, trade, name, group and list changes, and unknown actions. They fail with a message starting Not available in GO widgets, so handle that without breaking.

Also asked as: widget refused requests · not available in go widgets error · widget cannot publish pay · widget blocked actions · SEND_COIN in widget

## Q: How does my widget do something it isn't allowed to do?

A: Open your full app at the right page: OPEN_NEW_TAB with qortalLink set to qortal://APP/<your app>/<path>. GO switches to Apps with your app open there, and the payment, publish or message happens in the app, with GO's usual approval.

Also asked as: widget open full app · widget action open app · widget OPEN_NEW_TAB qortal link · widget pay via full app · widget tap opens app

## Q: How fast should my widget start?

A: Show something useful within about 300 ms, because GO unloads widgets a few minutes after the screen was last seen and loads them again each visit. A single index.html with inline CSS and JS starts fastest; keep the bundle under about 200 KB and draw from cache before you refresh.

Also asked as: widget start time · widget loads slow · widget bundle size · single file widget fast · widget show something quickly

## Q: Should I build a separate widget or a widget mode in my app?

A: A separate small widget beside your app is better for almost everyone: publish a light page as APP with identifier go-widget-<slug> under your app's name, reusing only your data code. A widget mode inside your app, shown when goWidget=1, suits only apps that are already small and fast; if your app takes more than about a second to show on a phone, make a separate widget.

Also asked as: separate widget or widget mode · widget approach a b · widget beside main app · widget mode existing app · best way make app widget

## Q: How do I test my GO widget?

A: Open it as a normal app with ?goWidget=1&theme=dark (and light) added to its address, at several window sizes. Then publish it, and in GO swipe to the widgets screen, tap +, find it and add it: check that it starts quickly, follows theme changes and pauses when you leave. Hold it to resize it to its smallest and largest, move it and drop it on Remove, and swipe sideways across it.

Also asked as: test go widget · widget test steps · goWidget=1 browser test · check widget sizes go · try widget before release

## Q: Why does my Q-App's size matter so much?

A: The zip is downloaded from peers, so every KB counts: a node that doesn't have your app yet must fetch all of it before the first open. Keep the biggest JavaScript chunk well under 1 MB where you can, lazy-load heavy screens and libraries (editors, PDF, emoji, charts, video), and remove dependencies you don't use.

Also asked as: q-app bundle size · zip size downloaded from peers · biggest js chunk size · make q-app smaller · q-app zip size first open

## Q: Should my Q-App poll QDN on a timer?

A: Only gently: never a fixed short setInterval. Poll while document.visibilityState is visible, back off when nothing changes, and stop when the view closes. Every search is a round trip to the node, and in GO it also takes an extra hop.

Also asked as: polling qdn timer · setInterval q-app · poll politely app · refresh data interval q-app · background polling hub app

## Q: How does my app add or remove items in a node list?

A: ADD_LIST_ITEMS takes list_name and items, an array; DELETE_LIST_ITEM takes list_name and a single item, so removals go one at a time; GET_LIST_ITEMS takes list_name and returns the list as an array. Each asks the user first, and they work only on the user's own node, since lists are kept there and not on QDN.

Also asked as: ADD_LIST_ITEMS fields · DELETE_LIST_ITEM one item · list_name items request · GET_LIST_ITEMS returns array · change node list from q-app code · What are Hub list actions · GET_LIST_ITEMS · ADD_LIST_ITEMS · hub lists

## Q: Where does the Q-Apps library get my app's icon, title and description?

A: The title, description, category and tags come from your publish, as you set them in the publish form. The icon is your name's avatar (THUMBNAIL with identifier qortal_avatar), so change the avatar to change the icon. GO keeps icons in a device cache and re-checks each about once a day, so a new one can take up to a day to show there.

Also asked as: q-app icon library · app icon from avatar · change my app icon qortal · app title description library · app icon not updating go

## Q: Where can I get help building a Q-App?

A: Qortal's wiki on qortal.dev suggests asking in the ui-extension group on Qortal. The Q-Apps API documentation is on qortal.dev too, and it points to a React tutorial video series that goes from starting a project to publishing it on Qortal.

Also asked as: help building q-app · q-app developer support · ask q-app questions · ui-extension group qortal · learn to build q-apps

## Q: Will updating my Q-App lose my users' data?

A: No. Your users' data lives on QDN under their own names, apart from your APP, so publishing a new version of the app doesn't touch it. What can break it is changing how the app finds that data, so keep your services, identifier prefixes and readers for older schemas, and with qapp-core the same publicSalt and app name.

Also asked as: update app user data · new app version breaks data · republish app keep data · users data after update · app update qdn data safe

## Q: Why does my Q-App work in Hub but not in GO?

A: Usually one of GO's differences: many GO users are on the public node, which takes no uploads and refuses lists, hosted data and foreign coins; GO's WebView has no PDF viewer; service workers, camera, microphone and location aren't available to apps; and the screen is small and touch-only. Check IS_USING_PUBLIC_NODE, test at phone sizes, and use Dev Mode to try your zip on a phone.

Also asked as: q-app works in hub not go · app broken on phone go · go q-app differences · app fails in go only · test app go issues

## Q: What does the node add to my Q-App's index.html?

A: When the node serves an HTML page of an app or website, it adds at the top of the head: a UTF-8 charset tag, a base href so relative paths resolve inside the app, a script with the _qdn variables, and q-apps.js, which defines qortalRequest. On a gateway it also adds q-apps-gateway.js. You don't ship any of these yourself.

Also asked as: node injects into q-app html · what core adds to index.html · q-apps.js added to head · base href added by node q-app · qortal node html injection

## Q: What query parameters does Hub add to my Q-App's address?

A: Hub opens your app with theme (dark or light), lang (the language code) and identifier (empty for a default resource). A refresh or Back can add time and isManualNavigation=false, and GO's widgets screen adds goWidget=1. q-apps.js leaves these keys out when it tells Hub which path is showing, and some apps also remove them from the visible address.

Also asked as: hub query parameters q-app · theme lang identifier in q-app url · why is theme in my app address · ?theme=dark&lang= q-app · time and isManualNavigation parameters

## Q: Can I use a qortal:// link as an image source in a Q-App?

A: Yes, for images in your page's HTML: write src as qortal://THUMBNAIL/<name>/qortal_avatar or qortal://WEBSITE/<name>/assets/logo.png, and q-apps.js rewrites it to the node's /arbitrary/ address when the page loads. It only handles images that are in the page at load time. For images your code adds later, such as list rows, get the address with GET_QDN_RESOURCE_URL.

Also asked as: qortal image src rewrite q-apps.js · img src qortal thumbnail q-app · image tag qortal link q-app · show avatar with qortal:// src · qortal link in img element code

## Q: Can a Q-App use inline scripts, eval or WebAssembly?

A: Yes. The policy Hub and GO put on Q-App pages allows inline scripts and styles, eval and WebAssembly, as long as the code comes from your app's own files on the node. A single-file app with its script inside index.html works, and so do bundles that use WebAssembly.

Also asked as: inline script q-app allowed · eval in q-app · webassembly q-app hub · webassembly wasm q-app · single file q-app inline js

## Q: Can my Q-App open a WebSocket?

A: Only to the node the app is served from. Hub and GO allow WebSocket connections to that node, but not to any other host, so a Q-App can't keep a live connection to an outside server.

Also asked as: websocket in q-app · wss connection q-app · q-app socket to server · websocket hub app blocked · q-app realtime connection

## Q: Can a Q-App use a service worker in GO?

A: No. GO refuses to install service workers for Q-Apps. It also blocks prefetches to other sites and links such as intent:, market: and tel:. Keep your app small and its files in the zip instead of relying on a service worker.

Also asked as: service worker q-app · pwa offline q-app go · q-app service worker blocked · service worker install refused go · q-app prefetch other sites go

## Q: What happens to wallet requests when my Q-App is opened on a gateway?

A: A gateway shows QDN apps in an ordinary browser, and _qdnContext is then gateway. Read-only requests still work, but GET_USER_ACCOUNT, PUBLISH_QDN_RESOURCE, SEND_COIN, SEND_CHAT_MESSAGE, JOIN_GROUP, DEPLOY_AT, GET_WALLET_BALANCE and the list actions fail with an error saying interactive features aren't supported via a gateway, and the page shows a small read-only notice. Make sure your app still reads well in that mode.

Also asked as: q-app on gateway read only · gateway interactive features error · qortal link gateway q-app wallet · q-apps-gateway.js script · q-app publish fails on gateway

## Q: Should my APP show its own not-found page?

A: Yes. For an APP the node sends every path that isn't a real file to index.html, so your router has to deal with unknown paths. Qortal's docs recommend showing a not-found page when a path can't be routed, rather than a blank screen.

Also asked as: q-app 404 page · unknown route q-app · app service missing path · not found page in q-app · router 404 page q-app

## Q: How does qortalRequest pass a request to Hub?

A: Each call posts your request object, with its action, through a MessageChannel and returns a Promise. q-apps.js either answers it from the node or forwards it to Hub or GO, and the reply comes back on that channel as a result or an error. That's why every call needs await and try/catch, and why a call can stay open while the user reads an approval.

Also asked as: how qortalRequest works inside · qortalRequest message channel reply · qortalRequest postMessage to hub · qortalRequest promise reply · q-app request to hub mechanism

## Q: How many qortalRequest calls can run at once?

A: q-apps.js runs at most 30 requests at the same time and queues the rest until a slot is free. A page that fires hundreds of searches at start just waits in that queue, so load in pages and fetch only what is on screen.

Also asked as: qortalRequest concurrency limit · too many qortalRequest calls queued · qortalRequest queue size · parallel qortalRequest limit · 30 requests at once q-app

## Q: How can my Q-App tell whether it runs in the desktop Hub?

A: Call WHICH_UI. It answers HUB_ELECTRON in the desktop Hub and HUB_WEB anywhere else, which includes Qortal GO on Android. It needs no approval.

Also asked as: WHICH_UI qortalRequest answer · detect desktop hub from q-app · HUB_ELECTRON HUB_WEB values · is my q-app in electron hub · which ui is running q-app code

## Q: How long does the Q-App approval window wait for the user?

A: About a minute. The window shows a countdown, and when it runs out the request counts as declined. Requests from apps queue one at a time, and Decline all answers every waiting request from the same app.

Also asked as: q-app approval window timeout · qortalRequest approval expires · approval countdown for q-app request · user ignores q-app approval popup · approval dialog one minute q-app

## Q: Will my app get the authenticate popup on every GET_USER_ACCOUNT call?

A: No. Once the user accepts, later GET_USER_ACCOUNT calls in that tab return without asking. If they also ticked Always authenticate automatically, Hub remembers that for your app's name, and even new tabs skip the popup. Still call it only after a user action, and keep the result for the session.

Also asked as: GET_USER_ACCOUNT popup every time · skip GET_USER_ACCOUNT popup · authenticate prompt repeats q-app · remember authenticate app hub · authenticate tick box q-app

## Q: What else does accepting GET_USER_ACCOUNT allow for that tab?

A: For that tab's session, Hub then also lets your app run GET_USER_WALLET, GET_WALLET_BALANCE, GET_USER_WALLET_INFO, GET_USER_WALLET_TRANSACTIONS, GET_LIST_ITEMS, SIGN_FOREIGN_FEES and START_CROSSCHAIN_SERVER without asking again (ARRR wallet reads still ask first). Publishes, payments and messages still ask every time unless granted another way.

Also asked as: auto granted permissions authenticate · after authenticate session permissions q-app · GET_USER_ACCOUNT session grant · authenticated q-app tab permissions · wallet read after login q-app

## Q: Which actions can SESSION_PERMISSIONS grant?

A: JOIN_GROUP, GET_USER_ACCOUNT, GET_USER_WALLET, GET_WALLET_BALANCE, GET_USER_WALLET_TRANSACTIONS, GET_USER_WALLET_INFO, GET_LIST_ITEMS, PUBLISH_QDN_RESOURCE, PUBLISH_MULTIPLE_QDN_RESOURCES, LOCK_TAB, CREATE_GROUP, the group admin actions (invite, kick, ban, cancel ban, add and remove admin), the foreign server and fee settings, SIGN_FOREIGN_FEES, REENCRYPT_GROUP_KEYS, START_CROSSCHAIN_SERVER and NOTIFICATION_PERMISSION. Anything else fails with Invalid permissions. SEND_COIN can't be granted this way.

Also asked as: valid session permissions list · SESSION_PERMISSIONS allowed actions · which actions auto approve session q-app · SESSION_PERMISSIONS valid list · invalid permissions error SESSION_PERMISSIONS

## Q: When do session permissions end?

A: They're kept in memory for that tab and your app's name only, and they end when the tab is closed (or all tabs are). A new tab, or opening the app again, starts without them.

Also asked as: q-app session permissions cleared · how long session permission lasts q-app · session permissions tab closed · q-app permissions reset · SESSION_PERMISSIONS expiry

## Q: Which approvals have an always allow box?

A: Authenticate (GET_USER_ACCOUNT), chat messages from this app (SEND_CHAT_MESSAGE), lists (GET_LIST_ITEMS), and the balance, wallet and wallet transaction reads. The user decides; your app can't tick it for them. Payments and publishes have no such box.

Also asked as: always allow box approvals q-app · remember approval q-app · always allow options q-app approvals · always allow balance retrieved · which q-app popups can be skipped

## Q: Which qortalRequest actions need the user's confirmation tick?

A: Hub keeps Accept off until the user ticks the confirmation for requests that move value or sign things: SEND_COIN for every coin, TRANSFER_ASSET, MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA, SIGN_TRANSACTION, SIGN_FOREIGN_FEES, trade buy and sell orders, BUY_NAME and SELL_NAME, a publish that carries an app fee, and SESSION_PERMISSIONS. Expect these to take the user a little longer.

Also asked as: actions needing confirm tick · confirmCheckbox in approval q-app · which requests require i have read tick · payment approval tick list · sign transaction confirmation tick

## Q: What error does GET_USER_ACCOUNT give when the user declines?

A: Hub answers with Unable to get user account, whether the user declined or something else failed. Show your Sign in or Connect button again rather than an error, and don't call it again by itself.

Also asked as: GET_USER_ACCOUNT declined error · unable to get user account · authenticate declined q-app · GET_USER_ACCOUNT fails · user said no to authenticate

## Q: Why does GET_USER_ACCOUNT sometimes hang?

A: If Hub is locked or busy, the request can wait until Hub's 30-second limit. Retry once, then show a Sign in button so the user can try when Hub is ready.

Also asked as: GET_USER_ACCOUNT hangs · authenticate never returns q-app · GET_USER_ACCOUNT slow · hub locked q-app login · GET_USER_ACCOUNT timeout

## Q: How do I show a user's level or blocks minted in my app?

A: Call GET_ACCOUNT_DATA with the address. Among its fields are level, blocksMinted, blocksMintedAdjustment and blocksMintedPenalty, along with publicKey and defaultGroupId. It's read-only and needs no approval.

Also asked as: show account level q-app · account level and blocksMinted field · level of address in q-app · account level display app · minter level from q-app code

## Q: How can my app show the node's sync state or version?

A: GET_NODE_STATUS answers with isSynchronizing, syncPercent, height, numberOfConnections, numberOfDataConnections and isMintingPossible. GET_NODE_INFO answers with buildVersion, buildTimestamp, uptime, currentTimestamp, nodeId, isTestNet and type. Both read the node Hub or GO is connected to and need no approval.

Also asked as: GET_NODE_STATUS qortalRequest · GET_NODE_INFO qortalRequest · node sync percent q-app · GET_NODE_INFO buildVersion · show node connections q-app

## Q: How do I read an asset balance from a Q-App?

A: Use GET_BALANCE with the address and assetId set to the asset's number. Without assetId you get the QORT balance. It's read-only and needs no approval.

Also asked as: GET_BALANCE assetId field · qortal asset balance q-app · token balance qortalRequest · balance of asset id q-app · read asset holdings q-app

## Q: Can my app register a name for the user?

A: Yes. REGISTER_NAME takes name and an optional description, and the user sees Allow this app to register this name? with the fee. UPDATE_NAME takes oldName and newName (and an optional description) to change a name. Both create transactions, so they cost QORT and need the user's approval.

Also asked as: REGISTER_NAME from q-app code · register name inside q-app · UPDATE_NAME oldName newName · UPDATE_NAME from q-app · REGISTER_NAME approval in q-app

## Q: Can my app buy or sell names for the user?

A: Yes. SELL_NAME takes nameForSale and salePrice, CANCEL_SELL_NAME takes nameForSale, and BUY_NAME takes nameForSale. Each one shows the user what will happen, such as buying a name for a price in QORT, and needs their approval.

Also asked as: BUY_NAME SELL_NAME requests · SELL_NAME salePrice field · BUY_NAME nameForSale field · CANCEL_SELL_NAME in q-app · name market q-app actions

## Q: How do I search several names at once?

A: Give SEARCH_QDN_RESOURCES a names array instead of name, for example the names a user follows. Add exactMatchNames set to true so only those exact names come back. One search like this is cheaper than one per name.

Also asked as: names array search qdn · SEARCH_QDN_RESOURCES names · search multiple publishers q-app · qdn search list of names · several names one search q-app

## Q: Can I search QDN by title or description?

A: Yes. Besides query (which looks in the name and identifier), q-apps.js passes title, description and keywords to the node's search. Keep the payload small and use only the filters you need, since unknown or extra keys can make a search come back empty.

Also asked as: search qdn by title · SEARCH_QDN_RESOURCES title description · keywords field qdn search · search metadata text q-app · find resource by title q-app

## Q: How do I get QDN resources from a time range?

A: Add after and before to SEARCH_QDN_RESOURCES, each a time in milliseconds. after gives resources created after that moment and before gives those created before it, so you can fetch only what is new since your last check.

Also asked as: before after timestamps search · qdn search date range · resources published after time · SEARCH_QDN_RESOURCES before · search since timestamp q-app

## Q: What does includeStatus do in a QDN search?

A: It adds each resource's download status to the results, so you can mark which ones are ready on this node. It makes the search slower, so ask only when you need it.

Also asked as: includeStatus search field · status in qdn search results · download status per result · includeStatus slow search · qdn search with status

## Q: How do I show only content from followed names?

A: Set followedOnly to true in SEARCH_QDN_RESOURCES or LIST_QDN_RESOURCES. The node then returns only resources from names it follows, which on the user's own node means the names they follow.

Also asked as: followedOnly search field · followed names only search · qdn search follows q-app · show followed publishers q-app · followedOnly true search

## Q: What is nameListFilter in a QDN search?

A: nameListFilter takes the name of a list kept on the node, and the search returns only resources from names in that list. Apps can keep such a list with ADD_LIST_ITEMS. Lists live on the user's own node, so this doesn't help on a public node.

Also asked as: nameListFilter search field · nameListFilter list of names · filter by list of names qdn · subscriptions list filter search · nameListFilter node list

## Q: What does default true do in a QDN search?

A: It returns only default resources, the ones published without an identifier, such as each name's main APP or WEBSITE. Leave it out to get both kinds.

Also asked as: default true search field · search default resources flag · default resources only search · search default websites q-app · default flag SEARCH_QDN_RESOURCES

## Q: What does minLevel do in a QDN search?

A: minLevel filters results by the publisher's account level, so only accounts at or above that level are returned. Use it where you want to show content only from established accounts.

Also asked as: minLevel search field · minimum account level search · filter new accounts qdn search · minLevel spam filter · search by publisher level q-app

## Q: What fields does GET_QDN_RESOURCE_STATUS return?

A: It returns status, id, title and description for the state, plus localChunkCount, totalChunkCount and percentLoaded. Show percentLoaded as progress while the node downloads, and wait for READY before you fetch large data.

Also asked as: GET_QDN_RESOURCE_STATUS fields · percentLoaded localChunkCount fields · resource status response q-app · status totalChunkCount field · download progress qdn app

## Q: What should my app show if a resource still won't load?

A: After about three failed tries, show the title and date you already have from the search row, with Not available on your node right now and a retry. Never leave a loading skeleton that never ends.

Also asked as: resource fails three times · not available on your node right now · qdn item never loads · endless skeleton q-app · give up loading resource

## Q: Why does GET_QDN_RESOURCE_URL say Resource does not exist?

A: q-apps.js checks the status first and gives that error when the node knows no such resource (NOT_PUBLISHED) or has no status for it. Check the name, service and identifier, which are case-sensitive, and show a placeholder instead of a broken image.

Also asked as: resource does not exist error · GET_QDN_RESOURCE_URL error · qdn url not published · image url missing resource · GET_QDN_RESOURCE_URL fails

## Q: What address does GET_QDN_RESOURCE_URL give?

A: It gives an address on the node: /arbitrary/<service>/<name>/<identifier>, with ?filepath=<path> added for one file inside a multi-file resource. It works as an image or video source, or for fetch, inside Hub and GO.

Also asked as: GET_QDN_RESOURCE_URL format · arbitrary url from q-app · qdn file address app · filepath url qdn resource · resource url relative node

## Q: How do I list the files inside a published APP or WEBSITE?

A: Call GET_QDN_RESOURCE_METADATA for it: the answer includes files, the list of paths inside the resource. Paths published from Windows can use backslashes, so treat a backslash as a slash. Then fetch a file with FETCH_QDN_RESOURCE and filepath.

Also asked as: list files in published app · files inside qdn website · metadata files list q-app · what files are in this app qdn · GET_QDN_RESOURCE_METADATA files

## Q: Why does GET_QDN_RESOURCE_METADATA fail for some resources?

A: The node answers 404 when it has no metadata for that resource, for example when it was published without a title, description or tags, or when the node hasn't fetched the metadata file yet. Fall back to the name and identifier.

Also asked as: GET_QDN_RESOURCE_METADATA 404 · metadata not found resource · no metadata qdn resource · resource without title metadata · metadata request fails

## Q: How do I read a group's chat messages from my app?

A: Use SEARCH_CHAT_MESSAGES with txGroupId set to the group's id, or involving with two addresses for a private chat, plus before, after, limit, offset and reverse. Set encoding to BASE64 to get the data as base64 instead of base58, then decode it. Private messages come back encrypted.

Also asked as: SEARCH_CHAT_MESSAGES group · read group chat q-app · chat messages txGroupId field · fetch chat history app · group messages qortalRequest

## Q: How do I get the results of a poll?

A: Fetch /polls/votes/<pollName> from the node with a relative fetch; it returns the votes for that poll. Encode the poll name, and create polls with unique names so you read the right one.

Also asked as: poll results q-app · poll votes fetch q-app · polls votes endpoint · count poll votes app · read poll result qortal app

## Q: Should my app merge identical QDN searches?

A: Yes. Keep one promise per set of search parameters, and let a second identical call wait for the first. q-apps.js already shares some identical reads that are in flight, but your own merging cuts the work, especially in GO where every request makes an extra hop.

Also asked as: dedupe qdn searches · same search twice q-app · merge identical qortalRequest calls · duplicate SEARCH_QDN_RESOURCES calls · in flight search sharing q-app

## Q: What does filename do when my app publishes?

A: It names the file the node stores, which helps apps and downloads tell its type. If the name has no proper extension, Core detects the type and adds one; with no filename at all it uses a qortal-<time> name. Give a real name such as photo.jpg when users will download the file.

Also asked as: publish filename field · file name of published resource · filename extension qdn publish · qortal- file name publish · mime type from filename publish

## Q: Can I pass tags as an array when publishing?

A: Yes. Hub takes a tags array and uses the first five, or the older tag1 to tag5 fields; both end up as the same five tags. Keep them short, since Core drops a tag that is too long.

Also asked as: tags array publish field · tag1 tag2 publish fields · publish tags list q-app · how to add tags in PUBLISH_QDN_RESOURCE · tags field qortalRequest

## Q: How does Hub upload a big file to QDN?

A: Hub first asks the node whether it has room (if not: Not enough space on your hard drive), then sends the file in 5 MB chunks, retrying a failed chunk up to three times, and finally asks the node to join them and build the transaction. You get PUBLISH_STATUS for each step.

Also asked as: hub upload in 5 mb parts · 5 mb chunks publish · upload chunks hub publish · publish upload retries chunk · large file upload hub

## Q: Which publish errors should my app retry?

A: Only those where the node didn't answer. Hub already retries network errors, timeouts and busy replies by itself. A refusal from the node (such as a missing API key or a validation error) comes back at once with Core's own words and won't change if you retry, and a decline is the user's choice. And after any unclear failure, check whether the resource exists before publishing again.

Also asked as: retry publish error q-app · publish refused vs no answer · your node did not answer publish · publish 4xx refusal app · when should q-app retry publish

## Q: Can one batch publish use several of the user's names?

A: Yes. Each resource in PUBLISH_MULTIPLE_QDN_RESOURCES can set its own name, as long as every one belongs to the user; one that doesn't stops the batch with The name X, does not belong to the publisher. A resource without a name uses the account's primary name.

Also asked as: batch publish several names · PUBLISH_MULTIPLE different names · resource name per item batch · multiple own names one approval · name does not belong to the publisher

## Q: What do the _PRIVATE errors mean when my app publishes?

A: Only encrypted data can go into private services means you sent plain data to a _PRIVATE service: turn on encrypt with publicKeys, or encrypt it first. For an encrypted publish please use a service that ends with _PRIVATE means the reverse: you asked to encrypt into a public service, so switch to one such as DOCUMENT_PRIVATE.

Also asked as: only encrypted data can go into private services · use a service that ends with _PRIVATE · private service publish error · encrypted publish wrong service · _PRIVATE service error q-app

## Q: Why does the node refuse encrypted data in a public service?

A: Core checks single-file data when it's published: data in a _PRIVATE service must start with Qortal's encrypted-data marker, and data in a public service must not. A mix-up fails with DATA_NOT_ENCRYPTED or DATA_ENCRYPTED. Hub's encrypt option adds the marker for you.

Also asked as: DATA_ENCRYPTED error publish · DATA_NOT_ENCRYPTED error · encrypted data public service refused · qortalEncryptedData prefix check · private service needs encryption core

## Q: Do I need a public key to decrypt with DECRYPT_DATA?

A: Only for data in the older single-recipient format: then pass publicKey, the other person's key, with encryptedData. Data encrypted for a list of public keys, which is what Hub's encrypt and ENCRYPT_DATA produce, needs only encryptedData. The answer is the plain data in base64.

Also asked as: DECRYPT_DATA publicKey field · decrypt without public key · decrypt group encrypted data · missing fields publicKey decrypt · DECRYPT_DATA encryptedData field

## Q: Does the node accept a zip with everything inside one folder?

A: Yes, in one case: when the zip holds exactly one top-level folder (folders starting with an underscore, such as __MACOSX, are ignored), Core uses that folder as the root. With more than one item at the top it doesn't. The safe way is still to zip the contents, so index.html sits at the top.

Also asked as: zip with one folder inside · dist folder inside zip · nested folder zip qdn · zip wrapper folder app · top folder in zip qortal · Why must index.html be at the zip root · index.html zip root · wrong zip structure · What is a flat dist zip · q-app zip layout

## Q: Which identifiers can't my app publish to?

A: Hub refuses identifiers that start with symmetric-qchat-group-, which hold group chat keys, with Invalid Data. Identifiers can be at most 64 characters, and they are case-sensitive.

Also asked as: forbidden identifier publish · symmetric-qchat-group identifier · invalid data publish identifier · reserved identifier qdn · identifier refused hub publish

## Q: Why does a publish fail while the node is syncing?

A: Core refuses new uploads until it's up to date: its latest block has to be less than about an hour old. Wait for the node to finish syncing, then publish again.

Also asked as: publish fails node syncing · blockchain needs sync publish · cant publish node behind · publish error sync · node not up to date publish

## Q: What does a successful publish return?

A: The ARBITRARY transaction: type, timestamp, signature, fee, name, identifier, service (as a number), size, and more. Keep the signature if you want to point to that exact publish. PUBLISH_MULTIPLE_QDN_RESOURCES returns a list of them.

Also asked as: publish response fields · PUBLISH_QDN_RESOURCE result · publish transaction signature · what returns after publish q-app · publish success object

## Q: What do the service numbers in a publish response mean?

A: Each service has a number: for example FILE 140, WEBSITE 200, IMAGE 400, THUMBNAIL 410, VIDEO 500, AUDIO 600, BLOG_POST 777, DOCUMENT 800, APP 1000 and JSON 1110. Private versions end in 1, such as IMAGE_PRIVATE 401 and DOCUMENT_PRIVATE 801.

Also asked as: service number 777 · service code qdn numbers · 1000 APP service number · numeric service id · DOCUMENT_PRIVATE 801

## Q: What should my app do with an item replaced by a delete marker?

A: Treat it as gone: if the fetched data is just the letter D, or your app's own delete marker, show that the publisher deleted it and drop it from your lists. Apps publish such markers at the same name, service and identifier because QDN has no real delete. Decide on one marker for your app and document it.

Also asked as: handle delete marker in q-app code · D body deleted resource · hide deleted qdn items app · tombstone handling q-app · deleted by publisher app logic

## Q: What does DELETE_HOSTED_DATA do?

A: It removes copies from the user's own node, not from QDN. Pass hostedData, a list of service, name and identifier; the user is asked Allow this app to delete N hosted resources?, and you get deletedCount, failedCount and failures back. It doesn't work on a public node.

Also asked as: DELETE_HOSTED_DATA request · hostedData array request · delete hosted resources qortalRequest · DELETE_HOSTED_DATA deletedCount · remove node copies from q-app code

## Q: What does GET_HOSTED_DATA do?

A: It lists the QDN resources the user's own node is storing, 20 at a time by default, with limit, offset and an optional query. The user is asked Allow this app to get a list of your hosted data? first, and it doesn't work on a public node.

Also asked as: GET_HOSTED_DATA request · list hosted data node q-app · what my node hosts app · hosted resources list q-app · storage manager q-app

## Q: How can my app show the publish fee before asking?

A: Fetch /transactions/unitfee?txType=ARBITRARY from the node; the answer is in units of 1/100,000,000 QORT, so divide by 100,000,000. Hub reads the same value for its approval, which shows the fee again before the user accepts. Multiply by the number of resources for a batch.

Also asked as: show publish fee q-app · arbitrary fee before publish · unitfee ARBITRARY endpoint · what does publishing cost app · publish fee estimate q-app

## Q: Should likes and votes wait for the publish to finish?

A: No. For likes, votes, follows and small edits, update the screen at once, publish in the background, and roll the change back if the publish fails. Waiting for each publish makes the app feel stuck.

Also asked as: optimistic ui q-app · likes wait for publish · instant like button qdn · roll back failed publish ui · votes show immediately app

## Q: How can I check that the published app is the build I meant?

A: Open the published index.html from the node (for example with FETCH_QDN_RESOURCE and filepath index.html) and compare the script and style files it references with a fresh build of the same commit. Different hashed file names mean an old or different zip went up.

Also asked as: verify published bundle · check live app matches build · compare published files build · qdn app wrong version · stale published zip check

## Q: What shouldn't my app put in identifiers?

A: Anything private. Identifiers, like titles and tags, are public and searchable by anyone, so keep them to your app prefix and neutral ids. Never put a user's private details, or data from one person meant for another, into an identifier or a link.

Also asked as: private data in identifier · identifier is public data · user data in identifier · identifier privacy q-app · what not to put identifier

## Q: Does SEND_COIN check the user's balance first?

A: Yes. For QORT, Hub refuses with Insufficient funds when the amount plus the fee is more than the balance, and an amount of zero or less is refused too. Check the balance yourself first if you want to warn the user before the approval.

Also asked as: SEND_COIN insufficient funds · payment balance check q-app · SEND_COIN balance plus fee check · amount must be above zero send coin · send coin fails balance

## Q: Which coins does SEND_COIN support?

A: QORT, BTC, LTC, DOGE, DGB, RVN and ARRR. Foreign coins can't be sent through a public node, and the approval warns that the coin's private key is sent to the node that makes the payment, so only the user's own node should do it.

Also asked as: SEND_COIN foreign coins · send btc ltc from q-app · SEND_COIN coin list · send doge from q-app · foreign coin payment q-app

## Q: What does SEND_COIN return for a QORT payment?

A: The PAYMENT transaction: amount, fee, recipient, creatorAddress, senderPublicKey, timestamp, reference and signature, among others. Store the signature with your order so you can show it and look the payment up later.

Also asked as: SEND_COIN response · payment result fields q-app · send coin signature field · what returns after payment q-app · SEND_COIN transaction object

## Q: What is MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA?

A: It pays one or more recipients in a single approval, with payments (each a recipient and amount) and assetId, and can publish data encrypted for each recipient alongside, such as an order's details. The user sees Allow this app to make the following payments and publishes? If one payment fails midway, the error says how many were already sent.

Also asked as: MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA · pay several recipients one approval · payment with encrypted data q-app · multi payment qortalRequest · pay and publish order data

## Q: Why can't my app send a private message to some users?

A: Private messages are encrypted to the recipient's public key, and some accounts have none on chain yet. Hub then refuses with Cannot send an encrypted message to this user since they do not have their publickey on chain. Tell the user that this account can't get private messages yet.

Also asked as: cannot send encrypted message publickey · dm fails no public key q-app · recipient has no public key · private message error q-app · publickey on chain chat

## Q: What happens when a user ticks always allow chat messages for my app?

A: Hub remembers it for your app's name, and later SEND_CHAT_MESSAGE calls are sent without asking. That trust is easy to lose, so send messages only when the user has just pressed a send button.

Also asked as: always allow chat messages tick · chat without approval q-app · qAPPSendChatMessage permission · skip chat approval q-app · auto send chat app

## Q: How does Hub format a plain chat message sent from my app?

A: Hub wraps your message text in its own chat format (messageText as rich text, images, repliedTo, version 3), so it shows like any message in Q-Chat. To send your own format instead, pass fullMessageObject or fullContent as a string, base64 or an object; anything else fails with fullContent is in an invalid format.

Also asked as: hub chat format for app messages · fullMessageObject field · fullContent chat message · tiptap message format app · send rich chat message q-app

## Q: What is chatReference in SEND_CHAT_MESSAGE?

A: chatReference ties a new message to an earlier one, by that message's signature. Q-Chat uses it for reactions and edits, and SEARCH_CHAT_MESSAGES can filter by chatReference or hasChatReference.

Also asked as: chatReference field in SEND_CHAT_MESSAGE · reply reaction chat reference · hasChatReference search field · edit message reference chat · chat reference signature

## Q: Why does sending a chat message from my app take a few seconds?

A: Each chat message needs a small proof-of-work, which Hub computes on the device before it sends, so slow phones take longer. q-apps.js allows 60 seconds for SEND_CHAT_MESSAGE. Show that the message is sending rather than freezing the screen.

Also asked as: chat message slow q-app · proof of work chat message · SEND_CHAT_MESSAGE delay · chat pow time app · message sending takes time

## Q: Can my app create a group?

A: Yes, with CREATE_GROUP and groupName, type, approvalThreshold, minBlock and maxBlock, plus an optional description. The user sees Allow this app to create a group? with the name and fee. UPDATE_GROUP changes one later, with groupId and newOwner among its fields.

Also asked as: CREATE_GROUP from q-app code · create group from q-app · group creation fields · approvalThreshold minBlock maxBlock · CREATE_GROUP required fields

## Q: Which group member actions can my app request?

A: INVITE_TO_GROUP (groupId, inviteeAddress, inviteTime), CANCEL_GROUP_INVITE, KICK_FROM_GROUP, BAN_FROM_GROUP, CANCEL_GROUP_BAN, ADD_GROUP_ADMIN and REMOVE_GROUP_ADMIN (each with groupId and qortalAddress), plus JOIN_GROUP and LEAVE_GROUP with groupId. Each one shows the user what it will do, with its fee, before anything is sent.

Also asked as: INVITE_TO_GROUP request fields · KICK_FROM_GROUP BAN_FROM_GROUP · group admin actions q-app · ADD_GROUP_ADMIN request · LEAVE_GROUP in q-app code

## Q: What does a NOTIFICATION_ADD rule need?

A: A notifications array, each item with notificationId (your name for the rule), link (the qortal:// link to open), filters (which publishes count) and message with at least an en text, plus other languages if you like; image is optional. Adding a rule with an existing notificationId replaces it.

Also asked as: notification rule fields · notificationId link filters message · NOTIFICATION_ADD format · notification message en field · notification rule image field

## Q: Which filters can a notification rule use?

A: service, query, identifier, names, title, description, keywords, prefix, defaultResource, followedOnly, excludeBlocked, after and before, much like the filters of SEARCH_QDN_RESOURCES. Any other key fails with Unknown filter key, and each value must have the right type, such as names as a list of strings.

Also asked as: notification filters list · NOTIFICATION_ADD filters keys · unknown filter key error · notification rule service identifier · filter publishes for notifications

## Q: How does my app read or remove its notification rules?

A: NOTIFICATION_GET returns your app's own rules in the same shape you added them. NOTIFICATION_REMOVE with notificationIds removes those rules; without notificationIds it removes all of your app's rules. Apps only see and change their own rules.

Also asked as: NOTIFICATION_GET rules · NOTIFICATION_REMOVE notificationIds · list my app notification rules · remove notification rule app · delete notification subscription q-app

## Q: What is NOTIFICATION_MARK_SEEN?

A: It tells Hub or GO that the user has seen your app's notifications for the given notificationIds, optionally for one identifier, so they aren't shown again. Call it when the user opens the item inside your app.

Also asked as: NOTIFICATION_MARK_SEEN request · mark notifications seen app · clear app notifications seen · seen notifications q-app · notification already read app

## Q: How can my app check notification permission without asking?

A: Call NOTIFICATION_HAS_PERMISSION. It answers true or false without showing anything, so you can show your notification settings correctly and only ask when the user turns them on.

Also asked as: NOTIFICATION_HAS_PERMISSION request · check notification permission app · has notification permission q-app · notification permission status q-app · ask notifications only if needed

## Q: How should my app handle a user revoking its notifications?

A: Users can tap Revoke for your app in GO's or Hub's notification settings, which removes every rule your app added; they can also just turn off phone alerts for it. So don't assume your rules are still there: check with NOTIFICATION_HAS_PERMISSION and NOTIFICATION_GET when your settings screen opens, show notifications as off if they're gone, and ask again only when the user turns them on.

Also asked as: NOTIFICATION_GET empty after revoke · user revoked q-app notification rules · notification permission revoke q-app code · handle revoked notifications app · q-app rules removed by user

## Q: What does CREATE_AND_COPY_EMBED_LINK do?

A: It builds a qortal://use-embed/ link and copies it to the clipboard, and also returns it. type POLL needs name (ref optional); type IMAGE or ATTACHMENT needs name, service and identifier, and for private encryption also key. People paste the link into chat, where it shows as the item.

Also asked as: CREATE_AND_COPY_EMBED_LINK · make embed link q-app · use-embed link from app · copy poll embed link · image embed link qortalRequest

## Q: What does ADMIN_ACTION do?

A: It runs a node admin command for apps like a node manager: stop, restart, bootstrap, addmintingaccount, getmintingaccounts, removemintingaccount, getpeers, addpeer, removepeer, adddatapeer, removedatapeer and forcesync; several need a value. The user is asked Allow this app to perform the admin action: <type>?, and it doesn't work on a public node.

Also asked as: ADMIN_ACTION request types · node admin from q-app · restart node from q-app code · ADMIN_ACTION addpeer value · forcesync admin action

## Q: Why does SAVE_FILE say a mimeType could not be derived?

A: Hub needs to know the file's type: from the blob's type or from mimeType in your request. Give the blob a type, or pass mimeType, and use a filename with an extension; otherwise it fails with A mimeType could not be derived or A file extension could not be derived. A missing filename fails too.

Also asked as: mimeType could not be derived · SAVE_FILE mime type error · file extension could not be derived · SAVE_FILE missing filename · save file error q-app

## Q: Why does OPEN_NEW_TAB fail with Invalid qortal link?

A: qortalLink must be a qortal:// link with at least a service and name, such as qortal://APP/<name>. Hub also refuses names or paths that would climb out of that app, for example with ../ segments. Build links from encoded parts instead of joining raw strings.

Also asked as: invalid qortal link error · OPEN_NEW_TAB error · qortalLink field missing · open tab link refused q-app · bad qortal link q-app

## Q: How does a qortal:// link decide what is the identifier and what is the path?

A: For a link like qortal://SERVICE/name/x/rest, q-apps.js asks the node whether that name has a resource with identifier x. If it does, x is the identifier and the rest is the path; if not, x is the first part of the path. Use default as the third part to say clearly that there is no identifier.

Also asked as: qortal link identifier or path · third part qortal link · qortal://APP name identifier path · link resolution qortal identifier · qortal link default keyword

## Q: How is a private Q-App stored on QDN?

A: Your zip (50 MB at most), a logo and the app's name are packed together, encrypted for one private group, and published as a DOCUMENT under your name with an identifier you choose. Only groups where you are an admin can be picked. Members open it from + private app with the group, your name and that identifier; GO builds it on the phone, and the desktop Hub through the user's own node.

Also asked as: private q-app storage · private app encrypted group · private app DOCUMENT identifier · ENCRYPT_QORTAL_GROUP_DATA app · private app zip logo

## Q: Which language codes can Hub and GO send to my app?

A: The 12 languages of Hub and GO: en, de, es, et, fi, fr, it, ja, pt, ru, zh and ar. Remember that ar is written right to left.

Also asked as: hub language codes list · go lang codes q-app · supported languages hub q-app · lang values en de es · which languages does go use

## Q: Does Hub pass its custom theme colours to my Q-App?

A: No. Hub tells your app only whether it is in light or dark mode, through the theme parameter, _qdnTheme and THEME_CHANGED. Pick your own colours for each mode.

Also asked as: hub custom theme colors q-app · q-app gets hub palette · user theme colors to app · theme manager colors q-app · only light or dark q-app

## Q: What colours and type match Hub 3.0?

A: Hub 3.0's dark chat surfaces are #0E0F14 and #1D1F27, with one soft blue accent, #84AFF0, 8 px corners and the Inter font. Torq's Hub 3.0 theme, a worked example of that look, pairs them with a warm paper colour, #F6F2EA, in light mode. If you use Inter, bundle the font files in your app.

Also asked as: hub 3.0 colors for q-app · match hub 3.0 design · hub dark surface colour · q-app look like hub · hub 3.0 font inter

## Q: Why do sticky headers scroll away in my Q-App?

A: overflow-x: hidden on html or body turns body into a scroll container, so sticky headers and back bars scroll away. Use overflow-x: clip instead.

Also asked as: sticky header not sticky q-app · overflow-x hidden body sticky · header scrolls away hub app · overflow clip q-app · back bar scrolls away

## Q: How does Hub's Back button move inside my app?

A: q-apps.js tells Hub which paths your app has shown. When the user presses Hub's Back or Forward, Hub posts NAVIGATE_TO_PATH with a path; move your router there and answer with NAVIGATION_SUCCESS and the same path. If Hub hears nothing within a fraction of a second, it reloads your app at that path instead.

Also asked as: NAVIGATE_TO_PATH · NAVIGATION_SUCCESS message · hub back button q-app routes · hub back forward in app · app history with hub back

## Q: Which screen sizes should I test my Q-App at?

A: At least 360 by 740 and 390 by 844 (phones), 844 by 390 (a phone sideways), 700 px wide (a narrow Hub window) and 1280 px wide, in light and dark mode.

Also asked as: q-app test sizes · test app phone sizes · 360 390 landscape test · narrow hub window test · q-app responsive check sizes

## Q: How do I keep inputs visible above the phone keyboard?

A: Keep the focused input and its send or publish button above the keyboard by following visualViewport, and don't pin things to the bottom with 100vh. Use the right inputMode, such as decimal for amounts, so phones show the right keys.

Also asked as: keyboard covers input q-app · phone keyboard hides send button · visualViewport q-app · inputMode amount field · q-app input under keyboard

## Q: Which fields does Hub's publish screen require?

A: Name, title, description, category, the type (APP or WEBSITE) and the zip; if one is missing Hub lists it under Missing fields. The title takes up to 80 characters, the description 240, and each of the five tags 20.

Also asked as: publish screen required fields · missing fields publish app hub · title description category required · hub publish form fields · app publish form tags

## Q: Why does Dev Mode Zip say I need a name?

A: Hub builds the preview of your zip under your registered name, the way it would be published. Without a name it stops with You need a name to use preview. Register a name first; the preview itself costs nothing.

Also asked as: you need a name to use preview · dev mode zip name required · preview needs registered name · hub zip preview no name · dev mode name preview error

## Q: What does Directory do in Hub's Dev Mode?

A: It zips the folder you pick, for example your build output, and previews it like Zip does. Refreshing the tab zips the folder again, so a new build shows without making a zip by hand.

Also asked as: dev mode directory option · preview folder hub · zip folder preview hub · dev mode build folder · directory preview q-app

## Q: Why does my app lose qortalRequest on a deep path in Dev Mode?

A: The node's dev proxy only adds q-apps.js to the root page and to .html files, so a deep path loads without qortalRequest. Reload at the root and move to the page with your app's router.

Also asked as: dev proxy deep link no qortalRequest · dev mode deep path broken · qortalRequest undefined dev server · reload at root dev mode · dev proxy q-apps.js injection

## Q: Why is my built app blank in Dev Mode Server?

A: Core 6.1.9's dev proxy answers 404 for every path under /assets/, which is where Vite puts built files. Test a build with Dev Mode's Zip instead, or use the development server; for a quick check you can build with another assets folder, but don't publish it that way.

Also asked as: built app blank dev mode server · assets 404 dev proxy · vite preview blank hub · dev proxy assets folder · production build dev mode server

## Q: Why doesn't hot reload work through Hub?

A: Vite's live-reload connection never gets through the node's proxy, so reload the tab yourself. After Vite optimises new dependencies a page can load two copies of React (Invalid hook call): reload again or restart Vite with --force. If the proxy stops after Vite restarts, add the server again in Dev Mode and close the dead tab.

Also asked as: vite hmr hub dev mode · hot reload not working hub · invalid hook call dev mode · two copies of react hub · dev proxy stopped after restart

## Q: Can I test Q-App publishing on a testnet?

A: Yes. Qortal's docs suggest the official testnet, or a single-node testnet (often called a devnet) on your own machine, for an end-to-end test of publishing. Publishing an unfinished app to mainnet isn't recommended; for most checks a preview is enough.

Also asked as: qortal testnet publish trial · devnet single node testnet · test publish without mainnet · qortal testnet for q-apps · trial publish before mainnet

## Q: How do I unit-test a Q-App without a Qortal node?

A: Use a test runner such as vitest with jsdom, and put a global qortalRequest mock in your test setup that answers by action. Then you can check which calls your code makes and how many, for example that the first screen makes only a few SEARCH_QDN_RESOURCES calls.

Also asked as: unit test q-app · mock qortalRequest tests · vitest q-app setup · test q-app without hub · fake qortalRequest jsdom

## Q: How do I check my Q-App for request storms?

A: Count the SEARCH_QDN_RESOURCES calls on first load, with a small wrapper or a test spy, and watch the console in Hub. Write down the numbers before and after a change, along with your biggest bundle chunk.

Also asked as: q-app too many searches · count qortalRequest calls first load · request storm q-app · measure searches on load · q-app slow many requests

## Q: How is testing in GO different from testing in Hub?

A: GO renders Q-Apps in Android System WebView, which is Chromium updated through the Play Store, inside a phone-sized frame. So check touch, the keyboard, narrow layouts and GO's own behaviour, such as its publish window, full screen and sideways swipes between sections, on a real phone.

Also asked as: test q-app go vs hub · android webview q-app · go specific q-app behaviour · test app on phone go · test q-app in go webview

## Q: Should my widget use the go-widget identifier or the tag?

A: Both if you can. An identifier starting with go-widget is filtered by Core on the node, so GO finds it fast, and it lets a name publish its widget next to its main app. The go-widget tag also works, for a name whose default APP is the widget, but GO finds tags by reading every APP's metadata, which is slower.

Also asked as: go-widget identifier or tag · widget discovery rules go · tag go-widget slower · identifier prefix widget fast · both identifier and tag widget

## Q: How do I turn my QDN website into a GO widget?

A: GO lists only APP resources, never a WEBSITE. Make a small page for the widget view and publish it as an APP under your website's name, with identifier go-widget-<slug> and the tag go-widget. Link to the full site with qortal://WEBSITE/<name>/<path> through OPEN_NEW_TAB, and don't embed outside web content.

Also asked as: website as go widget · WEBSITE widget go · widget for my qdn site · website resource not widget · site widget publish app

## Q: What address does GO load my widget at?

A: <node>/render/APP/<name> with theme (dark or light), lang (GO's language code), identifier (empty for a default APP) and goWidget=1 in the query. Core injects qortalRequest into the page as for every Q-App.

Also asked as: widget render address go · goWidget=1 url · widget url parameters · how go loads widget frame · widget query theme lang

## Q: What background should my GO widget have?

A: Transparent. The frame sits on GO's own card, with 16 px rounded corners and GO's card colour, so a transparent page blends in; a solid background shows as a box inside the card.

Also asked as: widget transparent background · widget card colour go · widget rounded corners · widget background color · blend widget into go card

## Q: What grid does GO's widgets screen use?

A: 4 columns and 40 px rows with 12 px gaps, at most 560 px wide. A widget is 1 to 4 columns wide and 2 to 14 rows tall, and a new one starts full width and 5 rows tall until the widget or the user sizes it. Height in px is rows times 40 plus 12 for each gap between rows.

Also asked as: widget grid columns rows · go widget grid size · widget rows 40 px · widget width columns · widget height rows formula

## Q: What does GO_WIDGET_INFO return?

A: widget (true), platform (GO 3.0), theme, language, visible, the frame's width and height in px, its columns and rows, gridColumns, minRows, maxRows, and sizedBy: default, widget or user.

Also asked as: GO_WIDGET_INFO · widget info fields · widget sizedBy field · widget visible columns rows · go widget platform info

## Q: What happens if my widget calls GO_WIDGET requests outside GO?

A: In the Hub or a normal Q-App tab they may fail or never answer. Send them only when goWidget=1 is in the address, never wait for them before drawing, and give any answer you need a short timeout, such as 1.5 seconds.

Also asked as: GO_WIDGET_INFO in hub tab · widget request never answers · widget in hub test · GO_WIDGET timeout · widget requests only in go

## Q: Which read requests work in a GO widget?

A: The read-only ones Core answers in your frame, as in any Q-App: SEARCH_QDN_RESOURCES, FETCH_QDN_RESOURCE, LIST_QDN_RESOURCES, GET_QDN_RESOURCE_URL, GET_QDN_RESOURCE_STATUS, GET_QDN_RESOURCE_PROPERTIES, GET_QDN_RESOURCE_METADATA, GET_ACCOUNT_DATA, GET_ACCOUNT_NAMES, GET_NAME_DATA, SEARCH_NAMES, GET_BALANCE, GET_PRICE, LIST_GROUPS, SEARCH_CHAT_MESSAGES, SEARCH_TRANSACTIONS, and the block and AT reads. Of GO's own requests, GET_PRIMARY_NAME, GET_NODE_INFO, GET_NODE_STATUS, IS_USING_PUBLIC_NODE, WHICH_UI, GET_DAY_SUMMARY and the GO_WIDGET ones always work.

Also asked as: widget read requests allowed · SEARCH_QDN_RESOURCES in widget · widget fetch qdn data · widget allowed actions list · widget qortalRequest reads

## Q: Which requests work in a widget only while the widgets screen shows?

A: OPEN_NEW_TAB, SET_TAB, OPEN_USER_LOOKUP, GET_USER_ACCOUNT and GET_WALLET_BALANCE; the last two ask the user as in any Q-App. When the screen is hidden they fail with The widgets screen is not showing.

Also asked as: widget requests screen showing · OPEN_NEW_TAB from widget · widget account request while visible · widget ask user while visible · the widgets screen is not showing error

## Q: What can't a widget's frame do?

A: The frame is sandboxed with scripts, same-origin and forms only. alert, confirm and prompt do nothing, and there are no pop-up windows, downloads, full screen, clipboard, camera, microphone or location. Use inline UI instead of dialogs.

Also asked as: widget sandbox limits · alert in go widget · widget no popups downloads · widget clipboard camera · widget confirm prompt

## Q: Can my widget use sideways swipes or long presses?

A: No. GO takes a swipe once it's clearly sideways (about 10 px, wider than tall) and takes a long press at 400 ms to pick the widget up; your page then gets a touchcancel. Build with buttons and vertical lists, not carousels or long-press menus. While the user arranges the screen, your widget gets no touches at all.

Also asked as: widget carousel swipe · widget long press menu · widget gets touchcancel event · widget gestures go · widget horizontal swipe

## Q: Where should my widget keep its settings?

A: In localStorage, under keys prefixed with your name, such as yourname.clock.hour12, since every Q-App from the node shares that storage. For the setting itself use a small inline form inside the widget; inputs work, dialogs don't.

Also asked as: widget settings storage · widget localStorage prefix · widget city choice save · widget remember setting · widget inline form settings

## Q: What privacy rules should a GO widget follow?

A: Load your code and data only from your bundle and QDN: outside web services may be blocked and leak the user's IP address and activity. Ask only for what you show, so no GET_USER_ACCOUNT unless the widget is about their account, and never put user data in links, identifiers or anything you publish.

Also asked as: widget privacy rules · widget outside web services · widget ask user address · widget ip address leak · widget user data links

## Q: How do I add a widget mode to my existing Q-App?

A: Check goWidget=1 once at start, before routers and providers, and then show a compact view: transparent background, no bars, menus or splash screen, data from cache first, fitted to the frame, no sideways swipes or dialogs, and every action opening your full app with OPEN_NEW_TAB. Pause timers on GO_WIDGET_VISIBILITY, avoid requests widgets refuse, add the tag go-widget, and publish.

Also asked as: widget mode in my app · goWidget compact view · existing app widget view · react widget view goWidget · tag app go-widget

## Q: Is there an example GO widget I can start from?

A: Yes. docs/go/go-widgets.md in the Qortal Hub repo has a template that handles theme, language, visibility and sizing, and the GO Clock example is tools/preview/fake-node/render/APP/GOClock.html; publish it as APP under your name with identifier go-widget-clock.

Also asked as: example go widget · go widget template code · widget template html · go widget starter code · goclock example

## Q: Why doesn't my widget update right after I publish a new version?

A: After its first load, GO keeps a copy of your widget's published files on the phone and opens it from there, while the data it shows still comes from QDN live. At most once an hour GO checks for a newer publish and fetches it in the background, and the new version shows from the widget's next load. The menu's Reload reloads the widget.

Also asked as: widget not updating after publish · widget old version go · widget copy on phone · widget update hourly · republish widget go

## Q: What checklist should my GO widget pass?

A: Published as APP with a go-widget identifier or tag, short title and one-line description. Draws the widget view from goWidget=1 on the first frame, with a transparent background that follows theme. Looks right from 79 by 92 to 351 by 716 px, pauses when hidden, uses only allowed requests and opens the full app for actions. No sideways or long-press gestures, dialogs or outside web requests; shows something within about 300 ms, with empty and error states; prefixes its storage keys.

Also asked as: go widget checklist · widget requirements list · widget must have · widget release checklist · widget quality checks

## Q: How do I show the latest items from my app in a widget?

A: Search with SEARCH_QDN_RESOURCES for your app's service and identifier prefix, with prefix true, includeMetadata, excludeBlocked, a small limit such as 5 and reverse true for newest first. Draw each as a row at least 40 px tall that opens the full app at that item with OPEN_NEW_TAB, and show only as many rows as fit the frame's height.

Also asked as: widget latest posts · widget list qdn items · widget search identifier prefix · widget rows open app · news widget go

## Q: Why do some files of my widget fail to load?

A: For an APP under an identifier, the node picks files by the identifier in the address. In HTML pages it adds that identifier to relative script and link tags for you, but other relative loads, such as images, fetches or lazily loaded script chunks, don't get it and are looked up in the name's default app instead. A single index.html with its CSS and JS inline, as GO's widget guide suggests, avoids this.

Also asked as: widget images not loading · identifier app relative files · widget lazy chunk fails · identifier app assets not loading · app under identifier files missing

## Q: How do I make my Q-App's first screen appear faster?

A: Show cached data at once and refresh after; use skeletons shaped like the final layout instead of a spinner on a blank page; load only the first page of results; and fetch images as they scroll into view. Code-split so the first screen loads only what it needs.

Also asked as: q-app first load fast · show cached data first · skeleton loading q-app · app start speed qdn · faster first screen app

## Q: What states should every screen in my Q-App have?

A: Loading, with a skeleton like the final layout; empty, with one line saying why and the next action (for example No mail yet, Compose); error, saying in plain words what failed, with Retry; and for QDN data not downloaded yet, Fetching from peers... with progress. Never show a raw error or [object Object].

Also asked as: q-app loading empty error states · empty state q-app · error state retry app · skeleton not spinner · screen states design q-app

## Q: Should my app confirm before it publishes or pays?

A: Yes. Before you call the request, say in your own screen what will happen and what it costs, for anything that publishes, spends QORT or deletes. Hub's approval then confirms it, but the user should already know why it's coming.

Also asked as: confirm before publish app · explain cost before approval · confirm spend q-app · dialog before payment app · tell user what publish costs

## Q: How do I show names and avatars in long lists efficiently?

A: Cache them: the same primary names and avatars come up again and again across lists, so keep one cache for name lookups and one for avatars, and load avatars only for rows on screen. Torq does this with its primary names and profile caches.

Also asked as: cache primary names list · avatars many rows slow · prefetch avatars q-app · name lookups repeat · profile cache q-app

## Q: Which details matter when my Q-App shows user-written HTML?

A: Sanitise it with DOMPurify 3.4 or newer, since older versions have known bypasses. Build links on the DOM, never with a regex over sanitised HTML; one Q-App had a stored XSS hole from exactly that. Drop inline text colours, because white text pasted from dark pages is invisible in light themes.

Also asked as: user html q-app sanitize · dompurify version q-app · links in user content · inline colours user html · mail description html safe

## Q: What does qapp-core's GlobalProvider give my app?

A: Auth, lists, identifier hashing and caching, through hooks such as useGlobal, usePublish, useResources and useResourceStatus, plus ResourceListDisplay for lists and VideoPlayer and AudioPlayerControls for media. Torq is one of the apps built on it.

Also asked as: qapp-core GlobalProvider · qapp-core hooks · usePublish useResources · qapp-core features · qapp-core video player

## Q: Why must I keep my app's qapp-core publicSalt and app name?

A: qapp-core builds your identifiers from them, so changing either one makes the app stop finding the data it already published. Keep the existing publicSalt and app name in its config, even in a fork or redesign.

Also asked as: qapp-core publicSalt · app stops finding its data · identifier hashing salt · qapp-core app name config · change publicSalt qapp-core

## Q: Why keep my app's name and storage prefix in one place?

A: Put the app's name, the name used in copied qortal://APP links, the browser storage prefix, the settings identifier and the repository links in one module. Then a rename or a fork changes one file, and storage keys can't clash with another version of the app on the same node.

Also asked as: app constants one module · rename q-app later · storage prefix constant · qortal link app name constant · fork q-app name change

## Q: What does LINK_TO_QDN_RESOURCE do for my own app and for other apps?

A: It takes service, name, identifier and path, and without service it assumes WEBSITE. A link to another name asks Hub to open it in a new tab; if Hub doesn't confirm within 200 ms, or the link points to your own app, the page itself moves there. qortal:// links clicked in your HTML go the same way.

Also asked as: LINK_TO_QDN_RESOURCE behaviour · link to other app new tab · LINK_TO_QDN_RESOURCE default service · link inside my own app · qortal link click opens tab

## Q: Do the encrypt and decrypt actions ask the user?

A: No. ENCRYPT_DATA, DECRYPT_DATA, ENCRYPT_QORTAL_GROUP_DATA, DECRYPT_QORTAL_GROUP_DATA and the sharing-key pair run without an approval window. Decryption only works for data meant for the user's keys or groups. Say in your own screen what you decrypt and why; GO widgets can't use these actions at all.

Also asked as: DECRYPT_DATA approval popup · encrypt data without popup · decrypt silently q-app · ENCRYPT_DATA permission · group decrypt approval

## Q: What is the difference between ENCRYPT_DATA and ENCRYPT_QORTAL_GROUP_DATA?

A: ENCRYPT_DATA with publicKeys encrypts for that fixed list of people, and you. ENCRYPT_QORTAL_GROUP_DATA uses a group's own key, which the group's admins publish for its members: pass groupId (and isAdmins for the admins-only key), and members read it with DECRYPT_QORTAL_GROUP_DATA. It fails with No group key found when the admins haven't published one, and a public node may fail to deliver the key.

Also asked as: group key encryption q-app · ENCRYPT_QORTAL_GROUP_DATA groupId · encrypt for group members · no group key found error · isAdmins group encryption

## Q: What are ENCRYPT_DATA_WITH_SHARING_KEY and DECRYPT_DATA_WITH_SHARING_KEY?

A: The first encrypts data for the listed public keys and you, like ENCRYPT_DATA, but seals a sharing key inside, so readers get the key along with the data. Anyone who has that key can then open it with DECRYPT_DATA_WITH_SHARING_KEY, passing encryptedData and key, without a wallet. That is how a link can carry the key to a private image or file, so guard the key like the data itself.

Also asked as: ENCRYPT_DATA_WITH_SHARING_KEY · DECRYPT_DATA_WITH_SHARING_KEY · sharing key encryption q-app · decrypt with key no wallet · encrypted link key share

## Q: How do I play encrypted video from my app?

A: On the desktop Hub, call PLAY_ENCRYPTED_MEDIA with mediaId, key, iv, location (service, name, identifier) and optionally mimeType, for media published with streamed-v1 encryption, and use the streamUrl it returns as the player's source. It runs on Hub's local media server, so it isn't available in GO. It needs no approval and is cleaned up when the tab closes.

Also asked as: PLAY_ENCRYPTED_MEDIA request · encrypted video q-app · stream encrypted media hub · play private video app · streamUrl encrypted media

## Q: What is streamed-v1 encryption in a publish?

A: A way to let Hub encrypt a big file as it uploads: give the resource encryption with encryptionType streamed-v1 and your own iv (16 bytes) and key (32 bytes), both base64, and pass the data as file. You keep and share the key yourself, for example encrypted for the recipients. Later, SAVE_FILE by location with the same encryption, or PLAY_ENCRYPTED_MEDIA, decrypts it.

Also asked as: streamed-v1 encryption · encrypt big file while uploading · encryption iv key publish · aes ctr publish q-app · encrypted large file publish

## Q: Can my app create trade orders?

A: Yes. CREATE_TRADE_SELL_ORDER takes qortAmount, foreignBlockchain and foreignAmount; CREATE_TRADE_BUY_ORDER takes crosschainAtInfo (the offers to buy) and foreignBlockchain; CANCEL_TRADE_SELL_ORDER takes atAddress. Each shows the amounts and an estimated fee and needs the confirmation tick. Trading uses the foreign coin's private key, so the approval says where it goes: the user's own node, or the trade proxy on a public node.

Also asked as: CREATE_TRADE_SELL_ORDER fields · CREATE_TRADE_BUY_ORDER request · CANCEL_TRADE_SELL_ORDER atAddress · trade portal actions q-app · sell qort order from q-app code

## Q: What does DEPLOY_AT need?

A: name, description, tags, type, creationBytes (base58), amount and assetId. An AT is an automated transaction, Qortal's kind of smart contract; Q-Fund deploys one for each crowdfund. It's for advanced apps, the user is asked Would you like to deploy this AT?, and it costs a fee.

Also asked as: DEPLOY_AT fields · deploy automated transaction app · creationBytes base58 · smart contract qortal app · crowdfund at deploy

## Q: How can my app read its rating from the Q-Apps library?

A: The library keeps ratings in a poll on the blockchain named app-library-APP-rating-<app name> (WEBSITE instead of APP for a site), with the options 1 to 5. Read its votes with a relative fetch of /polls/votes/<that poll name>, encoding the name.

Also asked as: read app rating poll · app library rating poll name · my q-app rating votes · rating poll app-library · fetch app stars

## Q: Why does Copy link ignore my app's path?

A: Copy link, Share and Refresh use the path your app last reported with QDN_RESOURCE_DISPLAYED, which q-apps.js also sends on load and on navigation. Hub and GO ignore a path that would climb out of your app, for example one with ../ in it. Keep paths inside your app and encode each part.

Also asked as: copy link wrong path q-app · share link root only app · QDN_RESOURCE_DISPLAYED path ignored · refresh loses app page · copy link path climbs out

## Q: Can my Q-App use the node's API key?

A: No. Hub and GO keep the node's API key to themselves; even private app previews now load without it in their address, because the app could read it there. Don't build on protected node endpoints in your own fetch calls; for node admin tasks use ADMIN_ACTION, which asks the user.

Also asked as: q-app api key access · node api key in app · admin endpoints from q-app · x-api-key q-app fetch · protected node api app

## Q: What is UPDATE_SUBSCRIPTIONS?

A: Only the Subscriptions app may call it. It tells Hub to fetch the user's group memberships again, for example right after a subscriber has been accepted into a group; any other app gets an error saying so.

Also asked as: UPDATE_SUBSCRIPTIONS request · subscriptions app qortalRequest · refresh group memberships app · UPDATE_SUBSCRIPTIONS error · only subscriptions app may call

## Q: Which foreign coin server actions can a wallet app use?

A: GET_CROSSCHAIN_SERVER_INFO (servers, remainingServers and uselessServers for a coin), GET_SERVER_CONNECTION_HISTORY, SET_CURRENT_FOREIGN_SERVER, ADD_FOREIGN_SERVER and REMOVE_FOREIGN_SERVER, plus GET_FOREIGN_FEE and UPDATE_FOREIGN_FEE. The ones that change something ask the user first and don't work on a public node.

Also asked as: GET_CROSSCHAIN_SERVER_INFO · foreign server actions q-app · ADD_FOREIGN_SERVER request · UPDATE_FOREIGN_FEE request · electrum server from q-app code

## Q: Why does my app's ARRR request show a private key warning?

A: Every ARRR wallet read, whether address, balance, transactions or sync status, sends the ARRR seed to the node. So before the first one in a tab, Hub shows that warning with a tick box, and one consent covers that tab, app, account and node until the tab closes; the authenticate grant and the always boxes don't cover it. A public node refuses these requests.

Also asked as: ARRR private key warning · arrr wallet access app · GET_ARRR_SYNC_STATUS · arrr seed sent to node · arrr balance q-app

## Q: How can I automate testing my Q-App inside the desktop Hub?

A: Start a second, test copy of the desktop Hub with a remote debugging port and drive it through the Chrome DevTools Protocol: list the app frames, run read-only checks inside your app, take screenshots, and emulate phone sizes and touch. The port listens on 127.0.0.1 only, but while it's open other programs on that computer can control that Hub, so close it when you're done.

Also asked as: automate hub testing · chrome devtools protocol hub · remote debugging port hub · drive hub from script · test q-app with cdp

## Q: Which app does GO open when a user taps my notification?

A: Your app, the one that added the rule: GO opens it at the path in the rule's link and shows your app's icon, or the post publisher's avatar, even when the rule's link or image names another app. So point notification links into your own app. The rule itself stays stored as you sent it.

Also asked as: notification opens which app · notification link other app · notification icon q-app go · notification owner app · tap q-app notification go

## Q: What should my Q-App's settings page contain?

A: Make it a full page reached from your navigation, not a small dialog. A good order is Account (the active name, with a switcher if you support several), Appearance (theme and display options), your app's own options, optional Sync of settings to QDN under the user's name, and About with the version and a changelog. Torq's Settings page is laid out this way.

Also asked as: q-app settings page layout · settings sections q-app · app settings design hub · about section version app · settings sync to qdn

## Q: What accessibility basics should a Q-App follow?

A: Give every icon button an aria-label, keep keyboard focus visible, and keep text contrast at least 4.5 to 1 in light and dark. Keep motion short, about 150 to 200 ms, and honour prefers-reduced-motion. Write short, plain text and keep every string translatable.

Also asked as: q-app accessibility · aria label icon buttons · contrast q-app themes · prefers-reduced-motion q-app code · focus visible app

## Q: Why doesn't my new widget show in GO's Add a widget list yet?

A: GO keeps the widget list for about 10 minutes per node, and the user's node must also have your publish. Widgets found only by their tag show up more slowly, since GO reads every APP's metadata for tags; an identifier starting with go-widget is found faster.

Also asked as: new widget not in list · widget list cache go · published widget missing picker · widget appears after minutes · go widget list refresh

## Q: Which browser engine runs my Q-App in Hub and GO?

A: Chromium in both. The desktop Hub renders apps with the Chromium inside its Electron shell, and GO on Android uses Android System WebView, which the Play Store updates separately from the system. Android 8 and 9 phones stop at Chromium 138, so check newer browser features against that if you support those phones.

Also asked as: q-app browser engine hub · chromium version go webview · android system webview q-app · browser features q-app support · electron chromium hub apps

## Q: Do Hub's own React and MUI versions affect my Q-App?

A: No. Each Q-App ships its own libraries inside its zip and runs in its own frame, so you can use the React, MUI or other versions you like, as long as the browser engine supports them.

Also asked as: hub react version q-app · mui version hub app · q-app library versions · react 19 in q-app · own react inside zip

## Q: Will GO's sideways section swipe take swipes from my Q-App?

A: No, in a normal Q-App tab your page keeps its own swipes. GO switches sections from inside an app only when the user swipes along the round buttons at the bottom. The exception is the widgets screen, where sideways swipes belong to GO.

Also asked as: go swipe steals app swipes · carousel in q-app go · section swipe q-app tab · horizontal swipe in my app go · go swipe bottom bar app

## Q: What is DECRYPT_AESGCM?

A: It decrypts AES-GCM data another account encrypted for the user. Pass encryptedData and iv, both base64 with a 12-byte iv, and senderPublicKey in base58; Hub derives the key from the user's private key and the sender's public key and returns the plain data as base64. Wrong data or keys fail with Failed to decrypt the message.

Also asked as: DECRYPT_AESGCM · aes gcm decrypt q-app · decrypt message sender public key · senderPublicKey iv decrypt · aes-gcm qortalRequest

## Q: How should my Q-App lay out in a wide Hub window?

A: From about 900 px wide: a left navigation rail with icons and labels, the main column centred at a comfortable width (about 600 to 760 px for feeds and lists, wider for grids), and an optional right rail for context such as filters. Use sticky headers with a thin bottom border, and switch to your phone layout below 600 px, since Hub also runs apps in narrow panes.

Also asked as: q-app desktop layout · wide window layout app · left rail navigation q-app · main column width app · desktop hub app design

## Q: How should my Q-App show images and video on phones?

A: Fit images and video to the screen width, let video go full screen, and load thumbnails rather than the originals in lists and on phones. Keep animations short and cheap, since many users run mid-range Android phones.

Also asked as: q-app images phone · let video go full screen in my app · thumbnails on phones app · media fit screen width · mobile media q-app

## Q: Can an AI coding agent build a GO widget for my app?

A: Yes. Give the agent docs/go/go-widgets.md from the Qortal Hub repository and your app's source; the guide has a ready prompt in section 3.5. It asks for a separate widget drawn from goWidget=1 on the first frame, transparent, following theme, language and visibility, fitting 79 by 92 to 351 by 716 px, using only allowed requests, opening the full app for every action, and passing the guide's checklist.

Also asked as: ai agent build widget · convert app to widget ai · widget prompt for agent · go-widgets.md agent · llm build go widget

## Q: How can my Q-App earn QORT?

A: Through payments the user approves: SEND_COIN for tips or purchases after a clear button press, an appFee on publishes made in your app, or MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA for orders. Q-Tube's super likes, paid in QORT, are one example. Payments can't be taken back, so always say what a payment is for.

Also asked as: q-app monetize qort · earn from my q-app · tips in q-app · charge for app features · paid features qortal app

## Q: What can users without a registered name do in my Q-App?

A: They can sign in with GET_USER_ACCOUNT, read everything public, send QORT with SEND_COIN and decrypt data meant for them. They can't publish to QDN (Hub says User has no Qortal name) or rate apps in the library, and chat messages need at least 4 QORT either way. Let them read first and explain what a name adds.

Also asked as: users without name q-app · no registered name app features · app for users with no name · q-app features needing a name · q-app without qortal name

## Q: Can my Q-App do anything while it's closed?

A: No. Your code runs only while the app is open in a tab. To tell users about new content while it's closed, add notification rules with NOTIFICATION_ADD: Hub and GO watch for matching QDN publishes and notify the user, and the notification opens your app.

Also asked as: q-app background task · run code when app closed · q-app alerts while closed · background sync q-app · app closed new content notify

## Q: When should my app publish a file instead of base64?

A: Use data64 (or base64) for small data such as JSON: it goes to the node in one request. Pass a File or Blob as file for anything bigger: Hub checks the node's free space, sends it in 5 MB chunks with retries and reports progress with PUBLISH_STATUS, and your page never has to build a huge base64 string.

Also asked as: file or base64 publish · data64 vs file publish · publish blob qortalRequest · large file publish base64 · base64 publish one request
