/** Short random id with a type prefix, e.g. `seg_k3j9x2ab`. Not for security. */
export function newId(prefix: string): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let s = "";
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `${prefix}_${s}`;
}
