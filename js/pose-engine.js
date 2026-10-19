/**
 * SIP//LAB — Pose engine (PoseEngine)
 *
 * MediaPipe Pose Landmarker (browser, on-device), camera, per-frame capture and
 * the skeleton/overlay drawing. Mirrors the STS architecture and pinned versions
 * (CONFIG.pose.*). Emits frames in the exact layout the analysis expects:
 *   { tMs, img: Float32Array(17*4) [x,y,z,visibility], world: Float32Array(17*3)|null [m] }
 *
 * Frontal-view conventions (B2a):
 *  - All geometry runs on the UN-MIRRORED camera frame. Mirroring is display-only.
 *  - Right leg = orange, Left leg = blue; labels always refer to the participant's
 *    ANATOMICAL side (we swap nothing in the data; only the on-screen text/mirror).
 *  - Image y is down; vertical outputs are reported positive-up by the analysis.
 *
 * Exposes global `PoseEngine`.
 */
(function (global) {
    'use strict';

    const TRACKED = CONFIG.tracked;
    const byKey = {}; TRACKED.forEach(m => { byKey[m.key] = m; });

    // skeleton connections (torso, shoulders, hip line, both legs; arms thin)
    const CONN = [
        ['l_sh', 'r_sh'], ['l_sh', 'l_el'], ['l_el', 'l_wr'], ['r_sh', 'r_el'], ['r_el', 'r_wr'],
        ['l_sh', 'l_hip'], ['r_sh', 'r_hip'], ['l_hip', 'r_hip'],
        ['l_hip', 'l_kn'], ['l_kn', 'l_an'], ['r_hip', 'r_kn'], ['r_kn', 'r_an'],
        ['l_an', 'l_heel'], ['l_heel', 'l_toe'], ['l_an', 'l_toe'],
        ['r_an', 'r_heel'], ['r_heel', 'r_toe'], ['r_an', 'r_toe']
    ];
    const ARM_CONN = new Set(['l_sh|l_el', 'l_el|l_wr', 'r_sh|r_el', 'r_el|r_wr']);

    const BLUE = '0,212,255';     // left
    const ORANGE = '255,106,0';   // right

    function PoseEngine() {
        this.landmarker = null;
        this.video = null; this.canvas = null; this.ctx = null;
        this.running = false;
        this.onFrame = null;            // (frame, tMs) => void  (called every frame)
        this.delegate = null; this.model = null;
        this.mirror = false;            // display-only mirroring (front camera)
        this.showLabels = true; this.showAll = false;
        // overlay payload set by the controller each frame:
        //   { lines:[{yNorm,label,color,dashed}], gauges:{l:0..1, r:0..1, countP}, diag:{...}, flash:{l,r} }
        this.overlay = null;
        this._lastTs = 0; this._rvfc = false; this._lastVT = -1;
        this.lastFull = null;
        this.fpsEMA = 0; this._lastFrameWall = 0;
        this.stream = null;
    }

    PoseEngine.prototype.initialize = async function (modelKey, onStatus) {
        const say = m => onStatus && onStatus(m);
        if (this.landmarker && this.model === modelKey) return true;
        say('Loading pose model…');
        const mod = await import(CONFIG.pose.bundleUrl);
        const { PoseLandmarker, FilesetResolver } = mod;
        const fileset = await FilesetResolver.forVisionTasks(CONFIG.pose.wasmUrl);
        const opts = delegate => ({
            baseOptions: { modelAssetPath: CONFIG.pose.models[modelKey], delegate },
            runningMode: 'VIDEO', numPoses: CONFIG.pose.numPoses,
            minPoseDetectionConfidence: CONFIG.pose.detectionConfidence,
            minPosePresenceConfidence: CONFIG.pose.presenceConfidence,
            minTrackingConfidence: CONFIG.pose.trackingConfidence
        });
        try {
            this.landmarker = await PoseLandmarker.createFromOptions(fileset, opts('GPU'));
            this.delegate = 'GPU';
        } catch (e) {
            console.warn('GPU delegate failed, using CPU', e);
            this.landmarker = await PoseLandmarker.createFromOptions(fileset, opts('CPU'));
            this.delegate = 'CPU';
        }
        this.model = modelKey;
        say('Pose model ready (' + modelKey + ', ' + this.delegate + ')');
        return true;
    };

    PoseEngine.prototype.startCamera = async function (video, canvas, facing) {
        this.video = video; this.canvas = canvas; this.ctx = canvas.getContext('2d');
        const portrait = window.innerHeight >= window.innerWidth;
        const videoConstraints = {
            facingMode: facing,
            width: { ideal: portrait ? 720 : 1280 },
            height: { ideal: portrait ? 1280 : 720 },
            frameRate: { ideal: 30 }
        };
        if (portrait) videoConstraints.aspectRatio = { ideal: 9 / 16 };
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
        } catch (e) {
            // Some devices reject the aspectRatio hint — retry without it before giving up.
            delete videoConstraints.aspectRatio;
            stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
        }
        this.stream = stream;
        video.srcObject = stream;
        await new Promise(res => { video.onloadedmetadata = () => { video.play(); res(); }; });
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        this.mirror = facing === 'user';   // only the selfie camera is mirrored for display
        this.running = true; this._lastTs = 0;
        this._rvfc = typeof video.requestVideoFrameCallback === 'function';
        this._schedule();
        return { width: video.videoWidth, height: video.videoHeight, mirror: this.mirror };
    };

    PoseEngine.prototype.stop = function () {
        this.running = false;
        if (this.stream) this.stream.getTracks().forEach(t => t.stop());
        this.stream = null;
        if (this.video) this.video.srcObject = null;
    };

    PoseEngine.prototype._schedule = function () {
        if (!this.running) return;
        if (this._rvfc) this.video.requestVideoFrameCallback((now, meta) => this._tick(meta));
        else requestAnimationFrame(() => this._tick(null));
    };

    PoseEngine.prototype._tick = function (meta) {
        if (!this.running) return;
        const v = this.video;
        if (!this._rvfc && v.currentTime === this._lastVT) { this._schedule(); return; }
        this._lastVT = v.currentTime;
        if (v.readyState < 2) { this._schedule(); return; }
        // skip heavy work when the tab is hidden (flagged elsewhere as TAB_HIDDEN)
        if (document.hidden) { this._schedule(); return; }

        let tMs = meta
            ? (meta.captureTime != null ? meta.captureTime
                : (meta.presentationTime != null ? meta.presentationTime : performance.now()))
            : performance.now();
        if (tMs <= this._lastTs) tMs = this._lastTs + 1;
        this._lastTs = tMs;

        const wall = performance.now();
        if (this._lastFrameWall) {
            const f = 1000 / Math.max(1, wall - this._lastFrameWall);
            this.fpsEMA = this.fpsEMA ? 0.9 * this.fpsEMA + 0.1 * f : f;
        }
        this._lastFrameWall = wall;

        let res = null;
        try { res = this.landmarker.detectForVideo(v, tMs); }
        catch (e) { console.warn('detect error', e); }

        let frame = null, full = null;
        if (res && res.landmarks && res.landmarks.length) {
            full = res.landmarks[0];
            const wl = res.worldLandmarks && res.worldLandmarks[0];
            const img = new Float32Array(TRACKED.length * 4);
            const world = new Float32Array(TRACKED.length * 3);
            TRACKED.forEach((m, i) => {
                const l = full[m.idx];
                img[i * 4] = l.x; img[i * 4 + 1] = l.y; img[i * 4 + 2] = l.z;
                img[i * 4 + 3] = l.visibility == null ? 0 : l.visibility;
                if (wl) { const w = wl[m.idx]; world[i * 3] = w.x; world[i * 3 + 1] = w.y; world[i * 3 + 2] = w.z; }
            });
            frame = { tMs, img, world: wl ? world : null };
        }
        this.lastFull = full;
        this.draw(full);
        if (this.onFrame) { try { this.onFrame(frame, tMs); } catch (e) { console.error(e); } }
        this._schedule();
    };

    // ------------------------------------------------------------ overlay text
    PoseEngine.prototype._text = function (str, x, y, color, size) {
        const c = this.ctx;
        c.save();
        c.font = '700 ' + size + 'px Orbitron, -apple-system, Segoe UI, sans-serif';
        c.textBaseline = 'middle';
        c.translate(x, y);
        if (this.mirror) c.scale(-1, 1);   // keep text readable when the view is mirrored
        c.lineWidth = 4; c.strokeStyle = 'rgba(0,0,0,0.75)'; c.strokeText(str, 0, 0);
        c.fillStyle = color; c.fillText(str, 0, 0);
        c.restore();
    };

    // ------------------------------------------------------------ main draw
    PoseEngine.prototype.draw = function (lm) {
        const c = this.ctx, w = this.canvas.width, h = this.canvas.height;
        if (!c) return;
        c.clearRect(0, 0, w, h);
        const base = Math.max(w, h) / 1000;

        // reference lines (hip-level line + per-knee target lines + S2 image-centre)
        if (this.overlay && this.overlay.lines) {
            c.save();
            for (const L of this.overlay.lines) {
                c.strokeStyle = L.color;
                c.lineWidth = (L.width || 2) * base;
                if (L.dashed) c.setLineDash([14 * base, 10 * base]); else c.setLineDash([]);
                const y = L.yNorm * h;
                c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
                if (L.label) this._text(L.label, w * (this.mirror ? 0.97 : 0.03), y - 14 * base, L.color, 18 * base);
            }
            c.restore();
        }

        if (lm) this._drawSkeleton(lm, w, h, base);

        // S2 hip-mid marker + image-centre dot already drawn via lines; draw hip-mid x crosshair
        if (this.overlay && this.overlay.hipMid) {
            const hm = this.overlay.hipMid; // {xNorm,yNorm}
            c.save();
            c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 2 * base;
            c.beginPath(); c.arc(hm.xNorm * w, hm.yNorm * h, 6 * base, 0, 6.2832); c.stroke();
            c.restore();
        }
    };

    PoseEngine.prototype._drawSkeleton = function (lm, w, h, base) {
        const c = this.ctx;
        const vis = i => (lm[i] && lm[i].visibility != null) ? lm[i].visibility : 0;
        const flash = (this.overlay && this.overlay.flash) || {};

        // connections
        c.lineCap = 'round';
        for (const [a, b] of CONN) {
            const A = lm[byKey[a].idx], B = lm[byKey[b].idx];
            if (!A || !B) continue;
            const side = a[0] === 'r' || b[0] === 'r' ? ORANGE : (a[0] === 'l' || b[0] === 'l' ? BLUE : '160,168,192');
            const vmin = Math.min(A.visibility || 0, B.visibility || 0);
            const isArm = ARM_CONN.has(a + '|' + b);
            c.strokeStyle = 'rgba(' + side + ',' + (vmin > CONFIG.signal.minVisibility ? 0.95 : 0.3) + ')';
            c.lineWidth = (isArm ? 2.5 : 5) * base;
            c.beginPath(); c.moveTo(A.x * w, A.y * h); c.lineTo(B.x * w, B.y * h); c.stroke();
        }

        // optional: all 33 faint
        if (this.showAll) {
            c.fillStyle = 'rgba(255,255,255,0.3)';
            for (const l of lm) { c.beginPath(); c.arc(l.x * w, l.y * h, 2.4 * base, 0, 6.2832); c.fill(); }
        }

        // tracked landmarks
        for (const m of TRACKED) {
            const l = lm[m.idx]; if (!l) continue;
            const good = (l.visibility || 0) >= CONFIG.signal.minVisibility;
            const isR = m.key[0] === 'r';
            const isL = m.key[0] === 'l';
            const col = isR ? ORANGE : (isL ? BLUE : '223,233,255');
            const isKnee = m.key === 'r_kn' || m.key === 'l_kn';
            const glow = isKnee && ((m.key === 'r_kn' && flash.r) || (m.key === 'l_kn' && flash.l));
            const r = (isKnee ? 9 : 6) * base;
            c.beginPath(); c.arc(l.x * w, l.y * h, r, 0, 6.2832);
            if (good) {
                c.fillStyle = glow ? 'rgba(76,223,124,0.95)' : 'rgba(' + col + ',0.95)';
                c.fill();
                c.strokeStyle = glow ? '#4cdf7c' : '#fff';
                c.lineWidth = (glow ? 3 : 2) * base; c.stroke();
                if (glow) { c.shadowColor = '#4cdf7c'; c.shadowBlur = 20 * base; c.stroke(); c.shadowBlur = 0; }
            } else {
                // hollow yellow = below visibility threshold
                c.strokeStyle = 'rgba(255,200,0,0.9)'; c.lineWidth = 3 * base; c.stroke();
            }
            if (this.showLabels && isKnee) {
                const label = (isR ? 'R' : 'L') + ' ' + Math.round((l.visibility || 0) * 100);
                this._text(label, l.x * w + 14 * base * (this.mirror ? -1 : 1), l.y * h, good ? '#fff' : '#ffc800', 15 * base);
            }
        }
    };

    global.PoseEngine = PoseEngine;
})(typeof window !== 'undefined' ? window : globalThis);
