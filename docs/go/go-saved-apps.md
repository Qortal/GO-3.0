# GO: pinned apps, folders and bookmarks, saved with the desktop Hub

GO's Pinned tab is the desktop Hub's launcher: the same pinned apps,
bookmarks, bookmark folders and order, saved in the account's encrypted
settings on QDN (`DOCUMENT_PRIVATE / <name> / ext_saved_settings`). GO uses
the Hub's format and rules, `savedApps`, described in
[../saved-apps.md](../saved-apps.md): every pin, folder and bookmark carries
the time it last changed, a removed one stays as a removal, and two devices'
copies are merged item by item. A save on GO no longer undoes what the
desktop Hub did, and the other way round.

The code is the Hub's, copied unchanged where it can be, so later Hub changes
port easily: `src/components/Apps/AppsLauncher/savedApps.ts`,
`savedAppsKeys.ts`, `savedAppsPositions.ts`, `savedAppsSync.ts`, with their
tests. What differs on GO is below; in `savedAppsSync.ts` it is marked "GO".

## What a GO save writes

- `savedApps`, and the fields older Hubs read, filled from it:
  `sortablePinnedApps`, `appBookmarks` and `launcherOrder`.
- Every other field as the newest copy read here holds it: Home's layout and
  the side panel the desktop Hub saves, and fields newer than this GO. The
  copy read at sign-in is kept in memory for that
  (`src/hooks/qdnSettingsCopy.ts`); a save reads QDN's copy again only when
  QDN has a newer one, or when this run holds none.
- Settings that can't be read are not written over (Save's Overwrite aside),
  as on the Hub.

## Where a phone keeps things

- Bookmarks and folders: GO's encrypted storage
  (`qortal_app_bookmarks_by_address`), since a phone has no desktop storage.
- What the phone records of the saved apps (`ext_saved_apps:<address>`, with
  the time of each change made here, and `ext_saved_apps_qdn:<address>`,
  QDN's copy as last read): GO's encrypted storage too, next to the bookmarks
  whose names and pages they hold
  (`src/components/Mobile/goLauncher/goSavedAppsStorage.ts`). Hub's code reads
  them like localStorage, so they are read into memory before each use and
  written behind.
- The pin list and the launcher's order stay in localStorage, as on the Hub.

## GO's own steps

- **Order of the Pinned tab's writes.** The Pinned tab shows its bookmarks at
  once and writes them behind (`goLauncherStore.ts`). The saved apps read the
  bookmarks only once those writes have landed, and write what they took in
  from QDN after them, shown at once. A read that started before a write never
  puts older bookmarks back on screen.
- **Sign-in.** GO's old Tabs folders become bookmark folders first, once, so
  QDN's copy is merged with them. Pins that move makes wait until the take-in
  has decided the pin list, then join it: a pin added before would look newer
  than QDN's list on the phone's first take-in.
- **Lost bookmarks.** If GO's encrypted storage can no longer be read, the
  bookmarks read as none while the launcher's order in localStorage still
  names folders and bookmarks. The phone then forgets what it recorded of them
  (and #374's mark of what it took in), so the next take-in starts again from
  QDN's copy as a new device does. Recorded from the empty store, every
  bookmark and folder would count as removed and be removed on every device
  by the next save.
- **Revert** puts back the pins, folders, bookmarks and order as QDN held
  them (`src/components/Save/useRevertSettings.ts`, the Hub's hook without
  Home's layout and the side panel). With nothing saved on QDN, the pins go
  back to the default ones.

## Older clients

- GO up to v0.0.20 reads and saves the pin list alone
  (`sortablePinnedApps`), as Hub 3.0.3 does. Hubs with #374 but before
  `savedApps` also save `appBookmarks` and `launcherOrder`. The next GO or Hub
  to read such a copy takes the differences from what it last saw as that
  client's changes (see the Hub's doc).
