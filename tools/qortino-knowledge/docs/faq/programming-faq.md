# programming — golden FAQ

Curated offline Q&A for Qortino (186 entries). Prefer these answers when relevant.

## Q: What are QDN coordinates?

A: Every QDN object is addressed by name (publisher's registered name controlling update rights), service (IMAGE, JSON, APP, WEBSITE, etc.), and optional identifier (distinguishes multiple resources per name+service). Omit identifier or use "default" for the main website/app for a name.

Also asked as: qdn address · name service identifier · how to address a qdn resource · resource coordinates

## Q: Do I need a registered name to publish from a Q-App?

A: Yes. Publishing from a Q-App requires the user to own a registered name; name ownership gates update rights for that name's resources. Call GET_USER_ACCOUNT then GET_ACCOUNT_NAMES, and if there is no name, explain that publish cannot proceed until they register one.

Also asked as: publish without name · registered name required · name required to publish

## Q: How do I detect if qortalRequest is available?

A: Resolve the bridge with window.qortalRequest ?? window.parent?.qortalRequest (and top if nested). If typeof req !== "function", the page is not inside Hub—show preview mode and refuse wallet/payment fakes. Example: async function qr(p){ const r=window.qortalRequest??window.parent?.qortalRequest; if(typeof r!=="function") throw new Error("Open inside Qortal Hub"); return r(p); }

Also asked as: feature detect qortalRequest · check if inside hub · preview mode detection

## Q: When should I use qortalRequest vs fetch?

A: Use qortalRequest for wallet identity, signing, publish, encrypt, payments, and anything personalized. Use relative fetch("/names/foo") inside Hub for anonymous public Core REST reads. fetch cannot see the logged-in wallet; never hardcode the local node address (127.0.0.1:12391) in shipped apps.

Also asked as: fetch vs qortalRequest · relative fetch · when to use REST in q-app

## Q: What is the authority order for Q-App API docs?

A: When sources conflict: (1) the user's running Qortal Core + Hub version, (2) Q-Apps.md in Core, (3) qortal.dev/docs/q-apps, (4) community guides for patterns only. Do not invent parameters; verify action names in qortal.dev or Core q-apps.js.

Also asked as: which docs are authoritative · verify action names · api source of truth

## Q: What are typical Q-App constraints?

A: No private backend holding secrets; identity is wallet address plus optional name; ship fonts/JS/assets in the zip (offline and CSP-safe); no required CDN. Prefer single-file HTML for small tools and Vite with a flat zip for production SPAs.

Also asked as: q-app limitations · q-app constraints · can q-apps have a backend

## Q: How should I package a Q-App zip?

A: Zip the contents of dist/, not a wrapper folder: index.html must sit at the zip root, with assets/ and manifest.json beside it. Use relative paths (./assets/...), Vite base: "./", case-sensitive [a-z0-9._-] names, and ship fonts/JS in-bundle with no required CDN. Rebuild and re-zip after any HTML or bundler config change.

Also asked as: zip layout · how to zip q-app · flat zip · dist zip structure

## Q: What goes in manifest.json for a Q-App?

A: Include at least "main": "index.html" plus title, version, and category metadata. The manifest sits at the zip root next to index.html so Hub knows the entry point. Keep paths relative and consistent with the built assets.

Also asked as: manifest.json q-app · q-app manifest fields

## Q: How do I publish a new Q-App?

A: Build (npm run build), create a flat zip from dist/, load it in Hub and Preview, then publish under an owned name with service APP. Open via qortal://APP/<Name>. Multi-file APP/WEBSITE publish from inside a Q-App is limited or unavailable in many Hub builds—use Hub UI and verify your version.

Also asked as: publish q-app steps · how to deploy q-app · publish APP service

## Q: How do I publish a WEBSITE resource in code?

A: Build a static site with relative paths, then publish via Hub under an owned registered name with service WEBSITE. Link with qortal://WEBSITE/<Name>/... . If you need SPA routing and heavy qortalRequest throughout, prefer APP instead of WEBSITE.

Also asked as: deploy website service · publish WEBSITE service programmatically · WEBSITE service publish API

## Q: Why is my Q-App a grey screen or stuck on Loading?

A: Usually assets/index-*.js 404s: Hub opened without trailing slash so ./assets resolves wrong, or you zipped a dist/ wrapper, used absolute /assets/ paths, or shipped a stale hashed build. Fix with flat zip, base: "./", relative ./assets/, full rebuild, and trailing slash or careful <base href>. Some builds also fail on crossorigin script tags—remove if needed.

Also asked as: grey screen q-app · eternal loading · assets 404 · blank q-app

## Q: What Vite base should I use for Q-Apps?

A: Set Vite base: "./" so built asset URLs are relative. Absolute /assets/... paths break under Hub render URLs like /render/APP/YourName without a trailing slash. After changing base, rebuild and create a fresh flat zip.

Also asked as: vite base q-app · relative base vite

## Q: What is the publish workflow after building?

A: 1) npm run build → dist/ 2) (cd dist && zip -r ../MyApp.zip .) 3) Hub → load zip → Preview 4) Publish service APP (or WEBSITE via Hub) 5) Open qortal://APP/<Name> or qortal://WEBSITE/<Name>/. Always Preview before QDN publish.

Also asked as: build and publish workflow · preview before publish

## Q: What is the JSON service used for?

A: JSON holds small structured metadata on QDN, typically capped around 25 KB. Publish with PUBLISH_QDN_RESOURCE using UTF-8-safe data64. For larger structured data use DOCUMENT or FILE. Always validate schema on fetch—never trust identifier alone.

Also asked as: JSON service qdn · 25kb json limit · when to use JSON service

## Q: What is the DOCUMENT service?

A: DOCUMENT stores larger text/JSON documents with a much higher size allowance than JSON (request caps can reach hundreds of MB depending on Core). Use DOCUMENT when metadata outgrows the ~25 KB JSON limit. DOCUMENT_PRIVATE (801) is the encrypted variant for recipients.

Also asked as: DOCUMENT service · large json document qdn

## Q: What are IMAGE and THUMBNAIL services?

A: IMAGE and THUMBNAIL store media on QDN (typical documented limits ~10 MB for IMAGE and ~500 KB for THUMBNAIL). Fetch via FETCH_QDN_RESOURCE or GET_QDN_RESOURCE_URL for <img src>. Shared convention: THUMBNAIL + identifier qortal_avatar for user avatars.

Also asked as: IMAGE service · THUMBNAIL service · avatar thumbnail

## Q: What are FILE, VIDEO, and AUDIO services?

A: FILE, VIDEO, and AUDIO hold binary payloads on QDN for downloads and media apps (e.g. Q-Share/Q-Tube patterns). Publish as single-file/data64 resources; fetch with FETCH_QDN_RESOURCE or resource URLs. Prefer SAVE_FILE on mobile instead of relying on blob anchor downloads.

Also asked as: FILE service · VIDEO service · AUDIO service · binary qdn services

## Q: When is a resource single-file vs multi-file?

A: JSON, IMAGE, FILE, VIDEO, AUDIO and similar services carry one payload (data64 or file). WEBSITE, APP, and GIF_REPOSITORY are multi-file; FETCH_QDN_RESOURCE requires filepath to load a specific file. Choose single-file services for records; use APP/WEBSITE for UI bundles.

Also asked as: single-file vs multi-file · filepath required · multi-file services

## Q: How should I name QDN identifiers?

A: Prefix identifiers with your app slug, e.g. myapp_config_v1 or myapp_post_<id>. QDN is permissionless—validate payload schema and never trust identifier alone. Use versioned schema strings in JSON (myapp-index-v1) and document the scheme in your README.

Also asked as: identifier naming · appslug prefix · identifier convention

## Q: What is the default identifier?

A: For a name's main website or app, omit identifier or use "default". In qortal:// paths you can include default when you need explicit no-identifier semantics. Shared cross-app locations use well-known identifiers like qortal_avatar.

Also asked as: default identifier · omit identifier

## Q: What is the qortal_avatar convention?

A: User avatars commonly use service THUMBNAIL with identifier qortal_avatar under the user's registered name. Fetch with FETCH_QDN_RESOURCE or GET_QDN_RESOURCE_URL for display. Always handle missing avatars gracefully.

Also asked as: avatar convention for apps · fetch qortal_avatar in code

## Q: How do I get names for a wallet address?

A: After GET_USER_ACCOUNT, call GET_ACCOUNT_NAMES with the address (and limit/offset). Use the primary name for publishing. Example: await qr({ action: "GET_ACCOUNT_NAMES", address: acc.address, limit: 10, offset: 0 }).

Also asked as: GET_ACCOUNT_NAMES · list names for address · primary name

## Q: How do latest publishes work for the same resource?

A: For a given name + service + identifier triple, the latest publish wins. Updates overwrite prior payload for that coordinate. Design identifiers so each logical object has a stable key, or version identifiers when you need immutable history.

Also asked as: latest publish wins · update qdn resource · overwrite resource

## Q: How do I search resources by identifier prefix?

A: Use SEARCH_QDN_RESOURCES with prefix: true and a minimal payload (service + identifier prefix). Keep optional fields stripped if search returns empty mysteriously. Normalize the response to an array—cores may wrap results in resources/results/entries/hits/data.

Also asked as: prefix search qdn · SEARCH_QDN_RESOURCES prefix · identifier prefix search

## Q: How do I authenticate the user in a Q-App?

A: Call GET_USER_ACCOUNT from an explicit Connect/Authenticate button after a user gesture—never on first paint. It returns address and publicKey and shows an approval popup. Opening built index.html in a normal browser cannot complete wallet auth.

Also asked as: GET_USER_ACCOUNT · connect wallet q-app · authenticate q-app · login q-app

## Q: What if my Q-App runs in a nested iframe and auth fails?

A: Resolve qortalRequest from window → parent → top. Parent pages may need a message relay that forwards qortalRequest to Hub. If parent === top and only a stub exists, or inner auth still fails, open the target in a new Hub tab.

Also asked as: iframe qortalRequest · nested iframe auth · message relay hub

## Q: Which qortalRequest actions require user approval?

A: Approval-gated examples include GET_USER_ACCOUNT, wallet info/balance variants, PUBLISH_QDN_RESOURCE, PUBLISH_MULTIPLE_QDN_RESOURCES, SEND_COIN, JOIN_GROUP, DEPLOY_AT, CREATE_POLL/VOTE_ON_POLL, SAVE_FILE, list item mutations, and friends/profile writes. Batch reads; keep approval calls behind clear user actions.

Also asked as: approval popup actions · which actions need consent

## Q: Which qortalRequest actions are read-only without approval?

A: Examples: GET_ACCOUNT_DATA, GET_ACCOUNT_NAMES, GET_NAME_DATA, GET_BALANCE, FETCH_QDN_RESOURCE, LIST_QDN_RESOURCES, SEARCH_QDN_RESOURCES, GET_QDN_RESOURCE_STATUS/METADATA/PROPERTIES/URL, SEARCH_NAMES, SEARCH_TRANSACTIONS, FETCH_BLOCK, group/AT list reads, GET_PRICE. Prefer these for background refresh.

Also asked as: read-only qortalRequest · no approval actions

## Q: How do I implement preview mode?

A: If qortalRequest is missing on window and parent, show "Preview mode" and allow mock reads only. Never fake successful payments or publishes. Prompt the user to open the app inside Qortal Hub for live APIs.

Also asked as: preview mode q-app · mock without hub

## Q: Can fetch tell me who is logged in?

A: No. Relative fetch hits the node REST API anonymously and cannot identify the logged-in wallet. Use qortalRequest GET_USER_ACCOUNT (and related wallet actions) for anything personalized or signing-related.

Also asked as: fetch logged in user · anonymous fetch limitation

## Q: How do I fetch a QDN resource?

A: Use FETCH_QDN_RESOURCE with name, service, and optional identifier; add filepath for multi-file APP/WEBSITE; set encoding: "base64" when you need binary-safe data. Example: await qr({ action: "FETCH_QDN_RESOURCE", name, service: "JSON", identifier: id }).

Also asked as: FETCH_QDN_RESOURCE · load qdn resource · fetch resource example · download from QDN · get a qdn resource

## Q: How do I publish a JSON resource?

A: Own a name, UTF-8-encode JSON to data64 (never raw btoa on Unicode), then PUBLISH_QDN_RESOURCE. Example: await qr({ action: "PUBLISH_QDN_RESOURCE", name, service: "JSON", identifier: id, data64: b64Utf8(obj) }). Await user approval and handle cancel vs errors.

Also asked as: PUBLISH_QDN_RESOURCE · publish json example · publish data64

## Q: How do I safely base64-encode UTF-8 JSON for publish?

A: Never btoa(JSON.stringify(obj)) on Unicode. Use TextEncoder: const bytes=new TextEncoder().encode(JSON.stringify(obj)); let bin=""; for(const b of bytes) bin+=String.fromCharCode(b); return btoa(bin);. Decode symmetrically when reading base64 text.

Also asked as: b64Utf8 · utf-8 base64 · btoa unicode bug

## Q: How do I search QDN resources?

A: Call SEARCH_QDN_RESOURCES with a minimal payload (service, optional name/identifier, prefix: true for prefixes). Normalize array-or-wrapper responses. If results are mysteriously empty, strip unknown optional keys—extra fields can yield [].

Also asked as: SEARCH_QDN_RESOURCES · normalize search results

## Q: How do I list QDN resources for a name?

A: LIST_QDN_RESOURCES lists by name/service with richer filters than search in some builds. Example: await qr({ action: "LIST_QDN_RESOURCES", name: "Qortino", service: "FILE", limit: 20 }). Prefer listing when you know the publisher name.

Also asked as: LIST_QDN_RESOURCES · list resources by name

## Q: What is GET_QDN_RESOURCE_URL for?

A: GET_QDN_RESOURCE_URL returns a URL suitable for <img src> or fetch (often /arbitrary/...). Use it for media display without manually building paths. On mobile, append ?attachment=true when you need native download handling.

Also asked as: GET_QDN_RESOURCE_URL · arbitrary url for img

## Q: What is GET_QDN_RESOURCE_STATUS?

A: GET_QDN_RESOURCE_STATUS reports build/load status such as READY and percent loaded. Probe status without downloading the full payload—useful before playing VIDEO/AUDIO or large FILE resources.

Also asked as: GET_QDN_RESOURCE_STATUS · resource ready status · percent loaded

## Q: What is GET_QDN_RESOURCE_METADATA?

A: GET_QDN_RESOURCE_METADATA returns title, tags, category and similar metadata without fetching the full payload. Use it for cards, search UIs, and galleries. Pair with PROPERTIES for filename/mimeType/size.

Also asked as: GET_QDN_RESOURCE_METADATA · resource metadata · title tags category

## Q: What is GET_QDN_RESOURCE_PROPERTIES?

A: GET_QDN_RESOURCE_PROPERTIES returns filename, mimeType, and size for a resource. Use before download/preview to show size and choose renderers. Validate mime types from untrusted publishers.

Also asked as: GET_QDN_RESOURCE_PROPERTIES · mimeType size filename

## Q: What is PUBLISH_MULTIPLE_QDN_RESOURCES?

A: PUBLISH_MULTIPLE_QDN_RESOURCES batch-publishes several resources to reduce approval rounds. Feature-detect availability for the user's Hub version. Prefer batches for related metadata+thumbnail publishes behind one clear user action.

Also asked as: PUBLISH_MULTIPLE_QDN_RESOURCES · batch publish

## Q: How do I normalize SEARCH_QDN_RESOURCES results?

A: Cores may return a bare array or an object with resources, results, entries, hits, or data arrays. Coerce: const arr = Array.isArray(r) ? r : (r?.resources ?? r?.results ?? r?.entries ?? r?.hits ?? r?.data ?? []);. Always Array.isArray-check before map.

Also asked as: normalize search array · search results wrapper

## Q: How do I open another QDN resource from my app?

A: Prefer LINK_TO_QDN_RESOURCE or OPEN_NEW_TAB with a qortal:// URL. For Hub tab switches, postMessage SET_TAB with { action: 'SET_TAB', requestedHandler: 'UI', payload: { service, name, identifier?, path? } }. Avoid raw window.open to localhost.

Also asked as: LINK_TO_QDN_RESOURCE · SET_TAB · open qdn resource

## Q: What is QDN_RESOURCE_DISPLAYED?

A: Call QDN_RESOURCE_DISPLAYED so Hub's address bar/copy-link matches the sub-path the user sees: { action, service, name, path? }. Useful for multi-page WEBSITE SPAs. Optionally keep <link rel="canonical"> with matching qortal://WEBSITE/<name>/<slug>.

Also asked as: QDN_RESOURCE_DISPLAYED · copy link hub · address bar sync

## Q: How should SPA routing work inside Hub?

A: Published apps often run under /render/WEBSITE/<name>/ or /render/APP/<name>/. Use pathname segments with history.pushState/popstate for in-app navigation without leaving Hub. Preserve intentional hash fragments when cleaning pathnames with replaceState.

Also asked as: spa routing hub · pushState q-app · render path

## Q: How do I encrypt data with qortalRequest?

A: Use ENCRYPT_DATA with file or base64 payload; pass optional publicKeys for group encryption. Store ciphertext under separate identifier namespaces from public metadata. Explain the encrypt action to the user before calling.

Also asked as: ENCRYPT_DATA · encrypt qortal · group publicKeys encrypt

## Q: How do I decrypt data with qortalRequest?

A: Use DECRYPT_DATA with ciphertext base64 and the counterparty publicKey. Group variants ENCRYPT_QORTAL_GROUP_DATA / DECRYPT_QORTAL_GROUP_DATA handle group-scoped encryption. Handle user cancel and wrong-key errors distinctly.

Also asked as: DECRYPT_DATA · decrypt qortal · group decrypt

## Q: Should encrypted and public data share identifiers?

A: No. Use separate identifier namespaces for encrypted blobs versus public JSON indexes. That prevents accidental public fetch of private coordinates and clarifies schema. Still validate decrypted payloads before use.

Also asked as: encrypted identifier namespace · private vs public identifiers

## Q: How do QORT amounts work in APIs?

A: SEND_COIN takes the amount as plain QORT, for example 1.5, not multiplied by 1e8; Hub or GO shows it in the approval window. QORT has up to 8 decimal places. For other APIs, check how each response field is written before converting it.

Also asked as: 1e8 qort · amount scale · GET_PRICE units

## Q: How do I send coins from a Q-App?

A: Use SEND_COIN / SEND_PAYMENT / TRANSFER_ASSET only after explaining amounts and recipients; these require user approval. Confirm parameters against the target Hub version. Treat payment success and any follow-up notification as separate steps—payment can succeed while notify fails.

Also asked as: SEND_COIN · SEND_PAYMENT · transfer asset q-app

## Q: How do I create a poll?

A: CREATE_POLL requires pollOptions as an array (e.g. objects with optionName), not a string, and pollName must be unique. VOTE_ON_POLL casts a vote with user approval. Validate options client-side before calling.

Also asked as: CREATE_POLL · VOTE_ON_POLL · pollOptions array

## Q: How do I save files on Qortal Go / mobile?

A: Mobile WebViews often ignore anchor/blob downloads. Use SAVE_FILE with blob + filename, or /arbitrary/…?attachment=true on builds with a native download listener. Detect mobile via user-agent when choosing download strategy.

Also asked as: SAVE_FILE · mobile download · attachment=true

## Q: How should I handle data larger than the JSON 25 KB limit?

A: Do not stuff oversized objects into JSON. Split: small JSON metadata (index, titles, pointers) plus FILE/DOCUMENT/IMAGE/VIDEO payloads under related identifiers. For very large content, chunk into multiple FILE parts with a versioned index JSON describing order and hashes.

Also asked as: chunking qdn · json too large · split metadata and payload

## Q: What is a good chunking pattern for large files?

A: Publish a JSON index (myapp_file_<id>_meta_v1) with part count, sizes, and SHA-256 hashes, then publish parts as FILE identifiers myapp_file_<id>_part_0001…. Fetch status before each part; reassemble client-side; verify hashes. Bound concurrency—avoid Promise.all on hundreds of fetches.

Also asked as: chunked file publish · multipart qdn · file parts pattern

## Q: Why avoid Promise.all on hundreds of QDN fetches?

A: Unbounded concurrency overwhelms Core/Hub, triggers timeouts, and freezes UI. Use a small worker pool (e.g. 3–6) with retries and backoff. Prefer GET_QDN_RESOURCE_STATUS before heavy FETCH on large media.

Also asked as: bounded concurrency · promise.all pitfall · fetch pool

## Q: How should I handle qortalRequest timeouts?

A: Timeouts are per-action in Core q-apps.js. Fix payload size and batching rather than wrapping everything in huge timeouts. Prefer Core-managed timeouts; qortalRequestWithTimeout exists but letting Core manage limits is more futureproof. Use longer helpers only for publish/payment UX.

Also asked as: qortalRequest timeout · qortalRequestWithTimeout

## Q: How should I test a new Q-App?

A: Test root URL, deep links, no-name wallet (publish gated), Connect gesture, publish then fetch after propagation delay, search normalization, and grey-screen asset loads. Use Hub Preview before QDN publish; when Core supports it, local preview is the node's /render/APP/<Name>?preview=true path on port 12391.

Also asked as: test q-app · q-app testing checklist · preview=true

## Q: What should I test for packaging?

A: After zip: open in Hub Preview, confirm Network shows assets/index-*.js as 200, navigate SPA routes, hard-refresh, and re-open via qortal://APP/<Name>. Catch absolute /assets/ paths and stale hashed filenames before publishing.

Also asked as: test zip packaging · network tab assets

## Q: What security rules apply to Q-Apps?

A: Never collect seed phrases or private keys. Treat all QDN JSON as untrusted—validate schema and sizes. Explain publishes, payments, and decrypt before calling qortalRequest. Sanitize any HTML from QDN to prevent XSS. Rate-limit retries; distinguish user cancel vs technical errors.

Also asked as: q-app security · never ask for seed · xss qdn html

## Q: Why sanitize HTML from QDN?

A: Anyone can publish under their own name; fetched HTML/Markdown can contain scripts. Escape or sanitize before innerHTML. Prefer text content or a vetted sanitizer. Never eval remote JS from QDN.

Also asked as: sanitize qdn html · xss from qdn

## Q: How do relative fetch calls work inside Hub?

A: Inside Hub, fetch("/names/foo") hits the user's node API—good for public reads (blocks, names, arbitrary endpoints). Do not hardcode 127.0.0.1:12391. For personalized or signing flows use qortalRequest instead.

Also asked as: relative fetch hub · node api from q-app

## Q: Where are official Q-App docs?

A: Authoritative qortalRequest reference: the Q-Apps docs on qortal.dev. Protocol: Q-Apps.md in the Qortal/qortal repository. Core implementation and timeouts: q-apps.js in Qortal/qortal. REST: api.qortal.org. Community code: gitea.qortal.link and the Qortal organisation on GitHub.

Also asked as: qortal.dev q-apps · Q-Apps.md · official docs

## Q: How do I publish a thumbnail with metadata?

A: Publish IMAGE or THUMBNAIL for the media and a small JSON record with title, tags, category, and pointer identifiers. Or set metadata fields supported by your publish action and read them later via GET_QDN_RESOURCE_METADATA. Keep JSON ≤25 KB; put heavy media in IMAGE/VIDEO/FILE.

Also asked as: publish thumbnail metadata · metadata with image

## Q: How do I show a resource thumbnail in the UI?

A: Resolve a URL with GET_QDN_RESOURCE_URL for the THUMBNAIL/IMAGE coordinate, or fetch base64 and build a blob URL. Check GET_QDN_RESOURCE_STATUS before display for large media. Provide a placeholder when missing.

Also asked as: display thumbnail · img src qdn

## Q: How do I read title and tags without downloading the file?

A: Call GET_QDN_RESOURCE_METADATA for title, tags, and category without the full payload. Use GET_QDN_RESOURCE_PROPERTIES for filename, mimeType, and size. Ideal for galleries and search result rows.

Also asked as: read metadata only · tags without fetch

## Q: What is the recommended new Q-App workflow?

A: Choose single HTML vs Vite/React; scaffold index.html + manifest with relative paths; centralize qortalRequest; Connect → GET_USER_ACCOUNT → GET_ACCOUNT_NAMES → gate publish; design identifier/schema; read with FETCH/SEARCH (+normalize); write with UTF-8 data64; test edge cases; flat zip → Hub Preview → publish APP.

Also asked as: new q-app checklist · scaffold q-app

## Q: How should I structure a central bridge module?

A: Export one qr(payload) that resolves window/parent/top qortalRequest, wraps try/catch, and optionally short vs long timeout helpers for publish/payments. All features call this module so iframe/mobile differences stay in one place.

Also asked as: bridge wrapper pattern · central qortalRequest module

## Q: What is a minimal Connect then publish pattern?

A: On Connect: account = GET_USER_ACCOUNT; names = GET_ACCOUNT_NAMES; pick primary name. On publish: PUBLISH_QDN_RESOURCE with owned name, service, identifier, data64. Then FETCH_QDN_RESOURCE to verify. Disable publish when no name exists.

Also asked as: connect then publish · minimal publish pattern

## Q: How do I wait for publish propagation?

A: After PUBLISH_QDN_RESOURCE, fetches/search may lag briefly. Retry FETCH or STATUS with backoff, or poll GET_QDN_RESOURCE_STATUS until READY. Do not assume instant global visibility; design UI for "publishing…" states.

Also asked as: publish propagation delay · wait until READY

## Q: What causes SEARCH_QDN_RESOURCES to return empty unexpectedly?

A: Unknown or extra JSON keys on the search payload can yield empty results on some cores. Use a minimal payload, enable prefix: true only when intended, and normalize wrapped responses. Also confirm service/name/identifier spelling and case.

Also asked as: empty search results · extra fields search

## Q: What is the SPA asset trap under /render/APP?

A: Hub may open /render/APP/YourName without a trailing slash, so ./assets/index.js resolves against /render/APP/ and 404s. Fix with trailing slash, careful <base href>, or paths matching how Hub serves the resource. Rebuild after HTML changes.

Also asked as: trailing slash app · render APP assets 404

## Q: Why shouldn't Q-Apps depend on external CDNs?

A: Hub CSP, offline use, and gateway contexts often block or break CDN scripts/fonts. Bundle JS/CSS/fonts inside the zip with relative paths so the app works offline and consistently across desktop and mobile Hub.

Also asked as: no CDN q-app · bundle fonts js

## Q: What does a minimal qortalRequest helper look like?

A: async function qr(payload){ const req=window.qortalRequest??window.parent?.qortalRequest; if(typeof req!=="function") throw new Error("Open inside Qortal Hub"); return req(payload); } Always try/catch at call sites. Extend resolution to top for nested iframes.

Also asked as: qr helper · minimal bridge helper

## Q: How do I publish an IMAGE?

A: Use PUBLISH_QDN_RESOURCE with service IMAGE, owned name, identifier, and file or data64 payload within size limits (~10 MB typical). Pair with JSON metadata for title/alt. Fetch via GET_QDN_RESOURCE_URL for display.

Also asked as: publish image qdn · IMAGE publish

## Q: How do I publish a VIDEO or AUDIO resource?

A: Publish service VIDEO or AUDIO with file/data64 under a namespaced identifier, keep a small JSON index for title/thumbnail pointers, and probe GET_QDN_RESOURCE_STATUS before playback. Use SAVE_FILE or attachment URLs for downloads on mobile.

Also asked as: publish video · publish audio · media qdn publish

## Q: How do I publish a FILE for download?

A: PUBLISH_QDN_RESOURCE with service FILE, owned name, identifier (e.g. myapp_file_<id>), and payload. Expose downloads via GET_QDN_RESOURCE_URL; on mobile prefer SAVE_FILE. Store filename/mime in metadata or rely on PROPERTIES.

Also asked as: publish file qdn · FILE download pattern

## Q: How do I avoid approval-popup fatigue?

A: Batch read-only calls freely; group approval-needing calls behind one explicit user action (Connect, Publish, Pay). Prefer PUBLISH_MULTIPLE_QDN_RESOURCES when available. Never spam GET_USER_ACCOUNT on timers or route changes.

Also asked as: popup fatigue · batch approvals

## Q: What happens if I open index.html in Chrome outside Hub?

A: qortalRequest is missing, so wallet auth, publish, and encrypt cannot work. Show preview mode with mock reads only. Instruct users to open via Hub/Qortal Go. Do not silently fake payments.

Also asked as: open outside hub · browser without qortalRequest

## Q: How do I link to an APP?

A: Use qortal://APP/MyQApp or OPEN_NEW_TAB / LINK_TO_QDN_RESOURCE with service APP and name. For in-app routes, combine Hub render paths with pushState and optional hash fragments. Prefer Hub navigation APIs over external browsers.

Also asked as: link to app · qortal://APP

## Q: What UTF-8 publish bug should I always avoid?

A: Raw btoa(JSON.stringify(obj)) throws or corrupts on Unicode characters. Always TextEncoder → binary string → btoa for data64 JSON publishes. This is a top production pitfall for international text.

Also asked as: unicode btoa pitfall · utf8 publish bug

## Q: How do I validate fetched QDN JSON?

A: Check typeof/object shape, required fields, schema version string, and size bounds before use. Reject unknown versions safely. Remember permissionless names: malicious publishers can reuse your identifier patterns under their own name.

Also asked as: validate qdn json · schema version validation

## Q: What is the difference between LIST_QDN_RESOURCES and SEARCH_QDN_RESOURCES?

A: LIST is suited to enumerating resources for a known name/service with richer filters in some builds. SEARCH discovers across the network with prefix options but needs minimal payloads and result normalization. Use LIST when you know the publisher; SEARCH for discovery.

Also asked as: list vs search qdn · LIST_QDN_RESOURCES vs SEARCH

## Q: What should I put in a JSON index resource?

A: Keep a versioned schema (v or schema field), lists of child identifiers, titles, timestamps, and content hashes—stay under ~25 KB. Point to FILE/IMAGE/VIDEO for heavy bytes. Publish index updates when parts change.

Also asked as: json index pattern · discovery index json

## Q: How do private services relate to encryption actions?

A: Private services (*_PRIVATE, 801, etc.) store encrypted payloads for recipients. Use ENCRYPT_DATA / DECRYPT_DATA or group encrypt/decrypt variants with the right public keys. Keep UX copy clear that decryption requires wallet approval.

Also asked as: private services encryption · *_PRIVATE services

## Q: Can I hardcode the Core API port 12391?

A: No—not in shipped apps. Use relative fetch so Hub routes to the user's node, and qortalRequest for wallet flows. Hardcoded localhost breaks remote gateways, mobile, and non-default ports.

Also asked as: hardcoded 12391 · localhost api antipattern

## Q: What parameters does PUBLISH_QDN_RESOURCE need?

A: At minimum: action PUBLISH_QDN_RESOURCE, owned name, service, and payload via data64 or file; identifier recommended for non-default resources. User approval required. Confirm optional metadata fields against qortal.dev for your Hub version—do not invent keys.

Also asked as: PUBLISH_QDN_RESOURCE params · publish required fields

## Q: How do I handle user cancel on approval popups?

A: Catch errors from qortalRequest and branch UX: user cancel should be quiet/non-alarming; technical failures can show retry. Do not loop automatic retries on cancel. Keep buttons re-enabled after cancel.

Also asked as: user cancel qortalRequest · approval cancelled

## Q: What is the APP vs WEBSITE choice for a portfolio site?

A: A mostly static portfolio with real 404s for bad URLs should use WEBSITE. If it is an interactive builder/marketplace with client routing, use APP. Confusing the two causes most routing bugs—read that distinction before architecture.

Also asked as: portfolio WEBSITE or APP · choose service type

## Q: How do I fetch a file inside a published APP zip?

A: FETCH_QDN_RESOURCE with service APP, name, optional identifier, and filepath set to the in-zip path (e.g. assets/config.json). Multi-file services require filepath; omitting it will not return a single nested file correctly.

Also asked as: filepath fetch APP · fetch file from zip

## Q: How do I use prefix:true correctly?

A: Pass prefix: true on SEARCH_QDN_RESOURCES when the identifier field is a prefix (e.g. myapp_post_). Without it, many cores expect exact identifier match. Combine with service filter and minimal payload for reliable discovery.

Also asked as: prefix true meaning · exact vs prefix identifier

## Q: What should an LLM remember before generating Q-App code?

A: Do not confuse WEBSITE and APP; use qortalRequest for wallet/publish/encrypt and relative fetch for public reads; verify actions against Hub/Core; flat zip with base "./"; Connect-button auth; UTF-8 safe base64; prefix identifiers; normalize search arrays; JSON ≤25 KB; try/catch; never handle seeds.

Also asked as: llm q-app rules · system prompt q-apps

## Q: How do I register publish rights conceptually?

A: Only the account that owns the registered name can publish/update resources under that name. GET_ACCOUNT_NAMES shows names you control; publishing under someone else's name fails. Plan multi-admin flows via shared wallets/groups carefully.

Also asked as: publish rights name owner · who can publish

## Q: What is the role of Qortal Core vs Hub for Q-Apps?

A: Core validates chain data, stores QDN, and exposes REST. Hub/Mobile/Extension embed the Q-App UI and inject qortalRequest for privileged actions. Your static app talks to both: fetch for public REST, qortalRequest for wallet-scoped operations.

Also asked as: core vs hub · who injects qortalRequest

## Q: What packaging mistake causes /assets 404 specifically?

A: Using absolute /assets/... in the bundler output or HTML, or zipping a parent folder so paths disagree. Set base "./" , verify built index references ./assets/..., and zip dist contents. Check Network tab inside Hub Preview.

Also asked as: absolute assets path · /assets 404 fix

## Q: How do I use encoding base64 on fetch?

A: Pass encoding: "base64" on FETCH_QDN_RESOURCE when you need binary-safe content for files/images. Decode to Uint8Array/Blob in the app. For JSON text, you may get string/object depending on Hub—normalize before parse.

Also asked as: encoding base64 fetch · binary fetch qdn

## Q: What is a safe pattern for Connect button code?

A: btn.onclick = async () => { try { const acc = await qr({ action: "GET_USER_ACCOUNT" }); const names = await qr({ action: "GET_ACCOUNT_NAMES", address: acc.address, limit: 10, offset: 0 }); /* enable publish if names[0] */ } catch (e) { /* show e.message */ } }; Never invoke that on DOMContentLoaded.

Also asked as: connect button code · GET_USER_ACCOUNT example

## Q: How do I gate publish UI without a name?

A: After fetching names, disable Publish and show "Register a Qortal name to publish". Do not call PUBLISH_QDN_RESOURCE hoping for a helpful error. Re-check names when the user returns from Hub name registration.

Also asked as: gate publish no name · disable publish

## Q: What offline-safe rules apply to Q-App assets?

A: Ship all critical JS/CSS/fonts/images in the zip; use relative URLs; avoid CDN and runtime code downloads. QDN itself may still need network to fetch remote resources, but the app shell should render offline once cached by Hub.

Also asked as: offline safe q-app · csp safe assets

## Q: How do I verify action names before shipping?

A: Check the Q-Apps docs on qortal.dev and Core's q-apps.js for the user's Hub/Core version. Feature-detect optional actions. Do not invent parameters from memory—wrong keys can fail publishes or empty searches.

Also asked as: verify actions before ship · do not invent parameters

## Q: How do I avoid XSS when rendering Markdown from DOCUMENT?

A: Fetch DOCUMENT as text, run a sanitizer or render to text-only, never inject raw HTML. Combine with CSP-friendly in-zip scripts only. Treat every publisher as untrusted even if the name looks familiar.

Also asked as: markdown xss document · render document safe

## Q: How do I publish multiple related resources with fewer popups?

A: Feature-detect PUBLISH_MULTIPLE_QDN_RESOURCES to batch JSON metadata + THUMBNAIL + FILE in one approval when supported. Otherwise sequence publishes with a progress UI after one user click. Explain what will be published before starting.

Also asked as: batch related publishes · fewer publish popups

## Q: What is a good identifier for per-user app config?

A: Use a stable id like myapp_config_v1 under the user's name and service JSON. Latest publish wins for updates. Bump _v2 only for breaking schema changes and migrate readers carefully.

Also asked as: app config identifier · myapp_config_v1

## Q: How do I open an avatar in the UI?

A: Request GET_QDN_RESOURCE_URL for service THUMBNAIL, name = user name, identifier qortal_avatar, and set img.src. On failure show a placeholder. Do not block Connect UX on avatar load.

Also asked as: load qortal_avatar · avatar url pattern

## Q: Why must pollOptions be an array?

A: CREATE_POLL rejects or mis-handles pollOptions when passed as a string. Pass an array of option objects (e.g. { optionName }). Validate non-empty unique labels client-side before the approval popup.

Also asked as: pollOptions must be array · CREATE_POLL options string bug

## Q: What is the recommended concurrency for chunk fetches?

A: Use a small pool (about 3–6 concurrent FETCH_QDN_RESOURCE calls), retry transient failures with backoff, and update progress from STATUS. Hundreds in Promise.all cause timeouts and UI jank.

Also asked as: chunk fetch concurrency · parallel fetch limit

## Q: What causes stale hashed files after rebuild?

A: Zipping an old dist/ or mixing previous index-*.js hashes with a new index.html yields Loading forever. Always clean build, zip fresh contents, and Preview once before publish. Clear Hub cache if it pins old assets during testing.

Also asked as: stale hashed assets · old dist zip

## Q: How do I read GET_USER_ACCOUNT fields?

A: Typical shape: { address, publicKey }. Use address for GET_ACCOUNT_NAMES and publicKey for encryption counterparties when appropriate. Do not log sensitive wallet details verbosely in production UIs.

Also asked as: GET_USER_ACCOUNT fields · address publicKey

## Q: How do I combine JSON metadata with VIDEO content?

A: Publish VIDEO under myapp_video_<id>, THUMBNAIL under myapp_video_<id>_thumb, and JSON myapp_video_<id>_meta with title/tags/pointers. Search prefix myapp_video_ for discovery; fetch metadata first, then STATUS, then play.

Also asked as: video metadata pattern · json pointer to video

## Q: How do I use SAVE_FILE correctly?

A: Call SAVE_FILE with blob and filename from a user gesture on mobile when anchor download fails. Ensure blob type/filename are set. Feature-detect and fall back to GET_QDN_RESOURCE_URL with attachment=true when appropriate.

Also asked as: SAVE_FILE example · save blob mobile

## Q: What is the relationship between registered names and resources?

A: Resources publish under a name you own; that name is part of the public coordinate others use to fetch. Changing ownership/name registration affects who can update. Design UX around primary name selection when users have several names.

Also asked as: names and resources · primary name selection

## Q: How do I avoid inventing qortalRequest parameters?

A: Copy parameter names from qortal.dev/docs/q-apps or Core sources for the installed version. When unsure, feature-detect and keep payloads minimal—especially for SEARCH_*. Extra unknown keys can break searches.

Also asked as: do not invent params · minimal payloads

## Q: What packaging checklist prevents grey screens?

A: index.html at zip root; flat zip of dist contents; base "./"; relative ./assets; no required CDN; rebuild after config changes; Preview Network 200s; consider trailing slash; remove problematic crossorigin; case-sensitive paths.

Also asked as: grey screen checklist · packaging checklist

## Q: How do inter-app SEARCH prefixes enable ecosystems?

A: Agree on myapp_ prefixes and schema versions; publish discovery JSON; partners SEARCH_QDN_RESOURCES with prefix: true; open hits via LINK_TO_QDN_RESOURCE. Validate every foreign payload—prefixes are not authentication.

Also asked as: ecosystem search prefixes · partner app discovery

## Q: How do I handle ENCRYPT_DATA for groups?

A: Pass a publicKeys array to ENCRYPT_DATA for group encryption, or use ENCRYPT_QORTAL_GROUP_DATA / DECRYPT_QORTAL_GROUP_DATA for group-scoped flows. Explain recipients before approval. Store ciphertext under private namespaces.

Also asked as: group encrypt publicKeys · ENCRYPT_QORTAL_GROUP_DATA

## Q: How do I test publish then search discovery?

A: Publish JSON with prefixed identifier, wait/retry, SEARCH_QDN_RESOURCES with prefix: true and minimal payload, normalize to array, and assert your item appears. If empty, strip optional fields and confirm service spelling.

Also asked as: test publish search · discovery after publish

## Q: Should I use <base href> in a Q-App?

A: Avoid <base href> unless you deliberately fix APP path resolution when Hub serves without a trailing slash. Prefer relative ./assets/ paths and ensuring the app URL has a trailing slash. Mis-set base can break deep links and asset loading.

Also asked as: base href q-app · html base tag hub

## Q: What is the APP service size limit?

A: APP multi-file zips are commonly limited around 50 MB (check your Core docs). Keep bundles lean: no CDN, tree-shake, and avoid shipping unused assets. WEBSITE is also multi-file; both need filepath when fetching individual files.

Also asked as: APP size limit · 50mb app · q-app zip size

## Q: What are BLOG_POST, MAIL, and MESSAGE services?

A: These are ecosystem-oriented QDN services used by apps like Q-Blog and Q-Mail (MAIL/MAIL_PRIVATE, MESSAGE, BLOG_POST). Follow each app's identifier conventions and validate payloads. Size and schema vary by app—study reference repos before publishing into those namespaces.

Also asked as: MAIL service · MESSAGE service

## Q: What services do reference apps use?

A: Q-Mail uses MAIL/MAIL_PRIVATE; Q-Share uses FILE/DOCUMENT; Q-Tube uses VIDEO/BLOG_POST; Q-Shop uses STORE/PRODUCT plus payments. Study their GitHub zips for packaging and qortalRequest patterns before inventing parallel conventions.

Also asked as: q-mail services · q-tube services · reference q-apps

## Q: What does GET_NAME_DATA return?

A: GET_NAME_DATA returns name owner and metadata for a registered name. Use it to verify ownership or show profile info before trusting a publisher name. Combine with payload schema validation—name alone does not prove content quality.

Also asked as: GET_NAME_DATA · name owner metadata

## Q: Why do unprefixed identifiers cause problems?

A: Global QDN namespaces collide easily. Unprefixed ids make discovery and ownership intent unclear and invite cross-app confusion. Always use appslug_type_id style identifiers and validate every fetched JSON schema.

Also asked as: unprefixed identifiers · identifier collision

## Q: How should multi-app ecosystems structure resources?

A: Publish a WEBSITE for visitors, separate APP tools, and small JSON/DOCUMENT indexes for discovery. Use stable identifier prefixes, versioned schema strings, SEARCH_QDN_RESOURCES with prefix: true, and open partners via qortal:// or LINK_TO_QDN_RESOURCE. Never assume identifier proves origin.

Also asked as: multi-app ecosystem · inter-app integration · discovery json

## Q: How do hash deep links work in Q-Apps?

A: SPAs may use location.hash for anchors (e.g. #section-id). If you use multiple prefixes like #folder- and #folderdir-, parse longest match first—naive startsWith('folder-') breaks on substrings. Preserve hashes across history.replaceState cleanup.

Also asked as: hash deep links · overlapping hash prefixes

## Q: How do I sign and broadcast a transaction?

A: Use SIGN_TRANSACTION for a Hub-signed transaction, then broadcast via REST /transactions/process. Keep signing behind an explicit user action and never handle seed phrases. Verify the exact payload shape for your Core version.

Also asked as: SIGN_TRANSACTION · broadcast transaction · transactions/process

## Q: How do group actions work?

A: LIST_GROUPS, JOIN_GROUP, and GET_GROUPS_WITH_MEMBER manage membership. JOIN_GROUP requires approval. Use groups with ENCRYPT_QORTAL_GROUP_DATA when sharing private payloads among members. Feature-detect and handle cancel.

Also asked as: LIST_GROUPS · JOIN_GROUP · group membership

## Q: Why is SEARCH_TRANSACTIONS message often missing?

A: Payment matching via SEARCH_TRANSACTIONS often lacks a reliable message field. Match by reference, type, amounts (1e8 scale), and parties instead of free-text memo. Design payment protocols that do not depend on message alone.

Also asked as: SEARCH_TRANSACTIONS · payment matching · transaction message missing

## Q: How do I test auth edge cases?

A: Cover: user cancels GET_USER_ACCOUNT; wallet with zero names; nested iframe without relay; opening index.html outside Hub (preview mode). Ensure publish buttons stay disabled without a name and errors are human-readable.

Also asked as: test auth cancel · no name wallet test

## Q: What is the difference between QDN search mode ALL and LATEST?

A: REST QDN search modes mode=ALL vs mode=LATEST change whether you see historical publishes or only latest per coordinate. Wrong mode causes duplicates or wrong counts. Prefer LATEST for current app state unless you need history.

Also asked as: mode=ALL · mode=LATEST · qdn search mode

## Q: Where is the REST API documentation?

A: Use the API documentation on api.qortal.org for node REST fields. Cross-check field names when debugging bridge vs REST mismatches. For qortalRequest actions, prefer the Q-Apps docs on qortal.dev and Core's Q-Apps.md.

Also asked as: api.qortal.org · rest docs qortal

## Q: What GitHub repos should Q-App developers study?

A: Qortal/qortal (Core, Q-Apps.md, q-apps.js), Qortal/Qortal-Hub, optional Qortal/qapp-core helpers, and reference apps q-mail, q-share, q-tube, q-shop. Community projects also live on gitea.qortal.link.

Also asked as: q-app github repos · qapp-core · gitea.qortal.link

## Q: How do I feature-detect optional publish batching?

A: Try PUBLISH_MULTIPLE_QDN_RESOURCES inside try/catch; on failure fall back to sequential PUBLISH_QDN_RESOURCE with clear progress. Do not invent parameters—check qortal.dev for the user's version.

Also asked as: feature detect batch publish

## Q: What if payment succeeded but notification failed?

A: Treat payment and notification as separate steps. Persist local state that payment confirmed (tx signature/reference) even if a follow-up QDN publish or chat notify fails, then retry notify without charging again.

Also asked as: payment notify failed · separate payment steps

## Q: Why are case-sensitive paths important in zips?

A: QDN/Hub serving is case-sensitive. Mismatched Asset vs asset paths work on some desktop FS previews and fail in Hub. Prefer lowercase [a-z0-9._-] filenames and matching import paths from the bundler.

Also asked as: case-sensitive paths · zip path case

## Q: How do I load demo JSON after connect in a skeleton app?

A: After Connect obtains a primary name, PUBLISH_QDN_RESOURCE a small JSON with identifier myapp_demo_<timestamp> and data64 from b64Utf8, then FETCH_QDN_RESOURCE the same coordinates and display the result. Disable the load/publish button until a name exists.

Also asked as: skeleton publish fetch · demo json q-app

## Q: How do Hub themes affect my Q-App UI?

A: Read window._qdnTheme ("light"|"dark") and style accordingly so the app matches Hub chrome. Re-check on visibility changes if Hub can toggle theme while open. Avoid assuming dark mode defaults.

Also asked as: hub theme q-app · match hub light dark

## Q: How do I keep Hub copy-link accurate for WEBSITE subpages?

A: On each route change, call QDN_RESOURCE_DISPLAYED with service WEBSITE, name, and path. Optionally update canonical qortal://WEBSITE/<name>/<slug>. Without this, copy-link may point only at the site root.

Also asked as: copy-link subpath · website path displayed

## Q: What is GET_ACCOUNT_DATA?

A: GET_ACCOUNT_DATA returns the account record for an address (read-only, typically no approval). Use it for public account fields after you know an address from GET_USER_ACCOUNT or a name lookup.

Also asked as: GET_ACCOUNT_DATA · account record

## Q: What is GET_BALANCE used for?

A: GET_BALANCE reads a balance for an address without implying the logged-in wallet session. For the user's wallet-specific balance UI, also consider approval-gated wallet balance actions on your Hub version. Remember 1e8 scaling for QORT display.

Also asked as: GET_BALANCE · read balance q-app

## Q: What chain helpers exist via qortalRequest?

A: Common helpers include FETCH_BLOCK, FETCH_BLOCK_RANGE, GET_BLOCK_HEIGHT, GET_PRICE, DEPLOY_AT, GET_AT, GET_AT_DATA, LIST_ATS, and day summary reads. Verify names/params for your Core; wrap in try/catch and prefer relative REST fetch for simple public chain reads.

Also asked as: FETCH_BLOCK · GET_BLOCK_HEIGHT · DEPLOY_AT · GET_AT

## Q: How do I link to a WEBSITE sub-page?

A: Use qortal://WEBSITE/MySite/gallery (service/name/path). Ensure the WEBSITE zip actually contains that path or APP-style SPA fallback will not apply—WEBSITE 404s missing files. Sync Hub chrome with QDN_RESOURCE_DISPLAYED.

Also asked as: website subpage link · qortal website path

## Q: What is local preview URL for an APP?

A: When Core supports it: the node's /render/APP/<Name>?preview=true path on port 12391 (varies by version). Still prefer Hub Preview for realistic bridge behavior. Confirm assets load under the render path.

Also asked as: local preview render · preview=true url

## Q: How do I use GET_QDN_RESOURCE_STATUS before playing video?

A: Poll or await GET_QDN_RESOURCE_STATUS until READY (and acceptable percent loaded) before setting video src or fetching large blobs. Show progress UI; cancel cleanly on navigation away.

Also asked as: video ready status · wait for media READY

## Q: How do I get a URL for an arbitrary resource path?

A: Prefer GET_QDN_RESOURCE_URL over string-concatenating /arbitrary/... yourself. For multi-file resources include the filepath Hub expects. Append ?attachment=true on mobile when triggering native download listeners.

Also asked as: arbitrary resource url · filepath url

## Q: What is OPEN_NEW_TAB used for?

A: OPEN_NEW_TAB opens a new Hub tab with a URL or qortal:// link. Use it for cross-app navigation while staying inside Hub. Prefer it over external browser windows for QDN targets.

Also asked as: OPEN_NEW_TAB · new hub tab

## Q: How does SET_TAB postMessage work?

A: Post a message like { action: 'SET_TAB', requestedHandler: 'UI', payload: { service, name, identifier?, path? } } to switch Hub tabs to a QDN resource. Feature-detect Hub support and fall back to LINK_TO_QDN_RESOURCE or OPEN_NEW_TAB.

Also asked as: SET_TAB postMessage · hub tab switch

## Q: How should category and tags be used on resources?

A: Set category/tags in publish metadata when supported, and read them via GET_QDN_RESOURCE_METADATA for filtering UIs. Keep tags short and consistent within your app. Do not trust tags for security decisions—validate payload bodies.

Also asked as: resource category tags · metadata tags

## Q: What does latest publish wins mean for identifiers?

A: Updating the same name+service+identifier overwrites prior content for readers fetching latest. To keep history, use new identifiers or version suffixes and point the index at the current id. Design for immutability when audits matter.

Also asked as: immutable identifiers · version suffix identifiers

## Q: How do I debug bridge vs REST field mismatches?

A: Compare qortalRequest responses with the same data from relative fetch against api.qortal.org field names. Log raw payloads in Preview. Prefer bridge for wallet-bound ops and REST/fetch for anonymous public reads.

Also asked as: bridge vs rest · debug field names

## Q: What is GET_USER_WALLET vs GET_USER_ACCOUNT?

A: GET_USER_ACCOUNT returns address/publicKey for identity. GET_USER_WALLET / GET_USER_WALLET_INFO are approval-gated wallet details on some Hubs—use only when needed and verify fields for your version. Prefer the least-privileged action.

Also asked as: GET_USER_WALLET · GET_USER_WALLET_INFO

## Q: How do I display QORT prices?

A: Call GET_PRICE (read-only) and divide integer amounts by 1e8 for human QORT. Cache briefly to avoid spamming; handle missing market data. Confirm units before using prices in SEND_COIN UX copy.

Also asked as: GET_PRICE · display qort price

## Q: What is SEARCH_NAMES for?

A: SEARCH_NAMES finds registered names (read-only). Use it for typeahead when linking to publishers. After picking a name, fetch resources with LIST/SEARCH QDN APIs and validate payloads.

Also asked as: SEARCH_NAMES · name search

## Q: How should error messages be written for users?

A: Map bridge errors to short actions: open in Hub, connect wallet, register a name, approve the popup, reduce payload size, or retry after publish delay. Avoid dumping raw stacks. Distinguish cancel from failure.

Also asked as: user facing errors · q-app error ux

## Q: How do I keep Q-App builds deterministic for republish?

A: Pin dependency versions, rebuild clean dist/, zip contents only, and bump manifest version. After publish, verify GET_QDN_RESOURCE_PROPERTIES size/hash expectations. Stale hashed assets in an old zip cause eternal Loading.

Also asked as: deterministic build zip · republish clean build

## Q: What crossorigin script issue can grey-screen an app?

A: Some Hub builds fail loading scripts marked crossorigin, leaving a blank/Loading UI even when files exist. If assets 200 but JS never runs, try removing crossorigin from script tags, rebuild, and re-zip.

Also asked as: crossorigin script hub · script load fail

## Q: How do I design identifier namespaces for encrypted mail-like apps?

A: Use public JSON indexes under myapp_pub_* and ciphertext under myapp_priv_* (or private services). ENCRYPT_DATA with recipient publicKeys; DECRYPT_DATA with counterparty publicKey. Never put secrets in public JSON.

Also asked as: encrypted mail identifiers · public vs private namespace

## Q: How do I use polls safely in a Q-App?

A: Ensure pollName uniqueness, pass pollOptions as an array of option objects, confirm copy before CREATE_POLL/VOTE_ON_POLL approvals, and handle cancel. Do not encode critical funds movement only in poll text—use SEND_COIN for payments.

Also asked as: polls best practices · pollName unique

## Q: How do I report resource display to Hub for APP routes?

A: Use QDN_RESOURCE_DISPLAYED with service APP, name, and path when your in-app route should appear in Hub chrome/copy-link. Keep path aligned with what you would put in a qortal:// link.

Also asked as: QDN_RESOURCE_DISPLAYED APP · app route copy link

## Q: What is the teaching-default artifact for small tools?

A: Default to a single-file HTML Q-App for small tools, and Vite + flat zip for production SPAs. Single-file simplifies packaging (still may zip one html); SPAs need careful relative asset paths and SPA service APP.

Also asked as: single-file html q-app · default artifact

## Q: What METADATA fields are commonly useful in galleries?

A: Title, tags, category from GET_QDN_RESOURCE_METADATA plus filename/mimeType/size from PROPERTIES and a THUMBNAIL URL. Lazy-load full FETCH only on open. Validate strings before rendering into HTML.

Also asked as: gallery metadata fields · lazy load resource

## Q: What is the difference between gateway context and full Hub?

A: window._qdnContext may be "gateway" vs fuller Hub environments. Some privileged behaviors differ; always feature-detect qortalRequest and degrade. Theme still via _qdnTheme. Test both if you support public gateways.

Also asked as: _qdnContext gateway · gateway vs hub

## Q: What FILE size strategy should apps use?

A: Prefer one FILE when under comfortable Hub timeouts; for larger binaries, chunk into parts with a JSON index and bounded parallel fetches. Probe STATUS before heavy FETCH. Show clear size warnings before user-approved publish.

Also asked as: large file strategy · file size timeouts

## Q: How do I fetch account names with pagination?

A: Pass limit and offset to GET_ACCOUNT_NAMES and loop until a short page returns. Most users have few names—still code defensively. Cache after Connect for the session unless the user refreshes names.

Also asked as: GET_ACCOUNT_NAMES pagination · limit offset names

## Q: How do relative asset paths interact with deep links?

A: Deep links into /render/APP/Name/some/route still need assets resolved from the app root, not the deep path. Relative ./assets from a nested route can break—use root-correct relative URLs from the bundler base or Hub trailing-slash strategies.

Also asked as: deep link assets · nested route asset paths

## Q: How do I use DOCUMENT vs FILE for text?

A: DOCUMENT suits larger text/JSON documents; FILE is generic binary/download oriented. If clients should edit structured text in-app, DOCUMENT (or JSON when tiny) is clearer; if users download opaque blobs, FILE fits. Either way validate size and mime.

Also asked as: DOCUMENT vs FILE · text on qdn

## Q: What Hub UI actions help multi-page sites?

A: QDN_RESOURCE_DISPLAYED keeps copy-link aligned; OPEN_NEW_TAB/LINK_TO_QDN_RESOURCE opens peers; SET_TAB switches tabs; SET_TAB_NOTIFICATIONS badges unread. Combine with real WEBSITE file paths or APP SPA fallback appropriately.

Also asked as: hub ui actions website · multi-page hub integration

## Q: How do I safely mock data in preview mode?

A: When the bridge is missing, serve local fixture JSON for reads and disable Publish/Pay buttons. Label the UI Preview. Never mark a mock payment as success. The same code paths should call qr() in Hub.

Also asked as: mock preview data · fixtures without hub

## Q: What is the end-to-end path for a WEBSITE visitor link?

A: Publisher builds static files → Hub publishes service WEBSITE under owned name → visitors open qortal://WEBSITE/<Name>/path. Missing files 404. For interactive wallet features on every page, consider APP instead.

Also asked as: website visitor path · end to end website

## Q: What REST mode mistake causes duplicate resources in UI?

A: Using mode=ALL when you meant LATEST lists historical publishes as separate rows. Prefer LATEST for current catalogs, or dedupe by name+service+identifier yourself if you need ALL for history UIs.

Also asked as: duplicate resources search mode · ALL vs LATEST duplicates

## Q: How do I implement bounded concurrency in JS?

A: Keep a queue of identifiers and N workers: while queue length, worker shifts an id, await FETCH_QDN_RESOURCE, push result, repeat. Avoid awaiting Promise.all on the entire list. Surface partial errors per id.

Also asked as: worker pool fetch · bounded concurrency code

## Q: What should happen when parent.qortalRequest is only a stub?

A: If parent === top and the stub cannot reach Hub, wallet calls fail—tell the user to open the app from Hub or a real Hub tab. Implement a message relay only when you control the parent embedder.

Also asked as: stub qortalRequest · parent top stub

## Q: What UI pattern fits Hub-embedded Q-Apps?

A: One primary Connect CTA, clear publish/pay confirmations, theme via _qdnTheme, large tap targets, and progressive loading with STATUS for media. Avoid assuming desktop hover. Keep critical actions gesture-gated.

Also asked as: hub embedded ui pattern · q-app ux pattern

## Q: What FILE identifier pattern do blog/mail apps use?

A: File attachments in blog/mail-style apps often use FILE with identifiers like qfile_…. Follow the host app's documented prefix so other clients can find attachments. Validate mime/size from GET_QDN_RESOURCE_PROPERTIES before rendering.

Also asked as: qfile identifier · file attachment identifier

## Q: What is NAVIGATION_HISTORY for?

A: NAVIGATION_HISTORY integrates back/forward with Hub (availability is Hub-dependent). Use it when your SPA should participate in Hub navigation chrome. Always feature-detect and provide in-app back affordances as fallback.

Also asked as: NAVIGATION_HISTORY · hub back forward

## Q: What is qapp-core?

A: Qortal/qapp-core is an optional npm helper library for Q-App development. It can wrap common bridge patterns, but you should still understand raw qortalRequest and verify actions against your Hub/Core version.

Also asked as: qapp-core npm · qortal qapp-core

## Q: Should Connect buttons meet mobile touch targets?

A: Yes. Use adequate tap targets (e.g. min-height ~44px) for Connect, Publish, and payment buttons. Mobile Hub and Qortal Go are primary surfaces—avoid hover-only UX and tiny icon-only critical actions.

Also asked as: mobile touch targets · button size q-app

## Q: What is GIF_REPOSITORY?

A: GIF_REPOSITORY is a multi-file QDN service type (like APP/WEBSITE) requiring filepath on fetch. Use it for gif packs rather than APP UI. Confirm size limits and publish path via Hub for your Core version.

Also asked as: GIF_REPOSITORY · gif repository service

## Q: Can I use STORE or PRODUCT services?

A: Q-Shop-style apps use STORE/PRODUCT services plus payment actions. Follow Q-Shop conventions for identifiers and JSON schemas rather than inventing incompatible shapes if you want ecosystem interoperability. Always validate foreign product JSON.

Also asked as: STORE service · PRODUCT service · q-shop services

## Q: How do identifiers work with MAIL or BLOG_POST?

A: Follow each ecosystem app's documented identifier schemes (Q-Mail, Q-Blog) so other clients interoperate. Prefix your own extensions carefully and never overwrite foreign coordinates. Validate payload schemas from those apps' repos.

Also asked as: mail identifiers · blog_post identifiers

## Q: What friends/profile list actions exist?

A: Hub builds may expose GET_FRIENDS_LIST, SET_PROFILE_DATA, and list item APIs—often approval-gated. Verify against your version's q-apps docs before relying on them. Store cross-user public profile data on QDN when other apps must read it.

Also asked as: GET_FRIENDS_LIST · SET_PROFILE_DATA

## Q: What is SEND_CHAT_MESSAGE used for?

A: SEND_CHAT_MESSAGE (group) sends chat with user approval on supported Hubs. Do not use it as a reliable payment receipt channel. Confirm group context and permissions; handle cancel and rate limits.

Also asked as: SEND_CHAT_MESSAGE qortalRequest · group chat message

## Q: What notifications permission actions exist?

A: Some Hub versions expose notifications permission actions alongside SET_TAB_NOTIFICATIONS. Feature-detect, request only from a gesture, and degrade silently if unavailable. Never depend on notifications for critical payment state.

Also asked as: notifications permission q-app · hub notifications

## Q: How do I open Q-Mail or other apps for a user?

A: Navigate with qortal:// or LINK_TO_QDN_RESOURCE / OPEN_NEW_TAB to the target APP name used by that product. Do not scrape their private coordinates; use documented public identifiers and services. Fail soft if the app is unpublished on that node.

Also asked as: open q-mail from app · cross app open

## Q: What is GET_GROUPS_WITH_MEMBER?

A: GET_GROUPS_WITH_MEMBER lists groups that include a member address (read-oriented; confirm approval needs for your version). Use it to personalize group UIs after Connect. Pair with LIST_GROUPS for broader discovery.

Also asked as: GET_GROUPS_WITH_MEMBER

## Q: What is TRANSFER_ASSET used for?

A: TRANSFER_ASSET moves assets with user approval (confirm params on target Hub). Explain asset name/amount in UI first. Like SEND_COIN, treat confirmation and any later notify/publish as separate steps.

Also asked as: TRANSFER_ASSET · asset transfer q-app

## Q: How do I integrate Hub back buttons with my SPA?

A: Listen to popstate for in-app routes and integrate NAVIGATION_HISTORY when available. Ensure each pushState has a matching UI state. Do not break Hub-level back by replacing history incorrectly.

Also asked as: hub back button spa · popstate integration

## Q: What should be in a Q-App README for other developers?

A: Document identifier prefixes, JSON schema versions, services used, publish rights (name ownership), Hub version tested, and example qortal:// links. Point to qortal.dev for actions. Clear conventions beat clever undocumented namespaces.

Also asked as: q-app readme conventions · document identifiers

## Q: What is SEARCH_CHAT_MESSAGES?

A: SEARCH_CHAT_MESSAGES searches chat on supported Hubs and may be approval-gated depending on version. Confirm parameters in qortal.dev. Do not treat chat search as a transactional ledger.

Also asked as: SEARCH_CHAT_MESSAGES
