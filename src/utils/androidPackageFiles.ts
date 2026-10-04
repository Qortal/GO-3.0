/**
 * Android app packages (.apk and the bundle formats) that reach GO as
 * ordinary files: a Q-App's SAVE_FILE, or a chat attachment.
 *
 * GO holds the install permission for its own updater. When GO hands a file
 * to Android with the package type, Android treats GO as the installer and,
 * once GO has been allowed to install updates, skips its "allow this source"
 * step. The file name, label and icon all come from the Q-App or the peer, so
 * a look-alike "GO update" would get GO's own "Tap to install". Only the
 * updater (src/appUpdate) installs. Everywhere else GO shows a package as a
 * saved file and does not offer to open it; the native open paths refuse
 * packages too (PackageArchivePolicy.java).
 */

export const ANDROID_PACKAGE_MIME = 'application/vnd.android.package-archive';

/**
 * The type to give a package if something opens it after all. Every one of
 * these formats is a zip archive, and the package installer does not claim
 * that type. The native open paths take a type GO gives over the one the
 * extension suggests (except application/octet-stream, which they treat as
 * "no type").
 */
export const PACKAGE_OPEN_MIME = 'application/zip';

// Trailing dots, spaces and underscores: some file systems and pickers drop
// the first two, and GO's own name cleaning turns "GO.apk?" into "GO.apk_".
const PACKAGE_EXTENSION = /\.(apk|apks|apkm|xapk|aab)[\s._]*$/;

// Invisible characters (zero-width space, joiners, direction marks) that make
// "GO.apk" read the same but end in something else.
const FORMAT_CHARACTERS = /\p{Cf}/gu;

// Cyrillic and Greek letters drawn like the Latin ones in the extensions
// above, so "GO.аpk" with a Cyrillic "а" is still caught.
const LOOK_ALIKES: Record<string, string> = {
  а: 'a',
  ɑ: 'a',
  α: 'a',
  р: 'p',
  ρ: 'p',
  к: 'k',
  κ: 'k',
  х: 'x',
  χ: 'x',
  ѕ: 's',
};
const LOOK_ALIKE_PATTERN = new RegExp(
  `[${Object.keys(LOOK_ALIKES).join('')}]`,
  'g'
);

/** The name the way it reads, for matching the extension. */
function readableName(filename?: string | null): string {
  return String(filename || '')
    .normalize('NFKC')
    .replace(FORMAT_CHARACTERS, '')
    .toLowerCase()
    .replace(LOOK_ALIKE_PATTERN, (letter) => LOOK_ALIKES[letter] || letter);
}

export function isAndroidPackageFile(
  filename?: string | null,
  mimeType?: string | null
): boolean {
  return (
    PACKAGE_EXTENSION.test(readableName(filename)) ||
    String(mimeType || '')
      .toLowerCase()
      .includes('android.package-archive')
  );
}

/**
 * The type to hand Android when opening a saved or received file: the file's
 * own type, except that a package gets {@link PACKAGE_OPEN_MIME}.
 */
export function safeOpenMimeType(
  filename?: string | null,
  mimeType?: string | null
): string | undefined {
  if (isAndroidPackageFile(filename, mimeType)) return PACKAGE_OPEN_MIME;
  return mimeType || undefined;
}
