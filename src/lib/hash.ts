/** Small deterministic helpers for the Sandbox: hashes, seeded random numbers and stable ids. */

/** 32-bit FNV-1a hash of a string, with an optional seed. */
export function hash32(text: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Seeded random numbers in [0, 1) (mulberry32): the same seed gives the same sequence. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A UUID (v4 layout) derived from its parts: the same parts always give the same id. */
export function stableUuid(...parts: readonly string[]): string {
  const key = parts.join("\u0000");
  const hex = [0x811c9dc5, 0x01234567, 0x89abcdef, 0x5bd1e995]
    .map((seed) => hash32(key, seed).toString(16).padStart(8, "0"))
    .join("");
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
