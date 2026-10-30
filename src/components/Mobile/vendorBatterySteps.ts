/**
 * Short in-app steps that stop a phone brand's own battery manager from
 * freezing GO, picked by Build.MANUFACTURER. GO links to no outside website
 * for this, so the steps live in the app. The texts are i18n keys
 * under core:background_sync.vendor_freeze.steps; menu names stay in quotes
 * for translators to match the phone's own wording.
 */

/** Brand groups with their own steps; everything else gets 'generic'. */
export type VendorBatteryBrand =
  | 'vivo'
  | 'xiaomi'
  | 'samsung'
  | 'oppo'
  | 'huawei'
  | 'generic';

export const VENDOR_BATTERY_BRANDS: readonly VendorBatteryBrand[] = [
  'vivo',
  'xiaomi',
  'samsung',
  'oppo',
  'huawei',
  'generic',
];

/** Build.MANUFACTURER (lowercased, letters and digits only) -> brand group. */
const BRAND_BY_MANUFACTURER: Record<string, VendorBatteryBrand> = {
  vivo: 'vivo',
  iqoo: 'vivo',
  xiaomi: 'xiaomi',
  redmi: 'xiaomi',
  poco: 'xiaomi',
  samsung: 'samsung',
  oppo: 'oppo',
  realme: 'oppo',
  oneplus: 'oppo',
  huawei: 'huawei',
  honor: 'huawei',
};

/**
 * The brand group for a Build.MANUFACTURER value. Case, spaces and
 * punctuation are ignored ("OnePlus", "HONOR", "Xiaomi Inc." all match).
 * Google, GrapheneOS, Motorola, HMD / Nokia and unknown makers are 'generic'.
 */
export const normalizeBatteryBrand = (
  manufacturer: string | null | undefined
): VendorBatteryBrand => {
  const key = String(manufacturer ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!key) return 'generic';
  if (BRAND_BY_MANUFACTURER[key]) return BRAND_BY_MANUFACTURER[key];
  // "Xiaomi Inc.", "Samsung Electronics": the brand leads the value.
  const leading = Object.keys(BRAND_BY_MANUFACTURER).find((name) =>
    key.startsWith(name)
  );
  return leading ? BRAND_BY_MANUFACTURER[leading] : 'generic';
};

const STEP_PREFIX = 'core:background_sync.vendor_freeze.steps';

const STEP_COUNT: Record<VendorBatteryBrand, number> = {
  vivo: 3,
  xiaomi: 3,
  samsung: 2,
  oppo: 2,
  huawei: 3,
  generic: 2,
};

/**
 * Brand names for a heading, untranslated (they are names). Null for
 * 'generic', which has no single brand.
 */
const BRAND_LABEL: Record<VendorBatteryBrand, string | null> = {
  vivo: 'vivo / iQOO',
  xiaomi: 'Xiaomi / Redmi / POCO',
  samsung: 'Samsung',
  oppo: 'OPPO / realme / OnePlus',
  huawei: 'Huawei / Honor',
  generic: null,
};

/** Shown under every brand's steps, in this order. */
const VENDOR_BATTERY_NOTE_KEYS: readonly string[] = [
  `${STEP_PREFIX}.note_menu_names`,
  `${STEP_PREFIX}.note_recents`,
];

type VendorBatterySteps = {
  brand: VendorBatteryBrand;
  /** e.g. 'vivo / iQOO'; null for generic phones. */
  brandLabel: string | null;
  /** Full i18n keys (with namespace), in order: render as a numbered list. */
  stepKeys: string[];
  /** Full i18n keys of the notes shown under the steps. */
  noteKeys: string[];
};

export const vendorBatteryStepKeys = (brand: VendorBatteryBrand): string[] =>
  Array.from(
    { length: STEP_COUNT[brand] ?? STEP_COUNT.generic },
    (_, index) => `${STEP_PREFIX}.${brand}.step_${index + 1}`
  );

/** The steps for a phone, from its Build.MANUFACTURER. */
export const vendorBatterySteps = (
  manufacturer: string | null | undefined
): VendorBatterySteps => {
  const brand = normalizeBatteryBrand(manufacturer);
  return {
    brand,
    brandLabel: BRAND_LABEL[brand],
    stepKeys: vendorBatteryStepKeys(brand),
    noteKeys: [...VENDOR_BATTERY_NOTE_KEYS],
  };
};
