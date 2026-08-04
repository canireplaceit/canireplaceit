/**
 * Locale handling, shared by the API and the web app.
 *
 * Translatable content lives in one map per row, keyed by locale. Adding a
 * language is a data migration, never a schema change.
 */

export const SupportedLangs = ["en", "fr"] as const;
export type Lang = (typeof SupportedLangs)[number];

/** English is authored first here, so it is the fallback. */
export const DEFAULT_LANG: Lang = "en";

export const isLang = (v: unknown): v is Lang =>
	typeof v === "string" && (SupportedLangs as readonly string[]).includes(v);

/** `en` is required; every other locale is optional and falls back to it. */
export type Translations = { en: string } & Partial<Record<Lang, string>>;

export function resolveTranslation(
	translations: Translations,
	lang: Lang,
): string {
	// `en` is structurally required, so the fallback can never be undefined.
	return translations[lang] ?? translations.en;
}
