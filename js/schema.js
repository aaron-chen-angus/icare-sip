/**
 * SIP//LAB — Data schema (single source of truth)
 *
 * Every exported column is declared here exactly once. export.js builds CSV
 * headers from these lists; tools/dictionary.html reads the same objects to
 * generate DATA_DICTIONARY.md. If a column is not here it is not exported.
 *
 * Field object: { key, group, type, unit, desc, calc }
 *   type: 'string' | 'int' | 'float' | 'bool' | 'enum'
 *   unit: '' when dimensionless
 *   desc: human description for the dictionary
 *   calc: calculation / source note for the dictionary
 *
 * Exposes global `SCHEMA` with { sessions, steps, framesAnalysis, framesRaw, markers, version }.
 */
(function (global) {
    'use strict';

    // Helper to declare a field tersely.
    const f = (key, group, type, unit, desc, calc) => ({ key, group, type, unit, desc, calc });

    // ---- SESSIONS (one row per test) -----------------------------------------
    const sessions = [
        // Session & participant
        f('session_id', 'Session & participant', 'string', '', 'Unique pseudonymous id for this attempt.', 'Generated at test start: timestamp + random suffix.'),
        f('timestamp_utc', 'Session & participant', 'string', 'ISO-8601', 'UTC time the test started.', 'new Date().toISOString() at GO.'),
        f('utc_offset_min', 'Session & participant', 'int', 'min', 'Local timezone offset from UTC.', '-Date.getTimezoneOffset().'),
        f('app_version', 'Session & participant', 'string', '', 'App version.', 'CONFIG.app.version.'),
        f('analysis_version', 'Session & participant', 'string', '', 'Analysis engine version.', 'CONFIG.app.analysisVersion.'),
        f('schema_version', 'Session & participant', 'string', '', 'Schema version.', 'CONFIG.app.schemaVersion.'),
        f('participant_id', 'Session & participant', 'string', '', 'Operator-entered pseudonymous participant id (no names).', 'Form input.'),
        f('age_years', 'Session & participant', 'int', 'years', 'Participant age.', 'Form input.'),
        f('sex', 'Session & participant', 'enum', '', 'Participant sex (male/female/other).', 'Form input.'),
        f('height_cm', 'Session & participant', 'float', 'cm', 'Standing height; drives the pixel->metre scale.', 'Form input (required).'),
        f('body_mass_kg', 'Session & participant', 'float', 'kg', 'Body mass (optional).', 'Form input.'),
        f('site', 'Session & participant', 'string', '', 'Site / session label.', 'Form input.'),
        f('operator_notes', 'Session & participant', 'string', '', 'Free-text operator notes.', 'Form input.'),
        f('attempt_number', 'Session & participant', 'int', '', 'Attempt number for this participant this visit.', 'Starts at 1; RETRY increments.'),
        f('previous_session_id', 'Session & participant', 'string', '', 'session_id of the previous attempt, if any.', 'Set on RETRY.'),
        f('selected_as_final', 'Session & participant', 'bool', '', 'Operator marked this attempt as the final result.', 'Set by Submit / Use-this-result.'),
        f('unable_to_perform', 'Session & participant', 'bool', '', 'Participant could not do the test (records 0, skips camera).', 'Form checkbox.'),
        f('support_used', 'Session & participant', 'bool', '', 'Participant held a wall/chair (covariate, not penalised).', 'Form checkbox.'),
        f('camera_height_cm', 'Session & participant', 'float', 'cm', 'Operator-entered camera lens height above floor (covariate).', 'Form input (optional).'),

        // Device & pose
        f('pose_model', 'Device & pose', 'enum', '', 'MediaPipe model used (lite/full/heavy).', 'Form input.'),
        f('pose_delegate', 'Device & pose', 'enum', '', 'GPU or CPU delegate actually used.', 'Reported by pose engine.'),
        f('camera_facing', 'Device & pose', 'enum', '', 'Camera facing (environment=rear, user=front).', 'Form input / runtime.'),
        f('camera_view', 'Device & pose', 'enum', '', 'Camera viewpoint (front = participant faces camera).', 'CONFIG.protocol.view.'),
        f('camera_pitch_deg', 'Device & pose', 'float', 'deg', 'Device pitch at calibration (0 = upright).', 'DeviceOrientationEvent beta-90.'),
        f('camera_roll_deg', 'Device & pose', 'float', 'deg', 'Device roll at calibration (0 = level).', 'DeviceOrientationEvent gamma.'),
        f('hip_y_norm_calib', 'Device & pose', 'float', '', 'Median hip-mid y (video-native normalised) at calibration.', 'Camera-height check; 0.5 ideal.'),
        f('video_width_px', 'Device & pose', 'int', 'px', 'Native video width.', 'video.videoWidth.'),
        f('video_height_px', 'Device & pose', 'int', 'px', 'Native video height.', 'video.videoHeight.'),
        f('screen_width_px', 'Device & pose', 'int', 'px', 'Screen width.', 'window.screen.width.'),
        f('screen_height_px', 'Device & pose', 'int', 'px', 'Screen height.', 'window.screen.height.'),
        f('user_agent', 'Device & pose', 'string', '', 'Browser user agent.', 'navigator.userAgent.'),

        // Protocol
        f('planned_duration_s', 'Protocol', 'float', 's', 'Planned test duration.', 'CONFIG.protocol.durationS.'),
        f('test_duration_s', 'Protocol', 'float', 's', 'Actual analysed test duration (<= 120).', 'Last frame t minus 0, capped.'),
        f('manual_stop', 'Protocol', 'bool', '', 'Operator stopped early.', 'STOP button.'),
        f('protocol_briefed', 'Protocol', 'bool', '', 'Operator confirmed the participant was briefed.', 'Form checkbox.'),
        f('count_threshold_preset', 'Protocol', 'enum', '', 'Count threshold preset used.', 'hip_level | official_midpoint.'),
        f('count_threshold_p', 'Protocol', 'float', '', 'Progress threshold to count a lift.', 'CONFIG.events.countP or countPOfficial.'),
        f('release_threshold_p', 'Protocol', 'float', '', 'Progress release threshold (hysteresis).', 'CONFIG.events.releaseP.'),
        f('filter_cutoff_hz', 'Protocol', 'float', 'Hz', 'Effective low-pass cutoff.', 'CONFIG.signal.cutoffHz.'),
        f('resample_hz', 'Protocol', 'float', 'Hz', 'Resample rate for the analysis series.', 'CONFIG.signal.resampleHz.'),

        // Primary outcomes
        f('steps_right', 'Primary outcomes', 'int', '', 'Right-knee lifts reaching threshold (OFFICIAL score).', 'Offline counted peaks, right leg, t_peak<=120.'),
        f('steps_left', 'Primary outcomes', 'int', '', 'Left-knee lifts reaching threshold.', 'Offline counted peaks, left leg.'),
        f('steps_total', 'Primary outcomes', 'int', '', 'Total counted lifts (left + right).', 'steps_right + steps_left.'),
        f('live_count_right', 'Primary outcomes', 'int', '', 'Live on-screen right count.', 'Causal state machine during test.'),
        f('live_count_left', 'Primary outcomes', 'int', '', 'Live on-screen left count.', 'Causal state machine during test.'),
        f('count_difference_right', 'Primary outcomes', 'int', '', 'Offline minus live right count.', 'steps_right - live_count_right.'),
        f('count_difference_left', 'Primary outcomes', 'int', '', 'Offline minus live left count.', 'steps_left - live_count_left.'),
        f('incomplete_attempts_right', 'Primary outcomes', 'int', '', 'Right peaks with lowP<=p<countP (uncounted).', 'Offline.'),
        f('incomplete_attempts_left', 'Primary outcomes', 'int', '', 'Left peaks with lowP<=p<countP (uncounted).', 'Offline.'),
        f('steps_right_q1', 'Primary outcomes', 'int', '', 'Right counted lifts in [0,30) s.', 'Quarter bucket by t_peak.'),
        f('steps_right_q2', 'Primary outcomes', 'int', '', 'Right counted lifts in [30,60) s.', 'Quarter bucket by t_peak.'),
        f('steps_right_q3', 'Primary outcomes', 'int', '', 'Right counted lifts in [60,90) s.', 'Quarter bucket by t_peak.'),
        f('steps_right_q4', 'Primary outcomes', 'int', '', 'Right counted lifts in [90,120] s.', 'Quarter bucket by t_peak.'),
        f('steps_left_q1', 'Primary outcomes', 'int', '', 'Left counted lifts in [0,30) s.', 'Quarter bucket by t_peak.'),
        f('steps_left_q2', 'Primary outcomes', 'int', '', 'Left counted lifts in [30,60) s.', 'Quarter bucket by t_peak.'),
        f('steps_left_q3', 'Primary outcomes', 'int', '', 'Left counted lifts in [60,90) s.', 'Quarter bucket by t_peak.'),
        f('steps_left_q4', 'Primary outcomes', 'int', '', 'Left counted lifts in [90,120] s.', 'Quarter bucket by t_peak.'),
        f('norm_reference', 'Primary outcomes', 'string', '', 'Normative reference used.', 'CONFIG.norms.reference.'),
        f('norm_cutoff_below_average', 'Primary outcomes', 'int', '', 'Below-average cut-point for age/sex.', 'Rikli & Jones table.'),
        f('norm_cutoff_above_average', 'Primary outcomes', 'int', '', 'Above-average cut-point for age/sex.', 'Rikli & Jones table.'),
        f('norm_classification', 'Primary outcomes', 'enum', '', 'Norm class on steps_right.', 'BELOW/AVERAGE/ABOVE/NOT CLASSIFIED.'),

        // Flutter parity
        f('total_repetitions', 'Flutter parity', 'int', '', 'Legacy total; maps to right-knee count (Q1 default).', '= steps_right.'),
        f('avg_transition_time_left', 'Flutter parity', 'float', 's', 'Mean left knee-raise duration (up+down).', 'mean(t_offset-t_onset) left.'),
        f('min_transition_time_left', 'Flutter parity', 'float', 's', 'Min left transition time.', 'min over left steps.'),
        f('max_transition_time_left', 'Flutter parity', 'float', 's', 'Max left transition time.', 'max over left steps.'),
        f('std_transition_time_left', 'Flutter parity', 'float', 's', 'SD left transition time.', 'sample SD (n-1).'),
        f('avg_transition_time_right', 'Flutter parity', 'float', 's', 'Mean right transition time.', 'mean right.'),
        f('min_transition_time_right', 'Flutter parity', 'float', 's', 'Min right transition time.', 'min right.'),
        f('max_transition_time_right', 'Flutter parity', 'float', 's', 'Max right transition time.', 'max right.'),
        f('std_transition_time_right', 'Flutter parity', 'float', 's', 'SD right transition time.', 'sample SD (n-1).'),
        f('avg_lifting_time_left_s', 'Flutter parity', 'float', 's', 'Mean left rise-phase time.', 'mean(t_peak-t_onset) left.'),
        f('std_lifting_time_left_s', 'Flutter parity', 'float', 's', 'SD left lifting time.', 'sample SD (n-1).'),
        f('avg_lifting_time_right_s', 'Flutter parity', 'float', 's', 'Mean right rise-phase time.', 'mean right.'),
        f('std_lifting_time_right_s', 'Flutter parity', 'float', 's', 'SD right lifting time.', 'sample SD (n-1).'),
        f('peak_standing_vertical_velocity_m_s', 'Flutter parity', 'float', 'm/s', 'Max upward knee velocity during the test.', 'max over all lifting knees.'),
        f('total_duration', 'Flutter parity', 'float', 's', 'Test duration (parity alias).', '= test_duration_s.'),
        f('n_steps_left', 'Flutter parity', 'int', '', 'Counted left steps (sample size for left means).', '= steps_left.'),
        f('n_steps_right', 'Flutter parity', 'int', '', 'Counted right steps (sample size for right means).', '= steps_right.'),

        // Pacing
        f('cadence_total_steps_per_min', 'Pacing', 'float', 'steps/min', 'Total cadence.', 'steps_total / (test_duration_s/60).'),
        f('cadence_right_steps_per_min', 'Pacing', 'float', 'steps/min', 'Right cadence.', 'steps_right / (dur/60).'),
        f('cadence_left_steps_per_min', 'Pacing', 'float', 'steps/min', 'Left cadence.', 'steps_left / (dur/60).'),
        f('step_interval_mean_s_left', 'Pacing', 'float', 's', 'Mean left same-leg interval.', 'mean diff of left t_peak.'),
        f('step_interval_mean_s_right', 'Pacing', 'float', 's', 'Mean right same-leg interval.', 'mean diff of right t_peak.'),
        f('step_interval_sd_s_left', 'Pacing', 'float', 's', 'SD left interval.', 'sample SD.'),
        f('step_interval_sd_s_right', 'Pacing', 'float', 's', 'SD right interval.', 'sample SD.'),
        f('step_interval_cv_pct_left', 'Pacing', 'float', '%', 'CV of left interval.', 'SD/mean*100.'),
        f('step_interval_cv_pct_right', 'Pacing', 'float', '%', 'CV of right interval.', 'SD/mean*100.'),
        f('alternation_interval_mean_s', 'Pacing', 'float', 's', 'Mean interval between opposite-leg peaks.', 'mean of alternation intervals.'),
        f('alternation_interval_cv_pct', 'Pacing', 'float', '%', 'CV of alternation interval.', 'SD/mean*100.'),
        f('interval_slope_s_per_step', 'Pacing', 'float', 's/step', 'OLS slope of interval vs step number.', 'needs >=4 steps.'),
        f('rate_change_pct_q1_q4', 'Pacing', 'float', '%', 'Rate change first vs last quarter.', '(q4-q1)/q1*100.'),
        f('time_to_first_step_s', 'Pacing', 'float', 's', 'Time of first counted step.', 'min t_peak.'),

        // Rest
        f('rest_count', 'Rest', 'int', '', 'Number of rest periods.', 'gaps > restGapS with no counted step.'),
        f('rest_total_s', 'Rest', 'float', 's', 'Total resting time.', 'sum of rest gaps beyond restGapS.'),
        f('longest_rest_s', 'Rest', 'float', 's', 'Longest single rest.', 'max rest gap.'),
        f('active_time_pct', 'Rest', 'float', '%', 'Percent of test not resting.', '(dur-rest_total)/dur*100.'),

        // Step height
        f('lift_progress_mean_left', 'Step height', 'float', '', 'Mean peak progress, left.', 'mean peak p left.'),
        f('lift_progress_mean_right', 'Step height', 'float', '', 'Mean peak progress, right.', 'mean peak p right.'),
        f('lift_progress_sd_left', 'Step height', 'float', '', 'SD peak progress, left.', 'sample SD.'),
        f('lift_progress_sd_right', 'Step height', 'float', '', 'SD peak progress, right.', 'sample SD.'),
        f('lift_progress_min_left', 'Step height', 'float', '', 'Min peak progress, left.', 'min counted peak p.'),
        f('lift_progress_min_right', 'Step height', 'float', '', 'Min peak progress, right.', 'min counted peak p.'),
        f('knee_rise_mean_cm_left', 'Step height', 'float', 'cm', 'Mean knee rise, left.', 'mean knee_rise_cm left.'),
        f('knee_rise_mean_cm_right', 'Step height', 'float', 'cm', 'Mean knee rise, right.', 'mean knee_rise_cm right.'),
        f('pct_steps_hip_level_left', 'Step height', 'float', '%', 'Percent of left lifts reaching hip level (p>=1).', 'count/total*100.'),
        f('pct_steps_hip_level_right', 'Step height', 'float', '%', 'Percent of right lifts reaching hip level.', 'count/total*100.'),
        f('lift_height_change_pct_left', 'Step height', 'float', '%', 'Left lift-height change first vs last third.', '(last-first)/first*100.'),
        f('lift_height_change_pct_right', 'Step height', 'float', '%', 'Right lift-height change first vs last third.', '(last-first)/first*100.'),

        // Velocity
        f('peak_up_velocity_mean_m_s_left', 'Velocity', 'float', 'm/s', 'Mean per-step peak up velocity, left.', 'mean.'),
        f('peak_up_velocity_mean_m_s_right', 'Velocity', 'float', 'm/s', 'Mean per-step peak up velocity, right.', 'mean.'),
        f('peak_up_velocity_max_m_s_left', 'Velocity', 'float', 'm/s', 'Max per-step peak up velocity, left.', 'max.'),
        f('peak_up_velocity_max_m_s_right', 'Velocity', 'float', 'm/s', 'Max per-step peak up velocity, right.', 'max.'),
        f('peak_down_velocity_mean_m_s_left', 'Velocity', 'float', 'm/s', 'Mean per-step peak down velocity, left.', 'mean (magnitude).'),
        f('peak_down_velocity_mean_m_s_right', 'Velocity', 'float', 'm/s', 'Mean per-step peak down velocity, right.', 'mean (magnitude).'),

        // Symmetry
        f('symmetry_step_count_pct', 'Symmetry', 'float', '%', 'Symmetry index for step count.', '(R-L)/mean(R,L)*100.'),
        f('symmetry_lift_height_pct', 'Symmetry', 'float', '%', 'Symmetry index for mean lift height.', '(R-L)/mean*100.'),
        f('symmetry_lifting_time_pct', 'Symmetry', 'float', '%', 'Symmetry index for mean lifting time.', '(R-L)/mean*100.'),

        // Balance & posture
        f('sway_ml_rms_cm', 'Balance & posture', 'float', 'cm', 'Medio-lateral hip-mid sway RMS (detrended).', 'RMS of hip-mid x displacement.'),
        f('sway_ml_range_cm', 'Balance & posture', 'float', 'cm', 'ML sway range.', 'max-min hip-mid x.'),
        f('sway_path_length_cm', 'Balance & posture', 'float', 'cm', 'ML sway path length.', 'sum |delta hip-mid x|.'),
        f('hip_vertical_range_cm', 'Balance & posture', 'float', 'cm', 'Hip-mid vertical range.', 'max-min hip-mid y.'),
        f('trunk_lean_mean_abs_deg', 'Balance & posture', 'float', 'deg', 'Mean absolute trunk lateral lean.', 'mean |lean|.'),
        f('trunk_lean_peak_deg', 'Balance & posture', 'float', 'deg', 'Peak trunk lateral lean.', 'max |lean|.'),
        f('pelvis_tilt_mean_abs_deg', 'Balance & posture', 'float', 'deg', 'Mean absolute pelvis (hip-line) tilt.', 'mean |tilt|.'),
        f('pelvis_tilt_peak_deg', 'Balance & posture', 'float', 'deg', 'Peak pelvis tilt.', 'max |tilt|.'),
        f('shoulder_tilt_mean_abs_deg', 'Balance & posture', 'float', 'deg', 'Mean absolute shoulder tilt.', 'mean |tilt|.'),
        f('hip_mid_drift_cm', 'Balance & posture', 'float', 'cm', 'Hip-mid drift from calibration (walking-off check).', 'net displacement.'),

        // Calibration
        f('scale_m_per_px', 'Calibration', 'float', 'm/px', 'Pixel-to-metre scale.', '0.779*height_m / chainpx.'),
        f('calib_chain_px', 'Calibration', 'float', 'px', 'Mean shoulder->hip->knee->ankle chain length.', 'calibration.'),
        f('calib_thigh_px_left', 'Calibration', 'float', 'px', 'Standing vertical thigh length, left (S0_L).', 'median knee_y-hip_y.'),
        f('calib_thigh_px_right', 'Calibration', 'float', 'px', 'Standing vertical thigh length, right (S0_R).', 'median knee_y-hip_y.'),
        f('calib_shoulder_width_px', 'Calibration', 'float', 'px', 'Standing shoulder width.', 'median |l_sh.x-r_sh.x|.'),
        f('frontalness_calib', 'Calibration', 'float', '', 'Shoulder width / trunk length at calibration.', 'facing check.'),
        f('calib_hold_s', 'Calibration', 'float', 's', 'Calibration hold duration.', 'CONFIG.calibration.holdS.'),
        f('calib_jitter', 'Calibration', 'float', '', 'Max jitter during hold (trunk fraction).', 'SD of hip-mid/ankle.'),
        f('calib_mode', 'Calibration', 'enum', '', 'Calibration mode used.', 'standstill | fallback.'),

        // Quality control
        f('effective_fs_hz', 'Quality control', 'float', 'Hz', 'Effective frames/s processed.', 'frames / window.'),
        f('valid_frame_pct', 'Quality control', 'float', '%', 'Percent frames with valid shoulders/hips/knees/ankles.', 'count/total*100.'),
        f('imputed_sample_pct', 'Quality control', 'float', '%', 'Percent resampled points bridged across gaps.', 'imputed/total*100.'),
        f('longest_gap_s', 'Quality control', 'float', 's', 'Longest tracking gap.', 'max gap.'),
        f('median_chain_visibility', 'Quality control', 'float', '', 'Median visibility of the scale chain.', 'median.'),
        f('feet_out_of_frame_pct', 'Quality control', 'float', '%', 'Percent frames with ankles/toes out of frame.', 'count/total*100.'),
        f('shoulder_width_change_pct', 'Quality control', 'float', '%', 'Max shoulder-width change from calibration.', 'max |delta|/calib*100.'),
        f('lift_2d_3d_diff', 'Quality control', 'float', '', 'Mean |p - p3d| at counted peaks.', '2D vs world-landmark cross-check.'),
        f('both_knees_up_pct', 'Quality control', 'float', '%', 'Percent of window with both knees >= countP.', 'count/total*100.'),
        f('qc_flags', 'Quality control', 'string', '', 'Semicolon-separated QC flags.', 'see DATA_DICTIONARY §8.'),
        f('qc_pass', 'Quality control', 'bool', '', 'True if no blocking flag.', 'no blocking flag present.'),
        f('valid_for_norm', 'Quality control', 'bool', '', 'Eligible for norm classification.', 'qc_pass & full 120s & age 60-94 & sex male/female.')
    ];

    // ---- STEPS (one row per detected lift) -----------------------------------
    const steps = [
        f('session_id', 'Step', 'string', '', 'Owning session id.', 'FK.'),
        f('step_index', 'Step', 'int', '', 'Global step index (time-ordered across legs).', 'Offline.'),
        f('leg', 'Step', 'enum', '', 'Leg (left/right, anatomical).', 'Offline.'),
        f('leg_step_number', 'Step', 'int', '', 'Step number within this leg.', 'Offline.'),
        f('counted', 'Step', 'bool', '', 'Step counted toward score.', 'peak>=countP, hysteresis satisfied.'),
        f('counted_in_window', 'Step', 'bool', '', 'Peak time within [0,120] s.', 't_peak<=120.'),
        f('peak_progress', 'Step', 'float', '', 'Peak lift progress p.', 'local max of filtered p.'),
        f('reached_hip_level', 'Step', 'bool', '', 'Peak p >= 1.0 (knee at/above hip).', 'peak_progress>=1.'),
        f('t_onset_s', 'Step', 'float', 's', 'Onset time (p crosses lowP upward).', 'before peak.'),
        f('t_peak_s', 'Step', 'float', 's', 'Peak time.', 'local max.'),
        f('t_offset_s', 'Step', 'float', 's', 'Offset time (p crosses lowP downward).', 'after peak.'),
        f('lifting_time_s', 'Step', 'float', 's', 'Rise phase duration.', 't_peak-t_onset.'),
        f('lowering_time_s', 'Step', 'float', 's', 'Lowering phase duration.', 't_offset-t_peak.'),
        f('transition_time_s', 'Step', 'float', 's', 'Full movement duration.', 't_offset-t_onset.'),
        f('interval_prev_same_leg_s', 'Step', 'float', 's', 'Interval from previous same-leg peak.', 'diff t_peak.'),
        f('alternation_prev_s', 'Step', 'float', 's', 'Interval from previous opposite-leg peak.', 'diff t_peak.'),
        f('knee_rise_cm', 'Step', 'float', 'cm', 'Knee rise above standing.', '(S0-d_peak)*scale*100.'),
        f('peak_up_velocity_m_s', 'Step', 'float', 'm/s', 'Peak upward knee velocity.', 'max positive vel in rise.'),
        f('peak_down_velocity_m_s', 'Step', 'float', 'm/s', 'Peak downward knee velocity (magnitude).', 'max negative vel in fall.'),
        f('sway_at_peak_cm', 'Step', 'float', 'cm', 'Hip-mid ML sway at peak.', 'hip-mid x displacement.'),
        f('trunk_lean_at_peak_deg', 'Step', 'float', 'deg', 'Trunk lean at peak.', 'lean at t_peak.'),
        f('pelvis_tilt_at_peak_deg', 'Step', 'float', 'deg', 'Pelvis tilt at peak.', 'tilt at t_peak.'),
        f('tracking_gap_flag', 'Step', 'bool', '', 'Low-visibility apex bridged.', 'gapPeakPolicy.'),
        f('both_knees_up_flag', 'Step', 'bool', '', 'Both knees up around this peak.', 'BOTH_KNEES_UP window.')
    ];

    // ---- FRAMES ANALYSIS (30 Hz) ---------------------------------------------
    const framesAnalysis = [
        f('session_id', 'Frame', 'string', '', 'Owning session id.', 'FK.'),
        f('t_s', 'Frame', 'float', 's', 'Time from GO.', 'resampled grid.'),
        f('phase_left', 'Frame', 'enum', '', 'Left leg phase (DOWN|RISING|UP|LOWERING).', 'offline state.'),
        f('phase_right', 'Frame', 'enum', '', 'Right leg phase.', 'offline state.'),
        f('tracking_gap', 'Frame', 'bool', '', 'Sample bridged across a gap.', 'resample.'),
        f('progress_left', 'Frame', 'float', '', 'Left lift progress p.', '1-(knee_y-hip_y)/S0.'),
        f('progress_right', 'Frame', 'float', '', 'Right lift progress p.', '1-(knee_y-hip_y)/S0.'),
        f('knee_rise_left_m', 'Frame', 'float', 'm', 'Left knee rise above standing.', '(S0-d)*scale.'),
        f('knee_rise_right_m', 'Frame', 'float', 'm', 'Right knee rise above standing.', '(S0-d)*scale.'),
        f('knee_vel_left_m_s', 'Frame', 'float', 'm/s', 'Left knee vertical velocity (positive up).', 'central diff.'),
        f('knee_vel_right_m_s', 'Frame', 'float', 'm/s', 'Right knee vertical velocity.', 'central diff.'),
        f('hip_mid_x_cm', 'Frame', 'float', 'cm', 'Hip-mid x displacement from calibration.', 'detrended ML sway.'),
        f('hip_mid_y_cm', 'Frame', 'float', 'cm', 'Hip-mid y displacement from calibration.', 'vertical.'),
        f('trunk_lean_deg', 'Frame', 'float', 'deg', 'Trunk lateral lean.', 'atan2.'),
        f('pelvis_tilt_deg', 'Frame', 'float', 'deg', 'Pelvis (hip-line) tilt.', 'atan2.'),
        f('shoulder_tilt_deg', 'Frame', 'float', 'deg', 'Shoulder tilt.', 'atan2.'),
        f('shoulder_width_px', 'Frame', 'float', 'px', 'Shoulder width.', '|l_sh.x-r_sh.x|.'),
        f('progress_left_3d', 'Frame', 'float', '', 'Left progress from world landmarks (cross-check).', '1-(kneeW_y-hipW_y)/S0w.'),
        f('progress_right_3d', 'Frame', 'float', '', 'Right progress from world landmarks.', 'cross-check.')
    ];
    // filtered pixel coordinates appended programmatically
    ['l', 'r'].forEach(side => ['sh', 'hip', 'kn', 'an'].forEach(j => ['x', 'y'].forEach(ax => {
        framesAnalysis.push(f(`${side}_${j}_${ax}_px`, 'Frame', 'float', 'px', `Filtered ${side === 'l' ? 'left' : 'right'} ${j} ${ax} (pixels).`, 'resampled + filtered.'));
    })));

    // ---- RAW FRAMES (device rate): t_ms + 17 markers x 7 values ----------------
    const framesRaw = [f('t_ms', 'Raw', 'float', 'ms', 'Time from GO in ms.', 'media/performance time.')];
    CONFIG.tracked.forEach(m => {
        ['x', 'y', 'z', 'v', 'wx', 'wy', 'wz'].forEach(suf => {
            const units = { x: '', y: '', z: '', v: '', wx: 'm', wy: 'm', wz: 'm' };
            framesRaw.push(f(`${m.key}_${suf}`, 'Raw', 'float', units[suf], `${m.name} ${suf}.`, 'MediaPipe landmark (normalised x/y/z, visibility v, world w*).'));
        });
    });

    // ---- Markers table (for dictionary §6) ------------------------------------
    const markers = CONFIG.tracked.map(m => ({ key: m.key, idx: m.idx, name: m.name, role: m.role }));

    global.SCHEMA = {
        version: CONFIG.app.schemaVersion,
        sessions, steps, framesAnalysis, framesRaw, markers,
        keys: {
            sessions: sessions.map(x => x.key),
            steps: steps.map(x => x.key),
            framesAnalysis: framesAnalysis.map(x => x.key),
            framesRaw: framesRaw.map(x => x.key)
        }
    };

    if (typeof module !== 'undefined') module.exports = global.SCHEMA;
})(typeof window !== 'undefined' ? window : globalThis);
