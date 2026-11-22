# GO widgets — one widget for Qortal GO and Qortal Hub

Widgets are small Q-Apps that people put on the **widgets screen of Qortal
GO** (phones) and on the **Home screen of Qortal Hub** (desktop). One
published widget runs in both.

This guide is complete on its own. Give it to a person or an AI coding agent
together with a short description of the widget you want (Part 0), and it
has everything needed to build, test and publish it: for a new idea, for
your own app, or for an app or QDN website someone else made (Q-Tube, Torq,
Subscreen, Subwire, …).

| Part | What                                                           |
| ---- | -------------------------------------------------------------- |
| 0    | The widget brief: what you describe                            |
| 1    | The rules GO and the Hub both follow                           |
| 2    | Building a widget, from a tested template                      |
| 3    | Widgets for existing Q-Apps and websites, with notes on apps   |
| 4    | Testing                                                        |
| 5    | Publishing                                                     |
| 6    | Checklist                                                      |

Checked against Qortal Core 6.1.9, GO 3.0 and a Qortal Hub build with Home
widgets, November 2026. Hub versions without Home widgets don't show widgets.

---

## Part 0 — The widget brief

Whoever builds the widget needs these answers. Copy the block, fill it in,
and hand it over with this file. An agent asks about anything missing, and
**never guesses an app's data format**: it looks it up (Part 3.2).

```text
WIDGET BRIEF
For:          <an existing app or QDN website, e.g. Q-Tube; or "new">
Shows:        <what, e.g. "the newest videos: thumbnail, title, channel">
Tap:          <what a tap opens, e.g. "that video in Q-Tube">
Size:         <small (1 column) | half (2) | full (4)>, about <N> px tall
When smaller: <what to drop first, e.g. "thumbnails, then channel names">
Look:         <colours, fonts, layout, in dark and light>
Updates:      <how often while visible, e.g. every 5 minutes>
Settings:     <anything picked inside the widget, e.g. a channel; or none>
Languages:    <English | all 12 GO languages | …>
Publish as:   <your name> / go-widget-<slug>
Title:        <24 characters at most>
Description:  <one sentence>
```

---

## Part 1 — The rules

### 1.1 What a widget is

- A normal Qortal **Q-App** (QDN service `APP`), loaded in a small frame.
- The user adds it from a list: in GO, the widgets screen (left of Home) →
  **+**; in the Hub, **Home → Widgets → Add widget**. Nothing runs until the
  user adds it.
- The user can **move** and **resize** it at any time, so it must look right
  at every size it can get (1.6).
- It shows things and opens apps. It **cannot** pay, publish, sign, decrypt,
  send messages, save files, show notifications, open dialogs or take the
  whole screen (1.8).

### 1.2 GO and the Hub side by side

|                        | Qortal GO (Android)                                             | Qortal Hub (desktop)                                            |
| ---------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| Where                  | widgets screen, left of Home                                    | Home → Widgets (Settings → Modules → Widgets turns it off)      |
| Frame                  | an `<iframe>` in GO: `window.parent` is GO                      | a top-level isolated page: `window.parent === window`           |
| Grid                   | 4 columns, about 79 px each on a 375 px phone                   | as many columns as fit, each at least 84 px                     |
| Widget width           | 1 to 4 columns                                                  | 1 column up to the whole width of Home                          |
| Widget height          | 2 to 14 rows of 40 px, 12 px gaps                               | the same                                                        |
| New widgets            | 4 columns × 5 rows                                              | the same                                                        |
| How many               | up to 12                                                        | up to 8                                                         |
| Input                  | touch; sideways swipes and long presses belong to GO            | mouse and keyboard; moving and resizing happen in **Arrange**   |
| Hidden when            | the widgets screen is not showing, or GO is in the background   | Home is not showing, or the widget is scrolled out of view      |
| Loads                  | a few seconds after GO starts, out of sight; stays loaded       | when Home first shows, 250 ms apart; stays loaded               |
| `localStorage`         | one for every Q-App on the node                                 | one per app name                                                |
| `GO_WIDGET_INFO`       | `platform: 'GO 3.0'`                                            | `platform: 'Qortal Hub'`                                        |
| A refused request      | rejects with a text                                             | rejects with `{ code, message }`                                |
| Your files             | kept on the phone; a new publish is fetched within an hour      | served by the node                                              |

Everything else in this guide is the same in both.

### 1.3 How widgets are found

An `APP` resource is listed as a widget when it is **tagged `go-widget`**
(any letter case). Give it an identifier starting with `go-widget` too, for
example `APP / Torq / go-widget-news`:

- a name can publish widgets **next to its main app** without registering
  another name;
- Core filters identifier prefixes on the node, so the lists find these
  fast. Core has no tag filter, so other identifiers are only found by
  reading every APP's metadata.

So publish with identifier `go-widget-<slug>` **and** the tag `go-widget`.

- `<slug>`: lowercase letters, digits and `-`, e.g. `go-widget-weather`.
  One name can publish several widgets.
- **Title** and **description** (QDN metadata) are what the list shows.
  Keep the title to 24 characters and the description to one sentence.
- The **icon** is the publishing name's avatar (`qortal_avatar`).
- Only `APP` is listed. A `WEBSITE` is never a widget; publish the widget
  page as an `APP` (3.4).
- Names blocked on the node are left out.

**Retiring a widget:** republish it under the same name and identifier
**without** the `go-widget` tag, for example as a "moved" notice. It leaves
the list, but everyone who already added it keeps loading it, since added
widgets are loaded by name and identifier.

### 1.4 How a widget is loaded

Both hosts load the widget from the node the user is on:

```text
<node>/render/APP/<name>?theme=<dark|light>&lang=<code>&identifier=<identifier or empty>&goWidget=1
```

- `goWidget=1` is always there. Draw the widget view from the first frame
  (no splash screen, no flash of a full app).
- `theme` is `dark` or `light`. `lang` is one of `en`, `de`, `es`, `et`,
  `fi`, `fr`, `it`, `ja`, `pt`, `ru`, `zh`, `ar`.
- Core adds to the top of your page, in GO and the Hub alike:
  - `qortalRequest` and `qortalRequestWithTimeout` (1.5);
  - the variables `_qdnName`, `_qdnIdentifier`, `_qdnTheme`, `_qdnLang` and
    `_qdnBase` (`/render/APP/<name>`);
  - `<base href="/render/APP/<name>/">`, so relative paths load files from
    your own bundle.
- **Keep the page background transparent.** The host draws the card behind
  it (GO: rounded corners and GO's card colour).

### 1.5 Talking to the host: always Core's `qortalRequest`

Core's script declares `qortalRequest` as a global `const`. It is a global
name, but **not** a property of `window`: `window.qortalRequest` is
`undefined`. Call it by its bare name.

Core answers the read-only requests itself (1.8) and passes every other
request on to `window.parent`: that is GO in GO, and the page itself in the
Hub, where the Hub's bridge picks it up. So the same call works in both.
Don't post requests to `window.parent` yourself, and don't give up when
`window.parent === window` (that is normal in the Hub).

```js
// Core's qortalRequest; a direct message only when Core is missing
// (a page opened as a local file).
function ask(request, timeoutMs) {
  const answer =
    typeof qortalRequest === 'function'
      ? qortalRequest(request)
      : new Promise((resolve, reject) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = ({ data }) => {
            channel.port1.close();
            data && data.error ? reject(data.error) : resolve(data && data.result);
          };
          window.parent.postMessage({ ...request, requestedHandler: 'UI' }, '*', [channel.port2]);
        });
  if (!timeoutMs) return answer;
  const late = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs));
  return Promise.race([answer, late]);
}
```

In TypeScript, declare it: `declare const qortalRequest: ((r: object) => Promise<any>) | undefined;`

Core gives every request a time limit: 30 s for most, 60 s for
`FETCH_QDN_RESOURCE`, up to an hour for requests that ask the user.

### 1.6 Size

Both hosts use rows of **40 px** with **12 px** gaps: a widget is 2 to 14
rows tall, `rows × 40 + (rows − 1) × 12` px. Widths differ:

- **GO:** 4 columns. On a 375 px phone a column is about 79 px; the grid is
  at most 560 px wide.
- **Hub:** as many columns as fit, each at least 84 px (about 90–100 px in
  a typical window). A widget can be stretched across all of them, so it can
  be **much wider than a phone**.

| Cells            | GO, 375 px phone | Hub, typical window (about) |
| ---------------- | ---------------- | --------------------------- |
| 1 × 2 (smallest) | 79 × 92          | 92 × 92                     |
| 2 × 3            | 170 × 144        | 197 × 144                   |
| 2 × 4            | 170 × 196        | 197 × 196                   |
| 4 × 5 (new)      | 351 × 248        | 406 × 248                   |
| 4 × 14 (tallest) | 351 × 716        | 406 × 716                   |
| 8 × 5            | —                | 830 × 248                   |

**Fill whatever you get.** The frame is your viewport: use `innerWidth` /
`innerHeight`, media queries, `vw` / `vh`, `clamp()`. Show fewer items or
drop details when it is small; use the room (for example two columns) when
it is wide. Never overflow or show a scrollbar, except in a vertical list.

#### Asking for your natural size

```js
ask({ action: 'GO_WIDGET_SET_SIZE', width: 'half', height: 196 }, 3000).catch(() => {});
// → { applied: true | false }
```

- `width`: `'small'` (1 column), `'half'` (2) or `'full'` (4); optional.
  `height`: the CSS px you need, rounded up to whole rows.
- It is taken **only until the user resizes** the widget; after that
  `applied` is `false` and the user's size stays. The host remembers the
  size for next time.
- Ask once at start, or when your natural size really changes. Never in a
  loop.

#### Reading the frame

```js
const info = await ask({ action: 'GO_WIDGET_INFO' }, 3000).catch(() => null);
// { widget: true, platform: 'GO 3.0' | 'Qortal Hub', theme, language, visible,
//   width, height,          // the frame now, CSS px
//   columns, rows,          // its cells now
//   gridColumns,            // GO: 4; Hub: the columns Home has now
//   minRows: 2, maxRows: 14, sizedBy: 'default' | 'widget' | 'user' }
```

Both only answer inside a widget frame. Elsewhere (an app tab, a browser)
nobody answers, so send them only when `goWidget=1` is in the address, never
wait for them before drawing, and always give them a short time limit.

### 1.7 Messages the host sends

Listen with `addEventListener('message', …)` and read `event.data`:

| `action`               | Data                            | When                                                       |
| ---------------------- | ------------------------------- | ---------------------------------------------------------- |
| `GO_WIDGET_VISIBILITY` | `payload: { visible: boolean }` | The widget can be seen, or not any more (1.2, Hidden when) |
| `THEME_CHANGED`        | `theme: 'dark' \| 'light'`      | The user switched theme                                    |
| `LANGUAGE_CHANGED`     | `language: string`              | The user switched language                                 |

Treat them as **changes**. Read `theme` and `lang` from the address (or
`_qdnTheme` / `_qdnLang`) when you start, and assume you are visible: the
Hub sends its first messages as the page starts, which can be before your
script runs. Pause timers, animations and polling while `visible` is
`false`, and also while `document.visibilityState` is `hidden`.

### 1.8 What a widget may ask for

**Read-only requests that Core answers inside the page** work as in any
Q-App, in both hosts:

`SEARCH_QDN_RESOURCES`, `FETCH_QDN_RESOURCE`, `LIST_QDN_RESOURCES`,
`GET_QDN_RESOURCE_URL`, `GET_QDN_RESOURCE_STATUS`,
`GET_QDN_RESOURCE_PROPERTIES`, `GET_QDN_RESOURCE_METADATA`,
`GET_ACCOUNT_DATA`, `GET_ACCOUNT_NAMES`, `GET_NAME_DATA`, `SEARCH_NAMES`,
`GET_BALANCE`, `GET_PRICE`, `LIST_GROUPS`, `SEARCH_CHAT_MESSAGES`,
`SEARCH_TRANSACTIONS`, `FETCH_BLOCK`, `FETCH_BLOCK_RANGE`, `LIST_ATS`,
`GET_AT`, `GET_AT_DATA`.

The same public data can be read with plain same-origin `fetch` from the
node's API (`/arbitrary/resources/search?…`, `/arbitrary/<service>/<name>/<identifier>`,
`/names/<name>`, …), since the widget is loaded from the node.

**Requests that reach the host** are filtered the same way in GO and the Hub:

| Allowed                          | Requests                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Always                           | `GO_WIDGET_SET_SIZE`, `GO_WIDGET_INFO`, `GET_NODE_INFO`, `GET_NODE_STATUS`, `IS_USING_PUBLIC_NODE`, `WHICH_UI`, `GET_PRIMARY_NAME`, `GET_DAY_SUMMARY`, `GET_TX_ACTIVITY_SUMMARY`, `GET_FOREIGN_FEE`, `GET_CROSSCHAIN_SERVER_INFO`, `QDN_RESOURCE_DISPLAYED`, `NAVIGATION_HISTORY`, `LINK_TO_QDN_RESOURCE` (but see below) |
| Only while the widget is showing | `OPEN_NEW_TAB`, `SET_TAB`, `OPEN_USER_LOOKUP`, `GET_USER_ACCOUNT`, `GET_WALLET_BALANCE` (the last two ask the user, as in any Q-App: only ask after a tap)                                                                                                                                                  |
| **Never**                        | Everything else: payments, publishing (`PUBLISH_*`), signing, encryption and decryption, chat messages, files (`SAVE_FILE`), notifications, lists, trades, names, groups, full screen, Reticulum, and any unknown action                                                                                    |

A refused request rejects. In GO the reason is a text starting with
`Not available in GO widgets` (or `The widgets screen is not showing.`); in
the Hub it is an object with `code: 'WIDGET_REQUEST_NOT_ALLOWED'` (or
`'WIDGET_NOT_ON_SCREEN'`) and a `message`. Don't parse it: catch it, keep
the widget working, and for anything refused **open the full app**.

#### Opening an app

```js
ask({ action: 'OPEN_NEW_TAB', qortalLink: 'qortal://APP/Q-Tube/some/path' }).catch(() => {});
```

- GO switches to Apps and the Hub to its Apps view, with that app open at
  that path.
- Links: `qortal://APP/<app name>/<path>` and
  `qortal://WEBSITE/<site name>/<path>`. Put names through
  `encodeURIComponent` (both hosts decode them). Add
  `?identifier=<identifier>` for an app published under an identifier.
- **Don't use `LINK_TO_QDN_RESOURCE` in a widget.** When the host doesn't
  answer it within 200 ms, Core falls back to loading the other app inside
  the widget's own frame.

### 1.9 The frame's limits

- GO: `<iframe sandbox="allow-scripts allow-same-origin allow-forms">`, no
  feature permissions.
- Hub: an isolated page with the Hub's Q-App rules (its own storage,
  navigation only inside `/render/APP/<your name>`, no pop-ups).
- So in both: no `alert` / `confirm` / `prompt` (use inline UI), no pop-up
  windows, downloads, full screen or clipboard, no camera, microphone or
  location.

### 1.10 Input

- **GO (touch):** taps, typing and vertical scrolling go to the widget.
  **Sideways swipes belong to GO** (they switch screens): once a swipe is
  clearly sideways your page gets a `touchcancel`. **Long presses belong to
  GO** too: holding a widget picks it up for arranging (`touchcancel` at
  400 ms).
- **Hub (mouse and keyboard):** clicks, typing and the wheel go to the
  widget. While the user arranges Home, the widget gets no input.
- So: **no sideways carousels or swipe gestures, no long-press menus.** Use
  buttons and vertical lists. Tap targets at least 40 px tall.

### 1.11 Lifetime, updates and speed

- Widgets stay loaded for hours while mostly unseen: **pause** whenever
  they are hidden (1.7), and when they show again refresh without blanking
  what is already there.
- **Start fast:** show something within about 300 ms. Keep the last data in
  `localStorage` and draw it at once, then refresh.
- Poll no more often than every 30 s (every few minutes is better for most
  data), and not at all while hidden.
- **GO keeps the widget's files on the phone** (up to 400 files and 20 MB),
  so it opens even when the node has dropped the app. GO checks for a newer
  publish at most once an hour per widget and shows it from the widget's
  next load. The Hub loads the files from the node every time.

### 1.12 Storage

- In GO, every Q-App on a node shares one `localStorage`; in the Hub, each
  app name has its own. So **prefix every key with your name**, e.g.
  `yourname.clock.hour12`.
- A widget shares the Hub's storage only with apps published **under the
  same name**. To read what your main app saved (a city, a choice), publish
  the widget under your app's name.
- **Never read another app's storage**, even where you technically can
  (GO). Use only public QDN data and what the user grants on screen.

### 1.13 Privacy and security

- Load code and data only from your bundle, the node and QDN. **No outside
  web services** or internet pages: they may be blocked, and they leak the
  user's IP address and activity.
- Ask only for what you show. Ask for the user's account
  (`GET_USER_ACCOUNT`) only when the widget is about their account, and
  only after they tap.
- Never put user data into links, identifiers or anything you publish.

---

## Part 2 — Building a widget

### 2.1 Files

```text
go-widget-yourwidget/
  index.html     # for a small widget, everything can live here
  (assets…)      # optional: icons, a small script bundle
```

Zip the folder **with `index.html` at the zip's root** and publish it
(Part 5). One HTML file with inline CSS and JavaScript starts fastest. Keep
it under about 200 KB.

### 2.2 The template

A complete widget: a list of the newest items from QDN (here: the newest
Q-Apps, one per publisher), with pictures; a tap opens the item. It follows
theme, language and visibility, fits every size from 1 × 2 cells to a wide
Hub widget, starts from the last rows it kept, asks once for its size, and
works in GO, in the Hub, and in a plain browser (with sample rows, to check
the layout). When the search result doesn't hold what a row shows, its
`details` step fetches each item's own data. Tested as a Home widget in
Qortal Hub, as it is and with the Q-Tube and Torq settings in 3.3.

Change only the `CHANGE` block: what to search for, which items to keep, the
details to fetch, and how each row looks (`row`: text, picture, link).

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Newest Q-Apps</title>
    <style>
      :root { color-scheme: dark; --fg: #f2f4f8; --muted: rgba(242, 244, 248, 0.62); --soft: rgba(242, 244, 248, 0.08); --accent: #7aa7f7; }
      :root[data-theme='light'] { color-scheme: light; --fg: #15181e; --muted: rgba(21, 24, 30, 0.6); --soft: rgba(21, 24, 30, 0.06); --accent: #2f6fe0; }
      /* Transparent: the host's card shows behind the widget. */
      html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; color: var(--fg); font: 14px/1.3 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; -webkit-tap-highlight-color: transparent; }
      main { box-sizing: border-box; height: 100%; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
      button { all: unset; box-sizing: border-box; cursor: pointer; }
      #heading { font-weight: 600; font-size: 13px; color: var(--accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #heading:disabled { cursor: default; color: var(--muted); }
      #list { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(var(--cols, 1), minmax(0, 1fr)); align-content: start; column-gap: 12px; }
      .row { display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 6px; border-radius: 10px; min-width: 0; }
      .row:hover, .row:focus-visible { background: var(--soft); }
      .row img { width: 32px; height: 32px; border-radius: 8px; object-fit: cover; flex: none; background: var(--soft); }
      .text { min-width: 0; }
      .title, .meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .meta { color: var(--muted); font-size: 12px; }
      .note { margin: auto; color: var(--muted); text-align: center; }
      /* The smallest sizes (2 rows tall): only the newest title, wrapped. */
      @media (max-height: 100px) {
        #heading, .meta { display: none; }
        main { padding: 8px; }
        .row { height: auto; padding: 0; align-items: flex-start; }
        .title { white-space: normal; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
      }
      @media (max-width: 130px) {
        .row img { display: none; }
      }
    </style>
  </head>
  <body>
    <main>
      <button id="heading" type="button"></button>
      <div id="list"></div>
    </main>
    <script>
      (() => {
        // ---- CHANGE: what this widget shows (Part 3.3 has settings for some apps) ----
        const avatar = (name) =>
          `/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/qortal_avatar?async=true`;
        const CONFIG = {
          heading: { en: 'Newest Q-Apps', de: 'Neueste Q-Apps' },
          headingLink: null, // e.g. 'qortal://APP/Q-Tube': the heading opens the app
          // SEARCH_QDN_RESOURCES fields. Newest first, metadata and leaving out
          // blocked names are added below. Feeds need mode: 'ALL' (Part 2.3).
          search: { service: 'APP', limit: 24 },
          // Size 32 is a deleted item.
          keep: (item) => item.size !== 32 && !String(item.identifier || '').startsWith('go-widget'),
          // Optional: each item's own data, when its row needs it (a download each).
          details: null, // e.g. (item) => ask({ action: 'FETCH_QDN_RESOURCE', service: item.service, name: item.name, identifier: item.identifier })
          detailsLimit: 8, // only the newest this many get details
          // One row: its text, picture and what a tap opens. `data` is what details gave.
          row: (item, data) => ({
            title: (item.metadata && item.metadata.title) || item.name,
            by: item.name,
            picture: avatar(item.name),
            link: `qortal://APP/${encodeURIComponent(item.name)}`,
          }),
          refreshMinutes: 10, // at least 0.5; only while the widget is seen
          size: { width: 'half', height: 196 }, // asked for once
          storageKey: 'yourname.go-widget-newest-apps.v1', // CHANGE: start with your name
        };
        const TEXT = {
          en: { empty: 'Nothing here yet.', error: "Can't load this right now." },
          de: { empty: 'Noch nichts da.', error: 'Gerade nicht ladbar.' },
        };
        // ---- end of CHANGE ----

        const params = new URLSearchParams(location.search);
        const inWidget = params.get('goWidget') === '1';
        // Core's qortalRequest is a global const in every page a node
        // renders (GO and the Hub alike), so it is not window.qortalRequest.
        const hasCore = typeof qortalRequest === 'function';

        let lang = 'en';
        const setLang = (code) => {
          lang = String(code || 'en').toLowerCase().split(/[-_]/)[0];
          document.documentElement.lang = lang;
        };
        const t = (key) => (TEXT[lang] || TEXT.en)[key] || TEXT.en[key];
        const setTheme = (theme) => {
          document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
        };
        setTheme(params.get('theme') || window._qdnTheme);
        setLang(params.get('lang') || window._qdnLang || navigator.language);

        /** Requests through Core: it answers reads itself and passes the rest to GO or the Hub. */
        function ask(request, timeoutMs) {
          const answer = hasCore
            ? qortalRequest(request)
            : new Promise((resolve, reject) => {
                // No Core (a local test page): straight to the host, if any.
                const channel = new MessageChannel();
                channel.port1.onmessage = ({ data }) => {
                  channel.port1.close();
                  data && data.error ? reject(data.error) : resolve(data && data.result);
                };
                window.parent.postMessage({ ...request, requestedHandler: 'UI' }, '*', [channel.port2]);
              });
          if (!timeoutMs) return answer;
          const late = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs));
          return Promise.race([answer, late]);
        }
        const open = (link) => {
          if (link) ask({ action: 'OPEN_NEW_TAB', qortalLink: link }).catch(() => {});
        };

        const ago = (ms) => {
          if (!ms) return '';
          const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' });
          const s = (ms - Date.now()) / 1000;
          const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
          for (const [unit, size] of units) {
            if (Math.abs(s) >= size) return rtf.format(Math.round(s / size), unit);
          }
          return rtf.format(0, 'minute');
        };

        /** Each listed item's details, loaded once and dropped when it leaves the list. */
        const details = new Map();
        const keyOf = (item) => `${item.service}/${item.name}/${item.identifier || ''}`;
        const detailsOf = (item) => {
          const key = keyOf(item);
          if (!details.has(key)) {
            details.set(key, Promise.resolve().then(() => CONFIG.details(item)).catch(() => null));
          }
          return details.get(key);
        };

        let rows = [];
        let failed = false;
        let lastLoad = 0;
        let visible = true;
        let timer = 0;

        try {
          rows = JSON.parse(localStorage.getItem(CONFIG.storageKey) || '[]');
        } catch {
          rows = [];
        }

        const heading = document.getElementById('heading');
        const list = document.getElementById('list');
        heading.onclick = () => open(CONFIG.headingLink);

        function rowElement(row) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'row';
          if (row.picture) {
            const img = document.createElement('img');
            img.alt = '';
            img.loading = 'lazy';
            img.onerror = () => (img.style.visibility = 'hidden');
            img.src = row.picture;
            button.append(img);
          }
          const text = document.createElement('div');
          text.className = 'text';
          const title = document.createElement('div');
          title.className = 'title';
          title.textContent = row.title;
          const meta = document.createElement('div');
          meta.className = 'meta';
          meta.textContent = [row.by, ago(row.created)].filter(Boolean).join(' · ');
          text.append(title, meta);
          button.append(text);
          button.onclick = () => open(row.link);
          return button;
        }

        function draw() {
          heading.textContent = CONFIG.heading[lang] || CONFIG.heading.en;
          heading.disabled = !CONFIG.headingLink;
          // The Hub lets users stretch a widget wider than a phone.
          const cols = innerWidth >= 560 ? 2 : 1;
          list.style.setProperty('--cols', cols);
          const fit = Math.max(1, Math.floor(list.clientHeight / 44));
          const shown = rows.slice(0, fit * cols);
          if (shown.length) {
            list.replaceChildren(...shown.map(rowElement));
          } else {
            const note = document.createElement('p');
            note.className = 'note';
            note.textContent = failed ? t('error') : lastLoad ? t('empty') : '';
            list.replaceChildren(note);
          }
        }

        async function load() {
          try {
            const found = await ask({
              action: 'SEARCH_QDN_RESOURCES',
              includeMetadata: true,
              excludeBlocked: true,
              reverse: true, // newest first (by first publish)
              ...CONFIG.search,
            });
            let items = (Array.isArray(found) ? found : []).filter(CONFIG.keep);
            if (CONFIG.details) items = items.slice(0, CONFIG.detailsLimit || 8);
            const data = await Promise.all(items.map((item) => (CONFIG.details ? detailsOf(item) : null)));
            for (const key of details.keys()) {
              if (!items.some((item) => keyOf(item) === key)) details.delete(key);
            }
            rows = items
              .map((item, i) => ({ ...CONFIG.row(item, data[i]), created: item.created }))
              .filter((row) => row.title);
            failed = false;
            try {
              // Kept for a quick start next time; pictures inside the data are left out.
              const small = rows.slice(0, 24).map((row) => ({
                ...row,
                picture: row.picture && !row.picture.startsWith('data:') ? row.picture : null,
              }));
              localStorage.setItem(CONFIG.storageKey, JSON.stringify(small));
            } catch {
              /* storage full or blocked: fine */
            }
          } catch {
            failed = true; // keep what is already shown
          }
          lastLoad = Date.now();
          draw();
          plan();
        }

        /** Loads when due, and only while someone can see the widget. */
        function plan() {
          clearTimeout(timer);
          if (!visible || document.visibilityState === 'hidden') return;
          const due = lastLoad + Math.max(0.5, CONFIG.refreshMinutes) * 60_000 - Date.now();
          timer = setTimeout(load, Math.max(0, due));
        }

        addEventListener('message', ({ data }) => {
          if (!data || typeof data !== 'object') return;
          if (data.action === 'GO_WIDGET_VISIBILITY') {
            visible = Boolean(data.payload && data.payload.visible);
            plan();
          } else if (data.action === 'THEME_CHANGED') {
            setTheme(data.theme);
          } else if (data.action === 'LANGUAGE_CHANGED' && data.language) {
            setLang(data.language);
            draw();
          }
        });
        document.addEventListener('visibilitychange', plan);
        new ResizeObserver(draw).observe(list);

        draw(); // what was kept from last time, at once
        if (!hasCore) {
          // A plain browser (no node): sample rows, to check the layout.
          rows = [1, 2, 3, 4, 5, 6].map((n) => ({
            title: `Sample item ${n}`,
            by: 'Example',
            created: Date.now() - n * 3600e3,
          }));
          lastLoad = Date.now();
          draw();
        } else {
          plan();
        }
        if (inWidget) {
          ask({ action: 'GO_WIDGET_SET_SIZE', ...CONFIG.size }, 3000).catch(() => {});
        }
      })();
    </script>
  </body>
</html>
```

### 2.3 Patterns

**A feed.** `SEARCH_QDN_RESOURCES` returns only **each name's newest match**
unless you add `mode: 'ALL'`. Use `mode: 'ALL'` for feeds (every post, every
video), and leave it out for "one per publisher" lists:

```js
const items = await ask({
  action: 'SEARCH_QDN_RESOURCES',
  service: 'DOCUMENT',        // where the app keeps its posts
  identifier: 'myapp-post-',  // the app's identifier prefix
  prefix: true,
  mode: 'ALL',
  includeMetadata: true,      // title, description, tags, category
  excludeBlocked: true,
  reverse: true,              // newest first
  limit: 20,
});
// items: [{ name, service, identifier, created, updated?, size, metadata? }]
```

- `reverse: true` sorts by first publish (`created`): an update does not
  move an item up.
- `identifier` is missing for a resource published without one.
- A deleted item is still listed, with `size: 32`: leave it out.
- Core puts your values into the address as they are: put free text and
  names through `encodeURIComponent`.
- Ask for a few more than you show, and filter (`keep` in the template).

**One item's data.** `FETCH_QDN_RESOURCE` (`service`, `name`, `identifier`)
returns the parsed JSON when the data is JSON, otherwise text. Each one is a
download: fetch only what you show, keep it while the item is listed, and
fetch again only new items (the template's `details` does this).

**Pictures.** An `<img>` can load from the node directly:

- a `THUMBNAIL` resource: `/arbitrary/THUMBNAIL/<name>/<identifier>?async=true`;
- a name's avatar: `/arbitrary/THUMBNAIL/<name>/qortal_avatar?async=true`;
- a picture inside an app's own JSON (often a `data:` URL): use it as it is.

`?async=true` makes the node answer at once instead of holding the request
while it fetches the file. Hide pictures that fail (`onerror`), and give
them a fixed size so the layout doesn't jump.

**A setting** (a city, a channel): a small inline form inside the widget,
saved to `localStorage` under your prefixed key. No dialogs.

**The user's own data:** show a button ("Show my balance"); on tap, ask
`GET_USER_ACCOUNT` (the host asks the user), then read public data for that
address with `GET_BALANCE` and similar. Keep the address only in memory or
under your prefixed key.

**Empty and error states:** always draw something useful, a short line of
text; never a blank frame or a spinner that never ends. On an error, keep
showing the last data.

**Translations:** `Intl.RelativeTimeFormat`, `Intl.NumberFormat` and
`Intl.DateTimeFormat` translate times and numbers for free; keep your own
words in a small table per language (`TEXT` in the template).

### 2.4 Fitting every size

- Work out what fits from the frame, e.g. rows of 44 px:
  `Math.floor(listHeight / 44)` items.
- Smallest (about 80–95 × 92 px): one number or one wrapped title, nothing
  else.
- Small (1–2 columns, 2–3 rows): the key value and one line of context.
- Medium and tall: a list; drop pictures before titles.
- Wide (Hub, 560 px and more): two columns, or more items per row.
- Test at 79 × 92, 170 × 144, 351 × 248, 351 × 716 and about 830 × 248.

---

## Part 3 — Widgets for existing Q-Apps and websites

### 3.1 Two cases: you own the app's name, or you don't

|                                  | You own the app's name                       | You don't (a widget for someone else's app)                              |
| -------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| Publish as                       | `APP / <the app's name> / go-widget-<slug>`  | `APP / <your name> / go-widget-<slug>`                                   |
| Icon in the list                 | the app's avatar                             | your avatar                                                              |
| The app's saved settings         | shared with the widget in the Hub            | not available; never read them                                           |
| Title and description            | the app's own                                | name the app and say it's yours: "Q-Tube: newest", "Unofficial widget for Q-Tube" |

If it's not your app, consider asking its developer first: they may want to
publish it under the app's name, which gives it the app's icon.

### 3.2 Find out how the app keeps its data

Before writing code, find these five things and write them down as **app
notes**: the service, the identifier pattern, the fields to show, the
picture, and the link that opens an item. Ways to find them (`<node>` is the
node's address, e.g. `http://127.0.0.1:12391` for a local node; reading
needs no API key):

1. **Find the app:**
   `<node>/arbitrary/resources/search?service=APP&name=<App>&exactmatchnames=true&includemetadata=true&mode=ALL`.
2. **Watch it work:** open `<node>/render/APP/<App>` in a desktop browser
   (no login needed for public data) and look at the developer tools'
   **Network** tab while it lists things. The calls to
   `/arbitrary/resources/search` show the service, identifier prefix, mode
   and order the app uses.
3. **Or read its code:** `<node>/arbitrary/APP/<App>?filepath=index.html`
   names the script files; fetch them the same way (`filepath=assets/…`) and
   search for `identifier`, `service:` and `SEARCH_QDN_RESOURCES`.
4. **Look at real items:**
   `<node>/arbitrary/resources/search?service=<S>&identifier=<prefix>&prefix=true&mode=ALL&reverse=true&limit=5&includemetadata=true`,
   then fetch one: `<node>/arbitrary/<S>/<name>/<identifier>`.
5. **Find the link:** open an item in the app in GO or the Hub and read the
   address (`qortal://APP/<App>/…`); or find the app's routes in its code.

Then build from the template (2.2) with those notes.

### 3.3 App notes

Checked on live QDN data in November 2026. The Q-Tube and Torq settings
below were run as Home widgets in Qortal Hub. Apps change, so if something
looks wrong, check it again as 3.2 says.

Two things hold for all of them:

- **A deleted item** is republished as a single byte: it shows in search
  results with `size: 32`. Leave those out (`keep`).
- **`prefix: true` also makes `title` and `description` match from their
  start.** To filter by description, leave `prefix` out (the identifier then
  matches anywhere), or start the description filter with what the app puts
  first.

To use a setting below, replace the template's whole `CHANGE` block with it.

#### Q-Tube: videos

| What        | Where                                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| Videos      | `DOCUMENT`, identifier starting `qtube_vid_` and ending `_metadata`, each under its publisher's name. Search with `mode: 'ALL'`. |
| In the search result | `metadata.title` (cut to 50 characters); `metadata.description` starts `**category:N;subcategory:M;…`             |
| In the document | `title`, `videoImage` (the picture, a `data:` URL), `duration` (seconds), `category`, `videoReference` (the VIDEO file) |
| Picture     | only inside each document: a download of 60–500 KB per video, so fetch details for the shown rows only                    |
| One category | `description: 'category:3;'` **without** `prefix`, or `'**category:3;'` with it                                           |
| Categories  | 1 Movies, 2 Series, 3 Music, 4 Education, 5 Lifestyle, 6 Gaming, 7 Technology, 8 Sports, 9 News & Politics, 10 Cooking & Food, 11 Animation, 12 Science, 13 Health & Wellness, 14 DIY & Crafts, 15 Kids & Family, 16 Comedy, 17 Travel & Adventure, 18 Art & Design, 19 Nature & Environment, 20 Business & Finance, 21 Personal Development, 22 Religion, 23 History, 24 Anime, 25 Cartoons, 26 Qortal, 27 Paranormal, 28 Spirituality, 29 Privacy, 99 Other |
| Links       | a video: `qortal://APP/Q-Tube/video/<name>/<identifier of the _metadata document>`; a channel: `qortal://APP/Q-Tube/channel/<name>` |
| Subscriptions | kept inside Q-Tube only: a widget can't read them. Let the user type channel names into the widget, then search with `names: [...]` and `exactMatchNames: true`. |

Tested setting, newest videos with their pictures:

```js
// ---- CHANGE: Q-Tube: the newest videos ----
const avatar = (name) =>
  `/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/qortal_avatar?async=true`;
const CONFIG = {
  heading: { en: 'Q-Tube: newest videos' },
  headingLink: 'qortal://APP/Q-Tube',
  search: {
    service: 'DOCUMENT',
    identifier: 'qtube_vid_', // the videos' metadata documents
    prefix: true,
    mode: 'ALL',
    limit: 16,
  },
  keep: (item) => item.size !== 32 && String(item.identifier).endsWith('_metadata'),
  // The picture is inside each video's document (60-500 KB each).
  details: (item) =>
    ask({ action: 'FETCH_QDN_RESOURCE', service: 'DOCUMENT', name: item.name, identifier: item.identifier }),
  detailsLimit: 6,
  row: (item, video) => ({
    title: (video && video.title) || (item.metadata && item.metadata.title) || '',
    by: item.name,
    picture: (video && video.videoImage) || avatar(item.name),
    link: `qortal://APP/Q-Tube/video/${encodeURIComponent(item.name)}/${encodeURIComponent(item.identifier)}`,
  }),
  refreshMinutes: 10,
  size: { width: 'full', height: 248 },
  storageKey: 'yourname.go-widget-qtube-newest.v1',
};
const TEXT = {
  en: { empty: 'No videos yet.', error: "Can't load videos right now." },
};
// ---- end of CHANGE ----
```

#### Torq and Quitter: posts

Torq and Quitter read and write **the same posts**, so one widget serves
both. Open them in whichever app you like.

| What      | Where                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| Posts     | `DOCUMENT`, identifier starting `MhNiRYdzkaP9dz-kX47dT-XrFXaYetyErMdF-` (top-level posts), under each author's name. `mode: 'ALL'`. |
| Replies   | identifier starting `MhNiRYdzkaP9dz-Tj2WBN-`; reposts: `MhNiRYdzkaP9dz-cEWGCt-`                                          |
| In the search result | nothing useful: most posts have no QDN metadata, so fetch each post (most are under 1 KB)                    |
| In the document | `text`, `timestamp`, `name`; maybe `images: [{ src }]` (base64 **without** a `data:` prefix, usually WebP), `videos: [{ name, service, identifier }]` (Q-Tube documents), `poll` |
| Text      | Torq adds links for Quitter readers to `text` (the post's own `qortal://APP/Torq/post/…` link and `qortal://use-embed/…` links): leave them out |
| Links     | a post: `qortal://APP/Torq/post/<name>/<identifier>` (or `APP/Quitter/…`); a user: `qortal://APP/Torq/user/<name>`; a hashtag: `qortal://APP/Torq/search/hashtags?q=<tag>` |
| Follows   | public. Who X follows: search `DOCUMENT`, identifier `gY.TWOeB25Co.7`, `prefix: true`, `name: X`, `exactMatchNames: true`, `mode: 'ALL'`, `limit: 0`; leave out size 32; fetch each: `{ "followedName": "…" }`. Then search posts with `names: [...]` (25 at most per search) and `exactMatchNames: true`. |

Tested setting, the newest posts:

```js
// ---- CHANGE: Torq (and Quitter): the newest posts ----
const avatar = (name) =>
  `/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/qortal_avatar?async=true`;
// Post pictures are base64 without a data: prefix.
const asImage = (b64) =>
  b64.startsWith('data:')
    ? b64
    : `data:image/${b64.startsWith('/9j/') ? 'jpeg' : b64.startsWith('iVBOR') ? 'png' : b64.startsWith('R0lGOD') ? 'gif' : 'webp'};base64,${b64}`;
const CONFIG = {
  heading: { en: 'Torq: newest posts' },
  headingLink: 'qortal://APP/Torq',
  search: {
    service: 'DOCUMENT',
    identifier: 'MhNiRYdzkaP9dz-kX47dT-XrFXaYetyErMdF-', // top-level posts
    prefix: true,
    mode: 'ALL',
    limit: 16,
  },
  keep: (item) => item.size !== 32 && item.size < 5242880,
  details: (item) =>
    ask({ action: 'FETCH_QDN_RESOURCE', service: 'DOCUMENT', name: item.name, identifier: item.identifier }),
  detailsLimit: 8,
  row: (item, post) => {
    // Torq adds links for Quitter readers; leave them out.
    const line = String((post && post.text) || '')
      .replace(/qortal:\/\/(use-embed|APP\/Torq\/post)\/\S+/gi, '')
      .split('\n')
      .map((part) => part.trim())
      .find(Boolean);
    const image = post && post.images && post.images[0] && post.images[0].src;
    return {
      title: line || (post && post.videos && post.videos.length ? '▶' : ''),
      by: item.name,
      picture: image ? asImage(image) : avatar(item.name),
      link: `qortal://APP/Torq/post/${encodeURIComponent(item.name)}/${encodeURIComponent(item.identifier)}`,
    };
  },
  refreshMinutes: 2,
  size: { width: 'full', height: 248 },
  storageKey: 'yourname.go-widget-torq-newest.v1',
};
const TEXT = {
  en: { empty: 'No posts yet.', error: "Can't load posts right now." },
};
// ---- end of CHANGE ----
```

#### Subscreen: movies and series

Subscreen shows Q-Tube's categories 1 (Movies) and 2 (Series), so its data
is Q-Tube's.

| What    | Where                                                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Movies  | Q-Tube video documents with `description: 'category:1;'` (no `prefix`); the documents also have `year` and `quality`          |
| Series  | `PLAYLIST`, identifier `qtube_playlist_`, `description: 'category:2;'` (no `prefix`); the document has `title`, `description`, `image` (a `data:` URL) and `videos` (the episodes) |
| Links   | a movie: `qortal://APP/Subscreen/title/DOCUMENT/<name>/<identifier>`; a series: `qortal://APP/Subscreen/title/PLAYLIST/<name>/<identifier>`; the lists: `qortal://APP/Subscreen/movies`, `qortal://APP/Subscreen/series` |
| Not readable | watch history (inside Subscreen only)                                                                                    |

Start from the Q-Tube setting and change the search, the link, and the
picture for series:

```js
search: { service: 'DOCUMENT', identifier: 'qtube_vid_', description: 'category:1;', mode: 'ALL', limit: 16 },
// series: { service: 'PLAYLIST', identifier: 'qtube_playlist_', description: 'category:2;', mode: 'ALL', limit: 16 }
// row: title: doc.title, picture: doc.videoImage (movies) or doc.image (series),
//      link: `qortal://APP/Subscreen/title/${item.service}/${encodeURIComponent(item.name)}/${encodeURIComponent(item.identifier)}`
```

Subscreen also builds "series" out of loose episodes; those exist only
inside the app, so a widget sees the published playlists only.

#### SubWire: articles

| What      | Where                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------------------------- |
| Articles  | `DOCUMENT`, identifier starting `7l1NGsWiY0SgPb-FJVWQM-T60ZadsfPsbLTh-`; episodes: `7l1NGsWiY0SgPb-eEGFM7-T60ZadsfPsbLTh-`. `mode: 'ALL'`. |
| In the search result | `metadata.title` is the article's title and `metadata.description` its subtitle: enough for a list, no download |
| In the document | `title`, `subtitle`, `content` (Markdown), `coverImage.src` (base64, with or without `data:`), `timestamp`, `type` (`essay` or `episode`) |
| Links     | an article: `qortal://APP/Subwire/article/<name>/<identifier>`; an author: `qortal://APP/Subwire/author/<name>`           |
| Not readable | subscriber-only posts: they are encrypted                                                                              |

```js
search: { service: 'DOCUMENT', identifier: '7l1NGsWiY0SgPb-FJVWQM-T60ZadsfPsbLTh-', prefix: true, mode: 'ALL', limit: 16 },
// no details needed:
// row: title: item.metadata.title, by: item.name, picture: avatar(item.name),
//      link: `qortal://APP/Subwire/article/${encodeURIComponent(item.name)}/${encodeURIComponent(item.identifier)}`
```

### 3.4 QDN websites (`WEBSITE`)

Only `APP` resources are widgets. For a QDN website:

1. Make a small page for the widget view (Part 2). Plain HTML and CSS are
   fine; `qortalRequest` is there when a node renders it.
2. Publish that page as an **`APP`**: under the site's name if you own it
   (`APP / <site> / go-widget-<slug>`), else under your own name.
3. Link to the full site with `qortal://WEBSITE/<site>/<path>` and
   `OPEN_NEW_TAB`.

Internet websites can't be shown or read from a widget (1.13). Only what is
on QDN or the node.

### 3.5 Your own app: a separate widget, or a widget mode

| Approach                                       | When                                    | How                                                                                                         |
| ---------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **A. A small widget beside the app** (best)    | almost always                           | A new small page, published as `APP / <app> / go-widget-<slug>`. Reuse the data code, not the UI.           |
| **B. A widget mode inside the app**            | the app is already small and fast       | When `goWidget=1` is in the address, render a compact view first thing. Tag the app `go-widget`.            |

Approach A costs the phone little memory and battery (widgets stay loaded),
starts fast, and leaves your app as it is. In Approach B: no app bar, menus
or splash screen in widget mode; transparent background; every action opens
the full app with `OPEN_NEW_TAB` (without `goWidget`); and if the app takes
more than about a second to show on a phone, use Approach A.

### 3.6 Asking an AI agent

Give the agent this file and the widget brief (Part 0), and ask:

> Read `go-widgets.md` and build the widget in this brief, for both Qortal
> GO and Qortal Hub. Start from the template in Part 2.2. If the widget is
> for an existing app or site, use its notes in Part 3.3; if it has none,
> find its data as Part 3.2 says and show me the app notes before writing
> code. Call Core's `qortalRequest` by its bare name; use `mode: 'ALL'` for
> feeds; open apps only with `OPEN_NEW_TAB`; read theme and language from
> the address; pause while hidden; fit every size from 79 × 92 px to a wide
> Hub widget; no swipes, long presses, dialogs or outside web requests.
> Check it against Part 6. Give me the widget folder, and the publish
> settings from Part 5.

---

## Part 4 — Testing

1. **The look, in a browser:** open `index.html` directly. The template
   shows sample rows without a node. Add `?theme=light` (and `dark`, on a
   dark background) and resize the window through the sizes in 2.4.
2. **With real data, before publishing**, as an app tab:
   - **Qortal Hub** (on a local node): turn on Dev Mode, open Dev Mode apps
     and pick the widget's folder; the Hub has your node build a preview and
     opens it as a tab.
   - **GO:** Settings → System → **Dev Mode**, then **Dev Mode** next to
     **New folder** in your pinned apps, and pick the widget's zip.
   - In a tab the widget gets no widget messages and `GO_WIDGET_*` gets no
     answer: it must still draw and work.
3. **As a widget, after publishing** (Part 5): add it in GO (widgets screen
   → **+**) and in the Hub (**Home → Widgets → Add widget**), then check:
   - it shows something at once, and real data soon after;
   - switching theme and language changes it;
   - the smallest and largest sizes, and a very wide one in the Hub
     (**Arrange**);
   - leaving the screen pauses it (no requests while hidden);
   - a tap opens the right app at the right place;
   - in GO, a sideways swipe across it switches screens.
4. **Updates:** after you publish a new version, the Hub shows it on the
   widget's next load once the node has it (**Arrange → Reload**); GO
   within about an hour.

---

## Part 5 — Publishing

| Field         | Value                                                              |
| ------------- | ------------------------------------------------------------------ |
| `service`     | `APP`                                                              |
| `name`        | the publishing name (3.1)                                          |
| `identifier`  | `go-widget-<slug>`                                                 |
| `title`       | 24 characters at most                                              |
| `description` | one sentence                                                       |
| tags          | `go-widget`, plus up to four of your own (`tag1` … `tag5`)        |
| file          | the widget folder as a zip, `index.html` at its root               |

From any Q-App open as a normal tab (not a widget) in GO or the Hub, for
example a "Publish widget" button in your own app, or a small page opened in
Dev Mode (Part 4):

```js
await qortalRequest({
  action: 'PUBLISH_QDN_RESOURCE',
  service: 'APP',
  name: 'YourName',
  identifier: 'go-widget-newest',
  title: 'Newest Q-Apps',
  description: 'The newest Q-Apps, one tap away.',
  tag1: 'go-widget',
  file: zipBlob, // the folder as a zip, index.html at its root
  isMultiFileZip: true, // publish the zip's files, not the zip as one file
});
```

- **`isMultiFileZip: true` is required.** Without it the zip is published as
  a single file and the widget doesn't open.
- The user approves the publish, and pays a small fee (0.01 QORT at the time
  of writing).
- The Hub's own **Publish** screen has no identifier field, so it can't
  publish `go-widget-…` identifiers: use the request above.
- **Updating:** publish again with the same name and identifier.
- **Retiring:** publish again without the `go-widget` tag (1.3).

---

## Part 6 — Checklist

Must:

- [ ] Published as `APP` with the tag `go-widget` and an identifier starting
      with `go-widget`; zip published with `isMultiFileZip: true`; short
      title; one-line description.
- [ ] Draws the widget view from the first frame; transparent background.
- [ ] Reads `theme` and `lang` from the address at start, and follows
      `THEME_CHANGED` and `LANGUAGE_CHANGED`.
- [ ] Calls Core's bare `qortalRequest`, and works whether
      `window.parent === window` (Hub) or not (GO).
- [ ] Looks right at 79 × 92, 170 × 144, 351 × 248, 351 × 716 and a wide
      Hub size: nothing cut mid-word, nothing overflowing, no scrollbars
      except in a vertical list.
- [ ] Pauses timers, animations and polling while hidden
      (`GO_WIDGET_VISIBILITY`, `document.visibilityState`).
- [ ] Uses only the requests in 1.8; survives a refused or failing request.
- [ ] Opens apps only with `OPEN_NEW_TAB`; never `LINK_TO_QDN_RESOURCE`.
- [ ] No sideways swipes or carousels, no long-press actions, no
      `alert` / `confirm` / `prompt`.
- [ ] No outside web services; never reads another app's storage.
- [ ] Shows something within about 300 ms; has an empty and an error state.
- [ ] `localStorage` keys start with your name.
- [ ] Feeds use `mode: 'ALL'`.
- [ ] Leaves out deleted items (`size: 32`).

Should:

- [ ] Asks once for its natural size (`GO_WIDGET_SET_SIZE`, with a time
      limit).
- [ ] Translated into the 12 languages, or at least falls back to English.
- [ ] Polls no more often than every 30 s (every few minutes is better).
- [ ] Tap targets at least 40 px tall.
- [ ] Under about 200 KB.
