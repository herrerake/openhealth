import type { Env } from "./env";

// Demo connectors talk to the mock providers over the same HTTP shapes as the real
// ones, but in-process: `http://internal/mock/...` is dispatched to this Worker's app
// instead of making a network round trip back to ourselves.

type Handler = (request: Request, env: Env) => Response | Promise<Response>;
let handler: Handler | null = null;

export const INTERNAL_ORIGIN = "http://internal";

export function registerInternalHandler(h: Handler): void {
  handler = h;
}

export function internalFetch(env: Env): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input instanceof Request ? input : String(input), init);
    if (new URL(request.url).origin !== INTERNAL_ORIGIN) return fetch(request);
    if (!handler) throw new Error("internal handler not registered");
    return handler(request, env);
  }) as typeof fetch;
}

export const mockBaseUrl = (provider: string) => `${INTERNAL_ORIGIN}/mock/${provider}`;
