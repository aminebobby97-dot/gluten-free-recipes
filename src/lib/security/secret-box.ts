// Encryption for secrets stored in the database (Pinterest OAuth tokens).
// AES-256-GCM with a random IV per value; the key lives only in the server
// environment (never in the database, the browser or the repository). Each
// value is bound to a purpose ("additional data"), so an encrypted refresh
// token cannot be passed off as an access token.
//
// Format: v1.<iv>.<auth tag>.<ciphertext>, each part base64url.

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = "v1";

/**
 * Parses a 32-byte key given as base64 (openssl rand -base64 32) or 64 hex
 * characters (openssl rand -hex 32). Returns null for anything else.
 */
export function parseEncryptionKey(value: string | undefined | null): Buffer | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(raw)) {
    const key = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (key.length === 32) return key;
  }
  return null;
}

/** A separate 32-byte key for each use of the master key (HKDF-SHA256). */
export function deriveKey(master: Buffer, label: string): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), label, 32));
}

export function encryptSecret(plain: string, key: Buffer, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(purpose));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

/** Throws if the value was not encrypted with this key and purpose, or was changed. */
export function decryptSecret(sealed: string, key: Buffer, purpose: string): string {
  const [version, iv, tag, data, extra] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || data === undefined || extra !== undefined) throw new Error("Unrecognized encrypted value.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** HMAC-SHA256 of `message`, base64url. Used to sign short-lived cookies. */
export function sign(message: string, key: Buffer, purpose: string): string {
  return createHmac("sha256", key).update(`${purpose}\n${message}`).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
