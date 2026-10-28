# OpenHealth: Vision and Ethos

Version 1.1 · 2026-10-27 · Owner: Kevin

This is the why behind the product. The [PRD](PRD.md) says what we build and in what order. This document says why it is worth building, why now, and how to tell whether a piece of work belongs. When a PRD or SPEC detail conflicts with this document, flag it; don't quietly pick one.

Related: [PRD](PRD.md) · [SPEC](SPEC.md) · [Story Playbook](STORY-PLAYBOOK.md) · [Decisions](DECISIONS.md)

## 1. The idea in one line

**Cover every amateur athlete the way ESPN covers the NFL.**

## 2. What pros get that amateurs don't

A professional athlete's career is documented from the start. Follow an NFL player and you can find:

| Pro coverage | What it is | The amateur equivalent |
|---|---|---|
| **Recruiting and college** | The long arc: high school stats, college seasons, a career page that keeps growing | Years of training history scattered across apps, watches and spreadsheets |
| **The combine** | Standardized tests that compare one athlete to the field and to their own past: 40-yard dash, bench reps, vertical | Benchmarks: a 5K time trial, an FTP test, Fran, HYROX station splits, a 1RM |
| **Practice** | Daily work the public rarely sees, but that the team tracks closely | Daily training: every run, ride, WOD and lift, plus sleep, HRV and resting heart rate |
| **Game day** | The performance everything builds toward, with official results | Race day: a marathon, a HYROX, a Spartan race, a CrossFit Open workout, a gran fondo |
| **The media** | Pressers, sideline interviews, features that ask how it felt and what changed | Nobody asks. The athlete's own account of the race is lost the next day. |
| **The stats sites** | Every number, online, any time, for anyone who cares | No single page. The data lives in a dozen silos the athlete doesn't control. |

Amateurs train with the same seriousness. Many log more data than a pro did twenty years ago. What they lack is the coverage: someone collecting it, making sense of it, and telling the story back.

## 3. Who it's for

Everyday athletes in endurance and fitness sports with a real competitive structure:

- **Running**: road races, marathons, ultras.
- **Triathlon**: sprint through Ironman.
- **HYROX**.
- **CrossFit**: daily WODs, benchmarks, the Open.
- **Obstacle racing**: Spartan and similar.
- **Cycling**: amateur road racing, gran fondos, the rider who follows the Tour de France and chases their own climbs.

Each sport has its own "league": its seasons, benchmark tests, race calendar, and the numbers its athletes care about. The product should speak each sport's language and not flatten them into generic "workouts."

The athlete comes first. Their followers (family, friends, a run club, a coach) are the audience, and they see only what the athlete chooses to share.

## 4. Point the camera at the athlete

The core move is to put a camera, figuratively, on the athlete. Everything that happens in real training and real competition is gathered in one place:

1. **Collect**: pull data from the tools the athlete already uses, keep it as received, and reconcile it into one owned history.
2. **Understand**: compute what happened and find what's notable: trends, records, comebacks, rivalries with their own past self.
3. **Give it back**: return it as products the athlete wants to look at: dashboards that answer what happened, and stories that explain what it means.

The bar for what we give back: **authentic, compelling, informative.** Authentic means every fact is true and every quote is the athlete's own. Compelling means it's worth watching or reading. Informative means it shows something a glance at the raw data couldn't.

## 5. Why now

Until recently, nobody could build this. Each sport needs its own data sources, metrics, dashboards and story formats, and each athlete wants something slightly different. Hand-building all that would cost far more than any one niche could pay back.

Two things changed:

1. **The cost of building software is falling toward zero.** AI writes, tests and maintains code. Software for a niche, or a niche within a niche, or one person, is now worth making.
2. **AI can do the work of the coverage team.** The analyst, the writer, the interviewer and the producer are jobs a model can do at scale, inside guardrails.

So the opportunity is personalized software at scale: a different product for each athlete, assembled for them. That is why the ethos in the PRD is **software that builds software**. We don't hand-build an app per sport. We build the factory that builds each athlete's coverage.

## 6. Human first, AI first

OpenHealth is a human-first product built AI first. The athlete is the subject and the audience: their effort, their races, their words. AI is how we build it and how it runs, never the point of it. When the two pull apart, the human wins: an honest, plain answer beats a clever generated one, and the athlete's own voice beats the model's.

AI is the foundation the product stands on, not a feature added at the end. In practice:

- **The interface is conversation.** A few standard dashboards exist; anything else the athlete asks for in chat or by voice, and AI assembles it from vetted components.
- **The newsroom is AI.** Analyst, editor, writer and fact-checker roles run as a pipeline (Story Playbook §2). An AI interviewer runs the post-race presser and the weekly sit-down, so the athlete's own voice is part of the record.
- **Connectors get built, not hand-coded forever.** Over time, AI writes the integration for a new data source.
- **The data stays open to AI.** A read-only MCP server lets the athlete bring their history to any assistant.

AI first does not mean AI decides. **Facts come from code, words from the model.** The model writes and assembles; deterministic code computes every number. The athlete approves anything that reaches followers. The non-negotiables are in [PRD §4](PRD.md#4-principles-non-negotiable).

## 7. Beyond the screen

Today people use screens, so today we build for screens: a web app on a phone and a laptop. That's where the product is going to start, not where it ends.

Where it's going: the athlete talks, and the coverage answers wherever they are.

- Getting into the car: "Show me this week's training." The dashboard appears on the car's screen, and the car reads the headline out loud.
- Cooling down after a run: they ask their watch how the run compared to last month, and it answers in a sentence.
- Wearing glasses, or in front of a projected display: the splits from last weekend's race appear in the air in front of them while they talk through the race with the AI interviewer.

Voice is the main input. The output is whatever serves the moment best: spoken, shown, or both. A runner mid-workout wants one spoken sentence. Someone parked in the driveway might want the full dashboard. The AI picks the form, and the athlete can always ask for the other one.

**What this means for what we build today:**

1. **Specs, not screens.** A dashboard is a description of what to show (the JSON spec and tile library, D-026), not a web page. The web app is one renderer. A car screen, a watch face, glasses or a voice answer are others.
2. **Every view can be spoken.** Every tile and dashboard has a short plain-language answer next to its visual, computed from the same verified data. If it can't be said in a sentence, it isn't ready yet.
3. **Conversation is the main path, not a feature.** Anything you can reach by tapping, you should eventually be able to ask for. Menus and buttons are a fallback for screens, not the model of the product.
4. **Small surfaces first in mind.** Design each answer so it holds up on the smallest surface (a watch, a voice reply), then add detail for bigger ones.
5. **Same truth everywhere.** The rules don't change with the surface. A number spoken in a car comes from the same code and carries the same provenance as one on the dashboard.

## 8. What we're building now

The foundation: a trustworthy data core (connectors, one owned history, reconciliation with provenance), a first dashboard, and a story engine that proves data can become a compelling, verified story. The current scope and release plan are in [PRD §5](PRD.md#5-release-plan).

Everything later (chat-built dashboards, the interviewer, follower pages, video formats, more sports) stands on that foundation. A shortcut in the data core is paid for in every product built on top of it.

## 9. How to tell if work fits the vision

Ask these when choosing between options, scoping a feature, or reviewing a change:

1. **Would a sports desk do this?** If ESPN would cover a pro this way (a stat page, a race recap, a combine comparison, a presser), it probably fits.
2. **Is it true?** Can every number be traced to a source record? Is every quote the athlete's own?
3. **Does it give something back?** Collecting data isn't enough. Does the athlete get a dashboard, a story or an answer they couldn't easily get before?
4. **Does it respect the sport?** Does it use that sport's own measures and language, or is it generic fitness-app filler?
5. **Does it scale through the factory?** Is it a component, rule or pipeline AI can reuse across athletes and sports, or a one-off hand-built screen?
6. **Would it work without a screen?** Can it be asked for by voice and answered in a sentence? Is it a spec any surface can render, not a layout tied to one page?
7. **Does the athlete stay in control?** Do they own the data, approve what's shared, and keep export and delete?
8. **Is it human first?** Does it center the athlete's own effort and words, or show off the AI?

## 10. Open questions

- What does "public" mean for an amateur? Pro stats are open by default; ours are private by default and shared by choice. Where is the line between a follower page and a public athlete page?
- Which sport comes after CrossFit (D-015)? Running and HYROX have the clearest official results.
- How much of the coverage is per-athlete versus comparative (age-group rankings, a run club's leaderboard)?
- Which non-screen surface comes first: a voice assistant, the watch, or the car? Each depends on platform access we don't control yet.
