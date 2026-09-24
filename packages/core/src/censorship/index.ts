import type { CensorshipSettings } from "@editor/schemas";
import en from "./en.json";
import es from "./es.json";

export interface WordList {
  language: string;
  words: string[];
  prefixes: string[];
}

export const BASE_LISTS: Record<string, WordList> = { es, en };

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i" };

/**
 * Canonical form used for matching: lowercase, accents stripped (ñ kept),
 * leetspeak mapped, punctuation removed.
 */
export function normalizeWord(raw: string): string {
  let s = raw.toLowerCase().replace(/ñ/g, "\u0000");
  s = s.normalize("NFD").replace(/\p{M}/gu, "").replace(/\u0000/g, "ñ");
  // Punctuation around the word is not leetspeak ("shit!" is not "shiti").
  s = s.replace(/^[^\p{L}\p{N}@$]+|[^\p{L}\p{N}]+$/gu, "");
  s = s.replace(/[013457@$!]/g, (c) => LEET[c] ?? c);
  return s.replace(/[^a-zñ]/g, "");
}

/**
 * Spellings to try for an elongated word: runs of 3+ letters collapsed to one
 * ("puuuta" → "puta") and to two ("pollllla" → "polla"). Double letters are
 * left alone so "pola" never collides with "polla".
 */
function candidates(normalized: string): string[] {
  const one = normalized.replace(/(.)\1{2,}/g, "$1");
  const two = normalized.replace(/(.)\1{2,}/g, "$1$1");
  return [...new Set([normalized, one, two])];
}

export interface Matcher {
  isProfane(word: string): boolean;
}

export function buildMatcher(settings: Pick<CensorshipSettings, "languages" | "addWords" | "allowWords">): Matcher {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  const allow = new Set<string>();
  for (const lang of settings.languages) {
    const list = BASE_LISTS[lang];
    if (list) {
      list.words.forEach((w) => exact.add(normalizeWord(w)));
      list.prefixes.forEach((p) => prefixes.push(normalizeWord(p)));
    }
    (settings.addWords[lang] ?? []).forEach((w) => exact.add(normalizeWord(w)));
    (settings.allowWords[lang] ?? []).forEach((w) => allow.add(normalizeWord(w)));
  }
  // User additions for languages not enabled still apply ("*" or any key).
  for (const [lang, words] of Object.entries(settings.addWords)) {
    if (!settings.languages.includes(lang)) words.forEach((w) => exact.add(normalizeWord(w)));
  }
  return {
    isProfane(word: string) {
      const n = normalizeWord(word);
      if (!n) return false;
      const forms = candidates(n);
      if (forms.some((f) => allow.has(f))) return false;
      return forms.some((f) => exact.has(f) || prefixes.some((p) => f.startsWith(p)));
    },
  };
}

/** How a censored word is drawn in captions. */
export function maskWord(text: string, mode: CensorshipSettings["captionMask"]): string {
  const letters = [...text];
  const isLetter = (c: string) => /\p{L}/u.test(c);
  switch (mode) {
    case "none":
      return text;
    case "asterisks":
      return letters.map((c) => (isLetter(c) ? "*" : c)).join("");
    case "grawlix": {
      const g = "#$%&@!";
      let i = 0;
      return letters.map((c) => (isLetter(c) ? g[i++ % g.length] : c)).join("");
    }
    case "first_letter": {
      let seen = false;
      return letters
        .map((c) => {
          if (!isLetter(c)) return c;
          if (!seen) {
            seen = true;
            return c;
          }
          return "*";
        })
        .join("");
    }
  }
}
