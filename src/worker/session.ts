import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "./env";

export const SESSION_COOKIE = "oh_session";

const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

export async function signSession(athleteId: string, secret: string): Promise<string> {
  return `${athleteId}.${await hmac(athleteId, secret)}`;
}

export async function verifySession(value: string | undefined, secret: string): Promise<string | null> {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const athleteId = value.slice(0, dot);
  const expected = await hmac(athleteId, secret);
  const given = value.slice(dot + 1);
  if (expected.length !== given.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0 ? athleteId : null;
}

export const requireAthlete = createMiddleware<AppEnv>(async (c, next) => {
  const athleteId = await verifySession(getCookie(c, SESSION_COOKIE), c.env.SESSION_SECRET);
  if (!athleteId) return c.json({ error: "unauthorized" }, 401);
  c.set("athleteId", athleteId);
  await next();
});
