/** Lightweight fake-data helpers for dynamic test inputs (no external faker dependency). */

export type RandomPartNumberOptions = {
  /** Prefix for generated value (default: Part). */
  prefix?: string;
  /** Skip values equal to this (case-insensitive). */
  exclude?: string;
};

export type RandomPartNumberFromListOptions = {
  /** Skip values equal to this (case-insensitive). */
  exclude?: string;
};

const PART_SUFFIX_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomSuffix(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += PART_SUFFIX_ALPHABET[Math.floor(Math.random() * PART_SUFFIX_ALPHABET.length)];
  }
  return out;
}

/**
 * Unique Part Number in Excel sample format (e.g. Part_ABC → Part_X7K2M9).
 * Used when tests need a dynamic value each run without reading Excel Test Data.
 */
export function randomPartNumber(options: RandomPartNumberOptions = {}): string {
  const prefix = (options.prefix ?? 'Part').replace(/\s+/g, '');
  const exclude = options.exclude?.trim().toLowerCase();

  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = `${prefix}_${randomSuffix()}`;
    if (!exclude || candidate.toLowerCase() !== exclude) {
      return candidate;
    }
  }

  return `${prefix}_${randomSuffix(8)}_${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

/** Randomly pick a catalog / quote Part Number from a validated candidate list. */
export function randomPartNumberFromList(
  candidates: string[],
  options: RandomPartNumberFromListOptions = {}
): string {
  const exclude = options.exclude?.trim().toLowerCase();
  const pool = [...new Set(candidates.map((c) => c.trim()).filter(Boolean))].filter(
    (c) => !exclude || c.toLowerCase() !== exclude
  );
  if (!pool.length) {
    throw new Error(
      `No alternate Part Number candidates available${exclude ? ` (exclude=${exclude})` : ''}`
    );
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

export const fakeLibrary = {
  randomPartNumber,
  randomPartNumberFromList,
};
