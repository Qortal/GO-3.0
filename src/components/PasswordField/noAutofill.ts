/**
 * N-33: the wallet password must never reach Android Autofill or a password
 * manager. A saved copy syncs to the provider's cloud, and with the wallet
 * backup it is enough to take the keys.
 *
 * On Android the real switch is native: MainActivity hides the whole WebView
 * from Autofill. These attributes are the in-page half, for the desktop app,
 * the browser build and managers that read the page themselves:
 * `autocomplete="off"` instead of "current-password" / "new-password" (both
 * invite "Save password?" and "Suggest strong password"), plus the opt-out
 * attributes of 1Password, LastPass, Bitwarden and Dashlane.
 *
 * Spread these into an `<input>` (MUI `inputProps` / `slotProps.htmlInput`)
 * after the caller's own props, so they always win.
 */
const PASSWORD_MANAGER_IGNORE_ATTRIBUTES = Object.freeze({
  'data-1p-ignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
  'data-lpignore': 'true',
});

/** For wallet password inputs (unlock, lock screen, create, backup, export). */
export const WALLET_PASSWORD_INPUT_PROPS = Object.freeze({
  ...PASSWORD_MANAGER_IGNORE_ATTRIBUTES,
  autoComplete: 'off',
  spellCheck: 'false',
});

/**
 * GO-42: for secrets typed as text, such as a seed phrase. Also turns off
 * autocorrect, capitalisation and spell checking, so the keyboard does not
 * rewrite words (an auto-capitalised first word would derive a different
 * wallet) or learn them. Use with a masked input: Android keyboards do not
 * learn from password fields, and Chromium keeps telling the keyboard that an
 * input which started as a password field is one when it is shown as text.
 */
export const SECRET_TEXT_INPUT_PROPS = Object.freeze({
  ...PASSWORD_MANAGER_IGNORE_ATTRIBUTES,
  autoCapitalize: 'none',
  autoComplete: 'off',
  autoCorrect: 'off',
  spellCheck: 'false',
});
