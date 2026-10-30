# GO 3.0 widgets — how to build them

This is the complete contract for **GO 3.0 widgets**: small Q-Apps that GO
shows on its widgets screen (the screen left of Home on phones). It is
written so an AI coding agent can build a working widget from it alone, and
so a person can turn an existing Q-App or website into one.

Part 1 is the contract. Part 2 is building a new widget. Part 3 is adjusting
an existing Q-App or website. Part 4 is a checklist to verify against.

---

## Part 1 — The contract

### 1.1 What a widget is

- A normal Qortal **Q-App** (QDN service `APP`), loaded by GO in a small
  frame on the widgets screen.
- The user picks widgets from GO's **Add a widget** list. Nothing runs until
  the user adds it.
- The user can **move** and **resize** every widget on a grid at any time.
  Your widget must look right at any size it allows (see 1.4).
- It shows things and opens apps. It **cannot** pay, publish, sign, decrypt,
  send messages, save files, show notifications, open dialogs or take the
  whole screen (see 1.6).

### 1.2 How GO finds widgets (publishing rules)

GO lists an `APP` resource as a widget when **either** is true:

| Rule | Example | Notes |
| --- | --- | --- |
| **Identifier starts with `go-widget`** (recommended) | `APP / Torq / go-widget-news` | Lets a name publish its widget **next to its main app** without registering another name. Qortal Core filters this on the node (identifier prefix search), so it is the fast path. |
| **Tagged `go-widget`** (any letter case) | `APP / Clock`, tags: `go-widget` | Works for a name whose default APP *is* the widget. GO finds tags by reading every APP's metadata (Core has no tag filter), so it is slower to discover. |

Use both if you can: identifier `go-widget-<slug>` **and** tag `go-widget`.

- `<slug>`: lowercase letters, digits and `-`, e.g. `go-widget-weather`.
  One name can publish several widgets (`go-widget-clock`,
  `go-widget-weather`, …).
- **Title** and **description** (QDN metadata) are what the picker shows.
  Keep the title short (≤ 24 chars) and the description to one sentence.
- The **icon** is the publishing name's QDN avatar (`qortal_avatar`).
- Only `APP` is listed. A `WEBSITE` resource is never a widget; publish the
  widget page as an `APP` instead (Part 3.4).
- Blocked names are left out by the node.

Publishing from code (any Qortal UI that supports `qortalRequest`):

```js
await qortalRequest({
  action: 'PUBLISH_QDN_RESOURCE',
  service: 'APP',
  name: 'YourName',
  identifier: 'go-widget-clock', // the widget's own slot, beside your app
  title: 'GO Clock',
  description: 'The time and date, at a glance.',
  tag1: 'go-widget',
  file: zipBlob, // zip of the widget folder, index.html at its root
});
```

Or use the Hub's publish screen with the same identifier, title, description
and tag.

### 1.3 How GO loads a widget

GO loads the widget from the node the user is on:

```
<node>/render/APP/<name>?theme=<dark|light>&lang=<code>&identifier=<identifier or empty>&goWidget=1
```

- `goWidget=1` is always there in GO's widgets screen. Read it on start and
  render your widget view from the first frame (no flash of a full app).
- `theme` is `dark` or `light`; `lang` is GO's language code
  (`en`, `de`, `es`, `et`, `fi`, `fr`, `it`, `ja`, `pt`, `ru`, `zh`, `ar`).
- The frame sits on GO's own card (rounded corners, 16 px radius, GO's card
  colour). **Keep your page background transparent** so it blends in.
- Core injects `qortalRequest` into the page as for every Q-App.

### 1.4 Size and the grid

The widgets screen is a grid of **4 columns** and **40 px rows** with
**12 px gaps**. A widget is `w × h` cells:

- width: 1 to 4 columns; height: 2 to 14 rows.
- New widgets start full width, 5 rows, until the widget or the user sizes
  them.
- The grid is at most 560 px wide, minus 12 px on each side of the screen.

Pixel sizes on a common 375 px wide phone (column ≈ 79 px):

| Cells | Width × height (CSS px) |
| --- | --- |
| 1 × 2 (smallest) | 79 × 92 |
| 2 × 2 | 170 × 92 |
| 2 × 3 | 170 × 144 |
| 2 × 4 | 170 × 196 |
| 4 × 3 | 351 × 144 |
| 4 × 5 (default) | 351 × 248 |
| 4 × 8 | 351 × 404 |
| 4 × 14 (tallest) | 351 × 716 |

Height in px = `rows × 40 + (rows − 1) × 12`.

**The user can resize your widget at any time.** Design it to fill whatever
it gets: use `vw` / `vh` / `min()` / `clamp()` (the frame is your viewport),
or listen to `resize`. Hide details that do not fit instead of overflowing.

#### Asking for your natural size

Tell GO the size that suits you best, once, after you start:

```js
const { applied } = await qortalRequest({
  action: 'GO_WIDGET_SET_SIZE',
  width: 'half', // 'small' (1 column), 'half' (2), 'full' (4); optional
  height: 140, // CSS px you need; GO rounds up to whole rows
});
```

- GO takes it **only until the user resizes the widget**. After that,
  `applied` is `false` and the user's size stays.
- GO remembers the size, so it comes back at that size next time.
- Call it once on start, or when your content's natural size really
  changes. Never call it in a loop or per animation frame.

#### Asking what GO knows

```js
const info = await qortalRequest({ action: 'GO_WIDGET_INFO' });
// {
//   widget: true, platform: 'GO 3.0',
//   theme: 'dark', language: 'en', visible: true,
//   width: 170, height: 144,        // the frame now, CSS px
//   columns: 2, rows: 3,            // its cells now
//   gridColumns: 4, minRows: 2, maxRows: 14,
//   sizedBy: 'default' | 'widget' | 'user',
// }
```

`GO_WIDGET_INFO` and `GO_WIDGET_SET_SIZE` only work in GO's widgets screen.
Anywhere else (the Hub, a Q-App tab) they may fail **or never answer**. So:
only send them when `goWidget=1` is in the address, never wait for them
before drawing, and give any answer you need a timeout:

```js
const withTimeout = (promise, ms = 1500) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(reject, ms))]);
const info = await withTimeout(qortalRequest({ action: 'GO_WIDGET_INFO' })).catch(() => null);
```

### 1.5 Messages GO sends you

Listen with `window.addEventListener('message', …)` and read `event.data`:

| `action` | Data | When |
| --- | --- | --- |
| `GO_WIDGET_VISIBILITY` | `payload: { visible: boolean }` | The widgets screen came into view or left it (or GO went to the background). Pause timers, animations and polling while `false`. Also sent right after you load. |
| `THEME_CHANGED` | `theme: 'dark' \| 'light'` | The user switched theme. Also sent right after you load. |
| `LANGUAGE_CHANGED` | `language: string` | The user switched language. Also sent right after you load. |

Also respect `document.visibilityState`.

### 1.6 What a widget may ask GO for

Read-only requests that Core answers inside your frame work as in any Q-App:
`SEARCH_QDN_RESOURCES`, `FETCH_QDN_RESOURCE`, `GET_QDN_RESOURCE_URL`,
`GET_QDN_RESOURCE_STATUS`, `GET_QDN_RESOURCE_PROPERTIES`,
`GET_QDN_RESOURCE_METADATA`, `LIST_QDN_RESOURCES`, `GET_ACCOUNT_DATA`,
`GET_ACCOUNT_NAMES`, `GET_NAME_DATA`, `SEARCH_NAMES`, `GET_BALANCE`,
`GET_PRICE`, `LIST_GROUPS`, `SEARCH_CHAT_MESSAGES`, `SEARCH_TRANSACTIONS`,
`FETCH_BLOCK`, `FETCH_BLOCK_RANGE`, `LIST_ATS`, `GET_AT`, `GET_AT_DATA`.

Requests that reach GO are filtered for widgets:

| Allowed | Requests |
| --- | --- |
| Always | `GO_WIDGET_SET_SIZE`, `GO_WIDGET_INFO`, `GET_NODE_INFO`, `GET_NODE_STATUS`, `IS_USING_PUBLIC_NODE`, `WHICH_UI`, `GET_PRIMARY_NAME`, `GET_DAY_SUMMARY`, `GET_TX_ACTIVITY_SUMMARY`, `GET_FOREIGN_FEE`, `GET_CROSSCHAIN_SERVER_INFO`, `LINK_TO_QDN_RESOURCE`, `QDN_RESOURCE_DISPLAYED`, `NAVIGATION_HISTORY` |
| Only while the widgets screen is showing | `OPEN_NEW_TAB`, `SET_TAB`, `OPEN_USER_LOOKUP`, `GET_USER_ACCOUNT`, `GET_WALLET_BALANCE` (the last two ask the user, as in any Q-App) |
| **Never** | Everything else, including `SEND_COIN`, `PUBLISH_QDN_RESOURCE`, `PUBLISH_MULTIPLE_QDN_RESOURCES`, `SIGN_TRANSACTION`, `ENCRYPT_*`, `DECRYPT_*`, `SEND_CHAT_MESSAGE`, `SAVE_FILE`, `NOTIFICATION_*`, `SET_FULL_SCREEN`, all trade, name, group and list-changing requests, and any unknown action |

A refused request fails with an error whose message starts with
`Not available in GO widgets` (or `The widgets screen is not showing.`).
For anything refused, **open your full app** and do it there:

```js
await qortalRequest({
  action: 'OPEN_NEW_TAB',
  qortalLink: 'qortal://APP/YourApp/path/inside/your/app',
});
```

This switches GO to Apps with your app open at that path.

### 1.7 The frame's limits

The frame is sandboxed with `allow-scripts allow-same-origin allow-forms`
only, and no feature permissions:

- no `alert` / `confirm` / `prompt` (they do nothing): use inline UI;
- no pop-up windows, no downloads, no full screen, no clipboard;
- no camera, microphone or location.

### 1.8 Touches

- Taps, typing and vertical scrolling go to your widget.
- **Sideways swipes belong to GO**: they switch between the widgets screen,
  Home, Apps and Chat. GO takes a swipe once it is clearly sideways (10 px,
  wider than tall) and your page gets a `touchcancel`. **Do not build
  sideways carousels or swipe gestures.** Use buttons or vertical lists.
- **Long presses belong to GO** too: holding a widget picks it up so the
  user can move it, drop it on Remove, or add others (your page gets a
  `touchcancel` at 400 ms). Don't rely on long-press menus.
- While the user arranges the screen, your widget gets no touches at all.

### 1.9 Lifetime

- GO loads widgets the first time the widgets screen is shown, not at start.
- GO unloads them about **3 minutes** after the screen was last seen, and
  loads them again when the user comes back. The user can also reload a
  widget from its menu.
- So **start fast** (show something within ~300 ms), and keep anything the
  user set (a city, a choice) in `localStorage`.
- **localStorage is shared** by every Q-App rendered from the same node.
  Prefix every key with your own name, e.g. `yourname.clock.hour12`.

### 1.10 Privacy and security rules

- Load your code and data from your bundle and from QDN. **Do not call
  outside web services**: they may be blocked, and they leak the user's IP
  address and activity.
- Ask only for what you show. Don't ask for the user's address
  (`GET_USER_ACCOUNT`) unless the widget is about their account.
- Never put user data in links, identifiers or anything you publish
  elsewhere.

---

## Part 2 — Building a new widget

### 2.1 Folder

```
go-widget-yourwidget/
  index.html     # everything can live here for a small widget
  (assets…)      # optional: icons, a small JS bundle
```

Zip the folder (with `index.html` at the zip's root) and publish it as in
1.2. A single HTML file with inline CSS and JS is ideal: it starts fastest.

### 2.2 Template

Copy this and change the marked parts. It handles theme, language,
visibility, sizing, and works outside GO too.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Your widget</title>
    <style>
      :root { --fg: #f2f4f8; --muted: rgba(242,244,248,.62); --accent: #7aa7f7; }
      :root[data-theme='light'] { --fg: #15181e; --muted: rgba(21,24,30,.6); --accent: #2f6fe0; }
      html, body {
        margin: 0; height: 100%; overflow: hidden;
        background: transparent;               /* GO's card shows behind */
        color: var(--fg);
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        -webkit-tap-highlight-color: transparent;
      }
      main {
        box-sizing: border-box; height: 100%; padding: 10px;
        display: flex; flex-direction: column; justify-content: center;
        font-size: clamp(11px, min(8vw, 16vh), 32px); /* scales with size */
      }
      .small-only { display: none; }
      @media (max-height: 120px) { .details { display: none; } }
    </style>
  </head>
  <body>
    <main id="root"><!-- CHANGE: your markup --></main>
    <script>
      (() => {
        const params = new URLSearchParams(location.search);
        const inGo = params.get('goWidget') === '1';
        let lang = params.get('lang') || navigator.language || 'en';
        const setTheme = (t) =>
          (document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark');
        setTheme(params.get('theme'));

        // qortalRequest from Core; a direct message to GO in local tests.
        const request = (data) =>
          typeof window.qortalRequest === 'function'
            ? window.qortalRequest(data)
            : new Promise((resolve, reject) => {
                const ch = new MessageChannel();
                ch.port1.onmessage = ({ data: a }) => {
                  ch.port1.close();
                  a && a.error ? reject(a.error) : resolve(a && a.result);
                };
                parent.postMessage({ ...data, requestedHandler: 'UI' }, '*', [ch.port2]);
              });

        let visible = true;
        let timer = null;

        async function refresh() {
          // CHANGE: fetch from QDN and draw. Keep it light.
        }

        function schedule() {
          clearTimeout(timer);
          if (!visible || document.visibilityState === 'hidden') return;
          refresh();
          timer = setTimeout(schedule, 60_000); // CHANGE: how often, ≥ 30 s for data
        }

        addEventListener('message', ({ data }) => {
          if (!data) return;
          if (data.action === 'GO_WIDGET_VISIBILITY') {
            visible = Boolean(data.payload && data.payload.visible);
            schedule();
          } else if (data.action === 'THEME_CHANGED') {
            setTheme(data.theme);
          } else if (data.action === 'LANGUAGE_CHANGED' && data.language) {
            lang = data.language;
            refresh();
          }
        });
        document.addEventListener('visibilitychange', schedule);

        schedule();
        if (inGo) {
          // CHANGE: your natural size.
          request({ action: 'GO_WIDGET_SET_SIZE', width: 'half', height: 140 }).catch(() => {});
        }
      })();
    </script>
  </body>
</html>
```

A complete working example is the **GO Clock** widget,
`tools/preview/fake-node/render/APP/GOClock.html` in this repo (publish it as
`APP / <your name> / go-widget-clock`).

### 2.3 Common patterns

**Latest items from QDN, tap to open the full app:**

```js
async function refresh() {
  const items = await qortalRequest({
    action: 'SEARCH_QDN_RESOURCES',
    service: 'DOCUMENT',          // CHANGE: where your app keeps its posts
    identifier: 'yourapp-post-',  // CHANGE: your identifier prefix
    prefix: true,
    includeMetadata: true,
    excludeBlocked: true,
    limit: 5,
    reverse: true,                // newest first
  });
  const list = document.getElementById('root');
  list.replaceChildren(
    ...items.map((item) => {
      const row = document.createElement('button');
      row.className = 'row';
      row.textContent = item.metadata?.title || item.identifier;
      row.onclick = () =>
        qortalRequest({
          action: 'OPEN_NEW_TAB',
          qortalLink: `qortal://APP/YourApp/post/${encodeURIComponent(item.name)}/${encodeURIComponent(item.identifier)}`,
        }).catch(() => {});
      return row;
    })
  );
}
```

Keep rows at least 40 px tall so they are easy to tap, and show only what
fits: `items.slice(0, Math.floor(innerHeight / 44))`.

**A user setting (e.g. a city):** a small inline form inside the widget
(inputs work), saved to `localStorage` under your prefixed key. No dialogs.

**Empty or error state:** always draw something useful: a short line of
text, never a blank frame or a spinner that never ends.

### 2.4 Testing

1. Open your widget in a browser or the Hub as a normal app with
   `?goWidget=1&theme=dark` (and `light`) added to its address, at several
   window sizes (from 79 × 92 up to 351 × 716).
2. Publish it (1.2), then in GO: swipe right to the widgets screen →
   **+** → find it → **Add**. Check it starts quickly, follows theme
   changes (Settings), and pauses when you leave the screen.
3. Hold it (or an empty spot) to arrange: resize it to its smallest and
   largest sizes, move it, and drag it onto **Remove**.
4. Swipe sideways across it: GO should switch screens, never your widget.

---

## Part 3 — Making an existing Q-App or website widget-friendly

### 3.1 Choose an approach

| Approach | When | How |
| --- | --- | --- |
| **A. A separate small widget beside your app** (recommended) | Your app is big, or a widget is a small slice of it | New folder, small page, publish as `APP / YourName / go-widget-<slug>`. Reuse your data code; don't reuse the whole UI. |
| **B. A widget mode inside your app** | Your app is already small and fast | Keep one resource; when `goWidget=1` is in the address, render a compact view. Tag the app `go-widget`. |

Approach A is better for almost everyone: GO loads the widget often (each
visit after it was unloaded), so a small page starts fast and saves battery,
and your main app stays exactly as it is.

### 3.2 Approach A — step by step

1. Pick the one thing worth seeing at a glance (latest posts, a balance, a
   status, the next event).
2. Start from the template (2.2). Copy only the functions that fetch that
   data from QDN; leave routing, menus and heavy libraries out.
3. Turn every action into `OPEN_NEW_TAB` with a `qortal://APP/YourApp/...`
   link into your full app (to read a post, reply, pay, publish).
4. Publish with identifier `go-widget-<slug>`, tag `go-widget`, a short
   title and one-line description, under the same name as your app (so it
   shows your app's icon).

### 3.3 Approach B — step by step

1. Detect the mode once, at start:

   ```js
   const isGoWidget = new URLSearchParams(location.search).get('goWidget') === '1';
   ```

   In React: `if (isGoWidget) return <WidgetView />;` at the top of your app,
   before routers, layouts and providers you don't need.
2. In widget mode:
   - transparent background, no app bar, no side menu, no footer;
   - no splash screen or intro; draw from cache first, refresh after;
   - fill the frame and adapt to its size (1.4);
   - no sideways carousels or swipes (1.8), no `alert`/`confirm` (1.7);
   - any action → `OPEN_NEW_TAB` to your full app without `goWidget`;
   - pause timers on `GO_WIDGET_VISIBILITY` (1.5).
3. Remove requests your widget view would make that are refused in widgets
   (1.6), or the view must handle them failing.
4. Add the tag `go-widget` to your app's metadata and publish.
5. Check bundle size: if your app takes more than ~1 s to show on a phone,
   use Approach A instead.

### 3.4 Websites (`WEBSITE` resources)

GO lists only `APP` resources as widgets. For a QDN website:

1. Make a small page for the widget view (2.2). Static HTML and CSS are
   fine; `qortalRequest` is available when it is rendered by a node.
2. Publish that page as an **`APP`** under your website's name, identifier
   `go-widget-<slug>`, tag `go-widget`.
3. Links to your full site: `qortal://WEBSITE/YourSite/path` with
   `OPEN_NEW_TAB`.
4. Don't embed outside web content or scripts (1.10).

### 3.5 Converting with an AI agent

Give the agent this file and your app's source, and ask for exactly this:

> Read `go-widgets.md`. Build a GO 3.0 widget for this app using
> Approach A (or B). It must: render from `goWidget=1` on the first frame;
> keep a transparent background; follow `theme`/`lang` and the
> `THEME_CHANGED`, `LANGUAGE_CHANGED` and `GO_WIDGET_VISIBILITY` messages;
> fit any size from 79 × 92 to 351 × 716 px; ask once for its natural size
> with `GO_WIDGET_SET_SIZE`; use only the requests allowed in section 1.6;
> open the full app with `OPEN_NEW_TAB` for every action; have no sideways
> or long-press gestures, dialogs or outside web requests; and pass the checklist in
> Part 4. Output the widget folder and the publish settings (service APP,
> identifier `go-widget-<slug>`, tag `go-widget`, title, description).

---

## Part 4 — Checklist

Must:

- [ ] Published as `APP`, identifier starting with `go-widget` and/or tag
      `go-widget`; short title; one-line description.
- [ ] Renders the widget view when `goWidget=1` is in the address, from the
      first frame.
- [ ] Transparent page background; follows `theme` and `THEME_CHANGED`.
- [ ] Looks right at 79 × 92, 170 × 144, 351 × 248 and 351 × 716 px: nothing
      cut off mid-text, nothing overflowing, no scrollbars unless it is a
      vertical list.
- [ ] Pauses timers, animations and polling while not visible
      (`GO_WIDGET_VISIBILITY`, `document.visibilityState`).
- [ ] Uses only requests allowed in 1.6; handles a refused or failing
      request without breaking.
- [ ] Every action that changes something opens the full app with
      `OPEN_NEW_TAB`.
- [ ] No sideways swipe gestures or carousels, no long-press actions; no
      `alert`/`confirm`/`prompt`.
- [ ] No requests to outside web services.
- [ ] Shows something useful within ~300 ms of loading; has an empty and an
      error state.
- [ ] `localStorage` keys prefixed with your name.

Should:

- [ ] Asks once for its natural size with `GO_WIDGET_SET_SIZE`.
- [ ] Follows `lang` / `LANGUAGE_CHANGED`.
- [ ] Polls no more often than every 30 s (once a minute is better).
- [ ] Tap targets at least 40 px tall.
- [ ] Bundle under ~200 KB.
