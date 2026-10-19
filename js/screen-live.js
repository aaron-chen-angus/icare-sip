/**
 * SIP//LAB — Live camera screens (LiveScreens)
 *
 * Shared scaffolding for S2 (camera setup + calibration) and S3 (live test).
 * Both show the same video + overlay canvas + HUD.
 *   Phase 2 — camera start, 17-marker overlay, hip/target lines, L/R debug.
 *   Phase 3 — frame-fit checklist, camera checks (facing/level/hip height),
 *             stand-still calibration (C3), OVERRIDE logic, START gating.
 *   Phase 4 — countdown, beeps, 120 s timer, live counters, STOP (adds to this file).
 *
 * Exposes global `LiveScreens`. Depends on App, PoseEngine, Geom, CONFIG.
 */
(function (global) {
    'use strict';

    const C = CONFIG;
    let engine = null;
    let dom = null;
    let participant = null;
    let modelReady = false;

    function App() { return global.App; }
    const clamp01 = x => Math.max(0, Math.min(1, x));
    const clampRange = (x, a, b) => Math.max(a, Math.min(b, x));

    // ---- live progress state -------------------------------------------------
    const live = { pEma: { l: 0, r: 0 }, lastImg: null, lastWorld: null, lastTMs: 0 };

    // ---- S2 calibration accumulator -----------------------------------------
    // running max of d (knee below hip) per side = pre-calibration standing estimate
    const s0guess = { l: 0, r: 0 };
    // checklist booleans updated each frame
    const checks = {
        face: false, shoulders: false, hips: false, knees: false,
        feet: false, distance: false, facing: false, level: false, hipHeight: false, still: false
    };
    let overrides = { facing: false, level: false, hipHeight: false };
    // calibration capture
    const calib = {
        active: false, startMs: 0, samples: [], done: false, result: null
    };

    // =========================================================================
    // DOM scaffold (shared)
    // =========================================================================
    function buildLiveDOM() {
        const el = App().el;
        const wrap = el('div', { class: 'live-video-wrap' });
        const video = el('video', { playsinline: '', muted: '', autoplay: '' });
        video.muted = true; video.playsInline = true;
        const canvas = el('canvas');
        wrap.appendChild(video);
        wrap.appendChild(canvas);

        const hud = el('div', { class: 'hud' });
        wrap.appendChild(hud);

        const overlay = el('div', { class: 'live-overlay' });
        const statusBox = el('div', { class: 'overlay-status', id: 'overlay-status', style: 'display:none' });
        overlay.appendChild(statusBox);
        wrap.appendChild(overlay);

        const gaugeL = el('div', { class: 'gauge left' }, [el('span', { class: 'lbl', text: 'L' }), el('div', { class: 'fill' }), el('div', { class: 'tick' })]);
        const gaugeR = el('div', { class: 'gauge right' }, [el('span', { class: 'lbl', text: 'R' }), el('div', { class: 'fill' }), el('div', { class: 'tick' })]);
        gaugeL.style.display = gaugeR.style.display = 'none';
        wrap.appendChild(gaugeL); wrap.appendChild(gaugeR);

        const bubble = el('div', { class: 'bubble-level', id: 'bubble-level' }, [el('div', { class: 'cross' }), el('div', { class: 'bubble' })]);
        bubble.style.display = 'none';
        wrap.appendChild(bubble);

        const diag = el('div', { class: 'angle-panel', id: 'diag-panel' });
        wrap.appendChild(diag);

        const session = el('section', { class: 'live-session' });
        session.appendChild(wrap);
        const below = el('div', { id: 'live-below' });
        session.appendChild(below);

        dom = { session, wrap, video, canvas, hud, statusBox, gaugeL, gaugeR, bubble, diag, below };
        return session;
    }

    function setStatus(msg, cls) {
        if (!dom) return;
        const s = dom.statusBox;
        if (!msg) { s.style.display = 'none'; return; }
        s.style.display = '';
        s.className = 'overlay-status' + (cls ? ' ' + cls : '');
        s.textContent = msg;
    }
    function setMirror(on) { if (dom) dom.wrap.classList.toggle('mirror', on); }

    // =========================================================================
    // Engine setup
    // =========================================================================
    async function ensureEngine(onStatus) {
        if (!engine) engine = new PoseEngine();
        if (!modelReady || engine.model !== participant.pose_model) {
            await engine.initialize(participant.pose_model, onStatus);
            modelReady = true;
        }
        return engine;
    }

    // =========================================================================
    // S2 — camera setup + calibration
    // =========================================================================
    async function enterS2(p) {
        participant = p;
        App().state.screen = 'S2';
        document.body.classList.add('live');
        resetS2State();

        buildLiveDOM();
        App().mount(dom.session);
        setMirror(participant.camera_facing === 'user');
        renderS2Below();

        dom.bubble.style.display = '';
        dom.gaugeL.style.display = dom.gaugeR.style.display = '';
        setGaugeTick(dom.gaugeL, thresholdP());
        setGaugeTick(dom.gaugeR, thresholdP());

        startOrientationSensor();

        setStatus('Loading pose model…');
        try {
            await ensureEngine(m => setStatus(m));
            const info = await engine.startCamera(dom.video, dom.canvas, participant.camera_facing);
            setMirror(info.mirror);
            resizeCanvasToVideo();
            setStatus(null);
            engine.onFrame = onS2Frame;
        } catch (e) {
            console.error(e);
            cameraError(e);
        }
        window.addEventListener('resize', resizeCanvasToVideo);
    }

    function thresholdP() {
        return participant.count_threshold_preset === 'official_midpoint'
            ? C.events.countPOfficial : C.events.countP;
    }

    function resetS2State() {
        live.pEma.l = live.pEma.r = 0;
        s0guess.l = s0guess.r = 0;
        Object.keys(checks).forEach(k => checks[k] = false);
        overrides = { facing: false, level: false, hipHeight: false };
        calib.active = false; calib.done = false; calib.samples = []; calib.result = null;
    }

    // ---- S2 HUD + below-video UI --------------------------------------------
    function renderS2Below() {
        const el = App().el;
        dom.hud.innerHTML = '';
        dom.hud.appendChild(el('div', { style: 'pointer-events:auto' },
            [el('button', { class: 'btn btn-small', type: 'button', onclick: exitToS1 }, '← Back')]));
        dom.hud.appendChild(el('div', { class: 'hud-reps', style: 'font-size:1rem' }, [el('small', { text: 'CAMERA SETUP' })]));

        const below = dom.below;
        below.innerHTML = '';

        // frame-fit checklist. Required = must be green to calibrate/START.
        // Advisory = guidance only (recorded as covariates), never blocks START.
        const checklist = el('ul', { class: 'checklist', id: 's2-checklist', style: 'margin:10px' });
        const items = [
            ['face', 'Face visible', true], ['shoulders', 'Shoulders', true],
            ['hips', 'Hips', true], ['knees', 'Knees', true], ['feet', 'Both feet in frame', true],
            ['distance', 'Distance OK', false], ['facing', 'Facing camera', false],
            ['level', 'Camera level', false], ['hipHeight', 'Camera at hip height', false],
            ['still', 'Calibrated', true]
        ];
        items.forEach(([k, label, required]) => {
            checklist.appendChild(el('li', { id: 'chk-' + k }, [
                el('span', { class: 'tick' }),
                el('span', { text: label + (required ? '' : ' (advisory)') })
            ]));
        });
        below.appendChild(el('div', { class: 'panel', style: 'margin:10px' }, [
            el('h3', { text: 'Frame-fit & camera checks' }),
            el('p', { class: 'status', style: 'margin-bottom:6px', text: 'Required checks + a 2-second still calibration enable START. "Advisory" items only guide setup.' }),
            checklist
        ]));

        // controls: overrides + recalibrate + START
        const controls = el('div', { class: 'controls' });
        controls.appendChild(el('button', { class: 'btn btn-small', type: 'button', id: 'btn-override-facing', onclick: () => toggleOverride('facing') }, 'Override facing'));
        controls.appendChild(el('button', { class: 'btn btn-small', type: 'button', id: 'btn-override-level', onclick: () => toggleOverride('level') }, 'Override level'));
        controls.appendChild(el('button', { class: 'btn btn-small', type: 'button', id: 'btn-override-hip', onclick: () => toggleOverride('hipHeight') }, 'Override height'));
        controls.appendChild(el('button', { class: 'btn btn-small', type: 'button', onclick: requestMotionPermission }, 'Enable tilt sensor'));
        controls.appendChild(el('button', { class: 'btn btn-small', type: 'button', id: 'btn-recalib', onclick: startCalibration }, 'Recalibrate'));
        controls.appendChild(el('button', { class: 'btn btn-primary', type: 'button', id: 'btn-start', disabled: 'true', onclick: onStartTest }, 'Start Test'));
        below.appendChild(controls);

        // calibration progress note
        below.appendChild(el('div', { class: 'note info', id: 's2-note', style: 'margin:10px',
            html: 'Fit the whole body and feet in frame, face the camera, keep the phone level at hip height, then stand still to calibrate.' }));
    }

    function toggleOverride(key) {
        overrides[key] = !overrides[key];
        const btn = document.getElementById('btn-override-' + (key === 'hipHeight' ? 'hip' : key));
        if (btn) btn.classList.toggle('active', overrides[key]);
    }

    // =========================================================================
    // S2 per-frame
    // =========================================================================
    function onS2Frame(frame, tMs) {
        if (!frame) {
            setStatus('NO PERSON — step into frame', 'warn');
            updateDiag(null); return;
        }
        const img = frame.img;
        const vw = dom.video.videoWidth, vh = dom.video.videoHeight;
        live.lastImg = img; live.lastTMs = tMs; live.lastWorld = frame.world || null;

        // --- individual checks ---
        const minV = C.signal.minVisibility;
        checks.face = Geom.lm(img, 'nose').v >= minV;
        checks.shoulders = Geom.lm(img, 'l_sh').v >= minV && Geom.lm(img, 'r_sh').v >= minV;
        checks.hips = Geom.lm(img, 'l_hip').v >= minV && Geom.lm(img, 'r_hip').v >= minV;
        checks.knees = Geom.lm(img, 'l_kn').v >= minV && Geom.lm(img, 'r_kn').v >= minV;
        checks.feet = Geom.feetInFrame(img) &&
            Geom.lm(img, 'l_an').v >= minV && Geom.lm(img, 'r_an').v >= minV;

        const span = Geom.bodySpanNorm(img);
        const [smin, smax] = C.camera.spanRange;
        checks.distance = span >= smin && span <= smax;

        // Facing: rely on shoulder ORDER (the reliable signal); frontalness is only a
        // soft hint. Being lenient here is intentional — a too-strict facing/frontalness
        // test can never pass for normal anatomy and would wedge the whole screen.
        const facing = Geom.facingCamera(img, vw, vh, C.camera.minFrontalness);
        checks.facing = facing.orderOk || overrides.facing;

        // camera level from device sensors (fallback: ankle-mid->shoulder-mid axis vs vertical)
        const levelOk = cameraLevelOk(img, vw, vh);
        checks.level = levelOk || overrides.level;

        // camera at hip height: median hip-mid y in video-native normalised ~ 0.5
        const hipMid = Geom.hipMidNorm(img);
        const [hlo, hhi] = C.camera.hipYNormRange;
        checks.hipHeight = (hipMid.y >= hlo && hipMid.y <= hhi) || overrides.hipHeight;

        // --- coaching text (priority order). Advisory checks (facing/level/hip/distance)
        // guide the operator but DO NOT block START; only core tracking + calibration do. ---
        let msg = null, cls = 'warn';
        if (!checks.face || !checks.shoulders || !checks.hips || !checks.knees) msg = 'STEP INTO FRAME';
        else if (!checks.feet) msg = 'BOTH FEET MUST BE IN FRAME';
        else if (span > smax) msg = 'STEP BACK';
        else if (span < smin) msg = 'STEP CLOSER';
        else if (!facing.orderOk && !overrides.facing) msg = 'FACE THE CAMERA';
        else if (!levelOk && !overrides.level) msg = 'TILT PHONE UPRIGHT';
        else if (hipMid.y > hhi && !overrides.hipHeight) msg = 'LOWER THE PHONE';
        else if (hipMid.y < hlo && !overrides.hipHeight) msg = 'RAISE THE PHONE';
        setStatus(calib.active ? null : msg, cls);

        // --- progress + overlay (gauges meaningful via running-max S0 guess) ---
        const A = C.live.emaAlpha;
        const lines = [{ yNorm: hipMid.y, label: 'HIP', color: 'rgba(0,212,255,0.8)', dashed: true, width: 2 }];
        // S2 image centre line (camera-height guide)
        lines.push({ yNorm: 0.5, label: '', color: 'rgba(255,255,255,0.25)', dashed: true, width: 1 });
        ['l', 'r'].forEach(side => {
            if (!Geom.sideVisible(img, side, minV)) return;
            const d = Geom.dVert(img, side, vw, vh, C.events.hipRef);
            if (d > s0guess[side]) s0guess[side] = d;
            const S0 = s0guess[side] || d || 1;
            const p = 1 - d / S0;
            live.pEma[side] = A * p + (1 - A) * live.pEma[side];
            const hipY = Geom.hipRefY(img, side, vw, vh, C.events.hipRef) / vh;
            const yTargetNorm = hipY + ((1 - thresholdP()) * S0) / vh;
            lines.push({ yNorm: yTargetNorm, label: side.toUpperCase() + ' TGT', color: side === 'r' ? 'rgba(255,106,0,0.7)' : 'rgba(0,212,255,0.7)', dashed: true, width: 1.5 });
        });
        engine.overlay = { lines, hipMid: { xNorm: hipMid.x, yNorm: hipMid.y }, flash: {} };
        setGaugeFill(dom.gaugeL, clamp01(live.pEma.l / 1.2));
        setGaugeFill(dom.gaugeR, clamp01(live.pEma.r / 1.2));

        // --- stillness + auto calibration ---
        // Calibrate as soon as the body + feet are tracked. Facing/level/hip-height are
        // advisory and must not block calibration (they still guide the operator).
        const coreFitOk = checks.face && checks.shoulders && checks.hips && checks.knees && checks.feet;
        handleCalibration(img, vw, vh, tMs, coreFitOk);

        renderChecklist();
        updateDiag(img, vw, vh, facing);
        updateStartButton();
    }

    // camera level: prefer device sensors; else use trunk axis vs image vertical
    function cameraLevelOk(img, vw, vh) {
        if (orient.supported && orient.pitch != null) {
            return Math.abs(orient.pitch) <= C.camera.maxPitchDeg && Math.abs(orient.roll) <= C.camera.maxPitchDeg;
        }
        // fallback: ankle-mid -> shoulder-mid axis should be within 5° of vertical
        const shm = { x: (Geom.px(img, 'l_sh', vw, vh).x + Geom.px(img, 'r_sh', vw, vh).x) / 2, y: (Geom.px(img, 'l_sh', vw, vh).y + Geom.px(img, 'r_sh', vw, vh).y) / 2 };
        const anm = { x: (Geom.px(img, 'l_an', vw, vh).x + Geom.px(img, 'r_an', vw, vh).x) / 2, y: (Geom.px(img, 'l_an', vw, vh).y + Geom.px(img, 'r_an', vw, vh).y) / 2 };
        const axisDeg = Math.abs(Math.atan2(shm.x - anm.x, anm.y - shm.y) * 180 / Math.PI);
        return axisDeg <= 5;
    }

    // ---- stand-still calibration (C3) ---------------------------------------
    function handleCalibration(img, vw, vh, tMs, frameFitOk) {
        if (calib.done) { checks.still = true; return; }
        if (!frameFitOk) {
            calib.active = false; calib.samples = []; checks.still = false;
            return;
        }
        if (!calib.active) startCalibration();

        // capture a sample of the quantities we need
        const hipMid = Geom.hipMidNorm(img);
        calib.samples.push({
            tMs,
            dL: Geom.dVert(img, 'l', vw, vh, C.events.hipRef),
            dR: Geom.dVert(img, 'r', vw, vh, C.events.hipRef),
            chain: Geom.chainPx(img, vw, vh),
            shW: Geom.shoulderWidthPx(img, vw, vh),
            trunk: Geom.trunkLenPx(img, vw, vh),
            hipMidX: hipMid.x * vw, hipMidY: hipMid.y * vh,
            hipYNorm: hipMid.y,
            lanX: Geom.px(img, 'l_an', vw, vh).x, ranX: Geom.px(img, 'r_an', vw, vh).x,
            front: Geom.frontalness(img, vw, vh),
            // world-landmark thigh for 3-D cross-check (if present)
            dLw: worldVert(live.lastWorld, 'l'), dRw: worldVert(live.lastWorld, 'r')
        });

        // jitter over the last holdS seconds
        const holdMs = C.calibration.holdS * 1000;
        const recent = calib.samples.filter(s => tMs - s.tMs <= holdMs);
        if (recent.length < 5) { checks.still = false; setCalibProgress(recent.length / 10); return; }

        const trunkMean = mean(recent.map(s => s.trunk)) || 1;
        const jitter = (sd(recent.map(s => s.hipMidX)) + sd(recent.map(s => s.hipMidY)) +
            sd(recent.map(s => s.lanX * vw)) ) / 3 / trunkMean;
        checks.still = jitter <= C.calibration.maxJitterTrunkFrac;

        const elapsed = tMs - calib.startMs;
        setCalibProgress(clamp01(elapsed / holdMs));

        if (elapsed >= holdMs && checks.still) finishCalibration(recent, vw, vh);
    }

    function startCalibration() {
        calib.active = true; calib.done = false; calib.result = null;
        calib.startMs = live.lastTMs || performance.now();
        calib.samples = [];
        const note = document.getElementById('s2-note');
        if (note) { note.className = 'note info'; note.textContent = 'Hold still…'; }
    }

    function finishCalibration(recent, vw, vh) {
        const S0_L = median(recent.map(s => s.dL));
        const S0_R = median(recent.map(s => s.dR));
        const chainpx = median(recent.map(s => s.chain));
        const heightM = Number(participant.height_cm) / 100;
        const scale = (C.anthropometry.segmentChainFractionOfHeight * heightM) / chainpx;
        const result = {
            mode: 'standstill',
            S0: { l: S0_L, r: S0_R },
            S0w: { l: median(recent.map(s => s.dLw).filter(isFinite)) || null, r: median(recent.map(s => s.dRw).filter(isFinite)) || null },
            scale_m_per_px: scale,
            chain_px: chainpx,
            shoulder_width_px: median(recent.map(s => s.shW)),
            trunk_px: median(recent.map(s => s.trunk)),
            hip_mid_x_px: median(recent.map(s => s.hipMidX)),
            hip_mid_y_px: median(recent.map(s => s.hipMidY)),
            hip_y_norm: median(recent.map(s => s.hipYNorm)),
            ankle_l_x: median(recent.map(s => s.lanX)), ankle_r_x: median(recent.map(s => s.ranX)),
            frontalness: median(recent.map(s => s.front)),
            jitter: (sd(recent.map(s => s.hipMidX)) + sd(recent.map(s => s.hipMidY))) / 2 / (median(recent.map(s => s.trunk)) || 1),
            hold_s: C.calibration.holdS,
            camera_pitch_deg: orient.pitch, camera_roll_deg: orient.roll,
            vw, vh
        };
        calib.result = result;
        calib.done = true;
        calib.active = false;
        // feed s0guess from the real calibration so gauges are accurate
        s0guess.l = S0_L; s0guess.r = S0_R;

        setStatus('CALIBRATED', 'good');
        setTimeout(() => { if (App().state.screen === 'S2') setStatus(null); }, 1200);
        const note = document.getElementById('s2-note');
        if (note) {
            note.className = 'note';
            const hm = (result.scale_m_per_px * result.chain_px);  // ~ 0.779*height
            note.innerHTML = `<b class="good">CALIBRATED.</b> Thigh L ${S0_L.toFixed(0)}px · R ${S0_R.toFixed(0)}px · ` +
                `scale ${(result.scale_m_per_px * 1000).toFixed(2)} mm/px. START enabled.`;
        }
        updateStartButton();
    }

    function setCalibProgress(frac) {
        // reuse status overlay with a progress bar during the hold
        if (calib.done) return;
        const s = dom.statusBox;
        s.style.display = '';
        s.className = 'overlay-status';
        s.innerHTML = 'HOLD STILL<div class="progress"><div style="width:' + (clamp01(frac) * 100).toFixed(0) + '%"></div></div>';
    }

    function renderChecklist() {
        const set = (k) => {
            const li = document.getElementById('chk-' + k);
            if (!li) return;
            const ok = checks[k];
            li.className = ok ? 'ok' : (overrideFor(k) ? 'ok' : '');
            const tick = li.querySelector('.tick');
            if (tick) tick.textContent = ok ? '✓' : '';
        };
        Object.keys(checks).forEach(set);
    }
    function overrideFor(k) {
        return (k === 'facing' && overrides.facing) || (k === 'level' && overrides.level) || (k === 'hipHeight' && overrides.hipHeight);
    }

    function updateStartButton() {
        const btn = document.getElementById('btn-start');
        if (!btn) return;
        // START needs the body tracked + a completed calibration. Facing/level/hip-height
        // are advisory (they are recorded as QC covariates, not hard gates).
        const coreFitOk = checks.face && checks.shoulders && checks.hips && checks.knees && checks.feet;
        const ready = coreFitOk && calib.done;
        btn.disabled = !ready;
        btn.textContent = ready ? 'Start Test →' : 'Start Test (stand still to calibrate)';
    }

    function onStartTest() {
        if (!calib.done) return;
        // hand calibration + camera covariates to the controller / S3
        const result = calib.result;
        App().state.calibration = {
            mode: result.mode,
            S0: result.S0, S0w: result.S0w,
            scale_m_per_px: result.scale_m_per_px,
            chain_px: result.chain_px,
            shoulder_width_px: result.shoulder_width_px,
            trunk_px: result.trunk_px,
            hip_mid_x_px: result.hip_mid_x_px, hip_mid_y_px: result.hip_mid_y_px,
            hip_y_norm: result.hip_y_norm,
            ankle_l_x: result.ankle_l_x, ankle_r_x: result.ankle_r_x,
            frontalness: result.frontalness,
            jitter: result.jitter, hold_s: result.hold_s,
            camera_pitch_deg: result.camera_pitch_deg, camera_roll_deg: result.camera_roll_deg,
            overrides: Object.assign({}, overrides),
            vw: result.vw, vh: result.vh,
            threshold_p: thresholdP(),
            threshold_preset: participant.count_threshold_preset
        };
        if (global.LiveScreens.enterS3) {
            global.LiveScreens.enterS3(participant, engine, dom);
        } else if (App().toS3Preview) {
            App().toS3Preview(participant);
        }
    }

    // world-landmark vertical thigh (for 3-D cross-check)
    function worldVert(world, side) {
        if (!world) return NaN;
        const kn = Geom.lmWorld(world, side === 'r' ? 'r_kn' : 'l_kn');
        const hip = Geom.lmWorld(world, side === 'r' ? 'r_hip' : 'l_hip');
        if (!kn || !hip) return NaN;
        return kn.y - hip.y;
    }

    // ---- small stats ---------------------------------------------------------
    function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
    function sd(a) {
        if (a.length < 2) return 0;
        const m = mean(a);
        return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
    }
    function median(a) {
        const b = a.slice().filter(x => isFinite(x)).sort((x, y) => x - y);
        if (!b.length) return 0;
        const mid = Math.floor(b.length / 2);
        return b.length % 2 ? b[mid] : (b[mid - 1] + b[mid]) / 2;
    }

    // ---- diagnostics panel ---------------------------------------------------
    function updateDiag(img, vw, vh, facing) {
        if (!dom || !dom.diag) return;
        if (!img) { dom.diag.textContent = 'no person'; return; }
        const valid = ['l_sh', 'r_sh', 'l_hip', 'r_hip', 'l_kn', 'r_kn', 'l_an']
            .reduce((n, k) => n + (Geom.lm(img, k).v >= C.signal.minVisibility ? 1 : 0), 0);
        dom.diag.textContent =
            `L ${(live.pEma.l * 100).toFixed(0)}%  R ${(live.pEma.r * 100).toFixed(0)}%\n` +
            `valid ${valid}/7  fps ${engine.fpsEMA ? engine.fpsEMA.toFixed(0) : '—'}\n` +
            `front ${facing ? facing.frontalness.toFixed(2) : '—'}  pitch ${orient.pitch == null ? 'N/A' : orient.pitch.toFixed(0) + '°'} roll ${orient.roll == null ? 'N/A' : orient.roll.toFixed(0) + '°'}`;
    }

    // ---- gauges --------------------------------------------------------------
    function setGaugeFill(g, frac) { const f = g.querySelector('.fill'); if (f) f.style.height = (frac * 100).toFixed(1) + '%'; }
    function setGaugeTick(g, countP) { const t = g.querySelector('.tick'); if (t) t.style.bottom = (clamp01(countP / 1.2) * 100).toFixed(1) + '%'; }

    // ---- device orientation (bubble level) ----------------------------------
    const orient = { pitch: null, roll: null, supported: false };
    function onOrient(e) {
        if (e.beta == null && e.gamma == null) return;
        orient.supported = true;
        orient.pitch = (e.beta || 0) - 90;
        orient.roll = e.gamma || 0;
        if (dom && dom.bubble) {
            const maxDeg = C.camera.maxPitchDeg * 3;
            const dx = clampRange(orient.roll / maxDeg, -1, 1) * 30;
            const dy = clampRange(orient.pitch / maxDeg, -1, 1) * 30;
            const b = dom.bubble.querySelector('.bubble');
            if (b) b.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            const off = Math.abs(orient.pitch) > C.camera.maxPitchDeg || Math.abs(orient.roll) > C.camera.maxPitchDeg;
            dom.bubble.classList.toggle('off', off);
        }
    }
    function startOrientationSensor() {
        try {
            if (typeof DeviceOrientationEvent !== 'undefined' &&
                typeof DeviceOrientationEvent.requestPermission === 'function') {
                // iOS: needs a user gesture; the "Enable tilt sensor" button calls requestMotionPermission.
            } else if (typeof window !== 'undefined' && 'ondeviceorientation' in window) {
                window.addEventListener('deviceorientation', onOrient);
            }
        } catch (e) { /* N/A */ }
    }
    function requestMotionPermission() {
        try {
            if (typeof DeviceOrientationEvent !== 'undefined' &&
                typeof DeviceOrientationEvent.requestPermission === 'function') {
                DeviceOrientationEvent.requestPermission().then(st => {
                    if (st === 'granted') window.addEventListener('deviceorientation', onOrient);
                    else setStatus('SENSOR N/A — using fallback level check', 'warn');
                }).catch(() => setStatus('SENSOR N/A — using fallback', 'warn'));
            } else if ('ondeviceorientation' in window) {
                window.addEventListener('deviceorientation', onOrient);
            } else {
                setStatus('SENSOR N/A — using fallback', 'warn');
            }
        } catch (e) { setStatus('SENSOR N/A', 'warn'); }
    }
    function stopOrientationSensor() { try { window.removeEventListener('deviceorientation', onOrient); } catch (e) {} }

    // ---- canvas sizing -------------------------------------------------------
    function resizeCanvasToVideo() {
        if (!dom || !dom.video || !dom.canvas) return;
        const vw = dom.video.videoWidth, vh = dom.video.videoHeight;
        if (vw && vh && (dom.canvas.width !== vw || dom.canvas.height !== vh)) {
            dom.canvas.width = vw; dom.canvas.height = vh;
        }
    }

    // ---- errors / exit -------------------------------------------------------
    function cameraError(e) {
        const el = App().el;
        const name = e && e.name ? e.name : '';
        let msg = 'Could not start the camera.';
        if (name === 'NotAllowedError') msg = 'Camera permission denied. Allow camera access and reload.';
        else if (name === 'NotFoundError') msg = 'No camera found on this device.';
        else if (name === 'NotReadableError') msg = 'The camera is in use by another app. Close it and retry.';
        else if (!window.isSecureContext) msg = 'The camera needs HTTPS. Open the GitHub Pages URL (not file://).';
        else if (String(e).includes('import') || String(e).includes('bundle')) msg = 'Could not load the pose model from the CDN. Check the network and retry.';
        dom.below.innerHTML = '';
        dom.below.appendChild(el('div', { class: 'controls' }, [
            el('div', { class: 'flag block', style: 'flex:1 1 100%', html: '<b>SETUP</b> ' + App().esc(msg) }),
            el('button', { class: 'btn', type: 'button', onclick: () => enterS2(participant) }, 'Retry'),
            el('button', { class: 'btn', type: 'button', onclick: exitToS1 }, '← Back')
        ]));
        setStatus(null);
    }

    function teardown() {
        if (engine) { engine.onFrame = null; engine.stop(); }
        stopOrientationSensor();
        window.removeEventListener('resize', resizeCanvasToVideo);
        document.body.classList.remove('live', 'landscape-warn');
    }
    function exitToS1() { teardown(); App().renderS1(); }

    global.LiveScreens = {
        enterS2, teardown, setStatus, setMirror,
        // expose internals for Phase 4 (S3) which augments this module
        _ctx: () => ({ C, engine: () => engine, dom: () => dom, live, orient, participant: () => participant,
            buildLiveDOM, setGaugeFill, setGaugeTick, clamp01, resizeCanvasToVideo, median, mean, sd, worldVert }),
        _dom: () => dom, _engine: () => engine, _live: () => live
    };
})(typeof window !== 'undefined' ? window : globalThis);

/* ============================================================================
   SIP//LAB — S3 live test (Phase 4)
   Appended to LiveScreens. Reuses the camera/engine/dom from S2 so there is no
   re-initialisation flicker between calibration and the test.
   ========================================================================== */
(function (global) {
    'use strict';

    const LS = global.LiveScreens;
    const C = CONFIG;
    const clamp01 = x => Math.max(0, Math.min(1, x));

    // raw-frame buffer: preallocated typed arrays, no per-frame allocation.
    // layout per frame: t_ms + 17*7 values (x,y,z,v,wx,wy,wz) = 1 + 119 = 120 cols.
    const COLS = 1 + CONFIG.tracked.length * 7;
    const MAX_SECONDS = CONFIG.protocol.durationS + CONFIG.protocol.tailS + CONFIG.protocol.preRollS + 2;
    const MAX_FRAMES = Math.ceil(MAX_SECONDS * 60) + 120; // headroom for 60fps devices

    const S3 = {
        engine: null, dom: null, participant: null, cal: null,
        buffer: null, n: 0,
        state: { l: 'DOWN', r: 'DOWN' }, pEma: { l: 0, r: 0 },
        count: { l: 0, r: 0 }, lastCountMs: { l: -1e9, r: -1e9 },
        tGo: 0, running: false, phase: 'idle',     // idle|countdown|test|analysing
        remaining: C.protocol.durationS, wakeLock: null,
        audioCtx: null, muted: false,
        timerRAF: 0, beepsDone: {}, startWall: 0
    };

    // ---- audio beeps ---------------------------------------------------------
    function ensureAudio() {
        if (S3.muted) return null;
        try {
            if (!S3.audioCtx) S3.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (S3.audioCtx.state === 'suspended') S3.audioCtx.resume();
            return S3.audioCtx;
        } catch (e) { return null; }
    }
    function beep(freq, durMs, when) {
        const ctx = ensureAudio(); if (!ctx) return;
        const t0 = (when || ctx.currentTime);
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.frequency.value = freq; osc.type = 'sine';
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(t0); osc.stop(t0 + durMs / 1000 + 0.02);
    }

    // ---- wake lock -----------------------------------------------------------
    async function acquireWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                S3.wakeLock = await navigator.wakeLock.request('screen');
                document.addEventListener('visibilitychange', reacquireWakeLock);
            }
        } catch (e) { /* ignore */ }
    }
    async function reacquireWakeLock() {
        if (document.visibilityState === 'visible' && S3.running && !S3.wakeLock) {
            try { S3.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
        }
    }
    function releaseWakeLock() {
        document.removeEventListener('visibilitychange', reacquireWakeLock);
        try { if (S3.wakeLock) { S3.wakeLock.release(); S3.wakeLock = null; } } catch (e) {}
    }

    // ---- entry ---------------------------------------------------------------
    function enterS3(participant, engine, dom) {
        const ctx = LS._ctx();
        S3.engine = engine || ctx.engine();
        S3.dom = dom || ctx.dom();
        S3.participant = participant;
        S3.cal = App().state.calibration;
        App().state.screen = 'S3';
        document.body.classList.add('live');

        // reset test state
        S3.buffer = new Float32Array(MAX_FRAMES * COLS);
        S3.n = 0;
        S3.state.l = S3.state.r = 'DOWN';
        S3.pEma.l = S3.pEma.r = 0;
        S3.count.l = S3.count.r = 0;
        S3.lastCountMs.l = S3.lastCountMs.r = -1e9;
        S3.phase = 'countdown'; S3.running = false;
        S3.remaining = C.protocol.durationS;
        S3.beepsDone = {}; S3.manualStop = false; S3.tabHidden = false;

        buildS3UI();
        // gauges visible, tick at threshold
        S3.dom.gaugeL.style.display = S3.dom.gaugeR.style.display = '';
        LS._ctx().setGaugeTick(S3.dom.gaugeL, S3.cal.threshold_p);
        LS._ctx().setGaugeTick(S3.dom.gaugeR, S3.cal.threshold_p);
        S3.dom.bubble.style.display = 'none';

        // route every frame through the test handler
        S3.engine.onFrame = onTestFrame;

        acquireWakeLock();
        document.addEventListener('visibilitychange', onVisibility);
        startCountdown();
    }

    function App() { return global.App; }

    function buildS3UI() {
        const el = App().el;
        const dom = S3.dom;
        dom.hud.innerHTML = '';
        // top-left countdown
        const timeEl = el('div', { class: 'hud-time counting', id: 's3-time', text: fmt(S3.remaining) });
        // top-right counts
        const reps = el('div', { class: 'hud-reps', id: 's3-reps' }, [
            el('span', { id: 's3-r', text: '0' }),
            el('small', { text: 'RIGHT · OFFICIAL' }),
            el('span', { class: 'sub-counts' }, [
                el('span', { class: 'l', id: 's3-l', text: 'L 0' }),
                document.createTextNode('  '),
                el('span', { class: 'tot', id: 's3-tot', text: 'TOTAL 0' })
            ])
        ]);
        dom.hud.appendChild(timeEl);
        dom.hud.appendChild(reps);

        // controls: STOP (confirm) + mute
        dom.below.innerHTML = '';
        const controls = el('div', { class: 'controls' });
        controls.appendChild(el('button', { class: 'btn btn-small', type: 'button', id: 's3-mute', onclick: toggleMute }, S3.muted ? 'Unmute' : 'Mute'));
        controls.appendChild(el('button', { class: 'btn btn-danger', type: 'button', id: 's3-stop', onclick: confirmStop }, 'Stop Test'));
        dom.below.appendChild(controls);
    }

    function fmt(sec) {
        sec = Math.max(0, sec);
        const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
        return m + ':' + String(s).padStart(2, '0');
    }

    function toggleMute() {
        S3.muted = !S3.muted;
        const b = document.getElementById('s3-mute');
        if (b) b.textContent = S3.muted ? 'Unmute' : 'Mute';
    }

    // ---- countdown -----------------------------------------------------------
    function startCountdown() {
        S3.phase = 'countdown';
        LS.setStatus(null);
        let n = C.protocol.countdownS;
        const timeEl = document.getElementById('s3-time');
        const show = () => {
            LS.setStatus(n > 0 ? String(n) : 'GO', n > 0 ? '' : '');
            S3.dom.statusBox.className = 'overlay-status big';
            if (!S3.muted) beep(n > 0 ? 660 : 990, n > 0 ? 150 : 300);
            if (timeEl) timeEl.textContent = fmt(C.protocol.durationS);
        };
        show();
        const tick = () => {
            n--;
            if (n >= 0) { show(); setTimeout(tick, 1000); }
            else { S3.dom.statusBox.className = 'overlay-status'; LS.setStatus(null); beginTest(); }
        };
        setTimeout(tick, 1000);
    }

    // ---- test loop -----------------------------------------------------------
    function beginTest() {
        S3.phase = 'test';
        S3.running = true;
        S3.tGo = S3.engine && S3.engine._lastTs ? S3.engine._lastTs : performance.now();
        S3.startWall = performance.now();
        runTimer();
    }

    function runTimer() {
        if (!S3.running) return;
        const elapsed = (performance.now() - S3.startWall) / 1000;
        S3.remaining = Math.max(0, C.protocol.durationS - elapsed);
        const timeEl = document.getElementById('s3-time');
        if (timeEl) { timeEl.textContent = fmt(S3.remaining); timeEl.classList.remove('counting'); }

        // scheduled beeps at 60,30,10 s remaining and final 3-2-1
        const rem = Math.ceil(S3.remaining);
        [60, 30, 10, 3, 2, 1].forEach(mark => {
            if (!S3.beepsDone[mark] && rem === mark && S3.remaining <= mark) {
                S3.beepsDone[mark] = true;
                if (!S3.muted) beep(mark <= 3 ? 880 : 740, mark <= 3 ? 150 : 120);
            }
        });

        if (S3.remaining <= 0) { finishTest(false); return; }
        S3.timerRAF = requestAnimationFrame(runTimer);
    }

    // per-frame: store raw, update live state machine + overlay (F2)
    function onTestFrame(frame, tMs) {
        const dom = S3.dom;
        if (!frame) { LS.setStatus('NO PERSON', 'warn'); return; }
        const img = frame.img, world = frame.world;
        const vw = dom.video.videoWidth, vh = dom.video.videoHeight;

        // store raw frame. t_ms is relative to GO; tGo is known only once the
        // test begins, so we store absolute media time here and rebase to GO in
        // finishTest (pre-roll/countdown frames end up negative, as intended).
        if (S3.n < MAX_FRAMES) {
            const base = S3.n * COLS;
            S3.buffer[base] = tMs; // absolute; rebased to (tMs - tGo) at finish
            for (let i = 0; i < CONFIG.tracked.length; i++) {
                const o = base + 1 + i * 7;
                const ii = i * 4;
                S3.buffer[o] = img[ii]; S3.buffer[o + 1] = img[ii + 1];
                S3.buffer[o + 2] = img[ii + 2]; S3.buffer[o + 3] = img[ii + 3];
                if (world) { const wi = i * 3; S3.buffer[o + 4] = world[wi]; S3.buffer[o + 5] = world[wi + 1]; S3.buffer[o + 6] = world[wi + 2]; }
                else { S3.buffer[o + 4] = S3.buffer[o + 5] = S3.buffer[o + 6] = NaN; }
            }
            S3.n++;
        }

        // live causal state machine (only counts during the test window)
        const A = C.live.emaAlpha, countP = S3.cal.threshold_p, releaseP = C.events.releaseP;
        const S0 = S3.cal.S0;
        const lines = [];
        const hipMid = Geom.hipMidNorm(img);
        lines.push({ yNorm: hipMid.y, label: 'HIP', color: 'rgba(0,212,255,0.8)', dashed: true, width: 2 });
        const flash = { l: false, r: false };

        ['l', 'r'].forEach(side => {
            if (!Geom.sideVisible(img, side, C.signal.minVisibility)) return;
            const d = Geom.dVert(img, side, vw, vh, C.events.hipRef);
            const s0 = S0[side] || d || 1;
            const p = 1 - d / s0;
            S3.pEma[side] = A * p + (1 - A) * S3.pEma[side];
            const pe = S3.pEma[side];

            // target line
            const hipY = Geom.hipRefY(img, side, vw, vh, C.events.hipRef) / vh;
            lines.push({ yNorm: hipY + ((1 - countP) * s0) / vh, label: side.toUpperCase() + ' TGT', color: side === 'r' ? 'rgba(255,106,0,0.7)' : 'rgba(0,212,255,0.7)', dashed: true, width: 1.5 });

            if (S3.running) {
                if (S3.state[side] === 'DOWN' && pe >= countP && (tMs - S3.lastCountMs[side]) >= C.events.minSameLegS * 1000) {
                    S3.count[side]++; S3.state[side] = 'UP'; S3.lastCountMs[side] = tMs; flash[side] = true;
                } else if (S3.state[side] === 'UP' && pe <= releaseP) {
                    S3.state[side] = 'DOWN';
                }
            }
            if (pe >= countP) flash[side] = true;
        });

        S3.engine.overlay = { lines, hipMid: { xNorm: hipMid.x, yNorm: hipMid.y }, flash };
        LS._ctx().setGaugeFill(dom.gaugeL, clamp01(S3.pEma.l / 1.2));
        LS._ctx().setGaugeFill(dom.gaugeR, clamp01(S3.pEma.r / 1.2));

        // tracking status
        const valid = ['l_hip', 'r_hip', 'l_kn', 'r_kn', 'l_an', 'r_an']
            .every(k => Geom.lm(img, k).v >= C.signal.minVisibility);
        if (S3.running) {
            if (!Geom.feetInFrame(img)) LS.setStatus('FEET OUT OF FRAME', 'warn');
            else if (!valid) LS.setStatus('LOW VISIBILITY', 'warn');
            else LS.setStatus(null);
        }

        updateCounts();
        if (S3.dom.diag) {
            S3.dom.diag.textContent =
                `R ${(S3.pEma.r * 100).toFixed(0)}%  L ${(S3.pEma.l * 100).toFixed(0)}%\n` +
                `fps ${S3.engine.fpsEMA ? S3.engine.fpsEMA.toFixed(0) : '—'}  frames ${S3.n}`;
        }
    }

    function updateCounts() {
        const r = document.getElementById('s3-r');
        const l = document.getElementById('s3-l');
        const t = document.getElementById('s3-tot');
        if (r) r.textContent = String(S3.count.r);
        if (l) l.textContent = 'L ' + S3.count.l;
        if (t) t.textContent = 'TOTAL ' + (S3.count.l + S3.count.r);
    }

    // ---- stop / finish -------------------------------------------------------
    function confirmStop() {
        App().modal({
            title: 'Stop test?',
            body: 'The test will end now and be marked as a manual stop. Continue?',
            buttons: [
                { label: 'Keep going', class: 'btn', onClick: close => close() },
                { label: 'Stop now', class: 'btn btn-danger', onClick: close => { close(); finishTest(true); } }
            ]
        });
    }

    function onVisibility() {
        if (document.hidden && S3.running) { S3.tabHidden = true; }
    }

    function finishTest(manual) {
        if (S3.phase === 'analysing' || S3.phase === 'done') return;
        S3.running = false;
        S3.manualStop = !!manual;
        S3.phase = 'analysing';
        cancelAnimationFrame(S3.timerRAF);
        releaseWakeLock();
        document.removeEventListener('visibilitychange', onVisibility);
        if (S3.engine) S3.engine.onFrame = null;

        // analysing overlay
        S3.dom.statusBox.className = 'overlay-status';
        S3.dom.statusBox.style.display = '';
        S3.dom.statusBox.innerHTML = 'ANALYSING…<div class="spinner" style="margin-top:12px"></div>';

        // rebase raw timestamps to GO (t_ms = media time - tGo). Pre-GO frames
        // become negative (pre-roll), test frames are >= 0.
        if (S3.buffer && S3.tGo) {
            for (let k = 0; k < S3.n; k++) {
                S3.buffer[k * COLS] = S3.buffer[k * COLS] - S3.tGo;
            }
        }

        // stash live results + raw buffer for the analysis engine
        App().state.liveCounts = { left: S3.count.l, right: S3.count.r };
        App().state.rawBuffer = { data: S3.buffer, n: S3.n, cols: COLS, tracked: CONFIG.tracked.map(m => m.key) };
        App().state.testMeta = {
            manual_stop: S3.manualStop,
            tab_hidden: S3.tabHidden,
            video_width_px: S3.dom.video.videoWidth,
            video_height_px: S3.dom.video.videoHeight,
            pose_delegate: S3.engine ? S3.engine.delegate : null,
            fps_ema: S3.engine ? S3.engine.fpsEMA : null
        };

        // stop the camera now (we have all frames)
        if (S3.engine) S3.engine.stop();

        // hand off to analysis + results (Phase 5/6). Defer so the overlay paints.
        setTimeout(() => {
            S3.phase = 'done';
            if (App().runAnalysisAndShowResults) {
                App().runAnalysisAndShowResults();
            } else {
                // Phase 4 standalone: show a quick summary until Phase 5/6 land.
                document.body.classList.remove('live');
                App().mount(App().el('section', { class: 'screen center' }, [
                    App().el('div', { class: 'logo', html: 'SIP<span class="slash">//</span>LAB' }),
                    App().el('div', { class: 'panel brackets' }, [
                        App().el('h3', { text: 'Test complete (live counts)' }),
                        App().el('div', { class: 'big-score' }, [
                            App().el('div', { class: 'big-number', text: String(S3.count.r) }),
                            App().el('div', { class: 'big-label', text: 'RIGHT KNEE LIFTS · LIVE' })
                        ]),
                        App().el('p', { html: `Left <b>${S3.count.l}</b> · Total <b>${S3.count.l + S3.count.r}</b> · ` +
                            `frames captured <b>${S3.n}</b>${S3.manualStop ? ' · <b>manual stop</b>' : ''}.` }),
                        App().el('p', { class: 'status', text: 'Offline analysis (authoritative counts, metrics, QC, norms) + results screen arrive in Phase 5–6.' }),
                        App().el('button', { class: 'btn', type: 'button', onclick: () => { LS.teardown(); App().renderS1(); } }, 'New participant')
                    ])
                ]));
            }
        }, 60);
    }

    // expose on LiveScreens
    LS.enterS3 = enterS3;
    LS._S3 = S3;
})(typeof window !== 'undefined' ? window : globalThis);
