# SIP//LAB — Data Dictionary

_This file is generated from `js/schema.js` and `js/config.js` by `tools/dictionary.html`.
Open that page in a browser and click **Download DATA_DICTIONARY.md** to regenerate the
complete per-column tables after any schema or config change. The content below mirrors
that output. Do not hand-edit; regenerate instead._

SIP//LAB is the 2-Minute Step-in-Place Biomechanics Lab (frontal view). This dictionary
documents every exported column, pose marker, derived quantity, QC flag and algorithm
parameter. The single source of truth is `js/schema.js`.

## 1. Conventions

- **Time**: `t = 0` at "GO". The scored window is `[0, 120]` s. Calibration and the 3-2-1
  countdown have negative time (pre-roll).
- **Image coordinates**: MediaPipe gives normalised `x, y ∈ [0,1]`. All distances/angles are
  computed in **pixels** first: `x_px = x_norm × video_width`, `y_px = y_norm × video_height`.
- **Vertical sign**: image `y` increases downward. Reported vertical quantities (knee rise,
  velocity) are **positive-up**.
- **Lift progress** `p`: `0` standing, `1` knee level with hip, `>1` above hip. Uses the
  **vertical** `knee_y − hip_y` only — never the 2-D Euclidean thigh length.
- **Anatomical sides**: right = orange, left = blue throughout. Geometry runs on the
  un-mirrored frame; the participant's right side appears on image-left.
- **World landmarks** (`_wx,_wy,_wz`, metres) are used only as a 3-D cross-check, never for counting.
- **Booleans** export as `true`/`false`. Missing values export as empty cells (no `-1` sentinels).

## 2. Summary (Sessions) — one row per test

Grouped columns (full descriptions and calculations in the generated file). Groups, in order:

- **Session & participant** — `session_id, timestamp_utc, utc_offset_min, app_version,
  analysis_version, schema_version, participant_id, age_years, sex, height_cm, body_mass_kg,
  site, operator_notes, attempt_number, previous_session_id, selected_as_final,
  unable_to_perform, support_used, camera_height_cm`
- **Device & pose** — `pose_model, pose_delegate, camera_facing, camera_view, camera_pitch_deg,
  camera_roll_deg, hip_y_norm_calib, video_width_px, video_height_px, screen_width_px,
  screen_height_px, user_agent`
- **Protocol** — `planned_duration_s, test_duration_s, manual_stop, protocol_briefed,
  count_threshold_preset, count_threshold_p, release_threshold_p, filter_cutoff_hz, resample_hz`
- **Primary outcomes** — `steps_right, steps_left, steps_total, live_count_right, live_count_left,
  count_difference_right, count_difference_left, incomplete_attempts_right,
  incomplete_attempts_left, steps_right_q1..q4, steps_left_q1..q4, norm_reference,
  norm_cutoff_below_average, norm_cutoff_above_average, norm_classification`
- **Flutter parity** — `total_repetitions, avg/min/max/std_transition_time_left|right,
  avg/std_lifting_time_left|right_s, peak_standing_vertical_velocity_m_s, total_duration,
  n_steps_left, n_steps_right`
- **Pacing** — `cadence_total|right|left_steps_per_min, step_interval_mean/sd/cv_*_left|right,
  alternation_interval_mean_s, alternation_interval_cv_pct, interval_slope_s_per_step,
  rate_change_pct_q1_q4, time_to_first_step_s`
- **Rest** — `rest_count, rest_total_s, longest_rest_s, active_time_pct`
- **Step height** — `lift_progress_mean/sd/min_left|right, knee_rise_mean_cm_left|right,
  pct_steps_hip_level_left|right, lift_height_change_pct_left|right`
- **Velocity** — `peak_up_velocity_mean/max_m_s_left|right, peak_down_velocity_mean_m_s_left|right`
- **Symmetry** — `symmetry_step_count_pct, symmetry_lift_height_pct, symmetry_lifting_time_pct`
- **Balance & posture** — `sway_ml_rms_cm, sway_ml_range_cm, sway_path_length_cm,
  hip_vertical_range_cm, trunk_lean_mean_abs_deg, trunk_lean_peak_deg, pelvis_tilt_mean_abs_deg,
  pelvis_tilt_peak_deg, shoulder_tilt_mean_abs_deg, hip_mid_drift_cm`
- **Calibration** — `scale_m_per_px, calib_chain_px, calib_thigh_px_left, calib_thigh_px_right,
  calib_shoulder_width_px, frontalness_calib, calib_hold_s, calib_jitter, calib_mode`
- **Quality control** — `effective_fs_hz, valid_frame_pct, imputed_sample_pct, longest_gap_s,
  median_chain_visibility, feet_out_of_frame_pct, shoulder_width_change_pct, lift_2d_3d_diff,
  both_knees_up_pct, qc_flags, qc_pass, valid_for_norm`

## 3. Steps — one row per detected lift

`session_id, step_index, leg, leg_step_number, counted, counted_in_window, peak_progress,
reached_hip_level, t_onset_s, t_peak_s, t_offset_s, lifting_time_s, lowering_time_s,
transition_time_s, interval_prev_same_leg_s, alternation_prev_s, knee_rise_cm,
peak_up_velocity_m_s, peak_down_velocity_m_s, sway_at_peak_cm, trunk_lean_at_peak_deg,
pelvis_tilt_at_peak_deg, tracking_gap_flag, both_knees_up_flag`

Uncounted peaks (local maxima with `lowP ≤ p < countP`) are included with `counted = false`.

## 4. Frames (analysis, 30 Hz)

`session_id, t_s, phase_left, phase_right (DOWN|RISING|UP|LOWERING), tracking_gap,
progress_left, progress_right, knee_rise_left_m, knee_rise_right_m, knee_vel_left_m_s,
knee_vel_right_m_s, hip_mid_x_cm, hip_mid_y_cm, trunk_lean_deg, pelvis_tilt_deg,
shoulder_tilt_deg, shoulder_width_px, progress_left_3d, progress_right_3d` plus filtered
pixel coordinates `{l,r}_{sh,hip,kn,an}_{x,y}_px`.

## 5. Raw frames (device rate)

One row per captured frame: `t_ms` (relative to GO) followed by 17 markers × 7 values —
`_x,_y,_z` (normalised), `_v` (visibility), `_wx,_wy,_wz` (world metres). 1 + 17×7 = 120 columns.

## 6. Tracked pose markers

| Key | Index | Name | Role (frontal view) |
|-----|-------|------|---------------------|
| `nose` | 0 | nose | Frame-fit (head in frame), facing check |
| `l_sh` / `r_sh` | 11 / 12 | left/right shoulder | Scale chain, trunk lean, shoulder tilt, frontalness (rotation) check |
| `l_el` / `r_el` | 13 / 14 | left/right elbow | Recorded only |
| `l_wr` / `r_wr` | 15 / 16 | left/right wrist | Recorded only (support use not penalised) |
| `l_hip` / `r_hip` | 23 / 24 | left/right hip | Same-side lift reference, pelvis tilt, sway, hip-height camera check, scale chain |
| `l_kn` / `r_kn` | 25 / 26 | left/right knee | **Primary lift signal** (right = official score) |
| `l_an` / `r_an` | 27 / 28 | left/right ankle | Scale chain, feet-in-frame, camera/feet-shift check |
| `l_heel` / `r_heel` | 29 / 30 | left/right heel | Feet-in-frame, ground reference (exploratory) |
| `l_toe` / `r_toe` | 31 / 32 | left/right foot index | Feet-in-frame, ground reference (exploratory) |

## 7. Definitions of derived quantities

- **Valid sample** — visibility ≥ `signal.minVisibility` (0.5) and inside the frame; otherwise
  missing (bridged if the gap ≤ `signal.maxGapS`, else flagged).
- **Standing thigh length `S0_s`** — median over the calibration hold of `knee_y_px − hip_y_px`
  for side s (px, vertical only).
- **Lift progress `p_s(t)`** — `1 − (knee_y_px − hip_y_px) / S0_s`.
- **Count threshold `countP`** — 0.85 default ("a little at hip level"); "official midpoint" preset = 0.50.
- **Counted step** — local maximum of filtered `p_s` with peak ≥ `countP`, preceded by a fall to
  ≤ `releaseP` since the previous counted peak of that leg, and `t_peak ≤ 120 s`.
- **`t_onset` / `t_peak` / `t_offset`** — upward `lowP` crossing before the peak / peak time /
  downward `lowP` crossing after the peak.
- **lifting / lowering / transition time** — `t_peak − t_onset`, `t_offset − t_peak`, `t_offset − t_onset`.
- **Same-leg step interval** — `t_peak(k) − t_peak(k−1)` same leg; alternation = to previous opposite-leg peak.
- **`knee_rise_cm`** — `(S0_s − (knee_y_px − hip_y_px)_peak) × scale_m_per_px × 100`.
- **Scale `scale_m_per_px`** — `0.779 × height_m ÷ chainpx` (Winter 2009); `chainpx` = mean
  shoulder→hip→knee→ankle pixel chain at standing calibration.
- **Knee vertical velocity** — central-difference derivative of filtered knee height (m/s, positive up).
- **Cadence** — `steps ÷ (test_duration_s / 60)` per leg and total.
- **Coefficient of variation** — `SD ÷ mean × 100` (sample SD, n−1).
- **Interval slope** — OLS slope of step interval vs step number (needs ≥ 4 steps).
- **Quarter counts** — q1 = [0,30), q2 = [30,60), q3 = [60,90), q4 = [90,120] s by `t_peak`.
- **Rate change %** — `(q4 − q1) ÷ q1 × 100` (negative = slowing).
- **Rest** — interval with no counted step by either leg longer than `rest.restGapS` (3 s).
- **Medio-lateral sway** — `(hipmid_x_px − calibration hipmid_x_px) × scale`, linearly detrended;
  RMS, range, path length (cm). Positive = toward the participant's left.
- **Trunk lateral lean** — `atan2(shoulder_mid.x − hip_mid.x, hip_mid.y − shoulder_mid.y)` degrees.
- **Pelvis tilt** — `atan2(l_hip.y − r_hip.y, l_hip.x − r_hip.x)` degrees (positive = left hip lower).
- **Shoulder tilt** — same with shoulders.
- **Frontalness** — `|l_sh.x − r_sh.x| ÷ trunk length`; facing check and `OBLIQUE_VIEW`.
- **Symmetry index** — `(R − L) ÷ mean(R, L) × 100`; positive = right greater.
- **3-D cross-check `p3d_s`** — `1 − (kneeW_y − hipW_y) ÷ S0w_s` from world landmarks; mean |p − p3d| at peaks.
- **Effective fps** — frames processed ÷ test window duration.
- **Norm classification** — Rikli & Jones table lookup on `steps_right`; only if `valid_for_norm`.

## 8. Quality-control flags

`qc_flags` is a `;`-separated list. `qc_pass` is true when no **blocking** flag is present;
blocking flags also withhold norm classification.

**Blocking**: `LOW_FPS, LOW_VALID_FRAMES, TRACKING_GAPS, FEET_OUT_OF_FRAME, CAMERA_OR_FEET_SHIFT,
MANUAL_STOP, TAB_HIDDEN, NO_STEPS, CAL_NOT_STILL, HEIGHT_IMPLAUSIBLE, BOTH_KNEES_UP`

| Flag | Blocking | Trigger |
|------|----------|---------|
| `LOW_FPS` | yes | effective fps < 15 |
| `LOW_VALID_FRAMES` | yes | valid-frame % < 90 |
| `TRACKING_GAPS` | yes | imputed % > 10 or gap > 0.5 s |
| `FEET_OUT_OF_FRAME` | yes | ankles/toes out of frame > 5 % of frames |
| `CAMERA_OR_FEET_SHIFT` | yes | ankle/hip-mid drift beyond limit |
| `MANUAL_STOP` | yes | operator stopped early |
| `TAB_HIDDEN` | yes | tab backgrounded mid-test |
| `NO_STEPS` | yes | no counted steps |
| `CAL_NOT_STILL` | yes | calibration jitter > 0.04 |
| `HEIGHT_IMPLAUSIBLE` | yes | scale-derived height vs entered > 15 % |
| `BOTH_KNEES_UP` | yes | both knees ≥ countP > 5 % of window |
| `OBLIQUE_VIEW` | no | shoulder-width change > 25 % from calibration |
| `CAMERA_TILT` | no | device pitch/roll > 5° |
| `CAMERA_HEIGHT_OFF` | no | calibration hip-mid y outside [0.35, 0.65] |
| `LIFT_2D_3D_DISAGREE` | no | mean |p − p3d| > 0.25 |
| `LONG_REST` | no | resting > 20 % of window |
| `CAL_FALLBACK` | no | calibration fell back to auto-estimate |
| `SUPPORT_USED` | no | operator declared support used |

## 9. Algorithm parameters (CONFIG)

Every value lives in `js/config.js`. Items marked `[TUNE]` there are engineering defaults not
yet validated against a criterion measure (see the pilot protocol). Key values:

- `protocol.durationS 120, countdownS 3, preRollS 1, tailS 2, view front`
- `signal.resampleHz 30, cutoffHz 8 [TUNE], maxGapS 0.25, minVisibility 0.5, padSamples 30`
- `events.countP 0.85 [TUNE], countPOfficial 0.50, releaseP 0.55 [TUNE], lowP 0.15,
  minSameLegS 0.25, bothKneesMaxS 0.2, minProminence 0.2 [TUNE], maxP 2.0, hipRef same_side,
  gapPeakPolicy flag`
- `rest.restGapS 3 [TUNE]`
- `calibration.holdS 2, maxJitterTrunkFrac 0.04 [TUNE], heightRangeCm [120,210]`
- `camera.maxPitchDeg 5 [TUNE], hipYNormRange [0.35,0.65] [TUNE], minFrontalness 0.8 [TUNE],
  spanRange [0.65,0.90]`
- `anthropometry.segmentChainFractionOfHeight 0.779`
- `qc.*` thresholds as in §8
- `live.emaAlpha 0.4`
- `sheets.webhookUrl '', uploadFrames false`

A snapshot of the full CONFIG is written into every `*_session.json`.

## 10. Limitations (frontal view)

- No depth-based angles (hip/knee flexion, forward trunk lean, anteroposterior sway).
- A thigh pointing at the camera is foreshortened and may add landmark jitter; only the vertical
  difference is used.
- Camera height/tilt biases apparent knee height (a high camera under-counts, a low camera
  over-counts); mitigated by the S2 checks and recorded as covariates.
- Knee occlusion by a hand, chair or loose clothing creates gaps at the apex.
- The MediaPipe hip landmark is not the iliac crest, so the "hip level" rule approximates the
  Senior Fitness Test's patella–iliac-crest midpoint.
- Thresholds marked `[TUNE]` are unvalidated; run the pilot before trusting absolute counts.
- Not a medical device.

## 11. References

- Rikli, R. E., & Jones, C. J. (1999). Functional fitness normative scores for community-residing
  older adults, ages 60–94. *Journal of Aging and Physical Activity, 7*(2), 162–181.
- Jones, C. J., & Rikli, R. E. (2002). Measuring functional fitness of older adults.
  *The Journal on Active Aging*, March–April, 24–30.
- Topend Sports. 2-Minute Step in Place Test.
  https://www.topendsports.com/testing/tests/step-in-place-2min.htm
- Winter, D. A. (2009). *Biomechanics and motor control of human movement* (4th ed.). Wiley.
- Bazarevsky, V., et al. (2020). BlazePose: On-device real-time body pose tracking. arXiv:2006.10204.
- Needham, L., et al. (2021). The accuracy of several pose estimation methods for 3D joint centre
  localisation. *Scientific Reports, 11*, 20673.
