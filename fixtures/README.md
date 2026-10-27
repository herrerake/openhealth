# Synthetic fixtures

Four weeks (2026-09-28 → 2026-10-25) of one athlete's training, shaped like the real source data, so ingestion can be built and demoed without live API access.

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
| `data/apple-health/export.xml` | Health app → Export All Health Data → `export.xml` | Structure from real exports; DTD trimmed |
| `data/expected.json` | Ground truth: canonical workouts, duplicates, conflicts, unmatched visits, metrics | — |

## Scenario

One CrossFit gym runs bookings in Mindbody and programming in WodUp. The athlete wears an Apple Watch. Classes are Mon/Tue/Thu/Fri 06:00 and Sat 09:00, with easy runs on Sundays.

The supported comparisons (PRD §11):
- **Fran:** 4:58 → 4:21.
- **Back squat 5x5:** 205 → 235 lb.
- **Deadlift 1RM test:** 385 lb.
- **2k row:** 7:45 → 7:35.

## Planted edge cases

| Date | Case | What correct ingestion does |
|---|---|---|
| 10-02 Fri | WodUp `done_at` is 19:40, logged hours after the 06:00 class | Match on `wod.occurs_on` and the single booked class, not `done_at` proximity |
| 10-04 Sun | The same run comes from both Apple Watch and Strava | Keep one workout; record the other as a duplicate |
| 10-06 Tue | Watch died: Mindbody + WodUp only | Canonical workout with HR and calories **missing**, not zero |
| 10-08 Thu | Indoor row: Apple has no distance (no GymKit) | Take distance from WodUp; Apple fills HR and calories |
| 10-12 Mon | 12-minute heart-rate gap mid-workout | Flag the gap; don't interpolate |
| 10-15 Thu | WodUp note contains "IGNORE ALL PREVIOUS INSTRUCTIONS…" | Store as athlete text; never treat as instructions |
| 10-16 Fri | Mindbody late-cancel | No workout |
| 10-17 Sat | Watch workout split into two (08:52–09:31, 09:38–10:04) | **Review required**; the correct answer is to merge both into one class |
| 10-18 Sun | Run logged in WodUp as 5000 m / 24:30; watch says 5210 m / 24:52 | Surface the conflict; don't average |
| 10-21 Wed | Open gym at 17:28 local = 00:28 UTC Thursday; no booking | Apple + WodUp match on the **local** date |
| 10-24 Sat | Mindbody no-show (`SignedIn: false`) overlapping a solo 8 km run | Don't merge on time overlap alone; the run stands alone |
| 10-06 → 10-07 night | Watch charging: no sleep record, no Wed-morning HRV | Missing, not zero |

The three sources format time differently. Normalizing them is the first job of ingestion:
- **Mindbody:** site-local, no offset (`2026-09-28T06:00:00`).
- **WodUp:** UTC (`…T13:00:00.000000Z`).
- **Apple Health:** offset (`2026-09-28 05:59:00 -0700`).

## Assumptions to check against live data

- Mindbody returns site-local times with no offset. Check against the sandbox, site `-99`.
- WodUp returns `training_sessions` newest first, and `done_at` can be when the result was logged rather than when the workout happened.
- Apple Health exports carry no workout UUID. `expected.json` keys Apple workouts as `sourceName|type|startDate`, which also serves as the re-import dedupe key.
- Mindbody `StaffId` is not resolved to a coach name. That would need `GetStaff`, which isn't faked here.
