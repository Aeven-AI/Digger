// What a high-score name may look like. Shared by the sim's classic screens, the
// storage layer and the HTML overlay so all three agree on the same rules.

/** Longest name the table accepts. */
export const MAX_NAME = 12;
/** Everything a name may not contain. */
export const NAME_PATTERN = /[^A-Z0-9 .'-]/g;
/** Curly quotes and dashes, folded to their ASCII form before filtering. */
const FOLDABLE = /[\u2018\u2019\u201a\u2032\u201c\u201d\u201e\u2013\u2014]/g;
const FOLDED: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201a': "'",
  '\u2032': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u201e': '"',
  '\u2013': '-',
  '\u2014': '-',
};

/**
 * Fold raw input into a storable name: accents and lookalike punctuation to ASCII,
 * upper case, allowed characters only, single spaces, trimmed and capped.
 * @param s raw text from the keyboard
 * @returns the sanitized name, possibly empty
 */
export function sanitizeName(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(FOLDABLE, (c) => FOLDED[c] ?? c)
    .toUpperCase()
    .replace(NAME_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
}
