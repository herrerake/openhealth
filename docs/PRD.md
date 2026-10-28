# OpenHealth — Product Requirements

Version 2.0 · 2026-10-27 · Status: draft for review
Supersedes v1.0. v1's data and ownership principles carry forward (§4). Its scope is replaced.

Related: [SPEC](SPEC.md) · [Story Playbook](STORY-PLAYBOOK.md) · [Decisions](DECISIONS.md) · [Fixtures](../fixtures/README.md)

## 1. Vision

**ESPN-style coverage for amateur athletes.**

Professional athletes have analysts, data desks, and reporters. Amateurs have a dozen apps that don't talk to each other. OpenHealth pulls an athlete's data into one place and gives them a newsroom:

- **Dashboards** that answer what happened.
- **Stories** that explain what it means: authentic, compelling, entertaining, informative, and backed by data.

**The ethos is software that builds software.** We don't hand-build a product per sport. We build the factory: AI assembles each athlete's dashboards, finds their storylines, and produces their coverage, inside rules that keep every fact true.

## 2. Who it's for

1. **The athlete.** An amateur who trains seriously and logs it across tools. Examples:
   - a CrossFit athlete using WodUp, Mindbody, and an Apple Watch;
   - a marathoner and HYROX racer with race results, a Garmin, and a training calendar.
2. **Their followers.** Family, friends, a run club, a coach. They follow the athlete's coverage the way fans follow a team.

The athlete comes first. Followers see only what the athlete approves.

## 3. Product shape (full vision)

| Layer | What it does |
|---|---|
| **Inputs** | 1. **Events**: race registrations, bibs, official results (mile splits, HYROX station times, year-over-year). 2. **Daily training**: wearables (Apple Watch, Garmin) and gym apps (WodUp, Mindbody). 3. **The athlete's voice**: an AI interviewer that runs post-race pressers, post-session check-ins, and a weekly sit-down. |
| **Data core** | One owned history: source records kept as received, reconciled into canonical sessions, with provenance on every value. |
| **Analyst** | Deterministic code that computes metrics and finds story angles (Playbook §3). |
| **Interface** | Conversation first. A few standard dashboards. Anything else is asked for by chat or voice ("build me a dashboard comparing my last three HYROX races"), and AI assembles it from vetted components. |
| **Coverage** | Written stories (v1), then short-, medium-, and long-form video assembled with the athlete's photos and clips. |
| **Distribution** | An athlete page and a follower feed. Later, social formats. |
| **Open access** | A read-only MCP server, so the athlete can bring their data to any AI assistant. |

## 4. Principles (non-negotiable)

1. **Facts come from code, words from the model.** Every number, date, comparison, and superlative is computed deterministically. The model writes, it never calculates (Playbook §2).
2. **Pictures set the mood, graphics carry the facts.** In video, generated footage never depicts a claim. Every number on screen is rendered from verified data.
3. **Authentic or nothing.** No invented quotes, feelings, injuries, competitions, or causes. Only the athlete's own words, from notes or interviews, appear as quotes, and they are attributed and dated.
4. **Association, not causation.** Patterns are described as patterns (Playbook §4).
5. **The athlete approves.** Nothing reaches followers without the athlete's approval. AI cannot approve, publish, change consent, or delete data.
6. **The athlete owns the data.** Export and delete stay first-class (carried from v1, R11).
7. **Imported text is data, not instructions.**

## 5. Release plan

| Release | Goal | Scope |
|---|---|---|
| **Hackathon demo (Thu 2026-10-29)** | Prove the engine: data in, one compelling, verified short-form video story out | §6 |
| **v1** | Usable for one real athlete (the founder) | Real imports (Apple Health export, WodUp, Mindbody), standard dashboards, chat-built dashboards, written stories, read-only MCP, athlete approval |
| **v1.x** | Coverage worth following | AI interviewer, follower page, race-result ingestion (marathon, HYROX), voice navigation |
| **Later** | The factory at scale | Multi-athlete, video formats beyond the demo, social distribution, AI-built connectors for new sources |

## 6. Hackathon demo requirements

**Build order (2026-10-27):**
1. Data infrastructure.
2. Onboarding and the first dashboard.
3. The story engine (H3–H10).

See SPEC §0.

### 6.1 Data infrastructure, onboarding, dashboard

| ID | Requirement | Acceptance criteria |
|---|---|---|
| **A1** | Connector framework | Every provider (Apple Health, Garmin, Oura, WHOOP, WodUp, Mindbody, HYROX, race results) implements one connector interface. WodUp and Mindbody demo connectors call mock endpoints with the providers' real request and response shapes. Others are stubs (D-023). |
| **A2** | Owned data store | The D1 schema holds athletes, connections, sync runs, source records with provenance, canonical sessions, results, measurements, notes, conflicts, decisions and dashboards. `athlete_id` is on every table. |
| **A3** | Sync runs | One action syncs all connected sources with live per-source progress. It is idempotent on re-run, keeps per-provider errors isolated, and records timings. |
| **B1** | Welcome | Create a profile: name, primary sport, time zone. |
| **B2** | Connect accounts | Provider tiles by category. A per-provider consent sheet (scopes, read-only) runs an OAuth-shaped sign-in. Apple Health uses file upload, parsed in the browser. |
| **B3** | Syncing screen | Live counts per source, the matching step, and a summary with timings. |
| **B4** | First dashboard | This week, streak, resting HR and HRV against the athlete's normal range, record book, review queue, 52-week heatmap, recent sessions, training mix. Every tile shows how it was calculated. Desktop and phone layouts. |
| **B5** | Review actions | Merge, split, pick and confirm from the review queue. Decisions persist and survive re-sync. |

### 6.2 Story engine

**The moment:** a 45-second vertical video story about a synthetic athlete, generated end to end from two years of synthetic data. Every number in it is traceable to a source record.

**Demo athlete:** Hyrox Henry (Henry Walsh, fictional; D-034), an Austin athlete training for HYROX. He takes Club Hybrid three mornings a week (booked in Mindbody, programmed in WodUp), runs at the track twice a week, wears an Apple Watch, and races HYROX every March and September.

**Video style:** Hybrid (Decision D-007). A broadcast graphics package carries the facts. AI-generated footage and an AI voiceover set the mood.

| ID | Requirement | Acceptance criteria |
|---|---|---|
| **H1** | Two years of synthetic data | Fixtures cover 2024-10-28 → 2026-10-25 for all three sources, with the storylines and decoys in Playbook §8. Shapes validate as today. `expected.json` lists every planted storyline, decoy, and edge case. |
| **H2** | Ingest and reconcile | All three sources load into one store. Source records are kept as received. Canonical sessions match `expected.json` (the 12 edge cases from the current fixtures, extended across two years). Re-running ingest creates no duplicates. |
| **H3** | Analyst finds angles | Detectors for at least: rematch / scoped best, comeback, streak, plateau broken, in-your-own-words. All planted storylines for those angles are found. **No decoy produces a candidate.** Each candidate has a fact sheet (Playbook §7). |
| **H4** | Editor picks the angle | Candidates are ranked (Playbook §3). The demo story uses the top-ranked candidate. The ranking is visible in the demo. |
| **H5** | Writer produces a video script | A scene-by-scene script (about 45 s, 6–8 scenes) following the Playbook: lede, nut graf, turn, kicker. Each scene has voiceover text, an on-screen graphic bound to fact IDs, and a footage prompt. |
| **H6** | Fact-checker gates the script | Every claim in the voiceover is tagged and matches the fact sheet. Untagged numbers, dates, or superlatives fail. On-screen values are rendered **from the fact sheet**, never from model text. A deliberately corrupted script fails the check (shown in the demo or tests). |
| **H7** | Video renders | 1080×1920, about 45 s, MP4. Graphics package, voiceover, footage, and an end card reading "Data-backed · AI-assisted · Approved by Alex". The graphics-only version renders without footage or voiceover (fallback). |
| **H8** | Story page | A web page that plays the video next to its evidence: each claim, its value, and its source records. Approval status is shown. |
| **H9** | Athlete approval | A story is "draft" until approved. Approval is a human action. |
| **H10** | One command | One command runs the whole pipeline from fixtures to MP4, with a progress log suitable for a demo. |
| **H11** | Bring your own Apple Health export | `npm run demo -- --apple <path/to/export.xml>` ingests a real Health export in place of the synthetic one. It streams a multi-GB file without loading it whole. The data core and dashboards-to-be work on real data ("could a real user act on this tomorrow?"). |
| **H12** | Fast and measured | The live pipeline (ingest → render, with media from cache) finishes in under 3 minutes on a laptop. Each stage logs its time and record counts. The final summary prints throughput, e.g. "2 years · 210k records · ingested in 14 s". |
| **H13** | Judging deliverables | The codebase is clean, with a README quickstart. A recorded demo video of about 3 minutes follows §7. The live table demo runs from a clean checkout without crashing, with a pre-rendered fallback ready. |

**Stretch (only if H1–H10 are done):**
- **S1:** read-only MCP server over the same data tools.
- **S2:** a chat box that answers questions using those tools.
- **S3:** a second angle rendered as a second video.

**If we fall behind, cut in this order** (D-021):
1. S1–S3.
2. The `streak` and `ownWords` detectors. Keep rematch, comeback and plateau, plus the decoy tests.
3. AI footage (keep graphics + voiceover).
4. Voiceover (graphics + burned-in captions only).
5. The desk page's Timeline section.
6. The story page's raw-payload expansion.

**Never cut:** reconciliation correctness (H2), the fact-checker (H6), decoy rejection.

**Out of scope for the demo:** real API connections, auth, multiple athletes, followers, chat-built dashboards, voice, AI interviewer, race-result ingestion, social posting, export/delete UI.

## 7. Demo script (what the audience sees, ~4 minutes)

1. **The mess (20 s):** three raw sources side by side. Times in three formats. A duplicate run. A split watch workout.
2. **One history (30 s):** the reconciled timeline. Two years, one athlete, provenance on hover.
3. **The analyst (45 s):** the engine scans two years and lists candidate angles with scores. The decoys are shown as **rejected**, with the reason ("inside the noise band", "single day, unconfirmed").
4. **The desk (45 s):** the script with its claim tags. The fact-checker passes it, then fails a corrupted copy.
5. **The story (45 s):** play the video.
6. **The receipts (30 s):** the story page. Tap a claim, see the record.
7. **The vision (30 s):** the roadmap. Chat-built dashboards, AI interviews, race coverage, followers.

## 8. Success measures

**Hackathon judging:** the live table demo, the submitted demo video, and the codebase are all scored.

| Criterion | How this demo answers it |
|---|---|
| Completeness | One command, end to end, no crash (H10, H13). Pre-rendered fallback. |
| Technical depth | Three-source reconciliation, deterministic analyst, fact-checked LLM desk, programmatic video, not a wrapper (H2–H7) |
| Insight quality | Stories synthesize two years into a non-obvious arc; the decoys show the engine knows when to stay quiet (H3) |
| Usability | Drop in a real Apple Health export tomorrow (H11). Every claim is traceable on the story page (H8). |
| Creativity, look and feel | New combination: gym booking + programming + wearable + sports-desk craft + video. Broadcast-grade graphics. |
| Performance | Streamed ingest, cached media, a timed pipeline with throughput numbers on screen (H12) |

**Demo:**
- The video is something an athlete would want to share.
- Every on-screen fact survives a live "where did that come from?"
- The decoys are visibly rejected.

**Product (v1 and later):**
- Athlete rating of stories: accuracy and "I learned something".
- Follower return rate.
- Share rate.
- Time from import to first approved story.
- Correction rate on reconciliation.
- Cost per approved story.

Product analytics never include health measurements or private content.

## 9. Risks

| Risk | Mitigation |
|---|---|
| AI footage looks generic or uncanny | Atmospheric shots only (gym, chalk, clock, bar), no faces. A graphics-only fallback is always rendered. |
| Generation services are slow or rate-limited on demo day | Pre-render the demo video. The live run is shown as a recording if needed. |
| Paid generation credits | Each generation needs explicit go-ahead (D-008). Budget set before generating. |
| Synthetic data feels fake | Storylines designed as real arcs, with noise and decoys. Athlete notes written in a believable voice. |
| Model writes a causal or invented claim | Fact-checker gate (H6). Banned-verb list. Corrupted-script test. |
