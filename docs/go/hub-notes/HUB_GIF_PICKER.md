# Message to Hub developers — chat GIF picker

This is the note for **upstream Qortal Hub** (Electron / desktop). Please port
the GIF picker from this GO 3.0 fork so Hub and GO send the same chat payload
and can display each other's GIFs.

**Repo:** https://gitea.qortal.link/simon/GO-3.0 (`main`, GO 3.0 **v0.0.5**)  
**Copy this folder as-is:** `src/components/Chat/gifs/`

Do **not** invent a new GIF protocol. The library already lives on QDN
(`qortal://APP/GIFs/`). Chat only stores a pointer.

---

## What a selected GIF is

QDN `IMAGE` resources whose identifier starts with `gif-`. Selecting one must
**attach a pointer**, not re-publish the file and not send the bytes over
Reticulum.

```ts
{
  identifier,          // starts with "gif-"
  libraryGif: true,
  mimeType: "image/gif",
  name,                // publisher QDN name
  service: "IMAGE",
  timestamp
}
```

Helper in this repo: `toChatImagePointer()` in `src/components/Chat/gifs/libraryGifs.ts`.

Embed (same as the GIFs Q-App copy button):

```
qortal://use-embed/IMAGE?name=NAME&identifier=ID&service=IMAGE&mimeType=image%2Fgif&timestamp=TS
```

---

## QDN endpoints (node already used by Hub)

Catalog — **one fetch**, then filter locally. Do not search QDN on every keystroke.

```
GET {node}/arbitrary/resources/search
  ?excludeblocked=true
  &identifier=gif-
  &includemetadata=true
  &limit=100
  &mode=ALL
  &prefix=true
  &reverse=true
  &service=IMAGE
```

Moderation list:

```
GET {node}/arbitrary/DOCUMENT/GIFs/gifs_moderation
```

Bytes (queued + cached in `gifMediaCache.ts`; concurrency 2):

```
GET {node}/arbitrary/IMAGE/{name}/{identifier}
GET {node}/arbitrary/IMAGE/{name}/{identifier}?async=true   // gather
```

`getBaseApiReact()` already points at the connected node. Hub already depends
on `react-intersection-observer` (used by `GifImage` for in-view lazy load).

---

## Files to copy

```
src/components/Chat/gifs/libraryGifs.ts
src/components/Chat/gifs/gifMediaCache.ts
src/components/Chat/gifs/gifUsage.ts
src/components/Chat/gifs/GifImage.tsx
src/components/Chat/gifs/ChatGifPicker.tsx
src/components/Chat/gifs/EmojiGifStage.tsx
src/components/Chat/gifs/EmojiGifSwitch.tsx
```

### One desktop tweak

`EmojiGifSwitch.tsx` imports `keepPanelKeyboardDown` from
`src/components/Mobile/emojiPanelBus.ts` (Android soft-keyboard). On Hub,
delete that import and the `keepPanelKeyboardDown()` call. Keep
`onMouseDown` / `onPointerDown` `preventDefault` so the composer does not
lose focus.

---

## Wire it (desktop path — `ReactionPicker`, not the mobile keyboard panel)

### 1. `src/components/ReactionPicker.tsx`

- Add optional `onGifSelect?: (gif: LibraryGif) => void`.
- When that callback is passed, wrap `emoji-picker-react` + `ChatGifPicker` in
  `EmojiGifStage` and put `EmojiGifSwitch` under the stage.
- Match this fork's `ReactionPicker.tsx`.

### 2. `src/components/Chat/TipTap.tsx`

- Add `insertGif?: (gif: LibraryGif) => void`.
- On the **desktop** emoji button (the existing `ReactionPicker`), pass
  `onGifSelect={insertGif}`.
- Do **not** port `MobileEmojiPanel`, `emojiPanelBus`, `useSoftKeyboardInset`,
  or the Capacitor SoftKeyboard plugin. Those are Android-only.

### 3. `ChatGroup.tsx` and `ChatDirect.tsx`

- `pendingLibraryGif` state.
- `insertLibraryGif`: refuse if another image / attachment is already pending.
- On send, prefer the pointer over a file upload:

```ts
const images = pendingLibraryGif
  ? [toChatImagePointer(pendingLibraryGif)]
  : existingImagePath;
```

- Composer preview: `<GifImage eager fill gif={pendingLibraryGif} />`.

### 4. `src/components/Chat/MessageItem.tsx`

- If `isLibraryGifImage(message.images[0])`, render
  `<GifImage fit="contain" gif={…} />`.
- Skip the normal image-download / Reticulum-resource path for these.

### 5. `src/utils/chat.ts` — `buildImageEmbedLink`

Treat `libraryGif === true`, identifier prefix `gif-`, or `mimeType ===
image/gif` as `image%2Fgif`, so copied embeds open as GIFs, not PNG.

### 6. Optional — `ReticulumDiscussionDialog.tsx`

Discussions are not the same image-pointer path. This fork fetches the blob
with `fetchLibraryGifFile` and attaches it as a normal file.

---

## Do not copy (mobile-only)

- `src/components/Mobile/MobileEmojiPanel.tsx`
- `src/components/Mobile/emojiPanelBus.ts` (unless you want the no-op stub)
- `src/hooks/useSoftKeyboardInset.ts`
- Capacitor SoftKeyboard / AppUpdate plugins
- Android keyboard / crash-guard bits (`GifLoadCancelled` in `App.tsx` is
  nice-to-have only)

---

## Behaviour to keep

- Fetch the catalog once (5 minute TTL). Search and tag chips are client-side
  (`filterLibraryGifs`, `gifTagCounts`).
- `gifMediaCache`: concurrency 2, memory + IndexedDB, cancel when a tile
  scrolls off screen, resolve cancelled work with an empty string (do not
  reject — that became an unhandled rejection on mobile).
- Most-used row from `localStorage` (`gifUsage.ts`, key `qortal-gif-usage-v1`).
- Masonry: three flex columns, `GifImage` `natural` (no square crop).
- Never stampede the node with one fetch per visible tile.

---

## Quick look after cloning this repo

```bash
git clone https://gitea.qortal.link/simon/GO-3.0.git
cd GO-3.0
git log --oneline -20

# Picker + send/render wiring vs upstream Hub
git diff origin/develop -- src/components/Chat/gifs src/components/ReactionPicker.tsx src/utils/chat.ts
```

Voice / dual-ring / `presence_bridge.py` notes are still in
[`HUB_DEV_NOTES.md`](HUB_DEV_NOTES.md) and
[`MOBILE_VOICE_HUB_DEV_NOTE.md`](MOBILE_VOICE_HUB_DEV_NOTE.md). Those are
separate from the GIF picker.
