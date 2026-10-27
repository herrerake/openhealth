import { routeAgentRequest } from "agents";
import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import { registerInternalHandler } from "./internal";
import { mockOAuth } from "./mock/oauthRoutes";
import { mockProviders } from "./mock/providers";
import { connect } from "./routes/connect";
import { sync } from "./routes/sync";
import { SESSION_COOKIE, verifySession } from "./session";
import { athletes } from "./routes/athletes";
import { providers } from "./routes/providers";

export { AthleteAgent } from "./agent";

export const app = new Hono<AppEnv>();

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/", athletes);
app.route("/", providers);
app.route("/", mockProviders);
app.route("/", mockOAuth);
app.route("/", connect);
app.route("/", sync);

registerInternalHandler((request, env) => app.fetch(request, env));

const sessionFromCookie = (request: Request) =>
  request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);

/** An athlete's agent (/agents/athlete-agent/<athleteId>) is reachable only with that athlete's session. */
async function authorizeAgentRequest(request: Request, env: Env): Promise<Response | null> {
  // Split exactly as routeAgentRequest does (empty segments dropped), so "//agents/..." can't slip past.
  const [prefix, , instance] = new URL(request.url).pathname.split("/").filter(Boolean);
  if (prefix !== "agents") return null;
  const athleteId = await verifySession(sessionFromCookie(request), env.SESSION_SECRET);
  if (!athleteId) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (decodeURIComponent(instance ?? "") !== athleteId) return Response.json({ error: "forbidden" }, { status: 403 });
  return null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const denied = await authorizeAgentRequest(request, env);
    if (denied) return denied;
    return (await routeAgentRequest(request, env)) ?? app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
