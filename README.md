# SIP//LAB — 2-Minute Step-in-Place Biomechanics Lab
### Clinical, Scientific and Technical Manual · v1.0.0

> **Clinical disclaimer.** SIP//LAB is **not a medical device**. It is a research and
> education instrument. Its outputs do not constitute a medical diagnosis, prognosis or
> treatment recommendation. Any clinical decision must be made by a qualified professional
> using validated tools. Always ensure the participant is medically fit to exercise and is
> supervised throughout the assessment.


**Live application:** https://aaron-chen-angus.github.io/icare-sip/

**Live data (Google Sheet):** https://docs.google.com/spreadsheets/d/1aQdyVw2kWy_kscfBcKeEl4UxWG5OC9izGOEGhg86k7E/edit?usp=sharing

---

## Table of contents

1. Overview and intended use
2. Clinical rationale — why the 2-Minute Step Test gauges cardiovascular fitness
3. Test protocol and standardisation
4. Operating the application (clinical workflow)
5. Computer-vision pipeline and pose markers
6. Signal processing and the counting algorithm
7. Complete metric specification (every measurement and its calculation)
8. Normative data and interpretation
9. Quality control and measurement validity
10. Data dictionary and exported files
11. System architecture and software design
12. Google Sheets integration and data governance
13. Privacy, ethics and safety
14. Validation, limitations and future work
15. Glossary
16. References (clinical and technical, APA 7th)

---

## 1. Overview and intended use

SIP//LAB is a standalone, browser-only computer-vision web application that administers and
scores the **2-Minute Step-in-Place Test (2MST)**, an aerobic-endurance item of the Senior
Fitness Test battery (Rikli & Jones, 2001). The participant marches in place for 120 seconds
while facing a phone camera; on-device pose estimation counts each knee lift, derives a
biomechanical profile of pacing, lift height, symmetry, velocity and frontal-plane balance,
classifies the score against published age- and sex-specific norms, and records the numeric
results to a Google Sheet for research use.

The application replaces an earlier record-and-upload Flutter assessment (which streamed video
to a server for analysis) with **real-time, on-device inference**. No video or raw landmark
data ever leaves the device; only numeric results are transmitted, and only to the operator's
configured research sheet.

**Intended users.** Community-dwelling older adults assessed by an operator
(physiotherapist, exercise physiologist, researcher, nurse or trained student) using a
consumer smartphone. Self-administration is possible but operator supervision is recommended
for safety and framing.

**Intended setting.** Clinics, community health screening, fitness and ageing-research
laboratories, and tele-assessment contexts where a laboratory treadmill or metabolic cart is
unavailable.

---

## 2. Clinical rationale — why the 2-Minute Step Test gauges cardiovascular fitness

### 2.1 The construct: aerobic (cardiorespiratory) endurance

Cardiorespiratory fitness (CRF) is the capacity of the cardiovascular and respiratory systems
to deliver oxygen to skeletal muscle and of the muscle to utilise it during sustained activity.
The criterion measure of CRF is maximal oxygen uptake (VO₂max), typically obtained by graded
treadmill or cycle-ergometer testing with gas analysis. CRF is one of the strongest modifiable
predictors of all-cause and cardiovascular mortality across the lifespan (Blair et al., 1989;
Ross et al., 2016), and low CRF in older adults is associated with loss of independence, frailty
and increased fall risk (Myers et al., 2002).

Direct VO₂max testing is impractical for most older adults and community settings: it requires
maximal effort, specialised equipment, and medical supervision, and may be contraindicated or
poorly tolerated. **Field tests of aerobic endurance** were developed to provide a safe,
submaximal, equipment-light proxy. The 6-Minute Walk Test (6MWT) is the best known; however, it
requires a measured 30-metre corridor that is frequently unavailable indoors (Rikli & Jones,
1998). The **2-Minute Step Test** was designed specifically as a space-efficient alternative that
can be administered in a clinic room or at home while retaining acceptable concurrent validity
with treadmill and walk-based measures of aerobic capacity.

### 2.2 Why stepping in place reflects aerobic capacity

Marching in place is a cyclical, large-muscle, weight-bearing activity that recruits the hip
flexors, quadriceps, hamstrings and calf musculature of both legs, together with postural
stabilisers of the trunk and pelvis. Sustaining a cadence of knee lifts for two minutes imposes
a continuous metabolic demand that, for most older adults, sits in the moderate-intensity,
predominantly aerobic domain. The **number of completed lifts in a fixed time window** is a
proxy for the participant's ability to sustain submaximal aerobic work: a fitter individual
maintains cadence and lift height for longer with less fatigue-related slowing, yielding a
higher count, whereas a deconditioned individual slows, rests more, and lifts lower.

Empirically, the 2-Minute Step Test shows:

- **Moderate-to-good concurrent validity** with treadmill-derived aerobic measures and with the
  6-Minute Walk Test in community-dwelling older adults (Rikli & Jones, 1998; Rikli & Jones,
  2013).
- **Good test–retest reliability** (intraclass correlation coefficients commonly reported in the
  0.8–0.9 range) when standardised (Rikli & Jones, 1999a).
- **Sensitivity to the expected age-related decline** in aerobic endurance and to training-induced
  improvement, supporting its use for screening and for tracking change over time (Rikli & Jones,
  2001; Jones & Rikli, 2002).
- **Discriminant value** for functional thresholds associated with independent living in later
  life (Rikli & Jones, 2013).

### 2.3 What the biomechanical add-ons contribute

The classical test yields a single number (the count). Because SIP//LAB observes the whole
movement, it additionally quantifies *how* the stepping was performed. These descriptors are not
part of the validated aerobic score but are clinically interpretable adjuncts:

- **Pacing and fatigue** — cadence, step-interval variability, and the change in rate from the
  first to the last 30-second quarter index the ability to sustain effort. A large negative
  rate change suggests early fatigue or pacing failure.
- **Lift height and its decline** — mean knee rise and the proportion of steps reaching hip level,
  compared across the first and last third of the test, reveal effort attenuation that a raw
  count can mask.
- **Inter-limb symmetry** — asymmetry in count, lift height or lifting time can reflect unilateral
  weakness, pain, or neurological asymmetry and may warrant follow-up.
- **Frontal-plane balance and posture** — medio-lateral hip sway, trunk lateral lean and pelvic
  tilt during repetitive single-leg loading are surrogate indicators of dynamic balance and
  postural control, which are themselves correlated with fall risk in older adults.

These adjuncts are reported transparently with their calculations so clinicians can decide how
much weight to place on them; they should be interpreted descriptively, not diagnostically.

---

## 3. Test protocol and standardisation

### 3.1 Equipment and environment

- A smartphone (modern iOS Safari or Android Chrome) on a **stand or tripod** — never hand-held.
- A clear floor, plain background, and even frontal lighting.
- A wall or stable chair within reach for optional support.
- Fitted trousers or shorts so the knees are visible; avoid long skirts or loose robes.

### 3.2 Camera placement (frontal view)

The participant **faces the camera**. The phone is centred in front of the participant,
**2.5–3.0 m** away, with the lens at **hip/waist height (approximately 0.9–1.1 m)**, held
**level** (no pitch or roll), in **portrait** orientation. The whole body from head to both feet
must be inside the frame.

**Why the frontal view.** The scored criterion is knee height relative to hip height — a
*vertical* image quantity that is preserved under a frontal, level camera. Both knees are
equally visible and equidistant, so the right-knee (official) count, the left-knee count and the
symmetry metrics are all reliable. A side view was evaluated and rejected because the far leg is
occluded, making left-leg counts and symmetry unreliable.

**Why camera height and level matter (perspective geometry).** With a level camera at hip
height, the hips lie near the optical axis and `knee_y − hip_y` compares like with like. A camera
placed too **high** makes a raised knee (which is nearer the lens) project **lower** than it truly
is, under-counting lifts; a camera too **low** does the opposite, over-counting. SIP//LAB mitigates
this with on-screen height/level checks and records camera pitch, roll and the calibration
hip-midpoint position as covariates.

### 3.3 The procedure

1. **Setup and calibration.** The participant stands still, fully framed, for ~2 seconds while
   the app measures their standing thigh length (the reference for "knee at hip level") and the
   pixel-to-metre scale.
2. **Countdown.** A 3-2-1 countdown with audible beeps precedes a "GO".
3. **Test.** The participant marches in place for **120 seconds**, lifting each knee to about
   hip height, at a self-selected sustainable pace. Audible cues sound at 60, 30 and 10 seconds
   remaining and for the final 3-2-1.
4. **Scoring.** The **official score** is the number of times the **right** knee reaches the
   target height within the 120-second window (Rikli & Jones, 2001). Left and total counts are
   also reported.
5. **Rest and support.** Resting and holding a wall or chair are permitted by protocol and are
   *recorded but never penalised*; the clock continues to run.

### 3.4 Contraindications and stopping rules (operator judgement)

Administer only to participants cleared for moderate exercise. Stop the test for chest pain,
severe dyspnoea, dizziness, pallor, a near-fall, or at the participant's request. The operator
may stop the test at any time (recorded as a manual stop).

---

## 4. Operating the application (clinical workflow)

**S1 — Entry.** Review the setup diagram and instructions, choose a language to play the
demonstration video (English, Mandarin or Cantonese), then **Proceed**. Complete the participant
form: pseudonymous ID, age, sex, **height (required — it scales all distances)**, optional body
mass, site label, operator notes, camera (rear/front), pose model (lite/full/heavy), optional
camera height, and the count-threshold preset. Tick the **Safety** and **Protocol briefed**
boxes. "Support used" is an optional covariate. A separate **Cannot do test** button records a
score of 0 and skips the camera.

**S2 — Camera setup and calibration.** The camera fills the screen; a scrollable panel below
shows the setup checks. **Required** checks (body landmarks visible, both feet in frame) plus a
**2-second still calibration** enable the test. **Advisory** checks (distance, facing, camera
level, camera at hip height) guide framing and are recorded as covariates but do not block the
test. Stand still until the calibration bar fills and **Start Test** activates.

**S3 — Live test.** The countdown runs, then the 120-second test. The heads-up display shows the
remaining time and the live right/left/total counts; vertical gauges show each knee's lift
progress. **Stop Test** ends the test early (recorded as a manual stop). A wake-lock keeps the
screen on.

**S4 — Results.** The official right-knee score is shown with left, total and duration chips, a
norm classification badge, a QC badge, grouped metric panels, charts, and a per-step table.
Results upload to Google Sheets automatically. Actions: **Use this result**, **Upload again**,
**Download ZIP**, **Retry test** (keeps the participant and increments the attempt number),
**History**, and **New participant**.

**S5 — History.** Lists recent local sessions with upload status; supports re-download and
re-upload.

---

## 5. Computer-vision pipeline and pose markers

### 5.1 Pose estimation

SIP//LAB uses Google **MediaPipe Pose Landmarker** (BlazePose-derived; Bazarevsky et al., 2020)
loaded in the browser from a pinned CDN (`@mediapipe/tasks-vision@0.10.18`). Inference runs in
`VIDEO` mode on a single pose with a GPU delegate and automatic CPU fallback. Detection,
presence and tracking confidences are each 0.5. The model emits 33 three-dimensional landmarks
per frame in normalised image coordinates (x, y ∈ [0, 1], with a relative z) plus a parallel set
of metric "world" landmarks (origin near the hips, in metres).

### 5.2 Tracked markers (17 of 33)

SIP//LAB records a 17-landmark subset. Each raw frame stores `t_ms` followed by seven values per
marker — normalised `x, y, z`, visibility `v`, and world `wx, wy, wz` — giving 1 + 17 × 7 = 120
columns per frame.

| Key | MediaPipe index | Anatomical landmark | Role in SIP//LAB (frontal view) |
|-----|-----------------|---------------------|---------------------------------|
| `nose` | 0 | Nose | Frame-fit (head in frame); facing check |
| `l_sh` / `r_sh` | 11 / 12 | Left / right shoulder | Scale chain; trunk lateral lean; shoulder tilt; frontalness (rotation) check |
| `l_el` / `r_el` | 13 / 14 | Left / right elbow | Recorded only |
| `l_wr` / `r_wr` | 15 / 16 | Left / right wrist | Recorded only (support/arm use is not penalised) |
| `l_hip` / `r_hip` | 23 / 24 | Left / right hip | Lift reference; pelvis tilt; medio-lateral sway; hip-height camera check; scale chain |
| `l_kn` / `r_kn` | 25 / 26 | Left / right knee | **Primary lift signal** (right knee = official score) |
| `l_an` / `r_an` | 27 / 28 | Left / right ankle | Scale chain; feet-in-frame; camera/feet-shift check |
| `l_heel` / `r_heel` | 29 / 30 | Left / right heel | Feet-in-frame; ground reference (exploratory) |
| `l_toe` / `r_toe` | 31 / 32 | Left / right foot index | Feet-in-frame; ground reference (exploratory) |

### 5.3 Visibility and frame conventions

A landmark is treated as **valid** when its visibility is ≥ 0.5 and it lies inside the frame.
All geometry is computed on the **un-mirrored** camera frame (mirroring is display-only). Because
the participant faces the camera, their anatomical **right** side appears on the **image-left**
of the un-mirrored frame. On-screen labels, colours (right = orange, left = blue) and counters
always refer to the participant's **anatomical** side. Image `y` increases downward; all reported
vertical quantities are converted to **positive-up**.

### 5.4 Pixel conversion (why it is done first)

MediaPipe returns normalised coordinates. Because the video frame is not square, distances and
angles must be computed in **pixels**, not normalised units, or the aspect ratio distorts them.
Therefore every geometric quantity is formed after `x_px = x_norm × video_width` and
`y_px = y_norm × video_height`.

---

## 6. Signal processing and the counting algorithm

SIP//LAB uses a two-pass design identical in spirit to the reference Sit-to-Stand app: a
**causal live pass** drives the on-screen counter in real time, and an **offline authoritative
pass** recomputes everything from the stored raw frames when the test ends. The offline result
is the one reported and exported; the live count is retained for comparison.

### 6.1 Calibration and scale

During the 2-second stand-still hold the app records, per side, the **standing vertical thigh
length** `S0 = median(knee_y_px − hip_y_px)`. It also records the shoulder→hip→knee→ankle pixel
chain length. The **pixel-to-metre scale** uses a whole-body anthropometric relation (Winter,
2009), in which the summed shoulder–hip–knee–ankle segment chain is approximately 0.779 of
standing height:

```
scale_m_per_px = 0.779 × height_m ÷ chain_px
```

`S0` makes the lift measure **scale- and distance-free** and tolerant of body size, because
progress is expressed as a fraction of the participant's own thigh length.

### 6.2 Lift progress p(t)

For each leg, every frame:

```
d(t) = knee_y_px − hip_ref_y_px           (vertical only; never Euclidean thigh length)
p(t) = 1 − d(t) / S0
```

`p = 0` is standing, `p = 1` is knee level with the hip, `p > 1` is above the hip. The hip
reference is the **hip midpoint** by default (`events.hipRef = 'mid'`), which is robust to the
per-side hip jitter that can occur during single-leg loading; a same-side-hip option is available.
Only the vertical difference is used, because a thigh pointing toward the camera is foreshortened
in 2-D and its apparent length shrinks. The 3-D world landmarks give a parallel `p3d` used only as
a cross-check, never for counting.

### 6.3 Resampling and zero-lag filtering (offline)

Raw frames (captured at the device rate, typically 30 fps) are linearly resampled onto a uniform
**30 Hz** grid using only valid samples; gaps longer than 0.25 s are flagged and bridged for
continuity. Each landmark series is then low-pass filtered with a **zero-phase, forward–backward
(filtfilt) second-order Butterworth** filter. The design cutoff is set so the effective −3 dB
point after the two passes is **8 Hz** (chosen above the ≈1–2 Hz per-leg stepping cadence to
preserve peak timing while suppressing landmark jitter). Reflection padding (30 samples) avoids
edge transients. Forward–backward filtering introduces **no phase lag**, so event timing is
preserved to within one sample.

### 6.4 Rep counting

**Live (causal) state machine**, per leg, on an EMA-smoothed `p` (α = 0.4):

```
DOWN → (p ≥ countP and ≥ 0.25 s since last count) → count++, state = UP
UP   → (p ≤ releaseP) → state = DOWN
```

**Offline (authoritative):** local maxima of the filtered `p` are detected with a minimum
prominence (0.12). A peak is **counted** when its value ≥ `countP`, the signal fell to ≤
`releaseP` since the previous counted peak of that leg (hysteresis prevents double counting), and
the peak time lies within the 0–120 s window. Peaks between `lowP` and `countP` are logged as
*incomplete attempts* (counted toward height statistics as uncounted rows, not toward the score).

**Count threshold — deliberately lenient.** The default `countP = 0.33` counts a rep when the
knee rises to roughly one-third of thigh length, i.e. *any clear march step*, rather than
requiring the knee to reach hip height. This reflects the operator's clinical intent: **count
every step the participant performs, and report how high they stepped separately**. Lift height
(cm, % reaching hip level, peak progress) is still fully measured and reported but does not gate
the count. A stricter `countPOfficial = 0.50` preset (approximating the patella–iliac-crest
midpoint) is selectable when a more conservative definition is desired.

### 6.5 Event timing and per-step kinematics

For each detected lift: `t_onset` (upward crossing of `lowP` before the peak), `t_peak`, and
`t_offset` (downward crossing of `lowP` after the peak). From these come lifting, lowering and
transition times; knee-rise height in centimetres; and the peak upward and downward knee
velocities (central-difference derivative of the filtered knee height in metres per second,
positive up).

### 6.6 Current algorithm parameters (from `js/config.js`)

| Parameter | Value | Meaning |
|-----------|-------|---------|
| `protocol.durationS` | 120 | Scored test window (s) |
| `protocol.countdownS` | 3 | Pre-test countdown (s) |
| `signal.resampleHz` | 30 | Analysis grid rate (Hz) |
| `signal.cutoffHz` | 8 | Effective −3 dB low-pass cutoff (Hz) `[TUNE]` |
| `signal.maxGapS` | 0.25 | Gap length flagged/bridged (s) |
| `signal.minVisibility` | 0.5 | Landmark visibility floor |
| `events.countP` | 0.33 | Progress to count a lift `[TUNE]` |
| `events.countPOfficial` | 0.50 | Stricter "official midpoint" preset |
| `events.releaseP` | 0.18 | Hysteresis re-arm level `[TUNE]` |
| `events.lowP` | 0.10 | Onset/offset timing level |
| `events.minSameLegS` | 0.25 | Minimum same-leg interval (s) |
| `events.minProminence` | 0.12 | Minimum peak prominence `[TUNE]` |
| `events.hipRef` | `mid` | Hip reference (midpoint) |
| `rest.restGapS` | 3 | No-step gap defining a rest (s) `[TUNE]` |
| `calibration.holdS` | 2.0 | Stand-still calibration hold (s) |
| `anthropometry.segmentChainFractionOfHeight` | 0.779 | Winter (2009) chain fraction |
| `live.emaAlpha` | 0.4 | Live-counter smoothing |

Parameters marked `[TUNE]` are engineering defaults not yet validated against a criterion count;
they may be refined with `tools/replay.html` during the pilot (Section 14).

---

## 7. Complete metric specification

All exported columns are defined once in `js/schema.js` (the single source of truth) and
documented exhaustively in `DATA_DICTIONARY.md`, which is regenerated by `tools/dictionary.html`.
This section summarises the measurement families and their calculations.

### 7.1 Primary outcomes

| Metric | Definition |
|--------|------------|
| `steps_right` | Right-knee counted lifts (peak ≥ countP, hysteresis satisfied, within 0–120 s). **Official score.** |
| `steps_left` | Left-knee counted lifts. |
| `steps_total` | `steps_right + steps_left`. |
| `live_count_right/left` | On-screen causal counts (retained for comparison). |
| `count_difference_right/left` | Offline minus live count (agreement check). |
| `incomplete_attempts_right/left` | Peaks with `lowP ≤ p < countP` (logged, not scored). |
| `steps_{right,left}_q1..q4` | Counted lifts per 30-second quarter by `t_peak`. |
| `norm_classification` | Rikli & Jones band on `steps_right` when `valid_for_norm`. |

### 7.2 Pacing (fatigue and rhythm)

Cadence (total, right, left) = steps ÷ (duration ⁄ 60). Same-leg step-interval mean, SD and
coefficient of variation per leg; alternation-interval mean and CV; ordinary-least-squares slope
of interval versus step number (≥ 4 steps); first-to-last-quarter **rate change %** = (q4 − q1) ⁄
q1 × 100 (negative = slowing); time to first step.

### 7.3 Rest

A **rest** is any interval with no counted step by either leg longer than `restGapS` (3 s).
Reported: rest count, total rest time, longest rest, and active-time %.

### 7.4 Step height (effort and its decline)

Per leg: mean / SD / minimum peak progress; mean knee-rise in cm = `(S0 − d_peak) × scale × 100`;
percentage of lifts reaching hip level (`p ≥ 1`); and the change in lift height from the first to
the last third of the test.

### 7.5 Velocity

Per leg: mean and maximum of the per-step peak upward knee velocity, and mean peak downward
velocity (m/s). `peak_standing_vertical_velocity_m_s` is the maximum upward knee velocity over the
whole test (retained for parity with the legacy Flutter metric set).

### 7.6 Symmetry

Symmetry index = (R − L) ⁄ mean(R, L) × 100, computed for step count, mean lift height and mean
lifting time; positive values indicate the right side is greater.

### 7.7 Balance and posture (frontal plane)

Medio-lateral hip-midpoint sway (RMS, range and path length in cm, linearly detrended); hip
vertical range; trunk lateral lean angle `atan2(shoulder_mid.x − hip_mid.x, hip_mid.y −
shoulder_mid.y)` (mean-absolute and peak); pelvic (hip-line) tilt `atan2(l_hip.y − r_hip.y,
l_hip.x − r_hip.x)` (mean-absolute and peak); shoulder tilt (mean-absolute); and hip-midpoint
drift from calibration (a walking-off check).

### 7.8 Calibration and device covariates

`scale_m_per_px`, the chain length and per-side standing thigh lengths, shoulder width, trunk
length, calibration frontalness, hold duration and jitter; camera pitch and roll; the calibration
hip-midpoint normalised y; video and screen dimensions; pose model and delegate; user agent.

### 7.9 Legacy (Flutter-parity) block

For continuity with the prior IntelliCARE assessment, SIP//LAB reports `total_repetitions`
(mapped to the right-knee count), per-leg transition-time average/min/max/SD, per-leg
lifting-time average/SD, peak standing vertical velocity, total duration, and per-leg sample
sizes. These are definitionally re-derived (the original server algorithm was unavailable) and
should be treated as approximations of the legacy quantities.

---

## 8. Normative data and interpretation

SIP//LAB classifies the **right-knee count** against the Rikli & Jones (2001) normative tables
for the 2-Minute Step Test, accessed via Topend Sports. Classification is reported only when
`valid_for_norm` is true (quality control passed, a full 120 s test, age 60–94, and sex recorded
as male or female). The classes are **Below Average**, **Average** and **Above Average**, with the
age- and sex-specific cut-points displayed on the badge.

| Age | Men: below / average / above | Women: below / average / above |
|-----|------------------------------|--------------------------------|
| 60–64 | <87 / 87–115 / >115 | <75 / 75–107 / >107 |
| 65–69 | <87 / 86–116 / >116 | <73 / 73–107 / >107 |
| 70–74 | <80 / 80–110 / >110 | <68 / 68–101 / >101 |
| 75–79 | <73 / 73–109 / >109 | <68 / 68–100 / >100 |
| 80–84 | <71 / 71–103 / >103 | <60 / 60–91 / >91 |
| 85–89 | <59 / 59–91 / >91 | <55 / 55–85 / >85 |
| 90–94 | <52 / 52–86 / >86 | <44 / 44–72 / >72 |

The published source lists the 65–69 men's average band as "86 to 116" while below-average is
"< 87"; the published values are kept verbatim. Participants outside 60–94 years, of unspecified
sex, or whose test did not pass quality control are reported as **Not Classified** — the
biomechanical descriptors remain available in that case.

**Interpretation guidance.** A below-average classification indicates aerobic endurance below the
age/sex reference and, in the context of a full clinical picture, may support a recommendation for
supervised aerobic conditioning. Change over repeated assessments (using the same camera setup) is
often more informative than a single classification; the per-quarter counts and rate-change metric
help distinguish a genuinely low capacity from pacing or motivational factors on the day.

---

## 9. Quality control and measurement validity

Each session carries a semicolon-separated `qc_flags` string and a `qc_pass` boolean.
Deliberately, only genuinely test-invalidating conditions **block** norm classification; framing
and tracking issues are **advisory** so a usable test still classifies.

**Blocking flags:** `MANUAL_STOP` (operator stopped early), `TAB_HIDDEN` (the app was
backgrounded mid-test), `NO_STEPS` (no counted steps).

**Advisory flags** (recorded, do not block): `LOW_FPS`, `LOW_VALID_FRAMES`, `TRACKING_GAPS`,
`FEET_OUT_OF_FRAME`, `CAMERA_OR_FEET_SHIFT`, `HEIGHT_IMPLAUSIBLE`, `BOTH_KNEES_UP`,
`OBLIQUE_VIEW`, `CAMERA_TILT`, `CAMERA_HEIGHT_OFF`, `LIFT_2D_3D_DISAGREE`, `LONG_REST`,
`CAL_FALLBACK`, `SUPPORT_USED`. Current trigger thresholds are documented in `DATA_DICTIONARY.md`
§8 and set in `js/config.js`.

The app also records **effective frame rate**, **valid-frame percentage**, **imputed-sample
percentage**, the **longest gap**, the **feet-out-of-frame percentage**, the **shoulder-width
change** (an obliquity/rotation surrogate), the **2-D versus 3-D lift disagreement**, and the
**both-knees-up percentage**, so an analyst can judge data quality independently of the flags.

---

## 10. Data dictionary and exported files

Pressing **Download ZIP** produces a bundle named `{timestamp}_{sex}_{age}_SIP_*` containing:

- `*_summary.csv` — one row, every session-level column.
- `*_steps.csv` — one row per detected lift (counted and uncounted).
- `*_frames_analysis.csv` — the 30 Hz analysed time series (progress, phase, velocities, posture,
  filtered pixel coordinates).
- `*_frames_raw.csv` — device-rate raw landmarks (`t_ms` + 17 markers × 7 values).
- `*_session.json` — the summary, a full configuration snapshot, the step list and the QC block.
- `README.txt` — a human-readable session header.

The authoritative, machine-generated **`DATA_DICTIONARY.md`** documents every column with its
type, unit, description and calculation, plus the marker table, derived-quantity definitions, the
QC-flag table with triggers, and the complete parameter list. Regenerate it after any schema or
configuration change by opening `tools/dictionary.html` and clicking **Download**.

---

## 11. System architecture and software design

### 11.1 Design constraints

SIP//LAB is a **zero-install, zero-build** application: no Node, npm, Git, bundler, TypeScript or
framework. It is vanilla HTML, CSS and JavaScript served as static files from GitHub Pages, with
classic `<script>` tags loaded in dependency order. MediaPipe is loaded at runtime from a pinned
CDN via dynamic `import()`; nothing is vendored. The camera requires a secure context (HTTPS),
which GitHub Pages provides.

### 11.2 Module map

```
index.html               Entry document, fonts, backdrop, ordered scripts, global error banner
css/styles.css           Visual design system (TRON HUD tokens) + SIP layout
js/config.js             CONFIG — every parameter, [TUNE] markers, Sheets webhook, norms
js/schema.js             SCHEMA — single source of truth for every exported column
js/geom.js               Geom — shared pixel/geometry helpers (used live and offline)
js/analysis.js           SIPAnalysis — offline engine: resample, filtfilt, events, metrics, QC, norms
js/export.js             Exporter — CSV/ZIP (dependency-free stored ZIP + CRC32), session.json, Sheets outbox
js/charts.js             Charts — dependency-free canvas charts
js/pose-engine.js        PoseEngine — camera, MediaPipe, overlay, live state machine
js/screen-live.js        LiveScreens — S2 setup/calibration and S3 live test
js/app.js                App — router, S1 entry, shared helpers, modal
js/screen-results.js     ResultsScreen — S4 results, S5 history, dialogs, auto-upload
tests/index.html         Browser unit tests (+ tests/synth.js synthetic generator)
tools/dictionary.html    Generates DATA_DICTIONARY.md from SCHEMA + CONFIG
tools/replay.html        Threshold-tuning tool: re-runs the analysis from a saved raw CSV
apps-script/Code.gs      Google Apps Script Sheets receiver
diag.html                On-device load/permission/CDN diagnostics
```

The only globals are the namespaced objects `CONFIG, SCHEMA, Geom, SIPAnalysis, Exporter, Charts,
PoseEngine, LiveScreens, App, ResultsScreen`. Every file uses strict mode.

### 11.3 Data flow

```
camera → <video> → requestVideoFrameCallback → PoseLandmarker.detectForVideo
  → 17 landmarks (+ world) ─┬→ overlay canvas
                            ├→ live EMA state machine → HUD counts
                            └→ preallocated raw-frame buffer (typed arrays)
test end → SIPAnalysis.run(buffer, calibration, participant, CONFIG)
        → { summary, steps, frames } → Results UI + Charts
        → Exporter: CSV/ZIP, local history, Google Sheets outbox
```

### 11.4 Engineering notes

- **Live loop** avoids per-frame allocations and skips work when the tab is hidden; it targets
  ≥ 15 effective fps on mid-range phones (GPU delegate with CPU fallback).
- **ZIP export** is a hand-rolled *stored* (uncompressed) archive with a table-driven CRC32 — no
  third-party library — validated against the standard CRC-32 test vector.
- **Robustness**: camera permission/availability errors, model-download failure, tab
  backgrounding, device sleep (screen wake-lock), storage-quota and offline conditions are each
  handled, and an on-device error banner surfaces any uncaught failure for field diagnosis.
- **Testing**: `tests/index.html` runs a synthetic-signal unit suite (counting correctness,
  threshold edges, hysteresis, boundary timing, rest detection, filter zero-phase property,
  schema/CSV integrity, ZIP/CRC correctness and the full norm table). It must be green before
  deployment.

---

## 12. Google Sheets integration and data governance

Numeric results are posted to a Google Apps Script web app (`apps-script/Code.gs`) deployed from
the operator's own Google account, which appends them to the bound spreadsheet. The current
deployment writes to the live sheet linked at the top of this manual.

- **Transport.** A single HTTP `POST` with `Content-Type: text/plain` (to avoid a CORS preflight),
  carrying `{ schemaVersion, summary, steps }` (and optionally `frames`).
- **Columns by name.** The receiver matches spreadsheet columns by header name and appends any new
  columns automatically, so schema growth never breaks ingestion.
- **De-duplication.** Rows are de-duplicated by `session_id`; re-sending a session is safe.
- **Resilience.** A local **outbox** queues uploads and retries automatically when connectivity
  returns; a manual re-send is available on the results and history screens. Because the browser
  often cannot read the cross-origin reply, the app may report "sent (cannot confirm)" even on
  success — the appearance of the row in the sheet is the definitive confirmation.
- **Tabs.** `Sessions` (one row per test), `Steps` (one row per lift), and an optional `Frames`
  tab (disabled by default).
- **Deployment requirements.** The web app must be deployed with **Execute as: Me** and **Who has
  access: Anyone**; a `GET` to the `/exec` URL returns `{"status":"active","service":"sip-lab"}`.

In the current configuration, results upload **automatically** on test completion. Operators who
require explicit participant consent should re-enable the consent gate (the hook remains in the
code) and obtain consent per their institutional ethics approval.

---

## 13. Privacy, ethics and safety

- **On-device inference.** Video frames and raw landmarks are processed on the phone and are
  **never transmitted or stored off-device**; only numeric results leave the device.
- **Pseudonymous identifiers only.** Participant IDs must not contain names or other direct
  identifiers.
- **Data minimisation.** The uploaded payload is numeric summary and per-step data; frame-level
  export to the sheet is off by default.
- **Governance.** Operators are responsible for obtaining ethics approval and, where required,
  informed consent appropriate to their jurisdiction and institution, and for securing the
  Google Sheet (access control, retention, and deletion policies).
- **Safety.** Screen for exercise contraindications before testing, supervise the participant,
  keep a stable support within reach, and apply the stopping rules in Section 3.4.

---

## 14. Validation, limitations and future work

### 14.1 Recommended pilot validation (before trusting absolute counts)

The counting thresholds are engineering defaults. Before relying on absolute counts, conduct a
pilot against a criterion:

- **Sample.** At least 10 participants (ideally older adults), or ≥ 20 healthy volunteers marching
  at slow, normal and fast cadences and varying knee heights.
- **Ground truth.** Two observers independently tally right-knee lifts reaching hip level; use
  their mean and flag disagreements greater than two.
- **Agreement.** Compute the mean absolute difference, percentage difference, Bland–Altman bias
  and limits of agreement, and the intraclass correlation coefficient between the app's
  `steps_right` and the observer mean.
- **Acceptance.** Target a mean absolute difference ≤ 2 steps or ≤ 3 %, with no systematic bias
  across cadence.
- **Tuning.** Use `tools/replay.html` to sweep `countP`, `releaseP`, cutoff and minimum prominence
  on saved raw CSVs; change defaults only after validation, then increment `analysis_version`.
- **Camera-height sensitivity.** Repeat a subset with the phone deliberately ±20 cm high and low to
  quantify the perspective bias described in Section 3.2.

### 14.2 Known limitations

- **Frontal-view-only kinematics.** Depth-dependent quantities (hip and knee flexion angles,
  forward trunk lean, anteroposterior sway) are not measured; world-landmark depth from a single
  camera is unreliable and is used only as a cross-check.
- **Landmark fidelity.** A thigh pointing at the camera is foreshortened; a hand, chair or loose
  clothing can occlude the knee at the apex. Filtering, hysteresis, a minimum prominence and a
  gap policy mitigate but do not eliminate these effects.
- **Hip landmark ≠ iliac crest.** The MediaPipe hip point is not the iliac crest, so the "hip
  level" criterion approximates the Senior Fitness Test's patella–iliac-crest midpoint.
- **Perspective.** Camera height and tilt bias apparent knee height; the S2 checks and recorded
  covariates reduce but do not remove this.
- **Thresholds are unvalidated** (`[TUNE]`) pending the pilot; the lenient default favours
  counting every step over strict height adherence, by design.
- **Not a diagnostic device.**

### 14.3 Future work

Criterion validation against VO₂ and the 6-Minute Walk Test; automatic per-participant threshold
personalisation; multi-camera or depth-sensor extension for true flexion angles; and longitudinal
change-detection reporting.

---

## 15. Glossary

**2MST** — 2-Minute Step Test. **CRF** — cardiorespiratory fitness. **VO₂max** — maximal oxygen
uptake. **p (lift progress)** — fraction of thigh length the knee has risen (0 standing, 1 at hip).
**S0** — standing vertical thigh length in pixels. **filtfilt** — forward–backward (zero-phase)
filtering. **Hysteresis** — separate rise/fall thresholds that prevent double counting. **Outbox**
— local queue of unsent uploads. **QC flag** — automatic data-quality marker. **ICC** — intraclass
correlation coefficient. **Bland–Altman** — a method for assessing agreement between two measures.

---

## 16. References

### Clinical and scientific

- Bazarevsky, V., Grishchenko, I., Raveendran, K., Zhu, T., Zhang, F., & Grundmann, M. (2020).
  *BlazePose: On-device real-time body pose tracking.* arXiv:2006.10204. https://arxiv.org/abs/2006.10204
- Blair, S. N., Kohl, H. W., Paffenbarger, R. S., Clark, D. G., Cooper, K. H., & Gibbons, L. W.
  (1989). Physical fitness and all-cause mortality: A prospective study of healthy men and women.
  *JAMA, 262*(17), 2395–2401. https://doi.org/10.1001/jama.1989.03430170057028
- Jones, C. J., & Rikli, R. E. (2002). Measuring functional fitness of older adults.
  *The Journal on Active Aging, 1*(2), 24–30.
- Myers, J., Prakash, M., Froelicher, V., Do, D., Partington, S., & Atwood, J. E. (2002). Exercise
  capacity and mortality among men referred for exercise testing. *New England Journal of
  Medicine, 346*(11), 793–801. https://doi.org/10.1056/NEJMoa011858
- Rikli, R. E., & Jones, C. J. (1998). The reliability and validity of a 6-minute walk test as a
  measure of physical endurance in older adults. *Journal of Aging and Physical Activity, 6*(4),
  363–375. https://doi.org/10.1123/japa.6.4.363
- Rikli, R. E., & Jones, C. J. (1999a). Development and validation of a functional fitness test for
  community-residing older adults. *Journal of Aging and Physical Activity, 7*(2), 129–161.
  https://doi.org/10.1123/japa.7.2.129
- Rikli, R. E., & Jones, C. J. (1999b). Functional fitness normative scores for community-residing
  older adults, ages 60–94. *Journal of Aging and Physical Activity, 7*(2), 162–181.
  https://doi.org/10.1123/japa.7.2.162
- Rikli, R. E., & Jones, C. J. (2001). *Senior Fitness Test manual.* Human Kinetics.
- Rikli, R. E., & Jones, C. J. (2013). Development and validation of criterion-referenced clinically
  relevant fitness standards for maintaining physical independence in later years. *The
  Gerontologist, 53*(2), 255–267. https://doi.org/10.1093/geront/gns071
- Ross, R., Blair, S. N., Arena, R., Church, T. S., Després, J.-P., Franklin, B. A., … Wisløff, U.
  (2016). Importance of assessing cardiorespiratory fitness in clinical practice: A case for
  fitness as a clinical vital sign. *Circulation, 134*(24), e653–e699.
  https://doi.org/10.1161/CIR.0000000000000461
- Winter, D. A. (2009). *Biomechanics and motor control of human movement* (4th ed.). Wiley.
  https://doi.org/10.1002/9780470549148
- Needham, L., Evans, M., Cosker, D. P., Wade, L., McGuigan, P. M., Bilzon, J. L., & Colyer, S. L.
  (2021). The accuracy of several pose estimation methods for 3D joint centre localisation.
  *Scientific Reports, 11*, 20673. https://doi.org/10.1038/s41598-021-00212-x
- Topend Sports. (n.d.). *2-Minute Step in Place Test.* Retrieved from
  https://www.topendsports.com/testing/tests/step-in-place-2min.htm

### Technical

- Google. (2024). *MediaPipe Pose Landmarker — task guide and model card.*
  https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
- Lugaresi, C., Tang, J., Nash, H., McClanahan, C., Uboweja, E., Hays, M., … Grundmann, M. (2019).
  *MediaPipe: A framework for building perception pipelines.* arXiv:1906.08172.
  https://arxiv.org/abs/1906.08172
- Oppenheim, A. V., & Schafer, R. W. (2010). *Discrete-time signal processing* (3rd ed.). Pearson.
  (Zero-phase forward–backward filtering; Butterworth design.)
- Gustafsson, F. (1996). Determining the initial states in forward–backward filtering.
  *IEEE Transactions on Signal Processing, 44*(4), 988–992. https://doi.org/10.1109/78.492552
- PKWARE. (2007). *.ZIP File Format Specification (APPNOTE.TXT, version 6.3.2).*
  (Stored-method archive layout used by the dependency-free exporter.)
- World Wide Web Consortium. (2021). *MediaDevices.getUserMedia() and the Screen Wake Lock API.*
  https://www.w3.org/TR/mediacapture-streams/ ; https://www.w3.org/TR/screen-wake-lock/

---

*SIP//LAB · v1.0.0 · This manual documents the current implementation; algorithm parameters marked
`[TUNE]` are subject to refinement following pilot validation. Regenerate `DATA_DICTIONARY.md` from
`tools/dictionary.html` after any change to `schema.js` or `config.js`.*
