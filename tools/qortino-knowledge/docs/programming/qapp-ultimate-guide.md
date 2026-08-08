# Qortal Q-Apps & QDN Websites — Developer & LLM Guide

**Revision:** 2026-07-14  
**Audience:** Developers and AI assistants building Q-Apps and WEBSITE resources on [Qortal](https://github.com/qortal)  
**Scope:** `qortalRequest`, QDN, packaging, Hub deployment, and common production patterns

---

## Navigation

| § | Topic | Read when… |
|---|--------|------------|
| [0](#0-for-llms-start-here) | For LLMs | You are an AI loading this as context |
| [1](#1-mental-model) | Mental model | First time on Qortal / QDN |
| [2](#2-website-vs-app) | WEBSITE vs APP | Choosing service type or debugging 404 vs SPA routing |
| [3](#3-qdn-coordinates) | QDN coordinates | Publishing, fetching, or linking resources |
| [4](#4-service-types) | Service types | Picking IMAGE / JSON / DOCUMENT / APP / … |
| [5](#5-qortalrequest-bridge) | `qortalRequest` | Wallet, publish, encrypt, navigate |
| [6](#6-fetch-and-rest) | `fetch` & REST | Public reads without wallet |
| [7](#7-packaging-and-publishing) | Packaging | Zip layout, Vite, grey-screen fixes |
| [8](#8-linking-and-deep-links) | Linking | `qortal://`, SPA routing, hash deep links |
| [9](#9-hub-integration) | Hub integration | Auth, iframes, mobile, bridge patterns |
| [10](#10-ecosystem-and-conventions) | Ecosystem | Cross-app identifiers and reference Q-Apps |
| [11](#11-source-repos) | Source repos | Gitea, GitHub, official docs |
| [12](#12-pitfalls) | Pitfalls | Debugging checklist |
| [13](#13-security) | Security | Trust model |
| [14](#14-workflows) | Workflows | Step-by-step new Q-App / WEBSITE |
| [15](#15-skeleton) | Skeleton | Copy-paste starter |
| [16](#16-llm-system-prompt) | System prompt | Paste into another LLM |

---

## 0. For LLMs: start here

1. Read **§1–§2** before generating architecture — confusing WEBSITE and APP causes most routing bugs.
2. Use **`qortalRequest`** for wallet, signing, publish, encrypt, and payments; use **relative `fetch()`** for anonymous public reads (§6).
3. Before publish/search code: read **§3, §6, §12** (identifiers, search normalization, UTF-8 base64).
4. Before shipping a zip: read **§7** (flat `dist/`, `base: "./"`, no CDN).
5. When the user's Hub/Core version matters, **verify action names** in [qortal.dev/docs/q-apps](https://qortal.dev/docs/q-apps) or Core `q-apps.js` — do not invent parameters.

**Default artifact:** single-file HTML for small tools; **Vite + flat zip** for production SPAs.

**Authority order when sources conflict:**

1. User's running **Qortal Core + Hub version**
2. [Q-Apps.md](https://github.com/Qortal/qortal/blob/master/Q-Apps.md) in Core
3. [qortal.dev/docs/q-apps](https://qortal.dev/docs/q-apps)
4. This guide (patterns and pitfalls — not a byte-perfect API dump)

---

## 1. Mental model

| Term | Meaning |
|------|---------|
| **Qortal Core** | Node software: chain validation, QDN storage, **REST API** |
| **Hub / Mobile / Extension** | User UIs that embed Q-Apps and inject **`qortalRequest`** |
| **QDN** | Qortal Data Network — resources indexed on-chain, payload mostly off-chain (SHA-256 verified) |
| **Registered name** | On-chain name tied to an account; **required to publish** from a Q-App |
| **Resource** | `{ name, service, identifier? }` + data; **latest publish wins** for the same triple |
| **Q-App** | Static web app (HTML/JS/CSS), usually a **zip** with **`index.html` at root**, service **`APP`** |
| **WEBSITE** | Multi-file site on QDN, service **`WEBSITE`** — different routing (§2) |

**Typical Q-App constraints:** no private backend with secrets; identity is **wallet address** + optional **name**; ship assets **in the zip** (offline/CSP-safe).

---

## 2. WEBSITE vs APP

| | **WEBSITE** | **APP** |
|---|-------------|---------|
| **Missing file path** | **404** | Falls through to **`index.html`** (SPA) |
| **Use for** | Visitor-facing static or multi-page sites | Interactive apps, builders, marketplaces, client routers |
| **Examples** | Portfolio site, published blog layout | Wallet UI, map tool, shop front-end |

**Rule:** Client-side router + app behaviour → **`APP`**. Mostly static pages with real 404s for bad URLs → **`WEBSITE`**.

**SPA asset trap:** Hub may open `/render/APP/YourName` **without** a trailing slash, so `./assets/index.js` resolves against `/render/APP/` and **404s**. Fixes:

- Ensure a **trailing slash** on the app URL, or
- Inject `<base href>` pointing at the app root (only when you understand the URL shape), or
- Use absolute-to-root paths that match how your Hub serves the resource.

Rebuild and re-zip after any HTML or bundler config change.

---

## 3. QDN coordinates

Every QDN object:

- **`name`** — publisher's registered name (controls update rights)
- **`service`** — `IMAGE`, `JSON`, `APP`, `WEBSITE`, `DOCUMENT`, `BLOG_POST`, …
- **`identifier`** — optional; distinguishes multiple resources per name+service

**Default resource:** main website or app for a name — omit `identifier` or use `"default"`.

**Shared identifiers:** deterministic cross-app locations (e.g. avatar: service `THUMBNAIL`, identifier `qortal_avatar` + user `name`).

**App namespaces:** prefix identifiers with your app slug: `myapp_config_v1`, `myapp_post_<id>`. QDN is permissionless — **validate payload schema**; never trust identifier alone.

---

## 4. Service types

Condensed from [qortal.dev](https://qortal.dev/docs/q-apps). Sizes are per-service limits where documented.

| Service | Role | Typical limit |
|---------|------|----------------|
| `JSON` | Small structured metadata | **25 KB** |
| `DOCUMENT` | Larger text/JSON documents | 500 MB general cap |
| `DOCUMENT_PRIVATE` (801) | Encrypted documents | Private |
| `IMAGE` / `THUMBNAIL` | Media | 10 MB / 500 KB |
| `FILE` / `VIDEO` / `AUDIO` | Binaries | Large |
| `WEBSITE` / `APP` | Multi-file zips | APP **50 MB** |
| `BLOG_POST` / `MAIL` / `MESSAGE` | Ecosystem apps | varies |
| `CHAIN_COMMENT` | Tiny on-chain payload | **239 B** |

**Single-file vs multi-file:** `JSON`, `IMAGE`, etc. → one payload (`data64` or `file`). `WEBSITE`, `APP`, `GIF_REPOSITORY` → many files; **`filepath`** required on fetch.

**Publishing multi-file WEBSITE/APP from inside a Q-App:** still **limited or unavailable** in many Hub builds — publish via Hub UI; **fetch** multi-file resources **is** supported. Verify your target version.

**Private services** (`*_PRIVATE`, numeric 801, etc.): encrypted for recipient; decrypt with wallet via `DECRYPT_DATA` or group variants.

---

## 5. `qortalRequest` bridge

Injected by Core/Hub into embedded pages. Returns a **Promise** — always **`try/catch`**. Timeouts are **per-action** in Core `q-apps.js`; fix payload size and batching rather than wrapping everything in long timeouts.

**Host variables:** `window._qdnTheme` (`light`|`dark`), `window._qdnContext` (e.g. `gateway`).

### 5.1 Feature detection

```javascript
async function qr(payload) {
  const req = window.qortalRequest ?? window.parent?.qortalRequest;
  if (typeof req !== "function") throw new Error("Open inside Qortal Hub");
  return req(payload);
}
```

Resolve the bridge from `window`, then `parent`, then `top` when running in nested iframes.

### 5.2 Identity (gesture-gated)

| Action | Purpose |
|--------|---------|
| `GET_USER_ACCOUNT` | Wallet address + public key — **user approval**; call from a **button**, not on first paint |
| `GET_ACCOUNT_NAMES` | Names for an address |
| `GET_ACCOUNT_DATA` | Account record |
| `GET_NAME_DATA` | Name owner and metadata |

**Publish gate:** user must **own** a registered name.

### 5.3 QDN read

| Action | Purpose |
|--------|---------|
| `FETCH_QDN_RESOURCE` | Load resource; add `filepath` for multi-file; `encoding: "base64"` when needed |
| `SEARCH_QDN_RESOURCES` | Discover resources; use `prefix: true` for identifier prefixes; **minimal payload** |
| `LIST_QDN_RESOURCES` | List by name/service (richer filters than search in some builds) |
| `GET_QDN_RESOURCE_URL` | URL for `<img src>` / fetch (e.g. `/arbitrary/...`) |
| `GET_QDN_RESOURCE_STATUS` | Build/load status (`READY`, percent loaded) — probe without full fetch |
| `GET_QDN_RESOURCE_METADATA` | Title, tags, category without full payload |
| `GET_QDN_RESOURCE_PROPERTIES` | filename, mimeType, size |

**Search normalization:** cores return array **or** `{ resources | results | entries | hits | data: [...] }` — coerce to array. Unknown JSON keys on search → **empty results**; strip optional fields if search mysteriously fails.

### 5.4 QDN write

| Action | Purpose |
|--------|---------|
| `PUBLISH_QDN_RESOURCE` | Single file / `data64`; `name` must be owned |
| `PUBLISH_MULTIPLE_QDN_RESOURCES` | Batch publish — feature-detect; fewer approval rounds |

**UTF-8 JSON → base64** — never raw `btoa(JSON.stringify(obj))` on Unicode text:

```javascript
function b64Utf8(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
```

### 5.5 Navigation & Hub UI

| Action / pattern | Purpose |
|------------------|---------|
| `LINK_TO_QDN_RESOURCE` | Open QDN resource in Hub |
| `OPEN_NEW_TAB` | New tab with URL or `qortal://` link |
| `OPEN_PROFILE` | Open peer profile |
| `SET_TAB` (via `postMessage`) | Hub tab switch — `{ action: 'SET_TAB', requestedHandler: 'UI', payload: { service, name, identifier?, path? } }` |
| `QDN_RESOURCE_DISPLAYED` | Tell Hub what resource is shown (address bar / copy-link) — `{ action, service, name, path? }` |
| `SET_TAB_NOTIFICATIONS` | Badge count on tab |
| `NAVIGATION_HISTORY` | Back/forward integration (Hub-dependent) |

### 5.6 Groups, polls, payments

| Action | Notes |
|--------|-------|
| `LIST_GROUPS` / `JOIN_GROUP` / `GET_GROUPS_WITH_MEMBER` | Group membership |
| `CREATE_POLL` / `VOTE_ON_POLL` | `pollOptions` must be **array**; `pollName` must be unique |
| `SEND_COIN` / `TRANSFER_ASSET` / `SEND_PAYMENT` | User approval; **confirm params** on target Hub version |
| `SIGN_TRANSACTION` | Hub-signed tx, then broadcast via REST `/transactions/process` |
| `SEARCH_TRANSACTIONS` | Payment matching — `message` field often missing; match by reference/type |

### 5.7 Encryption

| Action | Purpose |
|--------|---------|
| `ENCRYPT_DATA` | `file` or `base64`; optional `publicKeys` for group |
| `DECRYPT_DATA` | Ciphertext base64 + counterparty `publicKey` |
| `ENCRYPT_QORTAL_GROUP_DATA` / `DECRYPT_QORTAL_GROUP_DATA` | Group-scoped encryption |

Use **separate identifier namespaces** for encrypted blobs.

### 5.8 Lists (local UI state)

`GET_LIST_ITEMS`, `ADD_LIST_ITEMS`, `DELETE_LIST_ITEM` — per-user lists in Hub, not global QDN.

### 5.9 Mobile (Qortal Go)

| Action / URL | Purpose |
|--------------|---------|
| `SAVE_FILE` | Save `blob` + `filename` natively — mobile WebViews often **ignore** anchor/blob downloads |
| `/arbitrary/…?attachment=true` | Native download listener on some mobile builds |

Detect mobile via user-agent when choosing download strategy.

### 5.10 Chain & misc

`FETCH_BLOCK`, `GET_BALANCE`, `GET_BLOCK_HEIGHT`, `GET_PRICE`, `DEPLOY_AT`, `GET_AT`, notifications permission actions — see [qortal.dev](https://qortal.dev/docs/q-apps) for the full list.

---

## 6. `fetch` and REST

Inside Hub, **relative** `fetch("/names/foo")` hits the user's node API — good for **public reads** (blocks, names, arbitrary endpoints).

**Limitation:** `fetch` does not know the logged-in wallet; personalized or signing flows need **`qortalRequest`**.

Do **not** hardcode `http://127.0.0.1:12391` in shipped apps.

**QDN search modes (REST):** `mode=ALL` vs `mode=LATEST` — wrong mode → duplicates or wrong counts.

**Reference:** [api.qortal.org/api-documentation](https://api.qortal.org/api-documentation/) — cross-check field names when debugging bridge vs REST.

**Local preview (varies by Core):** `http://localhost:12391/render/APP/<Name>?preview=true`

---

## 7. Packaging and publishing

### 7.1 Zip layout (non-negotiable)

```
my-app.zip
├── index.html          ← at zip root
├── manifest.json
├── assets/
│   ├── index-xxxxx.js
│   └── index-xxxxx.css
└── … (fonts, images, workers)
```

- Zip **contents** of `dist/`, not a `dist/` folder wrapper.
- **`manifest.json`:** `"main": "index.html"`, title, version, category.
- Paths: **`./assets/...`**, never `/assets/...`.
- Avoid `<base href>` unless you are deliberately fixing APP path resolution (§2).
- Vite: `base: "./"`.
- **Ship fonts/JS in-bundle** — no required CDN.
- Case-sensitive paths; prefer `[a-z0-9._-]`.

### 7.2 Workflow

1. `npm run build` → `dist/` (or equivalent)
2. `(cd dist && zip -r ../MyApp.zip .)`
3. Hub → load zip → **Preview** before QDN publish
4. Publish service **`APP`** (or **`WEBSITE`** via Hub for end-user sites)
5. Open `qortal://APP/<Name>` or `qortal://WEBSITE/<Name>/`

### 7.3 Grey screen / eternal “Loading…”

| Cause | Fix |
|-------|-----|
| `assets/index-*.js` 404 | Flat zip, `base: "./"`, rebuild |
| Absolute `/assets/` paths | Relative `./assets/` |
| Stale hashed files | Full rebuild + fresh zip |
| `crossorigin` on scripts | Some Hub builds fail script load — remove if needed |

---

## 8. Linking and deep links

### 8.1 `qortal://` protocol

```text
qortal://{service}/{name}/{identifier?}/{path?}
```

Examples:

- `qortal://WEBSITE/MySite` — home
- `qortal://WEBSITE/MySite/gallery` — sub-page
- `qortal://APP/MyQApp`
- `qortal://THUMBNAIL/MyName/qortal_avatar`

Use `default` in path when you need explicit no-identifier semantics.

### 8.2 SPA routing inside Hub

Published apps often run under paths like `/render/WEBSITE/<name>/` or `/render/APP/<name>/`. Use **pathname** segments for sub-pages and **`history.pushState` / `popstate`** for in-app navigation without leaving the Hub.

**Hash deep links (optional):** SPAs may use `location.hash` for anchors (e.g. `#section-id`). If you use multiple hash prefixes (e.g. `#folder-…` and `#folderdir-…`), parse **longest match first** — naive `startsWith('folder-')` breaks when one prefix is a substring of another.

Preserve intentional hash fragments when calling `history.replaceState` for pathname cleanup.

### 8.3 Programmatic navigation

Prefer `LINK_TO_QDN_RESOURCE` or `SET_TAB` postMessage for cross-app opens.

---

## 9. Hub integration

### 9.1 Authentication

- `GET_USER_ACCOUNT` only works **inside Hub** (or via a bridge stub that forwards to `parent`).
- Opening built `index.html` in a normal browser **cannot** complete wallet auth.
- If `parent === top` and only a stub exists, wallet calls fail — user must open the app from Hub.
- **Do not** auto-call `GET_USER_ACCOUNT` on page load; use an explicit **Connect** / **Authenticate** button.
- **Embedded Q-Apps in iframes:** parent page may need a **message relay** that forwards `qortalRequest` to the Hub; if inner auth still fails, open the target in a **new Hub tab**.

### 9.2 Bridge wrapper pattern

Centralize all bridge calls in one module. Typical resolution order:

```text
window.qortalRequest → parent.qortalRequest → top.qortalRequest
```

Wrap with short-timeout and long-timeout helpers (publishes and payments often need longer limits). Always `try/catch`.

### 9.3 Preview mode

```javascript
if (typeof qortalRequest !== "function" && typeof window.parent?.qortalRequest !== "function") {
  // Show "Preview mode" — mock reads only; never fake successful payments
}
```

### 9.4 Hub copy-link / address bar

Multi-page WEBSITE apps can notify the Hub what sub-path is displayed via `QDN_RESOURCE_DISPLAYED`, so copy-link matches the page the user sees. Optionally maintain `<link rel="canonical">` with the matching `qortal://WEBSITE/<name>/<slug>` form.

---

## 10. Ecosystem and conventions

Well-known **reference Q-Apps** on GitHub (study zip layout and `qortalRequest` usage):

| Project | Repo | Typical services |
|---------|------|------------------|
| Q-Mail | [Qortal/q-mail](https://github.com/Qortal/q-mail) | `MAIL`, `MAIL_PRIVATE` |
| Q-Share | [Qortal/q-share](https://github.com/Qortal/q-share) | `FILE`, `DOCUMENT` |
| Q-Tube | [Qortal/q-tube](https://github.com/Qortal/q-tube) | `VIDEO`, `BLOG_POST` |
| Q-Shop | [Qortal/q-shop](https://github.com/Qortal/q-shop) | `STORE`, `PRODUCT`, payments |

**Cross-app conventions:**

| Identifier / pattern | Used for |
|---------------------|----------|
| `qortal_avatar` + `THUMBNAIL` | User avatar image |
| `myapp_` prefix on identifiers | App-scoped JSON search |
| `BLOG_POST` + Q-Blog identifiers | Blog content blocks |
| `FILE` + `qfile_…` identifiers | File attachments in blog/mail apps |

**Multi-app ecosystems:** Some products publish a **WEBSITE** for visitors plus separate **APP** tools plus **JSON/DOCUMENT** indexes for discovery. Use versioned schema strings in JSON (e.g. `myapp-index-v1`) and document identifiers in your app's README.

---

## 11. Source repos

### 11.1 Gitea (community)

| URL | Use |
|-----|-----|
| [gitea.qortal.link](https://gitea.qortal.link) | Community Gitea — browse and host Qortal-related projects |

Search Gitea for Q-Apps, Hub forks, and site builders. Clone URLs follow `https://gitea.qortal.link/<user>/<repo>.git`.

### 11.2 GitHub (official org)

| Repo | Use |
|------|-----|
| [Qortal/qortal](https://github.com/Qortal/qortal) | Core, **`Q-Apps.md`**, **`q-apps.js`** (timeouts, actions) |
| [Qortal/Qortal-Hub](https://github.com/Qortal/Qortal-Hub) | Desktop Hub |
| [Qortal/qapp-core](https://github.com/Qortal/qapp-core) | Optional npm helpers |
| [Qortal/q-mail](https://github.com/Qortal/q-mail), [q-share](https://github.com/Qortal/q-share), [q-tube](https://github.com/Qortal/q-tube), [q-shop](https://github.com/Qortal/q-shop) | Reference apps |

### 11.3 Official documentation

| URL | Use |
|-----|-----|
| [qortal.dev/docs/q-apps](https://qortal.dev/docs/q-apps) | **`qortalRequest`** reference (authoritative for actions) |
| [api.qortal.org/api-documentation](https://api.qortal.org/api-documentation/) | REST / node API |
| [Q-Apps.md](https://github.com/Qortal/qortal/blob/master/Q-Apps.md) | Protocol: routing, resources, linking |

---

## 12. Pitfalls

| Problem | Fix |
|---------|-----|
| Grey screen / Loading forever | Network tab: `assets/index-*.js` must be **200**; flat zip, `base: "./"` |
| `/assets/...` 404 on APP | Trailing slash / `<base href>` / relative paths |
| Auto `GET_USER_ACCOUNT` on load | Use **Connect** button |
| `btoa(JSON.stringify)` on Unicode | §5.4 UTF-8 safe base64 |
| `SEARCH_*` not an array | Normalize to array |
| Extra fields on search → `[]` | Minimal search payload |
| `JSON` service > 25 KB | Use `FILE` / `DOCUMENT` |
| Unprefixed identifiers | `appslug_type_id` |
| Multi-file publish from Q-App | Use Hub UI; verify version |
| `CREATE_POLL` options as string | **Array** of `{ optionName }` |
| Hardcoded localhost API | Relative `fetch` only |
| External CDN for core JS | Bundle in zip |
| Unsanitized QDN HTML → XSS | Escape / sanitize |
| `Promise.all` on hundreds of fetches | Bounded concurrency |
| Hub iframe wallet isolation | Open in new tab / message relay |
| Mobile blob download | `SAVE_FILE` or `?attachment=true` |
| Overlapping hash prefixes | Parse longest prefix first |
| Payment succeeded, notify failed | Treat payment and notification as separate steps |

---

## 13. Security

- **Never** collect seed phrases or private keys.
- Treat all QDN JSON as **untrusted** — validate schema and sizes.
- Explain publishes, payments, and decrypt actions **before** calling `qortalRequest`.
- Rate-limit retries; distinguish user cancel vs technical errors.

---

## 14. Workflows

### 14.1 New Q-App

1. Choose stack: single HTML vs Vite/React (or similar).
2. Scaffold `index.html`, `manifest.json`, relative paths only.
3. Central bridge module for all `qortalRequest` calls.
4. Connect button → `GET_USER_ACCOUNT` → `GET_ACCOUNT_NAMES` → gate publish.
5. Design identifier scheme + JSON schemas.
6. Reads: `FETCH_QDN_RESOURCE` / `SEARCH_QDN_RESOURCES` with normalization.
7. Writes: `PUBLISH_QDN_RESOURCE` with UTF-8 `data64`.
8. Test: root URL, deep link, no-name wallet, publish propagation delay.
9. Build → flat zip → Hub Preview → publish `APP`.

### 14.2 New WEBSITE (visitor site)

1. Static HTML/CSS/JS, relative paths.
2. Publish via Hub under an owned name → service **`WEBSITE`**.
3. Link: `qortal://WEBSITE/<Name>/...`
4. If the product needs SPA routing and heavy `qortalRequest` use throughout, consider **`APP`** instead (§2).

### 14.3 Inter-app integration

1. Define stable **identifier prefixes** and JSON schema versions.
2. Publish discovery metadata as small **JSON** or **DOCUMENT** resources.
3. Read partner apps via `SEARCH_QDN_RESOURCES` with `prefix: true`.
4. Open partner resources with `qortal://` links or `LINK_TO_QDN_RESOURCE`.
5. Never assume identifier alone proves origin — validate payload shape.

---

## 15. Skeleton

Minimal single-file Q-App (teaching reference):

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>My Q-App</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 1rem; }
    button { min-height: 44px; padding: 0 1rem; }
    pre { white-space: pre-wrap; word-break: break-word; }
    .warn { color: #b45309; }
  </style>
</head>
<body>
  <h1>My Q-App</h1>
  <p id="env" class="warn"></p>
  <button type="button" id="connect">Connect</button>
  <button type="button" id="load" disabled>Load demo JSON</button>
  <pre id="out"></pre>
  <script>
    function qr(payload) {
      const req = window.qortalRequest ?? window.parent?.qortalRequest;
      if (typeof req !== "function") throw new Error("Open inside Qortal Hub");
      return req(payload);
    }
    function b64Utf8(obj) {
      const bytes = new TextEncoder().encode(JSON.stringify(obj));
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      return btoa(bin);
    }

    const env = document.getElementById("env");
    const out = document.getElementById("out");
    const btnConnect = document.getElementById("connect");
    const btnLoad = document.getElementById("load");

    if (typeof qortalRequest !== "function" && typeof window.parent?.qortalRequest !== "function") {
      env.textContent = "Preview: open inside Qortal Hub for live APIs.";
    }

    btnConnect.onclick = async () => {
      out.textContent = "";
      try {
        const acc = await qr({ action: "GET_USER_ACCOUNT" });
        const names = await qr({ action: "GET_ACCOUNT_NAMES", address: acc.address, limit: 10, offset: 0 });
        const primary = Array.isArray(names) && names[0]?.name ? names[0].name : null;
        btnLoad.disabled = !primary;
        out.textContent = JSON.stringify({ address: acc.address, primaryName: primary }, null, 2);
      } catch (e) {
        out.textContent = String(e?.message ?? e);
      }
    };

    btnLoad.onclick = async () => {
      try {
        const acc = await qr({ action: "GET_USER_ACCOUNT" });
        const names = await qr({ action: "GET_ACCOUNT_NAMES", address: acc.address, limit: 1, offset: 0 });
        const name = names?.[0]?.name;
        if (!name) throw new Error("No registered name to publish under.");
        const id = "myapp_demo_" + Date.now();
        await qr({
          action: "PUBLISH_QDN_RESOURCE",
          name,
          service: "JSON",
          identifier: id,
          data64: b64Utf8({ v: 1, hello: "world", ts: Date.now() }),
        });
        const raw = await qr({ action: "FETCH_QDN_RESOURCE", name, service: "JSON", identifier: id });
        out.textContent = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
      } catch (e) {
        out.textContent = String(e?.message ?? e);
      }
    };
  </script>
</body>
</html>
```

---

## 16. LLM system prompt

Paste as system instructions for another model:

```text
You build Qortal Q-Apps: static web apps using qortalRequest for wallet/QDN/signing and relative fetch() for public Core reads.

Official API: https://qortal.dev/docs/q-apps — verify action names against the user's Hub/Core version.
Protocol reference: https://github.com/Qortal/qortal/blob/master/Q-Apps.md
REST reference: https://api.qortal.org/api-documentation/
Community repos: https://gitea.qortal.link and https://github.com/qortal

Rules:
- No <base href> unless deliberately fixing Hub APP path resolution.
- Relative paths (./assets/...) and bundler base "./".
- index.html at zip root; ship fonts/JS in-bundle; no required CDN.
- GET_USER_ACCOUNT only after explicit user gesture. No registered name → explain publish cannot proceed.
- Prefix QDN identifiers with app slug; validate all fetched JSON; UTF-8 safe base64 for publishes.
- Normalize SEARCH_QDN_RESOURCES to an array; minimal search payload if results empty.
- JSON service ≤25 KB; large data → FILE/IMAGE/DOCUMENT.
- try/catch all qortalRequest; never handle seeds/private keys.
- Preview mode when bridge missing — mock reads only, never fake payments.
- WEBSITE = 404 on bad paths; APP = SPA fallback to index.html.
- Mobile: SAVE_FILE for blob downloads when anchor download fails.
```

---

## Maintenance

- Bump **revision date** when Core/Hub changes `qortalRequest` contracts materially.
- Re-check multi-file publish support after major Hub releases.
- Keep links to [qortal.dev](https://qortal.dev/docs/q-apps), [api.qortal.org](https://api.qortal.org/api-documentation/), and [gitea.qortal.link](https://gitea.qortal.link) current.

---

*End of guide.*
