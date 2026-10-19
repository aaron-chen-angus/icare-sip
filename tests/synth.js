/**
 * SIP//LAB — Synthetic motion generator (Synth) for browser unit tests (E1)
 *
 * Emits a raw-frame buffer in the exact layout SIPAnalysis expects:
 *   { data: Float32Array, n, cols, tracked:[keys] }   (t_ms relative to GO)
 * plus a matching calibration object.
 *
 * Frontal-view model: participant faces the camera. A standing pose places
 * landmarks in normalised [0,1] coords; knees oscillate upward (y decreases)
 * to simulate alternating left/right lifts at a given cadence and height.
 *
 * Exposes global `Synth`.
 */
(function (global) {
    'use strict';

    const COLS = 1 + CONFIG.tracked.length * 7;
    const IDX = {}; CONFIG.tracked.forEach((m, i) => { IDX[m.key] = i; });

    // nominal standing pose in normalised coords (un-mirrored, participant faces camera)
    // participant's RIGHT side appears on image-LEFT (smaller x) when facing camera,
    // so r_sh.x < l_sh.x  => facingCamera.orderOk (l_sh.x > r_sh.x) holds.
    const VW = 720, VH = 1280;
    const STAND = {
        nose: [0.50, 0.12],
        l_sh: [0.60, 0.26], r_sh: [0.40, 0.26],
        l_el: [0.63, 0.40], r_el: [0.37, 0.40],
        l_wr: [0.64, 0.52], r_wr: [0.36, 0.52],
        l_hip: [0.57, 0.50], r_hip: [0.43, 0.50],
        l_kn: [0.57, 0.70], r_kn: [0.43, 0.70],
        l_an: [0.57, 0.90], r_an: [0.43, 0.90],
        l_heel: [0.56, 0.92], r_heel: [0.44, 0.92],
        l_toe: [0.58, 0.93], r_toe: [0.42, 0.93]
    };

    // standing thigh (vertical, px): (0.70-0.50)*VH = 0.20*VH
    const S0_PX = (0.70 - 0.50) * VH;

    function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

    /**
     * opts:
     *   durationS (default 120), fps (30), cadenceHz (0.8 per leg),
     *   heightL/heightR (peak progress p, default 1.0), noise (norm sd, default 0),
     *   dropout (0..1 prob of a frame's knee being invisible), restGaps [[start,end],...],
     *   phaseOffset (R leads L by half a cycle = alternation), seed
     *   custom(t, frame) hook to override a frame's progress directly
     */
    function generate(opts) {
        opts = opts || {};
        const durationS = opts.durationS != null ? opts.durationS : 120;
        const fps = opts.fps || 30;
        const cadence = opts.cadenceHz != null ? opts.cadenceHz : 0.8; // lifts/sec per leg
        const hL = opts.heightL != null ? opts.heightL : 1.0;
        const hR = opts.heightR != null ? opts.heightR : 1.0;
        const noise = opts.noise || 0;
        const dropout = opts.dropout || 0;
        const rests = opts.restGaps || [];
        const seed = opts.seed || 12345;
        const rand = rng(seed);
        const gauss = () => { // Box-Muller
            let u = 0, v = 0; while (u === 0) u = rand(); while (v === 0) v = rand();
            return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        };

        const preRollS = opts.preRollS != null ? opts.preRollS : 1.0;
        const tStart = -preRollS, tEnd = durationS + (opts.tailS != null ? opts.tailS : 2.0);
        const n = Math.floor((tEnd - tStart) * fps) + 1;
        const data = new Float32Array(n * COLS);

        const inRest = t => rests.some(r => t >= r[0] && t < r[1]);

        // progress waveform: raised-cosine bump per cycle so peak = target height
        function prog(t, cadenceHz, height, phase) {
            if (t < 0) return 0;                  // standing during pre-roll
            if (inRest(t)) return 0;
            const period = 1 / cadenceHz;
            const u = ((t + phase * period) % period) / period; // 0..1
            // bump: 0 at u=0 and u=1, peak at u=0.5
            const bump = 0.5 * (1 - Math.cos(2 * Math.PI * u)); // 0..1..0
            return height * bump;
        }

        for (let k = 0; k < n; k++) {
            const t = tStart + k / fps;
            const base = k * COLS;
            data[base] = t * 1000; // ms

            // alternation: R leads, L offset by half a period (phase 0.5)
            let pL = prog(t, cadence, hL, 0.5);
            let pR = prog(t, cadence, hR, 0.0);
            if (opts.custom) { const o = opts.custom(t, { pL, pR }); if (o) { pL = o.pL != null ? o.pL : pL; pR = o.pR != null ? o.pR : pR; } }

            for (const m of CONFIG.tracked) {
                const key = m.key;
                let [x, y] = STAND[key];
                // knees move up (y decreases) by p * S0 (in normalised units)
                if (key === 'l_kn') y = STAND.l_kn[1] - pL * (S0_PX / VH);
                if (key === 'r_kn') y = STAND.r_kn[1] - pR * (S0_PX / VH);
                // small noise
                if (noise) { x += gauss() * noise; y += gauss() * noise; }
                let vis = 1.0;
                // random dropout on the lifted knee near apex
                if (dropout && (key === 'l_kn' || key === 'r_kn')) {
                    if (rand() < dropout) vis = 0.0;
                }
                const o = base + 1 + IDX[key] * 7;
                data[o] = x; data[o + 1] = y; data[o + 2] = 0; data[o + 3] = vis;
                // world landmarks: approximate metres (hip at 0, knee rise = p*0.4m)
                data[o + 4] = (x - 0.5) * 1.0;
                data[o + 5] = (y - 0.5) * 1.78;
                data[o + 6] = 0;
            }
        }
        return { data, n, cols: COLS, tracked: CONFIG.tracked.map(m => m.key) };
    }

    function calibration(opts) {
        opts = opts || {};
        return {
            mode: 'standstill',
            S0: { l: S0_PX, r: S0_PX },
            S0w: null, // disable 3D cross-check by default in synth
            scale_m_per_px: (0.779 * 1.70) / ((0.26 + 0.20 + 0.20) * VH), // ~ chain
            chain_px: (0.26 + 0.20 + 0.20) * VH,
            shoulder_width_px: (0.60 - 0.40) * VW,
            trunk_px: (0.50 - 0.26) * VH,
            hip_mid_x_px: 0.5 * VW, hip_mid_y_px: 0.50 * VH,
            hip_y_norm: 0.50,
            ankle_l_x: 0.57, ankle_r_x: 0.43,
            frontalness: ((0.60 - 0.40) * VW) / ((0.50 - 0.26) * VH),
            jitter: 0.01, hold_s: 2.0,
            camera_pitch_deg: 0, camera_roll_deg: 0,
            overrides: { facing: false, level: false, hipHeight: false },
            vw: VW, vh: VH,
            threshold_p: opts.threshold_p != null ? opts.threshold_p : CONFIG.events.countP,
            threshold_preset: opts.threshold_preset || 'hip_level'
        };
    }

    function participant(opts) {
        opts = opts || {};
        return Object.assign({
            participant_id: 'SYNTH', age_years: 70, sex: 'male', height_cm: 170,
            body_mass_kg: '', site: 'test', operator_notes: '',
            camera_facing: 'environment', pose_model: 'full', camera_height_cm: '',
            count_threshold_preset: opts.threshold_preset || 'hip_level',
            safety: true, protocol_briefed: true, support_used: false,
            unable_to_perform: false, consent_upload: false
        }, opts.participant || {});
    }

    global.Synth = { generate, calibration, participant, VW, VH, S0_PX, STAND };
})(typeof window !== 'undefined' ? window : globalThis);
