import en from './en.json';
import ar from './ar.json';
import type { Lang } from '../progression/save';

const dicts: Record<Lang, Record<string, string>> = { en, ar };
let current: Lang = 'en';
const listeners = new Set<() => void>();

export function t(key: string, vars: Record<string, string | number> = {}): string {
  const s = dicts[current][key] ?? dicts.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function setLang(lang: Lang) {
  current = lang;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  listeners.forEach((l) => l());
}

export const getLang = () => current;
export const onLangChange = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };
export const hasKey = (key: string) => key in dicts.en;
