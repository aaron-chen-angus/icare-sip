/**
 * SIP//LAB — Shared geometry helpers (Geom)
 *
 * Pure functions used by BOTH the live loop (pose-engine/app) and the offline
 * analysis (analysis.js), so counting behaviour is consistent. All pixel
 * quantities use x_px = x_norm * videoWidth, y_px = y_norm * videoHeight BEFORE
 * any distance or angle (aspect ratio matters). Image y is down.
 *
 * Frontal view (B2a): only the VERTICAL difference knee_y - hip_y is ever used
 * for lift progress — never the 2-D Euclidean thigh length.
 *
 * Exposes global `Geom`.
 */
(function (global) {
    'use strict';

    // Index helper into the packed 17*4 img Float32Array from the pose engine.
    const IDX = {};
    CONFIG.tracked.forEach((m, i) => { IDX[m.key] = i; });

    function lm(img, key) {
        const i = IDX[key] * 4;
        return { x: img[i], y: img[i + 1], z: img[i + 2], v: img[i + 3] };
    }
    function lmWorld(world, key) {
        if (!world) return null;
        const i = IDX[key] * 3;
        return { x: world[i], y: world[i + 1], z: world[i + 2] };
    }

    // pixel-space point for a key
    function px(img, key, vw, vh) {
        const p = lm(img, key);
        return { x: p.x * vw, y: p.y * vh, v: p.v };
    }

    const midX = (a, b) => (a.x + b.x) / 2;
    const midY = (a, b) => (a.y + b.y) / 2;
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    // hip reference y (pixels) for a side: same-side hip or hip midpoint
    function hipRefY(img, side, vw, vh, mode) {
        if (mode === 'mid') {
            const lh = px(img, 'l_hip', vw, vh), rh = px(img, 'r_hip', vw, vh);
            return (lh.y + rh.y) / 2;
        }
        return px(img, side === 'r' ? 'r_hip' : 'l_hip', vw, vh).y;
    }

    // vertical distance d = knee_y - hip_y (pixels), positive when knee below hip
    function dVert(img, side, vw, vh, mode) {
        const knee = px(img, side === 'r' ? 'r_kn' : 'l_kn', vw, vh);
        return knee.y - hipRefY(img, side, vw, vh, mode);
    }

    // lift progress p = 1 - d / S0 ; 0 standing, 1 knee at hip, >1 above hip
    function progress(img, side, S0, vw, vh, mode) {
        if (!S0 || S0 <= 0) return 0;
        return 1 - dVert(img, side, vw, vh, mode) / S0;
    }

    // visibility of knee & hip for a side
    function sideVisible(img, side, minVis) {
        const knee = lm(img, side === 'r' ? 'r_kn' : 'l_kn');
        const hip = lm(img, side === 'r' ? 'r_hip' : 'l_hip');
        return knee.v >= minVis && hip.v >= minVis;
    }

    // shoulder->hip->knee->ankle chain length (px) averaged over both sides
    function chainPx(img, vw, vh) {
        const chain = side => {
            const sh = px(img, side + '_sh', vw, vh);
            const hip = px(img, side + '_hip', vw, vh);
            const kn = px(img, side + '_kn', vw, vh);
            const an = px(img, side + '_an', vw, vh);
            return dist(sh, hip) + dist(hip, kn) + dist(kn, an);
        };
        return (chain('l') + chain('r')) / 2;
    }

    // shoulder width (px)
    function shoulderWidthPx(img, vw, vh) {
        return Math.abs(px(img, 'l_sh', vw, vh).x - px(img, 'r_sh', vw, vh).x);
    }

    // trunk length (px) = shoulder-mid to hip-mid
    function trunkLenPx(img, vw, vh) {
        const shm = { x: midX(px(img, 'l_sh', vw, vh), px(img, 'r_sh', vw, vh)), y: midY(px(img, 'l_sh', vw, vh), px(img, 'r_sh', vw, vh)) };
        const hpm = { x: midX(px(img, 'l_hip', vw, vh), px(img, 'r_hip', vw, vh)), y: midY(px(img, 'l_hip', vw, vh), px(img, 'r_hip', vw, vh)) };
        return dist(shm, hpm);
    }

    // frontalness = shoulder width / trunk length
    function frontalness(img, vw, vh) {
        const t = trunkLenPx(img, vw, vh);
        return t > 0 ? shoulderWidthPx(img, vw, vh) / t : 0;
    }

    // "facing the camera" test for the UN-MIRRORED frame:
    // participant's LEFT shoulder (l_sh) appears to image-RIGHT of the right
    // shoulder when they face the camera, i.e. l_sh.x > r_sh.x in normalised
    // coords. Combined with a frontalness (shoulder width / trunk length) floor.
    function facingCamera(img, vw, vh, minFrontalness) {
        const lsh = lm(img, 'l_sh'), rsh = lm(img, 'r_sh');
        const orderOk = lsh.x > rsh.x;
        const fr = frontalness(img, vw, vh);
        return { orderOk, frontalness: fr, ok: orderOk && fr >= minFrontalness };
    }

    // trunk lateral lean angle (deg): atan2(sh_mid.x - hip_mid.x, hip_mid.y - sh_mid.y)
    // positive = toward participant's left (image-right, un-mirrored)
    function trunkLeanDeg(img, vw, vh) {
        const shm = { x: midX(px(img, 'l_sh', vw, vh), px(img, 'r_sh', vw, vh)), y: midY(px(img, 'l_sh', vw, vh), px(img, 'r_sh', vw, vh)) };
        const hpm = { x: midX(px(img, 'l_hip', vw, vh), px(img, 'r_hip', vw, vh)), y: midY(px(img, 'l_hip', vw, vh), px(img, 'r_hip', vw, vh)) };
        return Math.atan2(shm.x - hpm.x, hpm.y - shm.y) * 180 / Math.PI;
    }

    // pelvis (hip-line) tilt (deg): atan2(l_hip.y - r_hip.y, l_hip.x - r_hip.x)
    function pelvisTiltDeg(img, vw, vh) {
        const lh = px(img, 'l_hip', vw, vh), rh = px(img, 'r_hip', vw, vh);
        return Math.atan2(lh.y - rh.y, lh.x - rh.x) * 180 / Math.PI;
    }
    // shoulder tilt (deg): same with shoulders
    function shoulderTiltDeg(img, vw, vh) {
        const ls = px(img, 'l_sh', vw, vh), rs = px(img, 'r_sh', vw, vh);
        return Math.atan2(ls.y - rs.y, ls.x - rs.x) * 180 / Math.PI;
    }

    // hip-mid position (normalised) — for camera-height check and sway
    function hipMidNorm(img) {
        const lh = lm(img, 'l_hip'), rh = lm(img, 'r_hip');
        return { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
    }

    // head-to-ankle vertical span as fraction of frame height (frame-fit/distance)
    function bodySpanNorm(img) {
        const nose = lm(img, 'nose');
        const lan = lm(img, 'l_an'), ran = lm(img, 'r_an');
        const footY = Math.max(lan.y, ran.y);
        return footY - nose.y;
    }

    // are both ankles & toes inside the normalised frame [0,1]?
    function feetInFrame(img) {
        const ks = ['l_an', 'r_an', 'l_heel', 'r_heel', 'l_toe', 'r_toe'];
        return ks.every(k => { const p = lm(img, k); return p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1; });
    }

    global.Geom = {
        IDX, lm, lmWorld, px, midX, midY, dist,
        hipRefY, dVert, progress, sideVisible,
        chainPx, shoulderWidthPx, trunkLenPx, frontalness, facingCamera,
        trunkLeanDeg, pelvisTiltDeg, shoulderTiltDeg, hipMidNorm, bodySpanNorm, feetInFrame
    };
    if (typeof module !== 'undefined') module.exports = global.Geom;
})(typeof window !== 'undefined' ? window : globalThis);
