# OpenHealth

ESPN-style coverage for amateur athletes. OpenHealth pulls an athlete's training data from the apps they already use into one owned history, then builds dashboards and data-backed stories on top. The why is in [docs/VISION.md](docs/VISION.md); the what and how are in [docs/PRD.md](docs/PRD.md) and [docs/SPEC.md](docs/SPEC.md).

**Phase A, the data infrastructure:**
- connectors (WodUp, Mindbody, Apple Health, and demo stubs for Garmin, Oura, WHOOP, HYROX and race results);
- the D1 schema;
- a streaming Apple Health parser;
- deterministic reconciliation;
- sync runs driven by a per-athlete Durable Object agent.

## Quickstart

```bash
npm install
npm run fixtures                                       # two years of synthetic data + validation
npx wrangler d1 migrations apply openhealth --local    # local D1 schema
npm run seed:mock                                      # fixtures → local R2 for the demo providers
cp .dev.vars.example .dev.vars                         # local SESSION_SECRET
npm run dev                                            # wrangler dev on :8787
```

In a second terminal:

```bash
npm run demo:sync                                      # athlete → connect → Apple upload → sync → summary
npm run demo:sync -- --apple ~/Downloads/export.zip    # your own Health export instead of the fixture
```

A second `demo:sync` reuses the same demo athlete and shows that nothing is duplicated.

## Frontend

The app is Astro static pages with shadcn/ui React islands, served by the same Worker (D-028, D-029).

| Command | What it does |
|---|---|
| `npm run dev` | Builds the site and runs `wrangler dev` on :8787 (API, agents, demo providers and pages) |
| `npm run dev:web` | Astro dev server with hot reload. It proxies `/api`, `/agents` and `/mock` to a running `wrangler dev`. |
| `npm run e2e` | Playwright end-to-end tests against `wrangler dev` with isolated local state (`.wrangler/e2e`) |

The flow:
1. `/onboarding`: profile.
2. `/onboarding/connect`: providers and the Apple Health upload, parsed in the browser.
3. `/onboarding/sync`: live progress over the athlete agent.
4. `/dashboard`: tiles and the review sheet.

## Deploy

Live demo: https://openhealth.herrerake.workers.dev

```bash
npx wrangler d1 migrations apply openhealth --remote
npm run seed:mock -- --remote
npx wrangler deploy
openssl rand -base64 48 | npx wrangler secret put SESSION_SECRET   # first deploy only
OPENHEALTH_URL=https://openhealth.herrerake.workers.dev npm run demo:sync
```

## CI/CD

| When | Workflow | What happens |
|---|---|---|
| A pull request opens or updates | `ci.yml` | Fixtures, typecheck and tests (the required **Test** check), Playwright **E2E**, then a Worker Preview named `pr-<number>`. A comment posts its URL. |
| A PR is merged into `main` | `deploy.yml` | The same checks, then D1 migrations, fixture seeding and `wrangler deploy` to production |
| A PR closes | `preview-cleanup.yml` | Deletes that PR's Preview |

**Preview isolation:**
- Each Preview gets its own Durable Object namespace automatically.
- D1 and R2 point at `openhealth-preview` / `openhealth-raw-preview` (the `previews` block in `wrangler.jsonc`).
- `SESSION_SECRET` comes from the Preview base config.

**Repository settings** (one-time):

| Setting | Value |
|---|---|
| Secret `CLOUDFLARE_API_TOKEN` | Workers Scripts: Edit, D1: Edit, Workers R2 Storage: Edit, Account Settings: Read |
| Variable `CLOUDFLARE_ACCOUNT_ID` | — |

`main` is protected: changes land through a pull request with a passing **Test** check and one approval.

## Tests

```bash
npm test          # Node (core) + Workers (worker) projects
npm run typecheck
```

## Layout

| Path | What |
|---|---|
| `src/core/` | Pure logic: time zones, normalization, the Apple export parser, reconciliation |
| `src/connectors/` | One connector per provider, behind a shared interface |
| `src/worker/` | Hono API, the demo providers (`/mock/*`), and the `AthleteAgent` sync runner |
| `src/db/migrations/` | D1 schema |
| `fixtures/` | Synthetic-data generator, validator, and answer key (`expected.json`) |
| `docs/` | PRD, SPEC, story playbook, decision log, plans |
