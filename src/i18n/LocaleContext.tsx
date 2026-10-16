import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { translations, type Locale, type TranslationKey } from "./translations";

const STORAGE_KEY = "ai_helpdesk_locale";

/** Keys with plural forms: "replies" for repliesOne / repliesFew / repliesMany / repliesOther. */
type PluralBase<K> = K extends `${infer Base}One` ? Base : never;
export type PluralKey = PluralBase<TranslationKey>;

const PLURAL_SUFFIX = { one: "One", few: "Few", many: "Many", other: "Other" } as const;

// Our "kz" is "kk" (Kazakh) in Intl.
const INTL_LOCALE: Record<Locale, string> = { en: "en", kz: "kk", ru: "ru" };

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
  /** Count with the right word form: "1 reply", "2 ответа", "5 ответов". */
  plural: (count: number, key: PluralKey) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function readStoredLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "kz" || stored === "ru") return stored;
  return "en";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const t = useCallback(
    (key: TranslationKey) => translations[locale][key],
    [locale],
  );

  const plural = useMemo(() => {
    const rules = new Intl.PluralRules(INTL_LOCALE[locale]);
    return (count: number, key: PluralKey) => {
      const category = rules.select(count);
      const suffix = category in PLURAL_SUFFIX
        ? PLURAL_SUFFIX[category as keyof typeof PLURAL_SUFFIX]
        : "Other";
      return `${count} ${translations[locale][`${key}${suffix}`]}`;
    };
  }, [locale]);

  const value = useMemo(
    () => ({ locale, setLocale, t, plural }),
    [locale, setLocale, t, plural],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}
