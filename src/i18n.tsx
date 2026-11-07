import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Language } from './types';
import { en } from './i18n-en';

interface I18nValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (uk: string, vars?: Record<string, string | number>) => string;
  td: (message: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

const dynamicRules: Array<{ re: RegExp; en: (m: RegExpMatchArray) => string }> = [
  {
    re: /^χ²\/dof = ([\d.]+) — модель погано описує дані або похибки занижені\.$/,
    en: (m) => `χ²/dof = ${m[1]} — the model fits poorly or uncertainties are underestimated.`,
  },
  {
    re: /^Регресор «([^»]+)» пропущено: замало значень\.$/,
    en: (m) => `Regressor "${m[1]}" skipped: too few values.`,
  },
  {
    re: /^Для BLS потрібно щонайменше (\d+) валідних точок\.$/,
    en: (m) => `BLS requires at least ${m[1]} valid points.`,
  },
  {
    re: /^Діапазон періодів некоректний: min=([\d.]+) d, max=([\d.]+) d\.$/,
    en: (m) => `Invalid period range: min=${m[1]} d, max=${m[2]} d.`,
  },
  {
    re: /^BLS worker failed: (.+)$/,
    en: (m) => `BLS worker failed: ${m[1]}`,
  },
];

export function translateDynamic(lang: Language, message: string): string {
  if (lang !== 'en') return message;
  if (en[message]) return en[message];
  for (const rule of dynamicRules) {
    const match = message.match(rule.re);
    if (match) return rule.en(match);
  }
  return message;
}

const STORAGE_KEY = 'exoscope.language';

function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'uk' || saved === 'en') return saved;
  } catch {
    /* storage may be unavailable */
  }
  return 'uk';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(initialLanguage);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  const setLang = useCallback((next: Language) => setLangState(next), []);

  const t = useCallback(
    (uk: string, vars?: Record<string, string | number>) => {
      let text = lang === 'en' ? en[uk] ?? uk : uk;
      if (vars) {
        for (const [key, value] of Object.entries(vars)) {
          text = text.split(`{${key}}`).join(String(value));
        }
      }
      return text;
    },
    [lang],
  );

  const td = useCallback((message: string) => translateDynamic(lang, message), [lang]);

  const value = useMemo(() => ({ lang, setLang, t, td }), [lang, setLang, t, td]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}

export function LanguageToggle() {
  const { lang, setLang } = useI18n();
  return (
    <div className="lang-toggle" role="group" aria-label="Language / Мова">
      <button
        type="button"
        className={lang === 'uk' ? 'active' : ''}
        onClick={() => setLang('uk')}
      >
        UA
      </button>
      <button
        type="button"
        className={lang === 'en' ? 'active' : ''}
        onClick={() => setLang('en')}
      >
        EN
      </button>
    </div>
  );
}
