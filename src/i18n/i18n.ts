import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  capitalizeAll,
  capitalizeEachFirstChar,
  capitalizeFirstChar,
  capitalizeFirstWord,
  capitalizeSentenceStarts,
} from './processors';

export const supportedLanguages = {
  en: { name: 'English', flag: '🇺🇸' },
  ar: { name: 'العربية', flag: '🇸🇦' },
  de: { name: 'Deutsch', flag: '🇩🇪' },
  es: { name: 'Español', flag: '🇪🇸' },
  et: { name: 'Eesti', flag: '🇪🇪' },
  fi: { name: 'Suomi', flag: '🇫🇮' },
  fr: { name: 'Français', flag: '🇫🇷' },
  it: { name: 'Italiano', flag: '🇮🇹' },
  ja: { name: '日本語', flag: '🇯🇵' },
  pt: { name: 'Português', flag: '🇵🇹' },
  ru: { name: 'Русский', flag: '🇷🇺' },
  zh: { name: '中文', flag: '🇨🇳' },
} as const;

const supportedLngs = Object.keys(supportedLanguages);

// English (the fallback) stays in the main bundle; every other language is a
// lazy chunk loaded only when it's the active language. Previously ALL 12
// languages × 6 namespaces were parsed at startup.
const eagerEnModules = import.meta.glob('./locales/en/*.json', {
  eager: true,
}) as Record<string, { default: Record<string, unknown> }>;

const lazyLocaleModules = import.meta.glob('./locales/*/*.json') as Record<
  string,
  () => Promise<{ default: Record<string, unknown> }>
>;

const resources: Record<string, Record<string, unknown>> = { en: {} };

for (const path of Object.keys(eagerEnModules)) {
  const match = path.match(/\.\/locales\/en\/([^/]+)\.json$/);
  if (!match) continue;
  resources.en[match[1]] = eagerEnModules[path].default;
}

const loadedLanguages = new Set<string>(['en']);

export async function ensureLanguageLoaded(lng: string): Promise<void> {
  const base = (lng || '').split('-')[0];
  if (!base || loadedLanguages.has(base) || !supportedLngs.includes(base)) {
    return;
  }
  loadedLanguages.add(base);
  const loads = Object.keys(lazyLocaleModules)
    .map((path) => {
      const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
      if (!match || match[1] !== base) return null;
      return lazyLocaleModules[path]().then((mod) => {
        i18n.addResourceBundle(base, match[2], mod.default, true, true);
      });
    })
    .filter(Boolean);
  try {
    await Promise.all(loads);
  } catch (error) {
    loadedLanguages.delete(base);
    console.error(`[i18n] failed to load locale ${base}:`, error);
  }
}

function getInitialLanguage(): string {
  try {
    const raw = localStorage.getItem('i18nextLng');
    if (!raw) return 'en';
    const base = raw.split('-')[0];
    return supportedLngs.includes(base) ? base : 'en';
  } catch {
    return 'en';
  }
}

export const namespaces = [
  'auth',
  'core',
  'group',
  'question',
  'tutorial',
  'node',
] as const;

i18n
  .use(initReactI18next)
  .use(capitalizeAll as any)
  .use(capitalizeEachFirstChar as any)
  .use(capitalizeFirstChar as any)
  .use(capitalizeFirstWord as any)
  .use(capitalizeSentenceStarts as any)
  .init({
    resources,
    fallbackLng: 'en',
    lng: getInitialLanguage(),
    supportedLngs,
    ns: [...namespaces],
    defaultNS: 'core',
    interpolation: { escapeValue: false },
    // bindI18nStore 'added' re-renders translated components when a lazily
    // loaded language bundle arrives.
    react: { useSuspense: false, bindI18n: 'languageChanged loaded', bindI18nStore: 'added' },
    returnEmptyString: false,
    returnNull: false,
    debug: import.meta.env.MODE === 'development',
  });

// Pull in the active language's bundles (no-op for English) and keep future
// language switches working.
void ensureLanguageLoaded(i18n.language);
i18n.on('languageChanged', (lng) => {
  void ensureLanguageLoaded(lng);
});

export default i18n;
