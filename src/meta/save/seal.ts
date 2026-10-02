/**
 * The envelope every save is written in: the profile, its backups, the run
 * snapshot and the exported text.
 *
 * The point is to stop a player opening the file in a text editor and giving
 * themselves a million shards, not to stop a determined one: the key ships
 * in the bundle, so anyone who reads the source can forge a seal. Two layers:
 *
 * - a 64-bit keyed tag over the JSON, so an edit (or a file from another
 *   game) is caught on load and treated as a broken save;
 * - the JSON XORed with a keystream seeded by that tag, so the file is not
 *   readable — there are no numbers in it to find and change.
 *
 * Synchronous on purpose (no `crypto.subtle`): `snapshotRun` and
 * `exportProfile` stay sync, and a profile is small.
 *
 * Text form: `TWR1.` + base64(tag[8] ‖ body).
 */

const PREFIX = 'TWR1.';
const KEY = 'tower/7c1e9a4f-seal-2f86d0b3';

export class SealError extends Error {}

/** Two 32-bit FNV-1a-style lanes over the key and `bytes`, mixed at the end. */
function tag(bytes: Uint8Array): Uint8Array {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  const feed = (x: number): void => {
    a = Math.imul(a ^ x, 0x01000193);
    b = Math.imul(b ^ x, 0x5bd1e995);
    b ^= b >>> 15;
  };
  for (let i = 0; i < KEY.length; i++) feed(KEY.charCodeAt(i));
  for (let i = 0; i < bytes.length; i++) feed(bytes[i]);
  feed(bytes.length & 0xff);
  feed((bytes.length >>> 8) & 0xff);
  feed((bytes.length >>> 16) & 0xff);
  a ^= a >>> 16; a = Math.imul(a, 0x85ebca6b); a ^= a >>> 13; a = Math.imul(a, 0xc2b2ae35); a ^= a >>> 16;
  b ^= Math.imul(a, 0x27d4eb2f); b ^= b >>> 13; b = Math.imul(b, 0x165667b1); b ^= b >>> 16;
  const out = new Uint8Array(8);
  new DataView(out.buffer).setUint32(0, a >>> 0);
  new DataView(out.buffer).setUint32(4, b >>> 0);
  return out;
}

/** XOR `bytes` in place with an xorshift128 stream seeded by the tag and the key. */
function scramble(bytes: Uint8Array, t: Uint8Array): void {
  const v = new DataView(t.buffer, t.byteOffset, 8);
  let x = v.getUint32(0) ^ 0x6a09e667;
  let y = v.getUint32(4) ^ 0xbb67ae85;
  let z = 0x3c6ef372;
  let w = 0xa54ff53a;
  for (let i = 0; i < KEY.length; i++) w = Math.imul(w ^ KEY.charCodeAt(i), 0x01000193);
  if ((x | y | z | w) === 0) x = 1;
  let word = 0;
  for (let i = 0; i < bytes.length; i++) {
    if ((i & 3) === 0) {
      const s = x ^ (x << 11);
      x = y; y = z; z = w;
      w = (w ^ (w >>> 19) ^ s ^ (s >>> 8)) >>> 0;
      word = w;
    }
    bytes[i] ^= (word >>> ((i & 3) * 8)) & 0xff;
  }
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** True if `text` is in the sealed form at all (it may still fail to open). */
export function isSealed(text: string): boolean {
  return text.trim().startsWith(PREFIX);
}

/** `json` sealed. */
export function seal(json: string): string {
  const plain = new TextEncoder().encode(json);
  const t = tag(plain);
  const out = new Uint8Array(8 + plain.length);
  out.set(t, 0);
  out.set(plain, 8);
  scramble(out.subarray(8), t);
  return PREFIX + toBase64(out);
}

/** The JSON inside `text`. Throws `SealError` on anything not sealed by `seal`, or edited since. */
export function unseal(text: string): string {
  const s = text.trim();
  if (!s.startsWith(PREFIX)) throw new SealError('not sealed');
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(s.slice(PREFIX.length));
  } catch {
    throw new SealError('not sealed');
  }
  if (bytes.length < 8) throw new SealError('not sealed');
  const t = bytes.slice(0, 8);
  const body = bytes.slice(8);
  scramble(body, t);
  const check = tag(body);
  for (let i = 0; i < 8; i++) if (check[i] !== t[i]) throw new SealError('seal broken');
  return new TextDecoder().decode(body);
}
