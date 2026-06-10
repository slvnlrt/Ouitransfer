/** Languages that use right-to-left (RTL) text direction */
export const RTL_LANGUAGES = ["ar-SA", "fa-IR", "he-IL"] as const;

/** Base-code equivalents of RTL_LANGUAGES (e.g. "ar", "fa", "he") for contexts
 *  where only the language portion is available. */
export const RTL_BASE_LANGUAGES: string[] = RTL_LANGUAGES.map((code) => code.split("-")[0]);
