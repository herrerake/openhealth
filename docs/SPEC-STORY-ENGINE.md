# OpenHealth — Story Engine Specification (Phase C)

> The examples below still use the retired CrossFit athlete (Fran, squat, 2k row). The demo athlete is now Hyrox Henry; his storylines are in Playbook §8 and `fixtures/README.md` (D-034, D-035).

Version 0.1 · 2026-10-27 · Status: draft, deferred until Phases A and B ship
Companion to [SPEC](SPEC.md) §11. It implements PRD H3–H10 and follows the [Story Playbook](STORY-PLAYBOOK.md).
It reads from the D1 schema in SPEC §5.

## 1. Pipeline

**analyst → editor → writer → fact-checker → media → render → story page → approve**

If the fact-checker fails a script, it goes back to the writer, at most 2 times.

## 2. Analyst (H3)

### 2.1 Metrics and noise

- **Benchmark series:** values per benchmark at the same scaling (rx), from `results`.
- **Typical error (TE):** the SD of differences between consecutive attempts ÷ √2, with a floor per metric:

  | Metric | Floor |
  |---|---|
  | Fran | 6 s |
  | 2k row | 3 s |
  | Squat | 5 lb |
  | HRV | 3 ms |
  | Resting HR | 1 bpm |

- **Noise band:** ±TE. A change is "real" when it exceeds the band and is confirmed in the next 2 periods.
- **Recovery signals:** 3-day rolling averages for HRV and resting HR.

### 2.2 Detectors

Each detector is a pure function `(db, athleteId, asOf) → Candidate[]`.

| Detector | Fires when | Facts emitted |
|---|---|---|
| `rematch` | A benchmark has ≥4 attempts spanning ≥90 days and the latest is the best by more than TE | each attempt (date, value, record IDs), best, rank, count, span, TE |
| `comeback` | A gap of ≥14 days with zero records in **all** sources, followed by ≥3 sessions; metric returns to its pre-gap level | gap start/end/days, pre-gap value, the return-to-level date, weeks to return, first note after the gap |
| `streak` | The longest run of weeks with ≥4 sessions is ≥4 weeks **and** is the longest in history | start, end, weeks, threshold, the previous longest |
| `plateauBroken` | Rolling value stays inside the band ≥6 weeks, then 2 consecutive periods sit beyond it | plateau start/end/value, break date/value, band |
| `ownWords` | A non-stopword term appears in ≥3 notes across ≥2 calendar months | each note (date, verbatim text, record ID) |

**Decoys** in `expected.json` assert that specific detectors return nothing for their date ranges.

### 2.3 Fact sheet

Shape per Playbook §7. Every fact has:
- `id`;
- `kind` (`value`, `rank`, `count`, `gap`, `duration`, `note`, `span`);
- typed fields;
- `evidence` (source record IDs);
- for derived facts, `derivedFrom`.

Display strings are produced by code, never by the model.

## 3. Editor (H4)

score = rarity × (magnitude ÷ TE) × log2(1 + supporting events)

The top-ranked candidate is the **primary**. Secondary candidates merge in when both of these hold:
- their evidence dates fall inside the primary's span;
- the primary angle's template lists them as supporting beats.

| Primary | Supporting beats |
|---|---|
| rematch | comeback, streak, ownWords |
| comeback | ownWords, streak |
| plateauBroken | streak, ownWords |

Example: rematch(fran) + comeback(squat, Jun–Aug 2025) + streak + ownWords gives "Nine Frans, one answer".

Code ranks, picks and merges (D-019). The ranking, including rejected candidates and their reasons, is saved for the demo screen.

## 4. Writer (H5)

- **Model:** `claude-opus-5-5` (D-011). Key from `ANTHROPIC_API_KEY`.
- **Input:** the system prompt is Playbook §§1, 4, 6 condensed plus the video format rules. The user message is the fact sheet as JSON.
- **Output:** a tool call returning:

```json
{
  "title": "Nine Frans, one answer",
  "scenes": [
    {
      "id": "s1",
      "vo_digits": "4:21. Nine tries, one answer.",
      "claims": [{ "text": "4:21", "facts": ["f2"] }, { "text": "Nine tries", "facts": ["f7"] }],
      "graphic": { "component": "BigNumber", "bind": { "value": "f2", "caption": "f7" } },
      "broll": "Dawn, an empty CrossFit gym, lights flickering on, no people, no text"
    }
  ]
}
```

**Video format rules:**
- 6–8 scenes, about 120 spoken words total.
- Scene 1 is a hook (≤3 s).
- The last scene is a kicker.
- The quote card uses only `note` facts.

**Spoken form:** the writer writes numbers as digits in `vo_digits`. `speak.ts` converts them deterministically into spoken text for TTS ("4:21" → "four twenty-one") (D-016).

## 5. Fact-checker (H6)

Deterministic. A script passes only if every rule passes:

1. Every claim's `text` occurs in its scene's `vo_digits`.
2. Every number, date, or time token lies inside a claim span, and its value equals a referenced fact's value after unit normalization.
3. Superlatives (*best, fastest, longest, first, only, most, never*) lie inside a claim span referencing a `rank`/`span` fact.
4. No banned causal phrase (Playbook §4).
5. Any quoted text equals a referenced `note` fact's text exactly.
6. `graphic.bind` references existing facts of a kind compatible with the component.
7. `broll` prompts contain no digits, names, or text-on-screen requests.
8. Total spoken words are within limits.

**On fail:** return the failing rules to the writer and retry, at most 2 times. If it still fails, the story stays unrendered and the report is shown.

A `corrupt` command produces a corrupted script (a changed number, an injected "because", an invented quote). Tests assert it fails on rules 2, 4 and 5.

## 6. Media (H7)

- **Voiceover:** one clip per scene. Scene length = max(VO duration + 0.4 s, 2.5 s). Duration is read with the renderer's bundled ffprobe.
- **B-roll:** one 5 s clip per scene that has a `broll` prompt, 9:16, no faces, no text.
- **Generation:** both are generated once, cached by the hash of (prompt, model, settings), and gated by go-ahead and budget (D-008). A missing asset falls back to graphics-only for that scene.

## 7. Render (H7)

**Composition:** `Story` at 1080×1920, 30 fps. Renderer: Remotion or Revideo (licence pending).

| Component | Bound facts | Notes |
|---|---|---|
| `BigNumber` | value (+ caption) | Counts up to the value |
| `AttemptsChart` | benchmark series (+ noise band) | Best highlighted |
| `GapCalendar` | gap | Month grid with empty days |
| `StreakCounter` | streak | Week ticks |
| `QuoteCard` | note | Verbatim, dated |
| `LowerThird` | any value/rank | Over b-roll |
| `EndCard` | approval state | "Draft" or "Approved by Alex" (D-017) |

- Graphics read values only from the fact sheet via `bind`.
- Captions come from `vo_digits`.
- Rendering runs in local Node for the demo, and on Cloudflare Containers in v1.

## 8. Story page, desk page, approval (H8–H10)

**Story page:**
- the video;
- the claims table, with for each claim: VO text, fact value, kind, how it was computed, and its source records (expandable);
- the candidates, including the rejected decoys.

**Desk page** (D-020), four sections:
- Sources, one day, raw;
- Timeline;
- Candidates;
- Script & check, with the pass report and the corrupted fail report.

**Approval:** approving re-renders the final video with the approved end card.
