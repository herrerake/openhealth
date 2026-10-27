import { Hono } from "hono";
import type { AppEnv } from "../env";
import { loadFixture } from "./fixtures";
import { verifyMockToken } from "./oauth";
import { paginateMindbody, paginateWodup } from "./paginate";

export const MOCK_WODUP_ATHLETE = "ath_Ax7Rv2Lq";
export const MOCK_MINDBODY_CLIENT = "100015482";

export const mockProviders = new Hono<AppEnv>();

// Demo-only fault injection: while R2 holds mock/fail/<provider>, that provider's data endpoint returns 500.
mockProviders.use("/mock/:provider/*", async (c, next) => {
  if (c.req.path.includes("/oauth/")) return next();
  if (await c.env.RAW.head(`mock/fail/${c.req.param("provider")}`)) return c.json({ errors: [{ detail: "injected failure" }] }, 500);
  return next();
});

const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));

// WodUp: GET /api/public/athletes/{id}/training_sessions with HTTP Basic auth (API key as username).
mockProviders.get("/mock/wodup/api/public/athletes/:id/training_sessions", async (c) => {
  const auth = c.req.header("authorization") ?? "";
  const token = auth.startsWith("Basic ") ? atob(auth.slice(6)).replace(/:$/, "") : "";
  if (!(await verifyMockToken("wodup", token, c.env.SESSION_SECRET))) return c.json({ errors: [{ detail: "unauthorized" }] }, 401);
  if (c.req.param("id") !== MOCK_WODUP_ATHLETE) return c.json({ errors: [{ detail: "athlete not found" }] }, 404);
  const all = (await loadFixture(c.env, "wodup/training_sessions.json")) as { id: string }[];
  const { status, body } = paginateWodup(all, { limit: num(c.req.query("limit")), after_cursor: c.req.query("after_cursor") });
  return c.json(body, status);
});

// Mindbody: GET /public/v6/client/clientvisits with Api-Key, SiteId and Authorization headers.
mockProviders.get("/mock/mindbody/public/v6/client/clientvisits", async (c) => {
  const token = c.req.header("authorization") ?? "";
  if (!c.req.header("api-key") || !c.req.header("siteid") || !(await verifyMockToken("mindbody", token, c.env.SESSION_SECRET))) {
    return c.json({ Error: { Message: "Unauthorized", Code: "DeniedAccess" } }, 401);
  }
  if (c.req.query("request.clientId") !== MOCK_MINDBODY_CLIENT) {
    return c.json({ Error: { Message: "Client not found", Code: "InvalidClientId" } }, 404);
  }
  const { Visits } = (await loadFixture(c.env, "mindbody/client_visits.json")) as { Visits: { StartDateTime: string }[] };
  const { status, body } = paginateMindbody(Visits, {
    limit: num(c.req.query("request.limit")),
    offset: num(c.req.query("request.offset")),
    startDate: c.req.query("request.startDate"),
    endDate: c.req.query("request.endDate"),
  });
  return c.json(body, status);
});
