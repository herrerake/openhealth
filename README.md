# OpenHealth

ESPN-style coverage for amateur athletes. OpenHealth pulls an athlete's training data from the apps they already use into one owned history, then builds dashboards and data-backed stories on top. See [docs/PRD.md](docs/PRD.md) and [docs/SPEC.md](docs/SPEC.md).

**Phase A (this branch) is the data infrastructure:**
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
