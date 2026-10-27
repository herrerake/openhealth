import { routeAgentRequest } from "agents";
import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import { mockProviders } from "./mock/providers";
import { athletes } from "./routes/athletes";
import { providers } from "./routes/providers";

export { AthleteAgent } from "./agent";

export const app = new Hono<AppEnv>();

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/", athletes);
app.route("/", providers);
app.route("/", mockProviders);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return (await routeAgentRequest(request, env)) ?? app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
