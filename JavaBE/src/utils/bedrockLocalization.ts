import type { ExtractedZipEntry } from '@/utils/zip';
type TranslationMap = Record<string, string>;
const LOCALE = /^[a-z]{2}_[A-Z]{2}$/;
const KEY = /^[A-Za-z0-9_.:-]+$/;
function normalizeLocale(value: string): string | null {
  const match = value.replace('-', '_').match(/^([a-z]{2})_([a-z]{2})$/i);
  if (!match) return null;
  const locale = `${match[1].toLowerCase()}_${match[2].toUpperCase()}`;
  return LOCALE.test(locale) ? locale : null;
}
function parseLang(text: string): TranslationMap {
  const result: TranslationMap = {};
  for (const line of text.split(/\r?\n/)) {
    const row = line.trim();
    if (!row || row.startsWith('#') || row.startsWith('!')) continue;
    const split = row.indexOf('=');
    const key = split > 0 ? row.slice(0, split).trim() : '';
    const value = split > 0 ? row.slice(split + 1).trim() : '';
    if (KEY.test(key) && value) result[key] = value;
  }
  return result;
}
function encodeLang(values: TranslationMap): string {
  return `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
}
/** Convert Java language resources to Bedrock locale declarations and .lang entries. */
export function buildBedrockLocalization(entries: ExtractedZipEntry[] | undefined, defaults: string[]) {
  const translations = new Map<string, TranslationMap>();
  const english: TranslationMap = {};
  for (const line of defaults) Object.assign(english, parseLang(line));
  translations.set('en_US', english);
  for (const entry of entries ?? []) {
    const match = entry.path.replace(/\\/g, '/').match(/(?:^|\/)lang\/([a-z]{2}[_-][a-z]{2})\.(json|lang)$/i);
    if (!match || entry.isDirectory) continue;
    const locale = normalizeLocale(match[1]);
    if (!locale) continue;
    try {
      const text = new TextDecoder().decode(entry.data);
      let source: TranslationMap;
      if (match[2].toLowerCase() === 'json') {
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
        source = Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
          .filter(([key, value]) => KEY.test(key) && typeof value === 'string' && value.trim())
          .map(([key, value]) => [key, (value as string).trim()]));
      } else source = parseLang(text);
      if (Object.keys(source).length === 0) continue;
      const current = translations.get(locale) ?? {};
      Object.assign(current, source);
      translations.set(locale, current);
    } catch {
      // Invalid source localization is excluded rather than copied into a pack.
    }
  }
  if (Object.keys(translations.get('en_US') ?? {}).length === 0) {
    translations.set('en_US', { 'pack.name': 'Bedrock Add-on', 'pack.description': 'Converted content' });
  }
  const files: Record<string, string> = {};
  for (const [locale, values] of translations) files[`texts/${locale}.lang`] = encodeLang(values);
  return { languagesJson: JSON.stringify([...translations.keys()], null, 2), files };
}
/** Restore declarations and a default locale while retaining valid shipped translations. */
export function normalizeBedrockLocalization(files: Record<string, string | Uint8Array>): void {
  const translations = new Map<string, TranslationMap>();
  for (const path of Object.keys(files)) {
    const match = path.match(/^texts\/([a-z]{2}_[a-z]{2})\.lang$/i);
    if (!match) continue;
    const locale = normalizeLocale(match[1]);
    if (!locale) continue;
    const raw = files[path];
    const content = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    const values = parseLang(content);
    if (Object.keys(values).length > 0) translations.set(locale, values);
    delete files[path];
  }
  if (!translations.has('en_US')) {
    translations.set('en_US', { 'pack.name': 'Bedrock Add-on', 'pack.description': 'Converted content' });
  }
  for (const [locale, values] of translations) files[`texts/${locale}.lang`] = encodeLang(values);
  files['texts/languages.json'] = JSON.stringify([...translations.keys()], null, 2);
}