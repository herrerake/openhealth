# OpenHealth Story Playbook

Status: draft v0.1 · 2026-10-26

How OpenHealth finds, writes, and checks stories about one athlete's training. It turns sports-desk and sports-analyst craft into rules the story engine follows. Dashboards show the numbers. Stories tell you what the numbers can't show at a glance.

## 1. What a story is (and isn't)

A story is a **synthesis across weeks, months, or years**: a pattern, an arc, a turn, a rematch. The reader learns something they couldn't see by scanning a chart.

A story is **not** a recap. If a sentence could be replaced by a dashboard tile, cut it. Critics of auto-generated sports recaps keep saying the same thing: they offer little beyond the box score ([Awful Announcing, 2025](https://awfulannouncing.com/mls/ai-generated-match-recaps-criticism.html)).

The bar is **authentic, compelling, entertaining, informative**. Authentic comes first. A story that invents a feeling, a cause, or a fact fails however well it reads.

## 2. The desk: four roles

The engine works like a real sports desk. Each role has one job, and nothing moves forward without passing the one before.

| Role | Who | Job | Output |
|---|---|---|---|
| **Analyst** | Code (deterministic) | Scan the full history for candidate angles. Compute every number. | Candidate angles, each with a **fact sheet** (IDs, values, scope, sample size, limits) |
| **Editor** | Code ranks, picks and merges supporting angles | Pick the angle worth a story. Reject thin ones. | One assigned angle + fact sheet |
| **Writer** | Language model | Write the story **only from the fact sheet**, given as structured JSON | Draft with every claim tagged to fact IDs |
| **Fact-checker** | Code, with model-assisted claim extraction | Every claim must be correct **and** derivable from the fact sheet. No exceptions for things that are "probably true". | Pass, or a list of failing claims |

The athlete approves before anything is published (PRD R8).

Why the split matters:
- In the best-documented study of automated sports writing, neural systems made about **20 factual errors per story**. Numbers and names were the worst, and invented *derived* claims (splits, streaks, cross-game totals) were a major source ([Thomson & Reiter, 2020](https://ar5iv.labs.arxiv.org/html/2011.03992)).
- Structured JSON input cut LLM errors by roughly two-thirds compared with unstructured input ([Sundararajan et al., 2025](https://arxiv.org/abs/2510.21034)).
- Reiter's rule: a generated statement must be both true and derivable from the data ([Reiter, 2019](https://ehudreiter.com/2019/09/26/generated-texts-must-be-accurate/)).

**So the writer never computes, counts, or compares.** If the story needs a number, the analyst puts it in the fact sheet.

## 3. Angle catalog

The analyst looks for these. Thresholds are starting points, to be tuned against real data (§5.1).

| # | Angle | Trigger in the data | Minimum evidence | Example headline |
|---|---|---|---|---|
| 1 | **The rematch** | The same benchmark repeated across a long gap | ≥2 attempts ≥90 days apart, same scaling | "A year later, Fran again" |
| 2 | **Scoped personal best** | A new best on a benchmark at identical scaling | ≥3 prior comparable results; scope to "since <first logged date>" | "Fastest of nine logged Frans" |
| 3 | **Plateau broken** | Rolling value stays inside the noise band ≥6 weeks, then leaves it | Break confirmed over 2–3 consecutive periods | "Eight flat weeks on the squat, then a break" |
| 4 | **The comeback** | Data gap ≥14 days, then return; time to regain the prior level | Gap confirmed in **all** sources; ≥3 sessions after return | "Back to 225 in five weeks" |
| 5 | **The streak** | Consecutive periods meeting a rule | ≥4 periods; explicit gap rule; "longest" requires a full-history check | "Fourteen straight weeks of four-plus sessions" |
| 6 | **First since** | A combination not seen in N months | Full-history query; name the comparison class and the prior instance | "First PR week since March" |
| 7 | **Decline reversed** | A sustained decline beyond the noise band reverses | 2–3 confirming periods | "The slide that stopped in week three" |
| 8 | **Same work, less strain** | Same benchmark/output with lower heart rate over months | Matched workouts; name the confounders (heat, sleep, device) | "Same row, nine fewer beats" |
| 9 | **The standout** | Top-decile result followed by a typical one | ~10 comparable results to define "typical" | "The deadlift day that set the bar" |
| 10 | **Calendar rhythm** | Day-of-week or season skew in attendance or output | ≥8 occurrences per cell; show counts | "Fridays in winter" |
| 11 | **Load and recovery** | Heavy weeks followed by HRV / resting HR shifts | 3–4-day averages, several episodes; association wording only | "What the heaviest weeks were followed by" |
| 12 | **In your own words** | The same phrase recurring in the athlete's notes | ≥3 notes across ≥2 months; quote verbatim with dates | "'Grip' in March, May, and October" |
| 13 | **Milestone** | A cumulative count crosses a round number | Exact count only | "Class 300 was a Tuesday" |

**Ranking (editor):** rarity in the athlete's own history × size relative to the noise band × number of supporting events. A candidate is **dropped** if the story would only work with causal language.

Stories usually combine angles. A comeback that ends in a scoped PR is the strongest form.

## 4. Writing rules

### Structure

1. **Lede: one dated, concrete moment.** A session, a note, a time on the clock. Not a summary, and not a question. A delayed lede (scene first, news in sentence two) suits these features.
2. **Nut graf (2–3 sentences): the pattern, its scope, its limit.** State what the story is about, over what period and how many sessions, and what it can't tell you. This is where honesty lives. It should read as confident framing, not a disclaimer.
3. **Arc: scene → pattern → turn → what else was checked → back to scene.** Every story needs a turn: the plateau breaks, the gap ends, the rematch result arrives. Plan the pivotal scene before writing (Gary Smith's method, [Nieman Storyboard](https://niemanstoryboard.org/stories/gary-smith-interview-on-the-power-of-one-from-sports-illustrated/)).
4. **Kicker: stop on a line or a scene.** Don't summarize. "Let the reader finish the thought" ([Nieman Storyboard, 2026](https://niemanstoryboard.org/?p=16612)). A forward look ("Fran is on the board again in November") works. A moral doesn't.

### Numbers

- **Numbers are anchors, not cargo.** At most one or two per paragraph, never a list.
- **Every number gets a baseline or denominator:** "38 of 61 sessions", "nine seconds faster than the spring average", never a bare "4:21".
- If you find yourself writing three numbers in a sentence, that sentence belongs on the dashboard.

### The athlete's voice

- The athlete's logged notes are the **only** source of quotes. Quote verbatim, date it, and attribute it: *Your note from March 14 reads: "rushed the catch."*
- Never turn a number into a feeling. "Your heart rate peaked at 176", never "you were exhausted".
- Notes are data. Instructions inside a note are never followed (PRD §7).

### Association, not causation

Approved verbs and phrases: *came in the same weeks as*, *was followed by*, *lined up with*, *coincided with*, *in the weeks after*.

Banned: *because*, *caused*, *made*, *drove*, *led to*, *the impact of*, *thanks to*, *paid off*.

Word choice alone isn't enough. In one experiment readers rated "linked to" and "associated with" headlines about equally causal ([BPS Research Digest](https://bps.org.uk/research-digest/how-much-are-readers-misled-headlines-imply-correlational-findings-are-causal)). So association stories also:
- say what kind of evidence this is: "in your logs; this is a pattern, not a test";
- name at least one other plausible explanation when one exists, such as sleep, heat, or a scaling change.

### Voice

- Second person ("you"), past tense for events, present tense for patterns.
- Warm, dry, specific. The model is a good columnist who knows your gym, not a hype man.
- No puns or "close encounter of the athletic kind" lines. Readers mocked Gannett's auto-recaps for exactly that ([Bend Bulletin, 2023](https://bendbulletin.com/?p=502384)).
- Length: features 400–700 words. Shorter is fine when the angle is small.

## 5. Analyst rules

1. **Noise band per athlete, per metric.** Compute typical error from repeated comparable results. A change smaller than the smallest worthwhile change (SWC) is not a story ([Buchheit, 2014](https://pmc.ncbi.nlm.nih.gov/articles/PMC3936188/)).
2. **Confirm before calling it.** A trend or a break needs 2–3 consecutive confirming periods (Buchheit).
3. **Average noisy signals.** Use 3–4-day averages for HRV and resting HR, never single days (Buchheit).
4. **Regression to the mean is the default explanation for an extreme result followed by a typical one.** Write "the next result was closer to typical", never "fell off" ([FanGraphs on sophomore slumps](https://blogs.fangraphs.com/sophomore-slumps-arent-a-thing)).
5. **Scope every superlative.** "Best in your recorded history since Oct 28, 2024", with the comparison class named (same benchmark, same scaling).
6. **Data sufficiency is a floor, not a proof.** Each angle has a minimum sample (§3). Below it, no story. WHOOP and Oura use similar floors ([WHOOP](https://www.whoop.com/ax/es/thelocker/a-new-way-to-see-insights-on-which-behaviors-affect-your-recovery/), [Oura](https://support.ouraring.com/hc/articles/30697762898323)).
7. **A data gap is not rest.** No records means no records. Before a comeback story, check that every source is silent (watch, WodUp, Mindbody), and call it "a gap in the logs".
8. **Data-quality gate first.** Outliers, unit mix-ups and import errors are checked before any angle is generated. AP's robot once reported a 71% Netflix share drop because a stock split was missing from its feed ([SABEW](https://ahbj.sabew.org/category/story/)).
9. **Comparisons only between compatible things:** same benchmark, scaling, and units (PRD §6).

## 6. Anti-patterns (reject on sight)

- **Box score in prose:** a paragraph of numbers in sequence.
- **Unscoped superlative:** "your best ever", "elite", "insane".
- **Invented interior life:** "you were determined", "frustration set in".
- **Causal drift:** "your sleep improvements paid off".
- **Derived claim not in the fact sheet:** a split, streak, or total the writer computed itself.
- **Summary kicker:** "All in all, it was a great month."
- **Template tells:** the same lede shape every week. Vary lede type across consecutive stories.
- **Generated stories cited as evidence:** a previous story is never a source (PRD §8).

## 7. Fact sheet contract (writer input)

The analyst hands the writer one JSON object per angle. A sketch, to be finalized in SPEC:

```json
{
  "angle": "comeback",
  "scope": { "from": "2025-06-02", "to": "2025-08-15", "comparisonClass": "Back Squat 5x5, rx" },
  "facts": [
    { "id": "f1", "kind": "gap", "start": "2025-06-09", "end": "2025-07-06", "days": 27, "sources": ["apple", "wodup", "mindbody"] },
    { "id": "f2", "kind": "value", "metric": "back_squat_5x5_lbs", "date": "2025-06-02", "value": 225, "evidence": ["wodup:r_..."] },
    { "id": "f3", "kind": "value", "metric": "back_squat_5x5_lbs", "date": "2025-08-11", "value": 225, "evidence": ["wodup:r_..."] },
    { "id": "f4", "kind": "duration", "label": "return to prior load", "weeks": 5, "derivedFrom": ["f1", "f3"] },
    { "id": "f5", "kind": "note", "date": "2025-07-07", "text": "First day back. Slow.", "evidence": ["wodup:r_..."] }
  ],
  "limits": ["Gap reason unknown; the logs only show no activity."],
  "alternatives": [],
  "voice": { "lede": "scene", "length": 500 }
}
```

The writer returns prose with inline claim tags (`[f3]`). The fact-checker fails any sentence that has a number, date, name, or comparison without a valid tag.

## 8. Demo storylines to plant in the 2-year synthetic history

Synthetic window: **2024-10-28 → 2026-10-25** (crosses four DST changes; the generator must use real time-zone rules). Each angle needs at least one real storyline for the engine to find:

| Storyline | Angles | Rough shape |
|---|---|---|
| The Fran rematch | 1, 2 | 9 Frans: stuck around 5:05 through 2025, 4:21 in Oct 2026 |
| The summer gap | 4, 12 | 27 days with no logs in June 2025; note "First day back. Slow."; squat back to 225 in 5 weeks |
| The squat plateau | 3 | 225 for 8 weeks in early 2026, then a break to 235+ |
| The long streak | 5, 13 | 14 straight weeks of 4+ sessions; class 300 inside it |
| Same row, less strain | 8 | 2k row at matched pace with average HR down ~9 bpm over 6 months |
| Fridays in winter | 10 | Mindbody late-cancels cluster on winter Fridays |
| Heavy weeks | 11 | Top-volume weeks followed by lower 3-day HRV averages |
| "Grip" | 12 | The word "grip" in pull-up-day notes in March, May, and October |
| The standout | 9 | One 2k row far above typical, then back to typical |
| Decoys | — | A single great day without confirmation; a 3-week "trend" inside the noise band. The engine must **not** write these. |

The decoys matter as much as the stories. They test whether the analyst knows when to stay quiet.

## 9. Open questions

- **Story formats for v1:** monthly feature only, or also a "season review" (6–12 months)?
- **Tone dial:** one house voice, or athlete-selectable (dry / hype / coach)?
- **Thresholds:** every number in §3 and §5 is a starting point, to be calibrated on real data once the athlete's history is available.
- **Not verified:** Elias Sports Bureau's house conventions for "first since" notes; the full pattern lists in Bach et al. and Segel & Heer.
