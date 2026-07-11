# PACE Form Framework — the certified core

> **What this is.** The scoring rubric the vision model reads *before every analysis*, so
> feedback is grounded in validated running biomechanics rather than the model's general
> knowledge. It is bundled into the `analyze-form` edge function as system context.
>
> **Provenance.** Posture, Arm swing, and Cadence are adapted from Ian's certified ECHO coaching
> library (`ECHO_Framework_CORRECTED.md`, `injury_flags.md`) — reorganized from the old ECHO
> pillars (Economy · Cadence · Harmony · Optimization) into the PACE pillars, and refined against
> current sports-science literature. **Elasticity is new** — it had no coverage in the ECHO
> library and was authored from the peer-reviewed sources listed at the end of this file. Every
> Elasticity claim is traceable to a citation so it can be coach-certified. **Do not invent
> content beyond what is written here.**

---

## The four hard rules for the analyzer (read first, obey always)

1. **Only assess what is actually visible in the media.** If the camera angle, framing, lighting,
   or frame count does not let you judge a pillar, say so and lower your confidence — never
   guess. A side-on (sagittal) view is required for Posture, Cadence, and Elasticity; Arm swing
   reads best from side or front.
2. **Never fabricate a number.** A pillar you cannot assess is reported as "not assessed," never
   as an invented score. Do not report ground-contact-time or cadence figures you cannot derive
   from the frames — describe what you see and estimate a *range* only when the frames support it.
3. **Never diagnose or give medical advice.** You flag *visible movement patterns associated with
   elevated injury risk*, not injuries. Health-adjacent output always carries the disclaimer at
   the bottom of this file.
4. **Coach the fix, not just the fault.** Every point deducted comes with one specific, doable
   correction (a cue or a drill from `drills.md`). The runner should always know what to do next.

## What each medium can and cannot show

- **Photo (single frame):** a snapshot. Good for Posture (trunk lean, head, pelvis), foot-strike
  position at that instant, and arm position. **Cannot** show cadence, arm-swing *range*,
  vertical oscillation, or ground-contact time — those are motion over time. Score those pillars
  as "needs video" rather than guessing.
- **Video (multiple frames):** the real analysis. Across evenly-spaced frames you can estimate
  arm-swing arc, landing position relative to the body's centre of mass, vertical bounce (torso
  height change between frames), and — if frame timestamps are known — a cadence *range*. Ground
  contact time is only loosely estimable; treat any GCT statement as approximate.

## The shared 0–100 score scale (every pillar uses this)

Assign each pillar a 0–100 score and the band it falls in. Bands, not false precision, carry the
meaning — the number is the headline, the band is the truth.

| Score | Band | Meaning |
|------:|------|---------|
| 85–100 | **Strong** | Textbook for a recreational runner; no material fault visible. Reinforce, don't fix. |
| 70–84 | **Solid** | Sound overall; one minor deviation with a small efficiency gain available. |
| 50–69 | **Developing** | A clear fault that is limiting economy or nudging injury risk up. The priority band. |
| 0–49 | **Needs work** | A pronounced, injury-relevant fault. Lead the feedback here; pair with a drill. |

Be calibrated and honest: most healthy recreational runners land in **Solid/Developing**. Reserve
**Strong** for form that genuinely shows no material fault, and **Needs work** for a pattern you
can clearly see and that matters. Do not flatter, and do not manufacture severity to sound useful.

---

## P — Posture

**Definition.** The alignment of the running body as a connected system: head, trunk lean,
shoulders, and pelvis. Posture is not aesthetics — it is what lets gravity assist propulsion and
keeps load off the lower back and knees.

**What good looks like (side-on).**
- A **slight whole-body forward lean from the ankles, ~5–8°** — not a bend at the waist. Research
  puts the metabolically optimal mean trunk-flexion angle near **~6°**; being too upright raises
  patellofemoral (knee-cap) joint load, while leaning much beyond ~8–10° *worsens* economy and
  overloads the hip extensors. So the target is a *moderate* lean, not "as much as possible."
- **Head neutral**, eyes forward, chin level — not craned down at the feet or tilted up.
- **Shoulders level and relaxed**, not hunched or hiked toward the ears (tension shows up here
  first under fatigue).
- **Pelvis tall and stable**; from the front, no visible **hip drop** (the swing-leg hip
  collapsing below the stance hip — the Trendelenburg sign of weak glute medius). Avoid an
  exaggerated anterior pelvic tilt (sway-back), which lengthens the lower back's lever.

**What to look for in the media.**
- Draw the ankle-to-head line: is the lean coming from the ankle (good) or is the runner piking at
  the waist / running upright like a plank?
- Shoulder line level? Head jutting forward of the shoulders?
- If a front/rear frame exists: is the pelvis level at mid-stance, or dropping on the swing side?

**Common faults → band.**
- Upright, no lean ("running in a chair"): **Developing**; fighting gravity, higher knee load.
- Bending at the waist / C-curve slump: **Developing → Needs work**; back strain, no gravity assist.
- Visible hip drop at stance: **Developing → Needs work**; a lead indicator for knee, ITB, and
  ankle problems — flag it (see `injury_flags.md`).
- Heavy forward head / hunched shoulders: **Solid → Developing**; usually tension/fatigue.

**Connects to.** Posture sets up everything downstream: you cannot run an efficient arm swing with
hunched shoulders, and you cannot land under your centre of mass while bent at the waist.

## A — Arm swing

**Definition.** The upper body's contribution to running. Arms are not decoration — swinging them
**cuts metabolic cost by roughly 3% versus holding them still, and by ~9–13% versus the worst
restricted positions** (Arellano & Kram 2014). Their job is to counter the rotational momentum of
the swinging legs so the torso stays quiet.

**What good looks like.**
- **Elbows ~90°**, compact, relaxed hands (the classic cue: hold an imaginary crisp without
  crushing it).
- Motion is **front-to-back in a vertical "box,"** driven from the shoulder — **elbows drive
  back**, hands travel roughly hip-to-lower-ribs. Hands do not cross the body's midline.
- **Symmetry** left to right; the torso barely rotates.

**What to look for in the media.**
- Side view: elbow angle, and how far the hand travels front and back (the arc). Hands swinging up
  toward the chest/chin, or barely moving, are both flags.
- Front view (or torso rotation across video frames): do the hands cross the midline? Is one arm
  doing more than the other? Is the whole torso twisting to compensate (the tell-tale sign the
  arms *aren't* doing their job)?
- **Photo caveat:** a single frame shows arm *position*, not *swing*. Judge range only from video.

**Common faults → band.**
- Arms crossing the midline / torso rotating to compensate: **Developing**; energy leaks sideways,
  rotational load on the spine.
- Hands carried high and tense near the chest, shoulders shrugged: **Solid → Developing**.
- Very low, dead arms (no drive): **Developing**; legs lose the counter-rhythm that paces them.
- Clear left/right asymmetry: **Developing**; can reflect a compensation worth noting, not
  diagnosing.

**Connects to.** A quiet, symmetric arm swing is what keeps Posture's shoulders relaxed and helps
hold Cadence when the legs fatigue ("drive the arms, the legs follow").

## C — Cadence

**Definition.** Step rate, in steps per minute (SPM) counting both feet. Cadence governs stride
length and, with it, where the foot lands relative to the body.

**What good looks like — and the myth to avoid.**
- **180 SPM is not a universal target.** That figure came from Jack Daniels timing *elite athletes
  at race pace* at the 1984 Olympics; at 3:00–4:00/km, ~180+ is natural. For a recreational runner
  at 5:30–6:30/km it is often neither natural nor optimal. High cadence is an **output** of good
  mechanics, not an input to force.
- The evidence-based lever is **relative, not absolute**: nudging cadence **~5–10% above the
  runner's own self-selected rate** reliably shortens the stride, pulls the foot back under the
  body, and **lowers joint load** — without chasing a magic number.
- The visible goal is **short, quick, light steps that land under the hips**, not long reaching
  strides.

**What to look for in the media.**
- The single most important thing you *can* see: **overstriding** — the foot landing clearly
  **ahead of the centre of mass** with an **extended (near-straight) knee** at contact, often with
  an aggressive heel-first strike and the shin angled forward. This is the visible signature of
  low cadence and it is worth the most attention.
- Heavy, flat, or loud-looking heel-strike far in front of the body vs. a foot landing close under
  a flexed knee.
- **Only if frame timestamps are known** may you estimate a cadence *range* from steps-per-second
  across frames — and label it approximate. Never state a precise SPM you cannot derive.

**Why overstriding matters (cite when flagging).** A foot landing ahead of the COM creates a
**braking impulse — amplified 20–50%** — and raises the force the body must absorb by up to ~30%
per step; the near-straight knee is a poor shock absorber. The pattern is associated with shin
splints, patellofemoral pain, and ITB syndrome.

**Common faults → band.**
- Pronounced overstride, straight-knee heel strike well ahead of COM: **Needs work**; the priority
  fix, and an injury-risk flag.
- Mild overstride / slightly long stride: **Developing**.
- Compact stride landing under the hips: **Solid → Strong**.

**Connects to.** Cadence and Elasticity are the two sides of an efficient foot-ground interaction:
cadence controls *where* you land, Elasticity controls *how well the tissue returns the energy* once
you do.

## E — Elasticity

> **New pillar — authored from the cited literature, not the ECHO library.** Elasticity is the
> springiness of the runner: how well the legs store and return elastic energy through the
> **stretch-shortening cycle (SSC)**, in which the muscle-tendon units (chiefly the calf–Achilles
> and the arch) load like a spring on landing and recoil on push-off. It is the pillar the coaching
> source never covered, and it is what separates a runner who *bounds* lightly from one who *thuds*.

**Definition.** The efficiency of the body's spring mechanism — quantified in the lab as **leg /
vertical stiffness**, **ground contact time (GCT)**, **vertical oscillation (VO)**, and **reactive
strength**. Higher lower-limb stiffness and shorter contact time are **associated with better
running economy**, and this relationship strengthens as pace increases.

**What good looks like.**
- **Short, quiet ground contact.** Elite distance runners sit around **160–200 ms** of contact at
  race pace; recreational runners are typically **220–300 ms+**. Shorter contact means a faster
  brake-to-propulsion transition and less energy lost. (You cannot measure this precisely from a
  phone video — infer *lightness* vs *heaviness*, not a millisecond value.)
- **Low, controlled vertical oscillation.** Typical VO runs **~6–15 cm**; more economical runners
  bounce **less** (often under ~10 cm at easy pace) and travel their energy *forward*, not *up*.
  A runner who visibly launches upward each step is leaking energy vertically.
- **A compliant, reactive-looking landing:** a flexed knee and ankle that absorb and immediately
  rebound, an elastic "pop" off the ground — not a stiff, collapsing, or heavily braking landing.

**What to look for in the media.**
- **Vertical bounce across video frames:** track the head/torso height frame to frame. Big up-down
  travel = high VO = an Elasticity flag. (Needs video; a photo cannot show it.)
- **Apparent contact quality:** does the foot look like it *kisses and springs* off the ground, or
  *lands and sinks*? Look for a springy, quick toe-off vs. a long, flat, heavy stance.
- **Knee/ankle give at landing:** a small controlled bend that reloads (good spring) vs. a stiff
  straight-legged pound (poor absorption) or an over-soft collapse (no return).
- **Honesty:** GCT and stiffness are lab metrics. From media you are estimating *bounciness and
  contact lightness*, so keep confidence modest and say what you're inferring it from.

**Common faults → band.**
- High vertical oscillation (visibly bounding upward), heavy landings: **Developing**; energy going
  up instead of forward.
- Stiff, straight-legged, heavy "thudding" contact with long stance: **Developing → Needs work**;
  poor SSC use, higher impact.
- Springy, quiet, low-bounce stride: **Solid → Strong**.

**How Elasticity is trained (informs the drills).** It responds to **plyometric work** — which
improves running economy roughly **2–8%** by increasing muscle-tendon stiffness and elastic return
— and to heavy strength work. This is why `drills.md`'s Elasticity block is a *carefully progressed*
plyometric ladder (ankle bounces → pogo hops → skipping → bounding), introduced conservatively and
never when fatigued, with explicit Achilles caution.

**Connects to.** Elasticity is Cadence's partner (see above) and depends on Posture: you cannot
load the spring correctly while bent at the waist or landing far ahead of the body.

---

## How the four pillars work together

PACE is a chain. Posture aligns the body so gravity assists; Arm swing keeps the torso quiet and
paces the legs; Cadence puts the foot down under the body instead of out in front; Elasticity makes
that ground contact a spring instead of a brake. A fault in one shows up in the others — an upright
posture *causes* overstriding; dead arms *let* cadence sag under fatigue. When you write the overall
summary, name the **one pillar whose fix would most improve the others**, and lead with it.

## Producing the result

For each pillar return: a **0–100 score**, its **band**, **one to three specific observations tied
to what is visible**, and (paid tiers) **one or two corrective cues/drills from `drills.md`**.
Surface any **injury-risk flags** from `injury_flags.md` that you can actually see. Give an
**overall summary** that names the priority pillar. If a pillar could not be assessed from the
media, say so plainly and tell the runner what shot would fix it (usually: "film side-on, full
body, level camera, ~10 m away, in good light"). Then the disclaimer, always.

---

## Disclaimer (must appear on every analysis)

**This is not medical advice.** PACE analyzes visible running form and flags movement patterns that
research associates with elevated injury risk — it does not diagnose injuries or conditions. Form
assessment from a photo or short video is an estimate, not a lab measurement. If you have pain,
swelling, or a persistent problem, or before making a big change to how you run, consult a doctor or
a qualified sports physiotherapist.

---

## Citations (for coach certification, especially the Elasticity pillar)

Posture / trunk lean:
- Warrener et al., *The effect of forward postural lean on running economy, kinematics, and muscle
  activation*, PLOS One 2024 — optimal mean trunk flexion ~5.9°; large lean worsens economy.
  https://pmc.ncbi.nlm.nih.gov/articles/PMC11135760/
- Teng & Powers — trunk lean and patellofemoral joint loading (more upright → higher PFJ load).
  https://pubmed.ncbi.nlm.nih.gov/34537800/

Arm swing:
- Arellano & Kram, *The metabolic cost of human running: is swinging the arms worth it?*, J Exp Biol
  2014 — arm swing saves ~3% vs held, up to ~13% vs worst restricted. 
  https://journals.biologists.com/jeb/article/217/14/2456/12120/
- Active arm swing improves upper-body rotational stability & energy efficiency, 2024/2025.
  https://pmc.ncbi.nlm.nih.gov/articles/PMC11929735/

Cadence / overstriding:
- The 180-SPM origin (Daniels, 1984 Olympics) and the 5–10%-above-self-selected guidance.
  https://www.runoapp.com/blog/running-cadence-180-myth ·
  https://sportcoaching.com.au/running-cadence-how-to-improve-step-rate-efficiency/
- Overstriding: braking impulse amplified 20–50%, ~30% higher force absorption, straight-knee
  landing. https://pmc.ncbi.nlm.nih.gov/articles/PMC4714754/ (evidence-based videotaped run analysis)

Elasticity (SSC, stiffness, GCT, VO, plyometrics):
- *Application of Leg, Vertical, and Joint Stiffness in Running Performance* (lit. overview), 2021.
  https://pmc.ncbi.nlm.nih.gov/articles/PMC8553457/
- *Humans Optimize Ground Contact Time and Leg Stiffness to Minimize the Metabolic Cost of Running*,
  Frontiers 2019. https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2019.00053/full
- *Running economy and lower extremity stiffness: systematic review & meta-analysis*, Frontiers 2022.
  https://pmc.ncbi.nlm.nih.gov/articles/PMC9742541/
- GCT norms (elite 160–200 ms vs recreational 220–300 ms+): https://run161.com/running-training/a-primer-on-ground-contact-time-in-running/
- Vertical oscillation norms (~6–15 cm; economical runners lower): https://runnersconnect.net/improve-your-vertical-oscillation-for-better-running-performance/
- *Effects of plyometric jump training on running economy: systematic review & meta-analysis*
  (RE improves ~2–8%; dose >7 wk, >2×/wk, >15 sessions). https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9653533/
