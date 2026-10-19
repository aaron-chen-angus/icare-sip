# SIP//LAB — 2-Minute Step-in-Place Biomechanics Lab

> **Not a medical device.** For research and education only. Results do not constitute a medical
> diagnosis. Ensure participants are fit for the test and supervised.

A standalone, browser-only computer-vision web app for the **2-Minute Step in Place Test (2MSPT)**
of the Senior Fitness Test (Rikli & Jones). The participant **faces the phone** (frontal view).
The app counts right-knee lifts (the official score), reports left and total counts, produces a
full biomechanical analysis, captures numeric results to Google Sheets, and ships with a complete
data dictionary. All pose estimation runs **on-device**; no video or raw landmarks ever leave the phone.

Built to mirror the STS//LAB (Sit-to-Stand) app's architecture and TRON HUD design.

---

## 1. Quick start

1. Open the deployed URL on a phone (see §2). The camera needs **HTTPS**.
2. **Entry (S1)**: read the setup diagram, pick a language to watch the demo, then **Proceed**.
   Fill the participant form (pseudonymous ID, age, sex, height — height is required for scaling).
3. **Camera setup (S2)**: stand the phone on a tripod directly in front of the participant, at
   **hip height**, **level**, **2.5–3 m** away, portrait. Follow the on-screen checklist until all
   ticks are green, then hold still ~2 s for **calibration**. Press **Start Test**.
4. **Live test (S3)**: 3-2-1 countdown, then march in place for **120 s**, lifting each knee to
   about hip height. Live R / L / Total counts update on the HUD.
5. **Results (S4)**: official right-knee score, norm classification, QC, metrics and charts.
   **Download ZIP**, **Use this result** (optionally upload to Sheets), **Retry**, or start a
   **New participant**. **History (S5)** lists local sessions.

To run the **unit tests**, open `tests/index.html` in any browser (no camera, `file://` is fine).
To generate the data dictionary, open `tools/dictionary.html`. To tune thresholds from a saved
recording, open `tools/replay.html`.

---

## 2. Deploying to GitHub Pages (no install)

The institution forbids installing software. Nothing here needs Node, npm, Git or a build step.

1. On GitHub, create a repository (e.g. `icare-sip`).
2. **Add file → Upload files**. Drag the contents of `icare-sip/` so that `index.html` sits at the
   **repository root**, beside `css/` and `js/`. Upload in batches if needed (GitHub web upload
   allows ≤100 files and ≤25 MB per file).
3. **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save.**
4. After ~1 minute the site is live at `https://<user>.github.io/<repo>/`.
5. To make small edits later, use the GitHub web editor (pencil icon). Hard-refresh the phone after
   each change to bypass the cache.

Three ways to run it:
- **GitHub Pages (primary)** — HTTPS, so the camera works.
- `python -m http.server` — only if Python is already permitted on your machine.
- `tests/index.html` and `tools/*.html` open directly from `file://` (no camera needed).

The MediaPipe model and WASM load from a CDN at runtime (`@mediapipe/tasks-vision@0.10.18`). If your
network blocks CDNs, ask IT to allow `cdn.jsdelivr.net` and `storage.googleapis.com`.

---

## 3. Google Sheets integration (step by step)

Live numeric results can flow into a Google Sheet. This is entirely browser-based.

1. Create a new Google Sheet.
2. **Extensions → Apps Script**. Delete the placeholder, paste the contents of
   `apps-script/Code.gs`, and **Save**.
3. **Deploy → New deployment → Web app.** Set **Execute as: Me** and **Who has access: Anyone**.
   Deploy, authorise, and **copy the `/exec` URL**.
4. Paste that URL into `js/config.js` → `sheets.webhookUrl`. Commit via the GitHub web editor.
5. On the results screen, tick **Consent to upload** before submitting. Rows arrive in the
   **Sessions** and **Steps** tabs (and **Frames** if `uploadFrames` is enabled).
6. After **any** change to `Code.gs`, redeploy as a **new version** (Manage deployments → Edit → New version).

Notes: columns are matched **by name** and new columns are appended automatically. Uploads are
de-duplicated by `session_id`. If the browser cannot read the reply (CORS), the app reports
"sent (cannot confirm)". Offline uploads queue in a local **outbox** and retry when you reconnect.
A health check: opening the `/exec` URL returns `{"status":"active","service":"sip-lab"}`.

---

## 4. Complete list of inputs and metrics

**Inputs (S1 form):** participant ID, age, sex, height (cm, required), body mass (kg, optional),
site/session label, operator notes, camera (rear/front), pose model (lite/full/heavy), camera
height (cm, optional), count-threshold preset (hip level / official midpoint), and checkboxes for
safety, protocol briefed, support used, unable to perform, and consent to upload.

**Outputs:** right/left/total step counts, per-30-s quarter counts, norm classification, cadence,
step intervals and variability, alternation, rest periods, knee-rise height, % reaching hip level,
symmetry indices, knee velocities, medio-lateral sway, trunk lean, pelvis/shoulder tilt, the 13
Flutter-parity fields, calibration values and a full QC block. Every exported column is documented
in `DATA_DICTIONARY.md`.

---

## 5. Scientific manual: the 2-Minute Step in Place test

The 2MSPT is an aerobic-endurance item of the Senior Fitness Test (Rikli & Jones). The participant
marches in place for two minutes, raising each knee to a target height. The official score is the
number of times the **right** knee reaches the target in 120 s. Resting and holding a wall or stable
chair are allowed and are recorded as covariates, not penalised. SIP//LAB infers the target height
from the participant's own body (knee ≈ hip level) rather than taped wall marks.

---

## 6. Biomechanics of marching in place and knee lift

Each lift is a hip-flexion movement that raises the knee. Viewed from the front, the scored quantity
— knee height relative to the hip — is a **vertical** image displacement, which is preserved under a
frontal, level camera at hip height. Cadence is typically 1–2 lifts per second per leg, so the
signal processing uses a higher filter cutoff than a sit-to-stand test. The app also derives pacing,
rest, symmetry, knee velocity, and frontal-plane balance (sway, trunk lean, pelvis tilt).

---

## 7. Computer-vision and signal-processing methods

- **Pose**: MediaPipe Pose Landmarker (VIDEO mode, 1 pose, detection/presence/tracking 0.5), GPU
  with CPU fallback. 17 of 33 landmarks are recorded (image + world).
- **Live loop**: per-frame, causal. An EMA-smoothed progress `p` drives a hysteresis state machine
  for the on-screen counter.
- **Offline (authoritative)**: raw frames are resampled to 30 Hz (gaps > 0.25 s flagged and bridged),
  zero-phase low-pass filtered (forward-backward 2nd-order Butterworth, effective −3 dB at 8 Hz),
  converted to pixels, then peaks are detected and counted. Live and offline counts are both reported.
- **Scale**: `scale_m_per_px = 0.779 × height_m ÷ chainpx` (Winter 2009), from the shoulder→hip→
  knee→ankle pixel chain at standing calibration.

See `DATA_DICTIONARY.md` §7 for the exact formulae and `js/config.js` for every parameter.

---

## 8. How each metric is computed

- **Lift progress** `p = 1 − (knee_y_px − hip_y_px) / S0` (vertical only; `S0` = standing thigh length).
- **Counted step**: filtered peak `p ≥ countP` (default 0.85), the signal fell to `≤ releaseP` (0.55)
  since the previous counted peak of that leg, and `t_peak ≤ 120 s`.
- **Events**: `t_onset`/`t_offset` from `lowP` (0.15) crossings; lifting/lowering/transition times.
- **knee_rise_cm**, **velocities**, **cadence**, **CV**, **interval slope**, **rest**, **symmetry**,
  **sway/lean/tilt** — all defined in the data dictionary. Nothing uses depth (`z`) for counting;
  world landmarks are a cross-check only.

---

## 9. Quality control and validity

Blocking QC flags (which withhold norm classification) include low fps, too many missing frames,
tracking gaps, feet out of frame, camera/feet shift, manual stop, tab hidden, no steps, calibration
not still, implausible height, and both-knees-up. Non-blocking flags record oblique view, camera
tilt, camera-height-off, 2-D/3-D disagreement, long rest, calibration fallback and declared support.
`qc_pass` is true when no blocking flag is present. Run the pilot validation (`tools/replay.html`)
before trusting absolute counts; tune only the `[TUNE]` parameters and bump `analysis_version`.

---

## 10. Normative data and interpretation

Classification uses the Rikli & Jones (2002) 2-Minute Step norms (via Topend Sports) on the
**right-knee** count, only when `valid_for_norm` (QC pass, full 120 s, age 60–94, sex male/female).
Classes are BELOW AVERAGE / AVERAGE / ABOVE AVERAGE, with the age/sex cut-points shown on the badge.
The published source lists the 65–69 men's average band as "86 to 116" while below-average is "< 87";
the published values are kept as-is (see `js/config.js`).

---

## 11. Limitations

Frontal view only: no hip/knee flexion angles, forward trunk lean, or anteroposterior sway. A thigh
pointing at the camera is foreshortened (only the vertical difference is used). Camera height and
tilt bias apparent knee height — a high camera under-counts, a low camera over-counts — which the S2
checks mitigate and the data records as covariates. Knee occlusion by a hand, chair or loose clothing
creates gaps. The MediaPipe hip landmark is not the iliac crest, so the "hip level" rule approximates
the Senior Fitness Test's patella–iliac-crest midpoint. Thresholds marked `[TUNE]` are unvalidated.

---

## 12. Project structure and developer notes

```
index.html               entry (meta, fonts, tron-bg, <main id="app">, ordered <script> tags)
css/styles.css           STS visual tokens + SIP additions
js/config.js             CONFIG — every parameter, [TUNE] markers, Sheets webhook
js/schema.js             SCHEMA — single source of truth for every exported column
js/geom.js               shared pixel/geometry helpers (live + offline)
js/analysis.js           SIPAnalysis — offline engine (filter, events, metrics, QC, norms)
js/export.js             Exporter — CSV / ZIP / session.json / Sheets / outbox
js/charts.js             Charts — dependency-free canvas charts
js/pose-engine.js        PoseEngine — camera + MediaPipe + overlay
js/screen-live.js        LiveScreens — S2 camera+calibration and S3 live test
js/app.js                App — router, S1 entry, shared helpers, modal
js/screen-results.js     ResultsScreen — S4 results, S5 history, dialogs
tests/index.html         browser unit tests (+ tests/synth.js)
tools/dictionary.html    generates DATA_DICTIONARY.md
tools/replay.html        threshold tuning from a saved *_frames_raw.csv
apps-script/Code.gs      Google Sheets receiver
DATA_DICTIONARY.md       generated
README.md                this file
```

Rules: no build step; vanilla JS with `'use strict'`; the only globals are the namespaced objects
`CONFIG, SCHEMA, Geom, SIPAnalysis, Exporter, Charts, PoseEngine, LiveScreens, App, ResultsScreen`.
Every new metric needs a schema entry, dictionary text and a test. Never use the 2-D Euclidean thigh
length (vertical only); never use depth for counting; use `dvh`/`clamp()` (no `vh`, no fixed-pixel
layouts). **Run `tests/index.html` and confirm all green before deploying.**

---

## 13. References

- Rikli, R. E., & Jones, C. J. (1999). Functional fitness normative scores for community-residing older adults, ages 60–94. *Journal of Aging and Physical Activity, 7*(2), 162–181.
- Jones, C. J., & Rikli, R. E. (2002). Measuring functional fitness of older adults. *The Journal on Active Aging*, March–April, 24–30.
- Topend Sports. 2-Minute Step in Place Test. https://www.topendsports.com/testing/tests/step-in-place-2min.htm
- Winter, D. A. (2009). *Biomechanics and motor control of human movement* (4th ed.). Wiley.
- Bazarevsky, V., et al. (2020). BlazePose: On-device real-time body pose tracking. arXiv:2006.10204.
- Needham, L., et al. (2021). The accuracy of several pose estimation methods for 3D joint centre localisation. *Scientific Reports, 11*, 20673.
