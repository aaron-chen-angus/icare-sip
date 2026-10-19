/**
 * SIP//LAB — Offline analysis engine (SIPAnalysis)  [authoritative]
 *
 * Implements C1–C7 and F3–F4 of the brief. Pure, deterministic, dependency-free
 * so it runs identically in the app, in tests/index.html and in tools/replay.html.
 *
 *   SIPAnalysis.run(raw, calibration, participant, cfg) -> { summary, steps, frames }
 *
 *   raw         : { data: Float32Array, n, cols, tracked:[keys] }  (t_ms rebased to GO)
 *   calibration : { S0:{l,r}, S0w, scale_m_per_px, chain_px, ... , threshold_p, ... }
 *   participant : validated S1 form payload
 *   cfg         : CONFIG (so replay.html can pass a tweaked copy)
 *
 * Conventions: image y is down; vertical outputs reported positive-up; all
 * distances/angles computed in PIXELS; only the VERTICAL knee_y-hip_y is used
 * for lift progress (never Euclidean thigh length).
 *
 * Exposes global `SIPAnalysis`.
 */
(function (global) {
    'use strict';

    const SIDES = ['l', 'r'];

    // ---------- small stats ----------
    function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }
    function sd(a) {
        if (a.length < 2) return 0;
        const m = a.reduce((s, x) => s + x, 0) / a.length;
        return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
    }
    function median(a) {
        const b = a.filter(x => isFinite(x)).slice().sort((x, y) => x - y);
        if (!b.length) return null;
        const m = Math.floor(b.length / 2);
        return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
    }
    function cv(arr) { const m = mean(arr); return (m && arr.length > 1) ? sd(arr) / m * 100 : null; }
    function olsSlope(y) {
        const n = y.length; if (n < 4) return null;
        let sx = 0, sy = 0, sxx = 0, sxy = 0;
        for (let i = 0; i < n; i++) { sx += i; sy += y[i]; sxx += i * i; sxy += i * y[i]; }
        const d = n * sxx - sx * sx;
        return d === 0 ? null : (n * sxy - sx * sy) / d;
    }

    // ---------- F4: zero-lag 2nd-order Butterworth (filtfilt) ----------
    // Design cutoff fc chosen so the effective -3 dB point after two passes is
    // the requested cutoff: fcDesign = cutoff / 0.802.
    function butterCoeffs(cutoffHz, fs) {
        const fc = cutoffHz / 0.802;
        const safeFc = Math.min(fc, fs / 2 - 1e-6);
        const K = Math.tan(Math.PI * safeFc / fs);
        const n = 1 / (1 + Math.SQRT2 * K + K * K);
        const b0 = K * K * n, b1 = 2 * b0, b2 = b0;
        const a1 = 2 * (K * K - 1) * n, a2 = (1 - Math.SQRT2 * K + K * K) * n;
        return { b0, b1, b2, a1, a2 };
    }
    function filterOnce(x, c) {
        const y = new Float64Array(x.length);
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        for (let i = 0; i < x.length; i++) {
            const xi = x[i];
            const yi = c.b0 * xi + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
            y[i] = yi; x2 = x1; x1 = xi; y2 = y1; y1 = yi;
        }
        return y;
    }
    function filtfilt(x, cutoffHz, fs, pad) {
        if (x.length < 3) return x.slice();
        const c = butterCoeffs(cutoffHz, fs);
        const p = Math.min(pad, x.length - 1);
        // odd reflection padding: 2*x[0]-x[i], 2*x[last]-x[i]
        const n = x.length;
        const ext = new Float64Array(n + 2 * p);
        for (let i = 0; i < p; i++) ext[i] = 2 * x[0] - x[p - i];
        for (let i = 0; i < n; i++) ext[p + i] = x[i];
        for (let i = 0; i < p; i++) ext[p + n + i] = 2 * x[n - 1] - x[n - 2 - i];
        const f = filterOnce(ext, c);
        f.reverse();
        const b = filterOnce(f, c);
        b.reverse();
        return b.slice(p, p + n);
    }

    // ---------- raw unpack ----------
    function unpackRaw(raw) {
        const { data, n, cols } = raw;
        const idx = {}; CONFIG.tracked.forEach((m, i) => { idx[m.key] = i; });
        const t = new Float64Array(n);
        for (let k = 0; k < n; k++) t[k] = data[k * cols]; // ms
        const get = (k, key, comp) => {
            const o = k * cols + 1 + idx[key] * 7;
            // comp: 0..6 => x,y,z,v,wx,wy,wz
            return data[o + comp];
        };
        return { t, n, get, idx };
    }

    // ---------- resample to 30 Hz with gap bridging + flags ----------
    // Builds, for each tracked key, resampled x,y,z,v (+world) on a uniform grid
    // from t=firstTestRelevant..last. Marks tracking_gap when a sample sits inside
    // a gap longer than maxGapS (still linearly bridged for the filter).
    function resample(raw, cfg) {
        const { t, n, get } = unpackRaw(raw);
        const hz = cfg.signal.resampleHz;
        const minVis = cfg.signal.minVisibility;
        // window: from max(preRoll start, first frame) to last frame, but at least [0, lastT]
        const t0ms = t[0], t1ms = t[n - 1];
        const startS = Math.min(0, t0ms / 1000);       // include pre-roll (negative) for warm-up
        const endS = t1ms / 1000;
        const N = Math.max(2, Math.floor((endS - startS) * hz) + 1);
        const grid = new Float64Array(N);
        for (let i = 0; i < N; i++) grid[i] = startS + i / hz;

        const keys = CONFIG.tracked.map(m => m.key);
        const series = {}; // key -> { x:[],y:[],z:[],v:[], wx,wy,wz }
        const gap = new Uint8Array(N);
        let imputed = 0, totalValidFrames = 0;

        // Precompute per-frame validity of the scale chain for QC
        const chainKeys = ['l_sh', 'r_sh', 'l_hip', 'r_hip', 'l_kn', 'r_kn', 'l_an', 'r_an'];

        // For interpolation we need, per key, arrays of (t, value, valid)
        const perKey = {};
        keys.forEach(key => {
            const xs = new Float64Array(n), ys = new Float64Array(n), zs = new Float64Array(n), vs = new Float64Array(n);
            const wx = new Float64Array(n), wy = new Float64Array(n), wz = new Float64Array(n);
            for (let k = 0; k < n; k++) {
                xs[k] = get(k, key, 0); ys[k] = get(k, key, 1); zs[k] = get(k, key, 2); vs[k] = get(k, key, 3);
                wx[k] = get(k, key, 4); wy[k] = get(k, key, 5); wz[k] = get(k, key, 6);
            }
            perKey[key] = { xs, ys, zs, vs, wx, wy, wz };
        });

        // validity per frame (chain)
        for (let k = 0; k < n; k++) {
            let ok = true;
            for (const ck of chainKeys) if (perKey[ck].vs[k] < minVis) { ok = false; break; }
            if (ok) totalValidFrames++;
        }

        // helper: linear interp of a key component at grid time ts (seconds)
        // uses only samples with visibility >= minVis; tracks gap length
        function interpKey(key) {
            const pk = perKey[key];
            const out = { x: new Float64Array(N), y: new Float64Array(N), z: new Float64Array(N), v: new Float64Array(N), wx: new Float64Array(N), wy: new Float64Array(N), wz: new Float64Array(N) };
            // collect valid sample times
            const vt = [], vi = [];
            for (let k = 0; k < n; k++) { if (pk.vs[k] >= minVis) { vt.push(t[k] / 1000); vi.push(k); } }
            if (!vt.length) { return out; } // all missing -> zeros
            let j = 0;
            for (let i = 0; i < N; i++) {
                const ts = grid[i];
                while (j < vt.length - 1 && vt[j + 1] < ts) j++;
                let a = j, b = Math.min(j + 1, vt.length - 1);
                if (ts <= vt[0]) { a = b = 0; }
                else if (ts >= vt[vt.length - 1]) { a = b = vt.length - 1; }
                const ta = vt[a], tb = vt[b];
                const f = (tb > ta) ? (ts - ta) / (tb - ta) : 0;
                const ia = vi[a], ib = vi[b];
                out.x[i] = pk.xs[ia] + f * (pk.xs[ib] - pk.xs[ia]);
                out.y[i] = pk.ys[ia] + f * (pk.ys[ib] - pk.ys[ia]);
                out.z[i] = pk.zs[ia] + f * (pk.zs[ib] - pk.zs[ia]);
                out.v[i] = Math.min(pk.vs[ia], pk.vs[ib]);
                out.wx[i] = pk.wx[ia] + f * (pk.wx[ib] - pk.wx[ia]);
                out.wy[i] = pk.wy[ia] + f * (pk.wy[ib] - pk.wy[ia]);
                out.wz[i] = pk.wz[ia] + f * (pk.wz[ib] - pk.wz[ia]);
                // gap flag if the surrounding valid samples straddle a long gap
                if (tb - ta > cfg.signal.maxGapS && ts > ta && ts < tb) { gap[i] = 1; }
            }
            return out;
        }

        keys.forEach(key => { series[key] = interpKey(key); });

        // longest gap + imputed % computed from the gap array
        let longestGap = 0, run = 0;
        for (let i = 0; i < N; i++) {
            if (gap[i]) { imputed++; run++; longestGap = Math.max(longestGap, run); }
            else run = 0;
        }
        const longestGapS = longestGap / hz;
        const imputedPct = N ? imputed / N * 100 : 0;
        const validFramePct = n ? totalValidFrames / n * 100 : 0;

        return { grid, N, hz, series, gap, longestGapS, imputedPct, validFramePct, startS, endS };
    }

    // ---------- pixel helpers on resampled series ----------
    function makePx(series, key, i, vw, vh) {
        return { x: series[key].x[i] * vw, y: series[key].y[i] * vh, v: series[key].v[i] };
    }

    // ---------- main run ----------
    function run(raw, calibration, participant, cfg) {
        cfg = cfg || CONFIG;
        const vw = calibration.vw, vh = calibration.vh;
        const hipRef = cfg.events.hipRef;
        const countP = calibration.threshold_p != null ? calibration.threshold_p : cfg.events.countP;
        const releaseP = cfg.events.releaseP, lowP = cfg.events.lowP;
        const scale = calibration.scale_m_per_px;

        const rs = resample(raw, cfg);
        const { grid, N, hz, series } = rs;

        // --- build filtered pixel series we need ---
        // per side: knee_y, hip_y (ref), and progress p
        const filt = {};
        ['l_sh', 'r_sh', 'l_hip', 'r_hip', 'l_kn', 'r_kn', 'l_an', 'r_an'].forEach(key => {
            filt[key + '_x'] = filtfilt(series[key].x, cfg.signal.cutoffHz, hz, cfg.signal.padSamples);
            filt[key + '_y'] = filtfilt(series[key].y, cfg.signal.cutoffHz, hz, cfg.signal.padSamples);
        });

        // hip reference y (px) per side
        function hipRefYpx(i, side) {
            if (hipRef === 'mid') return (filt.l_hip_y[i] + filt.r_hip_y[i]) / 2 * vh;
            return filt[(side === 'r' ? 'r_hip' : 'l_hip') + '_y'][i] * vh;
        }
        function kneeYpx(i, side) { return filt[(side === 'r' ? 'r_kn' : 'l_kn') + '_y'][i] * vh; }

        // progress p(t) per side (filtered)
        const p = { l: new Float64Array(N), r: new Float64Array(N) };
        const kneeRiseM = { l: new Float64Array(N), r: new Float64Array(N) };
        const kneeVel = { l: new Float64Array(N), r: new Float64Array(N) };
        SIDES.forEach(side => {
            const S0 = calibration.S0[side] || 1;
            for (let i = 0; i < N; i++) {
                const d = kneeYpx(i, side) - hipRefYpx(i, side);
                let pi = 1 - d / S0;
                if (pi > cfg.events.maxP) pi = cfg.events.maxP; // artefact cap
                p[side][i] = pi;
                kneeRiseM[side][i] = (S0 - d) * scale; // metres, positive up
            }
            // velocity: central difference of knee height in metres (positive up)
            for (let i = 0; i < N; i++) {
                const im = Math.max(0, i - 1), ip = Math.min(N - 1, i + 1);
                const dt = (grid[ip] - grid[im]) || (1 / hz);
                // knee height up = -(knee_y_px)*scale ; use kneeRiseM which is positive-up
                kneeVel[side][i] = (kneeRiseM[side][ip] - kneeRiseM[side][im]) / dt;
            }
        });

        // 3-D cross-check progress (world landmarks), reported as mean |p - p3d| at peaks
        const p3d = { l: new Float64Array(N), r: new Float64Array(N) };
        SIDES.forEach(side => {
            const S0w = calibration.S0w && calibration.S0w[side];
            if (!S0w) { p3d[side] = null; return; }
            const knKey = side === 'r' ? 'r_kn' : 'l_kn', hipKey = side === 'r' ? 'r_hip' : 'l_hip';
            for (let i = 0; i < N; i++) {
                const d = series[knKey].wy[i] - series[hipKey].wy[i];
                p3d[side][i] = 1 - d / S0w;
            }
        });

        // --- detect peaks per side ---
        const durationS = cfg.protocol.durationS;
        const stepsBySide = { l: [], r: [] };
        SIDES.forEach(side => {
            const peaks = localMaxima(p[side], cfg.events.minProminence);
            let prevCountedPeakIdx = -1;
            let legNo = 0;
            peaks.forEach(pk => {
                const tPeak = grid[pk.i];
                // onset: last upward lowP crossing before the peak
                const tOnset = crossUpBefore(p[side], grid, pk.i, lowP);
                const tOffset = crossDownAfter(p[side], grid, pk.i, lowP);
                // counted rule
                const droppedBelowRelease = prevCountedPeakIdx < 0 ||
                    minBetween(p[side], prevCountedPeakIdx, pk.i) <= releaseP;
                const inWindow = tPeak >= 0 && tPeak <= durationS;
                const counted = pk.val >= countP && droppedBelowRelease && inWindow;
                const uncounted = !counted && pk.val >= lowP && pk.val < countP;
                if (!counted && !uncounted) return; // ignore tiny bumps

                // per-step velocities within [onset, offset]
                const i0 = tOnset != null ? nearestIdx(grid, tOnset) : pk.i;
                const i1 = tOffset != null ? nearestIdx(grid, tOffset) : pk.i;
                let peakUp = 0, peakDown = 0;
                for (let i = i0; i <= i1 && i < N; i++) {
                    if (kneeVel[side][i] > peakUp) peakUp = kneeVel[side][i];
                    if (kneeVel[side][i] < peakDown) peakDown = kneeVel[side][i];
                }
                const S0 = calibration.S0[side] || 1;
                const dPeak = kneeYpx(pk.i, side) - hipRefYpx(pk.i, side);
                const kneeRiseCm = (S0 - dPeak) * scale * 100;

                // posture at peak
                const sway = swayAtPx(filt, pk.i, calibration, scale, vw, vh);
                const trunkLean = trunkLeanAt(filt, pk.i, vw, vh);
                const pelvisTilt = pelvisTiltAt(filt, pk.i, vw, vh);

                // gap flag: knee visibility low near the apex
                const visNear = series[(side === 'r' ? 'r_kn' : 'l_kn')].v[pk.i] < cfg.signal.minVisibility;

                const step = {
                    leg: side === 'r' ? 'right' : 'left',
                    leg_step_number: ++legNo,
                    counted, counted_in_window: inWindow,
                    peak_progress: pk.val,
                    reached_hip_level: pk.val >= 1.0,
                    t_onset_s: tOnset, t_peak_s: tPeak, t_offset_s: tOffset,
                    lifting_time_s: (tOnset != null) ? (tPeak - tOnset) : null,
                    lowering_time_s: (tOffset != null) ? (tOffset - tPeak) : null,
                    transition_time_s: (tOnset != null && tOffset != null) ? (tOffset - tOnset) : null,
                    knee_rise_cm: kneeRiseCm,
                    peak_up_velocity_m_s: peakUp,
                    peak_down_velocity_m_s: Math.abs(peakDown),
                    sway_at_peak_cm: sway,
                    trunk_lean_at_peak_deg: trunkLean,
                    pelvis_tilt_at_peak_deg: pelvisTilt,
                    tracking_gap_flag: visNear,
                    both_knees_up_flag: false,
                    _i: pk.i, _p3dAtPeak: p3d[side] ? p3d[side][pk.i] : null
                };
                stepsBySide[side].push(step);
                if (counted) prevCountedPeakIdx = pk.i;
            });
        });

        // intervals (same leg + alternation) on counted steps
        SIDES.forEach(side => {
            const counted = stepsBySide[side].filter(s => s.counted);
            counted.forEach((s, k) => {
                s.interval_prev_same_leg_s = k > 0 ? s.t_peak_s - counted[k - 1].t_peak_s : null;
            });
        });
        // alternation: across both legs, counted, ordered by t_peak
        const allCounted = [...stepsBySide.l, ...stepsBySide.r].filter(s => s.counted)
            .sort((a, b) => a.t_peak_s - b.t_peak_s);
        let prevOpp = { left: null, right: null };
        allCounted.forEach(s => {
            const opp = s.leg === 'left' ? 'right' : 'left';
            s.alternation_prev_s = prevOpp[opp] != null ? s.t_peak_s - prevOpp[opp] : null;
            prevOpp[s.leg] = s.t_peak_s;
        });

        // both-knees-up detection
        let bothUp = 0; const bothKneesWindow = cfg.events.bothKneesMaxS;
        for (let i = 0; i < N; i++) if (p.l[i] >= countP && p.r[i] >= countP) bothUp++;
        const bothKneesUpPct = N ? bothUp / N * 100 : 0;
        // mark steps whose peak sits in a both-up run
        if (bothKneesUpPct > 0) {
            allCounted.forEach(s => { if (p.l[s._i] >= countP && p.r[s._i] >= countP) s.both_knees_up_flag = true; });
        }

        // assemble final step rows (time-ordered global index)
        const stepsAll = [...stepsBySide.l, ...stepsBySide.r].sort((a, b) => a.t_peak_s - b.t_peak_s);
        stepsAll.forEach((s, i) => { s.step_index = i; });

        // ---------- session metrics ----------
        const countedL = stepsBySide.l.filter(s => s.counted);
        const countedR = stepsBySide.r.filter(s => s.counted);
        const steps_left = countedL.length, steps_right = countedR.length;
        const steps_total = steps_left + steps_right;

        const testDuration = Math.min(durationS, Math.max(0, rs.endS));
        const live = (global.App && App.state && App.state.liveCounts) || { left: null, right: null };

        // quarters
        const quarter = t => t < 30 ? 1 : t < 60 ? 2 : t < 90 ? 3 : 4;
        const qCount = (arr, q) => arr.filter(s => quarter(s.t_peak_s) === q).length;

        // pacing
        const intervalsL = countedL.map(s => s.interval_prev_same_leg_s).filter(x => x != null);
        const intervalsR = countedR.map(s => s.interval_prev_same_leg_s).filter(x => x != null);
        const alternations = allCounted.map(s => s.alternation_prev_s).filter(x => x != null);
        const allPeakT = allCounted.map(s => s.t_peak_s).sort((a, b) => a - b);
        const intervalSeq = []; for (let i = 1; i < allPeakT.length; i++) intervalSeq.push(allPeakT[i] - allPeakT[i - 1]);

        // rest detection
        const rest = detectRests(allPeakT, cfg.rest.restGapS, testDuration);

        // height
        const peakPL = countedL.map(s => s.peak_progress), peakPR = countedR.map(s => s.peak_progress);
        const riseL = countedL.map(s => s.knee_rise_cm), riseR = countedR.map(s => s.knee_rise_cm);

        // velocity
        const upL = countedL.map(s => s.peak_up_velocity_m_s), upR = countedR.map(s => s.peak_up_velocity_m_s);
        const dnL = countedL.map(s => s.peak_down_velocity_m_s), dnR = countedR.map(s => s.peak_down_velocity_m_s);
        const peakStandingVel = Math.max(0, ...upL, ...upR) || 0;

        // balance & posture over the full window series
        const posture = computePosture(filt, calibration, scale, vw, vh, N, grid, durationS);

        // transition / lifting parity values
        const transL = countedL.map(s => s.transition_time_s).filter(x => x != null);
        const transR = countedR.map(s => s.transition_time_s).filter(x => x != null);
        const liftL = countedL.map(s => s.lifting_time_s).filter(x => x != null);
        const liftR = countedR.map(s => s.lifting_time_s).filter(x => x != null);

        // symmetry
        const symmetry = (R, L) => (R != null && L != null && (R + L) !== 0) ? (R - L) / ((R + L) / 2) * 100 : null;

        // lift height change first vs last third
        const firstLastThird = arr => {
            if (arr.length < 2) return null;
            const third = Math.max(1, Math.floor(arr.length / 3));
            const first = mean(arr.slice(0, third)), last = mean(arr.slice(-third));
            return (first && first !== 0) ? (last - first) / first * 100 : null;
        };

        // 3-D cross-check diff at counted peaks
        const diffs = allCounted.map(s => s._p3dAtPeak != null ? Math.abs(s.peak_progress - s._p3dAtPeak) : null).filter(x => x != null);
        const lift2d3d = diffs.length ? mean(diffs) : null;

        // ---------- QC ----------
        const fps = (global.App && App.state && App.state.testMeta && App.state.testMeta.fps_ema) || (raw.n / Math.max(0.001, (rs.endS - rs.startS)));
        const qc = runQC({
            cfg, rs, fps, testDuration, durationS,
            steps_total, bothKneesUpPct,
            calibration, participant,
            meta: (global.App && App.state && App.state.testMeta) || {},
            scale, posture, lift2d3d
        });

        // ---------- norms ----------
        const normInfo = classifyNorm(steps_right, participant, cfg, qc.valid_for_norm);

        // ---------- build frames (30 Hz) ----------
        const frames = buildFrames(rs, filt, p, p3d, kneeRiseM, kneeVel, calibration, scale, vw, vh, countP, releaseP, durationS);

        // ---------- summary ----------
        const summary = {
            // primary
            steps_right, steps_left, steps_total,
            live_count_right: live.right, live_count_left: live.left,
            count_difference_right: live.right != null ? steps_right - live.right : null,
            count_difference_left: live.left != null ? steps_left - live.left : null,
            incomplete_attempts_right: stepsBySide.r.filter(s => !s.counted).length,
            incomplete_attempts_left: stepsBySide.l.filter(s => !s.counted).length,
            steps_right_q1: qCount(countedR, 1), steps_right_q2: qCount(countedR, 2), steps_right_q3: qCount(countedR, 3), steps_right_q4: qCount(countedR, 4),
            steps_left_q1: qCount(countedL, 1), steps_left_q2: qCount(countedL, 2), steps_left_q3: qCount(countedL, 3), steps_left_q4: qCount(countedL, 4),
            norm_reference: cfg.norms.reference,
            norm_cutoff_below_average: normInfo.below, norm_cutoff_above_average: normInfo.above,
            norm_classification: normInfo.classification,

            // flutter parity
            total_repetitions: steps_right,
            avg_transition_time_left: mean(transL), min_transition_time_left: transL.length ? Math.min(...transL) : null,
            max_transition_time_left: transL.length ? Math.max(...transL) : null, std_transition_time_left: transL.length ? sd(transL) : null,
            avg_transition_time_right: mean(transR), min_transition_time_right: transR.length ? Math.min(...transR) : null,
            max_transition_time_right: transR.length ? Math.max(...transR) : null, std_transition_time_right: transR.length ? sd(transR) : null,
            avg_lifting_time_left_s: mean(liftL), std_lifting_time_left_s: liftL.length ? sd(liftL) : null,
            avg_lifting_time_right_s: mean(liftR), std_lifting_time_right_s: liftR.length ? sd(liftR) : null,
            peak_standing_vertical_velocity_m_s: peakStandingVel,
            total_duration: testDuration, n_steps_left: steps_left, n_steps_right: steps_right,

            // pacing
            cadence_total_steps_per_min: testDuration > 0 ? steps_total / (testDuration / 60) : null,
            cadence_right_steps_per_min: testDuration > 0 ? steps_right / (testDuration / 60) : null,
            cadence_left_steps_per_min: testDuration > 0 ? steps_left / (testDuration / 60) : null,
            step_interval_mean_s_left: mean(intervalsL), step_interval_mean_s_right: mean(intervalsR),
            step_interval_sd_s_left: intervalsL.length ? sd(intervalsL) : null, step_interval_sd_s_right: intervalsR.length ? sd(intervalsR) : null,
            step_interval_cv_pct_left: cv(intervalsL), step_interval_cv_pct_right: cv(intervalsR),
            alternation_interval_mean_s: mean(alternations), alternation_interval_cv_pct: cv(alternations),
            interval_slope_s_per_step: olsSlope(intervalSeq),
            rate_change_pct_q1_q4: ratePct(qCount(countedR, 1), qCount(countedR, 4)),
            time_to_first_step_s: allPeakT.length ? allPeakT[0] : null,

            // rest
            rest_count: rest.count, rest_total_s: rest.total, longest_rest_s: rest.longest,
            active_time_pct: testDuration > 0 ? (testDuration - rest.total) / testDuration * 100 : null,

            // step height
            lift_progress_mean_left: mean(peakPL), lift_progress_mean_right: mean(peakPR),
            lift_progress_sd_left: peakPL.length ? sd(peakPL) : null, lift_progress_sd_right: peakPR.length ? sd(peakPR) : null,
            lift_progress_min_left: peakPL.length ? Math.min(...peakPL) : null, lift_progress_min_right: peakPR.length ? Math.min(...peakPR) : null,
            knee_rise_mean_cm_left: mean(riseL), knee_rise_mean_cm_right: mean(riseR),
            pct_steps_hip_level_left: peakPL.length ? peakPL.filter(x => x >= 1).length / peakPL.length * 100 : null,
            pct_steps_hip_level_right: peakPR.length ? peakPR.filter(x => x >= 1).length / peakPR.length * 100 : null,
            lift_height_change_pct_left: firstLastThird(riseL), lift_height_change_pct_right: firstLastThird(riseR),

            // velocity
            peak_up_velocity_mean_m_s_left: mean(upL), peak_up_velocity_mean_m_s_right: mean(upR),
            peak_up_velocity_max_m_s_left: upL.length ? Math.max(...upL) : null, peak_up_velocity_max_m_s_right: upR.length ? Math.max(...upR) : null,
            peak_down_velocity_mean_m_s_left: mean(dnL), peak_down_velocity_mean_m_s_right: mean(dnR),

            // symmetry
            symmetry_step_count_pct: symmetry(steps_right, steps_left),
            symmetry_lift_height_pct: symmetry(mean(riseR), mean(riseL)),
            symmetry_lifting_time_pct: symmetry(mean(liftR), mean(liftL)),

            // balance & posture
            sway_ml_rms_cm: posture.swayRms, sway_ml_range_cm: posture.swayRange, sway_path_length_cm: posture.swayPath,
            hip_vertical_range_cm: posture.hipVertRange,
            trunk_lean_mean_abs_deg: posture.trunkLeanMeanAbs, trunk_lean_peak_deg: posture.trunkLeanPeak,
            pelvis_tilt_mean_abs_deg: posture.pelvisTiltMeanAbs, pelvis_tilt_peak_deg: posture.pelvisTiltPeak,
            shoulder_tilt_mean_abs_deg: posture.shoulderTiltMeanAbs,
            hip_mid_drift_cm: posture.hipMidDrift,

            // calibration
            scale_m_per_px: scale, calib_chain_px: calibration.chain_px,
            calib_thigh_px_left: calibration.S0.l, calib_thigh_px_right: calibration.S0.r,
            calib_shoulder_width_px: calibration.shoulder_width_px, frontalness_calib: calibration.frontalness,
            calib_hold_s: calibration.hold_s, calib_jitter: calibration.jitter, calib_mode: calibration.mode,

            // QC
            effective_fs_hz: fps, valid_frame_pct: rs.validFramePct, imputed_sample_pct: rs.imputedPct,
            longest_gap_s: rs.longestGapS, median_chain_visibility: qc.medianChainVis,
            feet_out_of_frame_pct: qc.feetOutPct, shoulder_width_change_pct: qc.shoulderWidthChangePct,
            lift_2d_3d_diff: lift2d3d, both_knees_up_pct: bothKneesUpPct,
            qc_flags: qc.flags.join(';'), qc_pass: qc.pass, valid_for_norm: qc.valid_for_norm
        };

        return { summary, steps: stepsAll, frames, _p: p, _grid: grid, _N: N };
    }

    // ---------- peak detection ----------
    function localMaxima(arr, minProminence) {
        const peaks = [];
        const n = arr.length;
        for (let i = 1; i < n - 1; i++) {
            if (arr[i] > arr[i - 1] && arr[i] >= arr[i + 1]) {
                // prominence: drop to the higher of the two neighbouring valleys
                let lv = arr[i], j = i;
                while (j > 0 && arr[j - 1] <= arr[j]) { j--; lv = Math.min(lv, arr[j]); }
                let rv = arr[i], k = i;
                while (k < n - 1 && arr[k + 1] <= arr[k]) { k++; rv = Math.min(rv, arr[k]); }
                const prom = arr[i] - Math.max(lv, rv);
                if (prom >= minProminence) peaks.push({ i, val: arr[i] });
            }
        }
        return peaks;
    }
    function crossUpBefore(arr, grid, peakIdx, level) {
        for (let i = peakIdx; i > 0; i--) {
            if (arr[i] >= level && arr[i - 1] < level) {
                const f = (level - arr[i - 1]) / (arr[i] - arr[i - 1]);
                return grid[i - 1] + f * (grid[i] - grid[i - 1]);
            }
        }
        return grid[0];
    }
    function crossDownAfter(arr, grid, peakIdx, level) {
        for (let i = peakIdx; i < arr.length - 1; i++) {
            if (arr[i] >= level && arr[i + 1] < level) {
                const f = (arr[i] - level) / (arr[i] - arr[i + 1]);
                return grid[i] + f * (grid[i + 1] - grid[i]);
            }
        }
        return grid[grid.length - 1];
    }
    function minBetween(arr, a, b) { let m = Infinity; for (let i = a; i <= b; i++) m = Math.min(m, arr[i]); return m; }
    function nearestIdx(grid, t) {
        // grid is uniform; estimate
        const lo = grid[0], hz = 1 / (grid[1] - grid[0] || 1 / 30);
        let i = Math.round((t - lo) * hz);
        return Math.max(0, Math.min(grid.length - 1, i));
    }

    // ---------- rests ----------
    function detectRests(peakTimes, restGapS, durationS) {
        const ts = peakTimes.filter(t => t >= 0 && t <= durationS).sort((a, b) => a - b);
        let count = 0, total = 0, longest = 0;
        const bounds = [0, ...ts, durationS];
        for (let i = 1; i < bounds.length; i++) {
            const gap = bounds[i] - bounds[i - 1];
            if (gap > restGapS) { count++; const r = gap - 0; total += gap; longest = Math.max(longest, gap); }
        }
        return { count, total, longest };
    }
    function ratePct(q1, q4) { return q1 > 0 ? (q4 - q1) / q1 * 100 : null; }

    // ---------- posture helpers ----------
    function swayAtPx(filt, i, cal, scale, vw, vh) {
        const hipMidX = (filt.l_hip_x[i] + filt.r_hip_x[i]) / 2 * vw;
        return (hipMidX - cal.hip_mid_x_px) * scale * 100;
    }
    function trunkLeanAt(filt, i, vw, vh) {
        const shmX = (filt.l_sh_x[i] + filt.r_sh_x[i]) / 2 * vw, shmY = (filt.l_sh_y[i] + filt.r_sh_y[i]) / 2 * vh;
        const hpmX = (filt.l_hip_x[i] + filt.r_hip_x[i]) / 2 * vw, hpmY = (filt.l_hip_y[i] + filt.r_hip_y[i]) / 2 * vh;
        return Math.atan2(shmX - hpmX, hpmY - shmY) * 180 / Math.PI;
    }
    function pelvisTiltAt(filt, i, vw, vh) {
        const lx = filt.l_hip_x[i] * vw, ly = filt.l_hip_y[i] * vh, rx = filt.r_hip_x[i] * vw, ry = filt.r_hip_y[i] * vh;
        return Math.atan2(ly - ry, lx - rx) * 180 / Math.PI;
    }
    function shoulderTiltAt(filt, i, vw, vh) {
        const lx = filt.l_sh_x[i] * vw, ly = filt.l_sh_y[i] * vh, rx = filt.r_sh_x[i] * vw, ry = filt.r_sh_y[i] * vh;
        return Math.atan2(ly - ry, lx - rx) * 180 / Math.PI;
    }
    function computePosture(filt, cal, scale, vw, vh, N, grid, durationS) {
        const swayX = [], hipY = [], lean = [], pelvis = [], shoulder = [];
        for (let i = 0; i < N; i++) {
            if (grid[i] < 0 || grid[i] > durationS) continue;
            swayX.push(((filt.l_hip_x[i] + filt.r_hip_x[i]) / 2 * vw - cal.hip_mid_x_px) * scale * 100);
            hipY.push(((filt.l_hip_y[i] + filt.r_hip_y[i]) / 2 * vh) * scale * 100);
            lean.push(trunkLeanAt(filt, i, vw, vh));
            pelvis.push(pelvisTiltAt(filt, i, vw, vh));
            shoulder.push(shoulderTiltAt(filt, i, vw, vh));
        }
        // detrend sway (linear) for RMS
        const detr = detrend(swayX);
        const rms = Math.sqrt(detr.reduce((s, x) => s + x * x, 0) / Math.max(1, detr.length));
        let path = 0; for (let i = 1; i < swayX.length; i++) path += Math.abs(swayX[i] - swayX[i - 1]);
        const absMean = a => a.length ? a.reduce((s, x) => s + Math.abs(x), 0) / a.length : null;
        const absPeak = a => a.length ? Math.max(...a.map(Math.abs)) : null;
        return {
            swayRms: rms, swayRange: range(swayX), swayPath: path,
            hipVertRange: range(hipY),
            trunkLeanMeanAbs: absMean(lean), trunkLeanPeak: absPeak(lean),
            pelvisTiltMeanAbs: absMean(pelvis), pelvisTiltPeak: absPeak(pelvis),
            shoulderTiltMeanAbs: absMean(shoulder),
            hipMidDrift: swayX.length ? Math.abs(swayX[swayX.length - 1] - swayX[0]) : null
        };
    }
    function range(a) { return a.length ? Math.max(...a) - Math.min(...a) : null; }
    function detrend(a) {
        const n = a.length; if (n < 2) return a.slice();
        const slope = olsSlope(a) || 0; const m0 = mean(a) || 0;
        // subtract best-fit line through index
        const mx = (n - 1) / 2;
        return a.map((x, i) => x - (m0 + slope * (i - mx)));
    }

    // ---------- QC ----------
    function runQC(ctx) {
        const { cfg, rs, fps, testDuration, durationS, steps_total, bothKneesUpPct, calibration, participant, meta, scale } = ctx;
        const flags = [];
        // median chain visibility & feet out — recompute quickly from series
        const medianChainVis = medianVis(rs.series, cfg.signal.minVisibility);
        const feetOutPct = feetOutOfFramePct(rs);
        const shoulderWidthChangePct = shoulderWidthChange(rs, calibration);

        if (fps < cfg.qc.minEffectiveFps) flags.push('LOW_FPS');
        if (rs.validFramePct < cfg.qc.minValidFramePct) flags.push('LOW_VALID_FRAMES');
        if (rs.imputedPct > cfg.qc.maxImputedPct || rs.longestGapS > cfg.qc.maxGapS) flags.push('TRACKING_GAPS');
        if (feetOutPct > cfg.qc.maxFeetOutPct) flags.push('FEET_OUT_OF_FRAME');
        // camera / feet shift
        if (cameraFeetShift(rs, calibration)) flags.push('CAMERA_OR_FEET_SHIFT');
        if (meta.manual_stop) flags.push('MANUAL_STOP');
        if (meta.tab_hidden) flags.push('TAB_HIDDEN');
        if (steps_total === 0) flags.push('NO_STEPS');
        if (calibration.mode === 'fallback' || (calibration.jitter != null && calibration.jitter > cfg.calibration.maxJitterTrunkFrac)) {
            if (calibration.jitter != null && calibration.jitter > cfg.calibration.maxJitterTrunkFrac) flags.push('CAL_NOT_STILL');
        }
        // height plausibility: scale-derived height vs entered
        const derivedHeightM = scale * calibration.chain_px / cfg.anthropometry.segmentChainFractionOfHeight;
        const enteredM = Number(participant.height_cm) / 100;
        if (enteredM && Math.abs(derivedHeightM - enteredM) / enteredM * 100 > cfg.qc.maxHeightDiffPct) flags.push('HEIGHT_IMPLAUSIBLE');
        if (bothKneesUpPct > cfg.qc.maxBothKneesUpPct) flags.push('BOTH_KNEES_UP');

        // non-blocking
        if (shoulderWidthChangePct > cfg.qc.maxShoulderWidthChangePct) flags.push('OBLIQUE_VIEW');
        if (calibration.camera_pitch_deg != null && (Math.abs(calibration.camera_pitch_deg) > cfg.camera.maxPitchDeg || Math.abs(calibration.camera_roll_deg || 0) > cfg.camera.maxPitchDeg)) flags.push('CAMERA_TILT');
        if (calibration.hip_y_norm != null && (calibration.hip_y_norm < cfg.camera.hipYNormRange[0] || calibration.hip_y_norm > cfg.camera.hipYNormRange[1])) flags.push('CAMERA_HEIGHT_OFF');
        if (ctx.lift2d3d != null && ctx.lift2d3d > cfg.qc.maxLift2d3dDiff) flags.push('LIFT_2D_3D_DISAGREE');
        if (calibration.mode === 'fallback') flags.push('CAL_FALLBACK');
        if (participant.support_used) flags.push('SUPPORT_USED');

        const blocking = cfg.qc.blocking;
        const hasBlocking = flags.some(f => blocking.indexOf(f) >= 0);
        const pass = !hasBlocking;
        const age = Number(participant.age_years);
        const sexOk = participant.sex === 'male' || participant.sex === 'female';
        const valid_for_norm = pass && testDuration >= durationS - 0.5 &&
            age >= cfg.norms.ageRange[0] && age <= cfg.norms.ageRange[1] && sexOk;

        return { flags, pass, valid_for_norm, medianChainVis, feetOutPct, shoulderWidthChangePct };
    }
    function medianVis(series, minVis) {
        const chain = ['l_sh', 'r_sh', 'l_hip', 'r_hip', 'l_kn', 'r_kn', 'l_an', 'r_an'];
        const vals = [];
        const N = series.l_hip.v.length;
        for (let i = 0; i < N; i++) {
            let s = 0; for (const k of chain) s += series[k].v[i];
            vals.push(s / chain.length);
        }
        return median(vals);
    }
    function feetOutOfFramePct(rs) {
        const N = rs.N; let out = 0;
        const ks = ['l_an', 'r_an', 'l_toe', 'r_toe'];
        for (let i = 0; i < N; i++) {
            let bad = false;
            for (const k of ks) { const x = rs.series[k].x[i], y = rs.series[k].y[i]; if (x < 0 || x > 1 || y < 0 || y > 1) { bad = true; break; } }
            if (bad) out++;
        }
        return N ? out / N * 100 : 0;
    }
    function shoulderWidthChange(rs, cal) {
        if (!cal.shoulder_width_px) return 0;
        const N = rs.N; let maxd = 0;
        for (let i = 0; i < N; i++) {
            const w = Math.abs(rs.series.l_sh.x[i] - rs.series.r_sh.x[i]) * cal.vw;
            maxd = Math.max(maxd, Math.abs(w - cal.shoulder_width_px));
        }
        return cal.shoulder_width_px ? maxd / cal.shoulder_width_px * 100 : 0;
    }
    function cameraFeetShift(rs, cal) {
        if (cal.ankle_l_x == null) return false;
        const N = rs.N; let maxShift = 0;
        for (let i = 0; i < N; i++) {
            const lshift = Math.abs(rs.series.l_an.x[i] - cal.ankle_l_x);
            const rshift = Math.abs(rs.series.r_an.x[i] - cal.ankle_r_x);
            maxShift = Math.max(maxShift, lshift, rshift);
        }
        // shift beyond ~12% of frame width = suspicious walking/camera move
        return maxShift > 0.12;
    }

    // ---------- norms ----------
    function classifyNorm(stepsRight, participant, cfg, valid) {
        const out = { below: null, above: null, classification: 'NOT CLASSIFIED' };
        const sex = participant.sex;
        const table = sex === 'male' ? cfg.norms.male : sex === 'female' ? cfg.norms.female : null;
        if (!table) return out;
        const age = Number(participant.age_years);
        const row = table.find(r => age >= r[0] && age <= r[1]);
        if (!row) return out;
        out.below = row[2]; out.above = row[3];
        if (!valid) return out;
        if (stepsRight < row[2]) out.classification = 'BELOW AVERAGE';
        else if (stepsRight > row[3]) out.classification = 'ABOVE AVERAGE';
        else out.classification = 'AVERAGE';
        return out;
    }

    // ---------- frames (30 Hz export) ----------
    function buildFrames(rs, filt, p, p3d, kneeRiseM, kneeVel, cal, scale, vw, vh, countP, releaseP, durationS) {
        const { grid, N } = rs;
        const frames = [];
        // phase per side from progress (DOWN|RISING|UP|LOWERING)
        const phase = { l: new Array(N), r: new Array(N) };
        SIDES.forEach(side => {
            let st = 'DOWN';
            for (let i = 0; i < N; i++) {
                const pv = p[side][i], prev = i > 0 ? p[side][i - 1] : pv;
                if (st === 'DOWN' && pv > releaseP && pv > prev) st = 'RISING';
                else if ((st === 'RISING') && pv >= countP) st = 'UP';
                else if (st === 'UP' && pv < countP && pv < prev) st = 'LOWERING';
                else if (st === 'LOWERING' && pv <= releaseP) st = 'DOWN';
                phase[side][i] = st;
            }
        });
        for (let i = 0; i < N; i++) {
            const row = {
                t_s: round(grid[i], 4),
                phase_left: phase.l[i], phase_right: phase.r[i],
                tracking_gap: !!rs.gap[i],
                progress_left: round(p.l[i], 4), progress_right: round(p.r[i], 4),
                knee_rise_left_m: round(kneeRiseM.l[i], 4), knee_rise_right_m: round(kneeRiseM.r[i], 4),
                knee_vel_left_m_s: round(kneeVel.l[i], 4), knee_vel_right_m_s: round(kneeVel.r[i], 4),
                hip_mid_x_cm: round(((filt.l_hip_x[i] + filt.r_hip_x[i]) / 2 * vw - cal.hip_mid_x_px) * scale * 100, 3),
                hip_mid_y_cm: round(((filt.l_hip_y[i] + filt.r_hip_y[i]) / 2 * vh - cal.hip_mid_y_px) * scale * 100, 3),
                trunk_lean_deg: round(trunkLeanAt(filt, i, vw, vh), 3),
                pelvis_tilt_deg: round(pelvisTiltAt(filt, i, vw, vh), 3),
                shoulder_tilt_deg: round(shoulderTiltAt(filt, i, vw, vh), 3),
                shoulder_width_px: round(Math.abs(filt.l_sh_x[i] - filt.r_sh_x[i]) * vw, 2),
                progress_left_3d: p3d.l ? round(p3d.l[i], 4) : null,
                progress_right_3d: p3d.r ? round(p3d.r[i], 4) : null
            };
            ['l', 'r'].forEach(side => ['sh', 'hip', 'kn', 'an'].forEach(j => {
                row[`${side}_${j}_x_px`] = round(filt[`${side}_${j}_x`][i] * vw, 2);
                row[`${side}_${j}_y_px`] = round(filt[`${side}_${j}_y`][i] * vh, 2);
            }));
            frames.push(row);
        }
        return frames;
    }
    function round(x, d) { if (x == null || !isFinite(x)) return null; const f = Math.pow(10, d); return Math.round(x * f) / f; }

    global.SIPAnalysis = {
        run,
        // expose internals for the test harness
        _filtfilt: filtfilt, _butterCoeffs: butterCoeffs, _localMaxima: localMaxima,
        _classifyNorm: classifyNorm, _detectRests: detectRests, _resample: resample,
        _mean: mean, _sd: sd, _median: median
    };
    if (typeof module !== 'undefined') module.exports = global.SIPAnalysis;
})(typeof window !== 'undefined' ? window : globalThis);
