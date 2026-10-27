# Decision Log

Newest decisions are appended at the bottom.
- **By** shows who decided: **Kevin** (product owner) or **Claude** (a builder's call, open to override).
- **Status** is `decided`, `assumption` (needs checking against real data), or `open`.

| ID | Date | Decision | Why | By | Status |
|---|---|---|---|---|---|
| D-001 | 2026-10-26 | Build for one athlete first: the founder's own use case | Prove the core before generalizing v1's multi-athlete scope | Kevin | decided |
| D-002 | 2026-10-26 | Demo runs on synthetic data shaped like the real WodUp, Mindbody and Apple Health outputs | Live access needs the gym owner (Mindbody activation, WodUp keys); Thursday can't wait | Kevin | decided |
| D-003 | 2026-10-27 | Dashboards and stories are separate products. The app home is dashboard-first. | Numbers belong on dashboards; stories must not repeat them | Kevin | decided |
| D-004 | 2026-10-27 | Stories synthesize long-range patterns using sports-journalist and analyst craft. See the Story Playbook. | The value is what a glance at the data can't show | Kevin | decided |
| D-005 | 2026-10-27 | The MCP server is read-only | Agents may read; only the athlete changes data or approves | Kevin | decided |
| D-006 | 2026-10-27 | The demo centerpiece is a short-form, AI-generated video story backed by the synthetic data | The single moment that should make the room lean forward | Kevin | decided |
| D-007 | 2026-10-27 | Video style: hybrid. AI footage sets the mood; graphics carry the facts. Build the graphics package first and layer footage on top. | Most compelling while keeping every fact verifiable; graphics-first guarantees a demo even if footage fails | Kevin (style), Claude (build order) | decided |
| D-008 | 2026-10-27 | Paid AI generation (voice, footage) runs only with explicit go-ahead and a set budget. Outputs are cached and never regenerated silently. | Credits cost money; reproducible demo | Claude | decided |
| D-009 | 2026-10-27 | The demo runs locally on Node 22 with SQLite, using a D1-compatible schema. Cloudflare (D1, R2, Agents SDK, Containers) arrives in v1. | Video rendering needs Chrome and ffmpeg, which Workers lack; local is the lowest risk in two days | Claude | superseded by D-024 |
| D-010 | 2026-10-27 | Conflicting distance/duration: the canonical value is device-measured over self-logged. Both values are shown and never averaged. | The watch measures; a "5k" log is often rounded | Claude | decided |
| D-011 | 2026-10-27 | Story writer model: `claude-opus-5-5`, JSON fact sheet in, tool-call script out | Writing quality matters most; structured input cuts factual errors | Claude | decided |
| D-012 | 2026-10-26 | Apple workouts are keyed `sourceName\|type\|startDate` | Health exports carry no workout UUID; this key also makes re-import idempotent | Claude | assumption |
| D-013 | 2026-10-26 | Mindbody visit times are site-local with no offset | The SDK model shows naive datetimes | Claude | assumption: verify in sandbox (site −99) |
| D-014 | 2026-10-26 | WodUp `done_at` may be the logging time; match on `wod.occurs_on` first | Athletes often log results hours later | Claude | assumption |
| D-015 | 2026-10-27 | The demo athlete is a fictional CrossFit athlete (Alex Rivera). Marathon and HYROX coverage is deferred to v1.x. | The fixtures and the storylines already exist for CrossFit | Claude | **open: confirm** |
| D-016 | 2026-10-27 | The writer emits numbers as digits (`vo_digits`); a deterministic speller produces the spoken form for TTS | The fact-checker can verify digits exactly; spoken numbers are ambiguous | Claude | decided |
| D-017 | 2026-10-27 | Draft videos end with a "Draft" card. Approval re-renders the final video with "Approved by Alex". | Approval stays a human action and is visible in the artifact | Claude | decided |
| D-018 | 2026-10-27 | Keep the 12 reconciliation edge cases. Regenerate the benchmark results in the final 4 weeks to fit the two-year storylines. | The four-week metrics (weekly PR flags, Fran 4:58→4:21 in three weeks) contradict a two-year arc | Claude | decided |
| D-019 | 2026-10-27 | Code ranks, picks and merges angles (primary + supporting beats inside its span). The model only writes. The data is tuned so the Fran rematch wins. | Keeps angle choice deterministic and testable; the demo story is known in advance | Claude | decided |
| D-020 | 2026-10-27 | Demo steps 1–4 use one static desk page plus the terminal log, not separate app screens | Keeps UI effort from rivaling the video work | Claude | decided |
| D-021 | 2026-10-27 | Cut order if behind: S1–S3 → streak/ownWords detectors → footage → voiceover → desk timeline → raw-payload expansion. Never cut H2, H6, or decoy rejection. | Two days is tight; protect the things that make the story trustworthy | Claude | decided |
| D-022 | 2026-10-27 | Judging criteria add H11 (real Apple Health import), H12 (timed, fast pipeline) and H13 (demo video + clean codebase). Hosting is not judged, so local is fine for D-009; deploying the story page to Workers is a bonus. | Scored on a live demo, a demo video, and the codebase: usability, performance, completeness | Kevin (criteria), Claude (requirements) | decided |
| D-023 | 2026-10-27 | Every service (Apple Health, Garmin, Oura, WHOOP, WodUp, Mindbody, HYROX, race results) is shown as connectable through one connector interface with a demo-mode sign-in. The demo connects only WodUp, Mindbody and Apple Health, which have synthetic data. | Show the full aggregation vision without blocking on API access | Kevin | decided |
| D-024 | 2026-10-27 | App stack: Cloudflare Workers (Hono) + D1 + R2 + an Agents SDK Durable Object per athlete + a React/Vite frontend, run locally with `wrangler dev`. Phase C video rendering stays local Node. | Onboarding, live sync progress and future chat dashboards need a real app backend; the Agents SDK gives state sync now and chat later; deployable as is | Claude | decided |
| D-025 | 2026-10-27 | Apple Health exports are parsed in the browser (streaming, Web Worker). Only workouts, daily metrics and HR aggregates are sent; raw HR samples stay on the device. | Multi-GB files exceed request limits; faster and more private; a visible performance win | Claude | decided |
| D-026 | 2026-10-27 | Dashboards are JSON specs rendered from a tile library, and every tile returns a `calc` provenance envelope. The home dashboard is the first spec. | Chat-built dashboards (v1) emit the same spec, so the renderer is built once | Claude | decided |
| D-027 | 2026-10-27 | Build order: data infrastructure → onboarding and first dashboard → story engine | The story needs a trustworthy data core and a real user flow under it | Kevin | decided |
