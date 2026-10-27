import type { ProviderId } from "../../core/types";

// Demo-provider access tokens: stateless and verifiable, `mock_<provider>_<hmac>`.

async function hmacB64url(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`mock-token:${value}`));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function mintMockToken(provider: ProviderId, secret: string): Promise<string> {
  return `mock_${provider}_${await hmacB64url(provider, secret)}`;
}

export async function verifyMockToken(provider: ProviderId, token: string, secret: string): Promise<boolean> {
  return token === (await mintMockToken(provider, secret));
}

const MOCK_CODE_PREFIX = "code_";

export async function mintMockCode(provider: ProviderId, state: string, secret: string): Promise<string> {
  return `${MOCK_CODE_PREFIX}${provider}_${await hmacB64url(`code:${provider}:${state}`, secret)}`;
}

export async function verifyMockCode(provider: ProviderId, state: string, code: string, secret: string): Promise<boolean> {
  return code === (await mintMockCode(provider, state, secret));
}
