import { routeAgentRequest } from "agents";
import { Hono } from "hono";
import type { Env } from "./env";

export { AthleteAgent } from "./agent";

export const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return (await routeAgentRequest(request, env)) ?? app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
