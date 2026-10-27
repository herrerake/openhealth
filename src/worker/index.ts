import { routeAgentRequest } from "agents";
import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import { registerInternalHandler } from "./internal";
import { mockOAuth } from "./mock/oauthRoutes";
import { mockProviders } from "./mock/providers";
import { connect } from "./routes/connect";
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

registerInternalHandler((request, env) => app.fetch(request, env));

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return (await routeAgentRequest(request, env)) ?? app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
