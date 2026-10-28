# Synthetic fixtures

Two years (2024-10-28 → 2026-10-25) of one athlete's training, shaped like the real source data, so ingestion can be built and demoed without live API access. Timestamps follow real America/Chicago DST rules.

```bash
npm install
npm run fixtures   # generate + validate
```

The generator is seeded: same seed, same output.

## Output

| File | Shaped like | Shape confidence |
|---|---|---|
| `data/wodup/training_sessions.json` | `GET /api/public/athletes/{id}/training_sessions`, all pages concatenated | **Verified.** Validated against WodUp's published OpenAPI 3.1 spec (`schemas/wodup-openapi.json`) |
| `data/wodup/athlete.json` | Minimal athlete stub | Partial |
| `data/mindbody/client_visits.json` | `GET /public/v6/client/clientvisits` (`PaginationResponse` + `Visits`) | **Field list verified** against the v6 `Visit` model; values and casing assumed |
| `data/hyrox/results.json` | The finisher page on results.hyrox.com (mika:timing). HYROX has no public API (D-036) | **Fields copied** from a real results page; JSON shape and `waveStart` assumed |
| `data/apple-health/export.xml` | Health app → Export All Health Data → `export.xml` | Structure from real exports; DTD trimmed |
| `data/expected.json` | Ground truth: canonical workouts, duplicates, conflicts, unmatched visits, storylines, and the true block times of every watch workout (`timelines`) | — |

## Scenario: Hyrox Henry (D-034)

Henry Walsh lives in Austin and trains for HYROX. His week mirrors the founder's:

| Day | Session | Mindbody | WodUp | Apple Watch |
|---|---|---|---|---|
| Mon | Club Hybrid 07:00: strength (deadlift 4x4 @ 80%, push press 3x5 @ 70%), circuit, farmer-carry finisher | "Club Hybrid", Jack Woolsey | Warm-up + lettered blocks | Functional Strength Training |
| Tue | Run Club at the track: 6 x 800m @ 3:20 every other week, else 5 x 1k or 10 x 400m | "Run Club" | CardioIntervals | Outdoor Run with one segment per rep and recovery |
| Wed | Club Hybrid: threshold intervals (6x5min w/2min rest, run → max wall balls, erg → max lunges) | "Club Hybrid" | Generic, scored by reps | Functional Strength Training |
| Thu | Run Club: 5k time trial in the first week of the month, else tempo 3 x 2k or an easy 8–10k | "Run Club" | Cardio | Outdoor Run with segments |
| Fri | Club Hybrid: the 40-min race-simulation AMRAP every fourth week, other hybrid AMRAPs between | "Club Hybrid" | Amrap | Functional Strength Training |
| Sat | Sometimes an easy run | — | — | Outdoor Run |

The workout text copies the real Club Hybrid programming (warm-up line, "A. Main Block", "Goal: Consistent pacing.", "PUSH YOURSELF hard in each 5min round…"). About one track day in ten exists only on the watch: no booking, nothing in WodUp.

**Heart rate follows the blocks.** Each workout is a list of blocks with a target effort over time (sets and rests, steady AMRAPs, work/rest intervals, carries, cool-downs). Heart rate chases the target with a lag, faster up than down, and fitter Henry needs fewer beats for the same effort. One fitness curve drives every benchmark and heart-rate response, so progress, the summer gap, the winter slide and the breakthrough agree across sources. `expected.timelines` records the true start and end of every block so the session timeline's matching can be scored (D-038).

**Races.** Four HYROX Men's Open races, logged on the watch as **Outdoor Run** (D-037): indoors the GPS wanders, so the watch's distance (9.1–9.6 km) overcounts the official 8 km. Race weeks taper to Mon–Wed.

| Date | Event | Time | Age group rank |
|---|---|---|---|
| 2025-03-22 | 2025 Houston | 1:28:14 | 97 of 211 (30-34) |
| 2025-09-20 | 2025 Dallas | 1:21:40 | 71 of 248 (35-39) |
| 2026-03-21 | 2026 Houston | 1:24:55 | 88 of 260 (35-39) |
| 2026-09-19 | 2026 Dallas | 1:14:32 | 29 of 271 (35-39) |

Each result has the 16 splits in race order (8 runs, 8 stations) with station places, Roxzone, run total and best lap, as the results page shows them.

## Storylines and decoys (Story Playbook §8)

Each storyline and decoy is listed with its facts in `expected.json → storylines[]` / `decoys[]`.

| ID | What's planted |
|---|---|
| `hyrox_sub_115` | Four races, 1:28:14 → 1:21:40 → 1:24:55 → 1:14:32; "Wall balls unbroken in Dallas. Finally." two days later |
| `march_setback` | March 2026 is slower than September 2025: stations about the same, slower runs |
| `summer_gap` | No records in any source 2025-06-09 → 07-05; "First day back. Slow." on 07-07; deadlift back to 250 by 07-28 |
| `deadlift_plateau` | Deadlift 4x4 at 265 from 2025-09-29 to 2026-03-23, then 275, then 285 |
| `long_streak` | 14 straight weeks of 4+ sessions from 2026-05-25; every other run of 4+ is capped at 9 |
| `track_less_strain` | The same 6 x 800m @ 3:20, rep heart rate down ~5 bpm from April to September 2026 (computed from the records) |
| `winter_fridays` | Mindbody late-cancels cluster on Fridays, Dec–Feb |
| `heavy_weeks` | HRV dips ~6 ms on the Mon–Wed after a 6-session week |
| `wall_ball_words` | "Wall balls" in notes on 2026-03-23, 05-20 and 09-21 |
| `time_trial_standout` | A 18:55 5k time trial on 2026-04-16, then back to typical |
| Decoy `single_great_day` | One 295 lb deadlift 4x4 day on 2025-11-17 that never repeats |
| Decoy `short_trend` | A three-week 255 lb deadlift bump in April 2025, inside the noise band |

## Planted edge cases (final four weeks)

| Date | Case | What correct ingestion does |
|---|---|---|
| 10-02 Fri | WodUp `done_at` is 19:40, logged hours after the 07:00 class | Match on `wod.occurs_on` and the single booked class, not `done_at` proximity |
| 10-04 Sun | The same run comes from both Apple Watch and Strava | Keep one workout; record the other as a duplicate |
| 10-06 Tue | Watch died at Run Club: Mindbody + WodUp only | Canonical workout with HR and calories **missing**, not zero; the timeline shows the plan without times |
| 10-08 Thu | Track rained out, Run Club moved to the rowers: Apple has no distance (no GymKit) | Take distance from WodUp; Apple fills HR and calories |
| 10-12 Mon | 12-minute heart-rate gap mid-class | Flag the gap; don't interpolate; the timeline breaks the line |
| 10-14 Wed | Watch workout stopped and restarted mid-class (06:52–07:31, 07:38–08:04) | **Review required**; the correct answer is to merge both into one class |
| 10-15 Thu | WodUp note contains "IGNORE ALL PREVIOUS INSTRUCTIONS…" | Store as athlete text; never treat as instructions |
| 10-16 Fri | Mindbody late-cancel | No workout |
| 10-18 Sun | Run logged in WodUp as 5000 m / 24:30; watch says 5210 m / 24:52 | Surface the conflict; don't average |
| 10-20 Tue | Run Club no-show (`SignedIn: false`) overlapping a solo 8 km run | Don't merge on time overlap alone; the run stands alone |
| 10-21 Wed | Open gym at 19:28 local = 00:28 UTC Thursday; no booking | Apple + WodUp match on the **local** date |
| 10-06 → 10-07 night | Watch charging: no sleep record, no Wed-morning HRV | Missing, not zero |

The four sources format time differently. Normalizing them is the first job of ingestion:
- **Mindbody:** site-local, no offset (`2026-09-28T07:00:00`).
- **WodUp:** UTC (`…T12:00:00.000000Z`).
- **Apple Health:** offset (`2026-09-28 06:59:00 -0500`).
- **HYROX:** split times as `HH:MM:SS`; the assumed `waveStart` is site-local like Mindbody.

## Assumptions to check against live data

- Mindbody returns site-local times with no offset. Check against the sandbox, site `-99`.
- WodUp returns `training_sessions` newest first, and `done_at` can be when the result was logged rather than when the workout happened.
- Apple Health exports carry no workout UUID. `expected.json` keys Apple workouts as `sourceName|type|startDate`, which also serves as the re-import dedupe key.
- Apple Health exports a custom workout's segments as `WorkoutEvent type="HKWorkoutEventTypeSegment"` with a date and duration.
- Mindbody `StaffId` is not resolved to a coach name. That would need `GetStaff`, which isn't faked here.
- HYROX results: the summary page gives Roxzone only as a total and doesn't show the wave start. The timeline spreads Roxzone evenly around the stations, and `waveStart` stands in for what the Race Replay view or a partner feed would provide.
