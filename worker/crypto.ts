/**
 * Web Crypto AES-256-GCM helper for encrypting user-provided BYOK API keys at rest.
 * Works identically in Node.js 22 and Cloudflare Workers.
 */

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function deriveAesKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plaintext: string, masterSecret: string): Promise<string> {
  const key = await deriveAesKey(masterSecret);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encoded = new TextEncoder().encode(plaintext);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded));
  return `${toBase64(iv)}.${toBase64(cipher)}`;
}

export async function decryptSecret(payload: string, masterSecret: string): Promise<string | null> {
  const parts = payload.split(".");
  if (parts.length !== 2) return null;
  try {
    const key = await deriveAesKey(masterSecret);
    const iv = fromBase64(parts[0]);
    const cipher = fromBase64(parts[1]);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      cipher as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export function maskApiKey(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= 8) return "••••";
  return `${trimmed.slice(0, 5)}••••${trimmed.slice(-4)}`;
}
