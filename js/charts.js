/**
 * SIP//LAB — Dependency-free canvas charts (Charts)
 *
 * Each function takes a <canvas> and the analysis result and draws a TRON-styled
 * chart. Handles devicePixelRatio for crisp lines and redraws on resize via the
 * controller. Right = orange, Left = blue, labelled L/R.
 *
 * Exposes global `Charts`.
 */
(function (global) {
    'use strict';

    const BLUE = '#00d4ff', ORANGE = '#ff6a00', GREEN = '#4cdf7c', DIM = '#8fa6c8', GRID = 'rgba(0,212,255,0.12)';
    const FONT = "11px 'Rajdhani', sans-serif";
    const HFONT = "700 11px 'Orbitron', sans-serif";

    function setup(canvas) {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(200, rect.width || canvas.clientWidth || 320);
        const h = canvas.clientHeight || 210;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        return { ctx, w, h };
    }

    function axes(ctx, w, h, pad, opts) {
        opts = opts || {};
        ctx.strokeStyle = GRID; ctx.lineWidth = 1;
        ctx.strokeRect(pad.l, pad.t, w - pad.l - pad.r, h - pad.t - pad.b);
        ctx.fillStyle = DIM; ctx.font = FONT;
        if (opts.xlabel) { ctx.textAlign = 'center'; ctx.fillText(opts.xlabel, pad.l + (w - pad.l - pad.r) / 2, h - 4); }
        if (opts.ylabel) {
            ctx.save(); ctx.translate(10, pad.t + (h - pad.t - pad.b) / 2); ctx.rotate(-Math.PI / 2);
            ctx.textAlign = 'center'; ctx.fillText(opts.ylabel, 0, 0); ctx.restore();
        }
        if (opts.title) { ctx.fillStyle = DIM; ctx.font = HFONT; ctx.textAlign = 'left'; ctx.fillText(opts.title, pad.l, pad.t - 6); }
    }

    function legend(ctx, w, pad, items) {
        let x = pad.l + 2; const y = pad.t - 6;
        ctx.font = HFONT; ctx.textAlign = 'left';
        // draw right-aligned to avoid clashing with title
        let total = items.reduce((s, it) => s + ctx.measureText(it.label).width + 22, 0);
        x = w - pad.r - total;
        items.forEach(it => {
            ctx.fillStyle = it.color; ctx.fillRect(x, y - 8, 12, 8);
            ctx.fillStyle = DIM; ctx.fillText(it.label, x + 16, y);
            x += ctx.measureText(it.label).width + 22;
        });
    }

    // (1) knee-lift progress L vs R over time with threshold line + counted peaks
    function progressOverTime(canvas, res) {
        const { ctx, w, h } = setup(canvas);
        const pad = { l: 34, r: 10, t: 20, b: 22 };
        const N = res._N, grid = res._grid, pL = res._p.l, pR = res._p.r;
        const durationS = CONFIG.protocol.durationS;
        const countP = (App_() && App_().state.calibration && App_().state.calibration.threshold_p) || CONFIG.events.countP;
        const pMax = 1.6;
        const X = t => pad.l + (clamp(t, 0, durationS) / durationS) * (w - pad.l - pad.r);
        const Y = p => pad.t + (1 - clamp(p, 0, pMax) / pMax) * (h - pad.t - pad.b);
        axes(ctx, w, h, pad, { title: 'KNEE-LIFT PROGRESS', xlabel: 'time (s)' });
        legend(ctx, w, pad, [{ label: 'R', color: ORANGE }, { label: 'L', color: BLUE }]);

        // threshold + hip lines
        ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; line(ctx, pad.l, Y(1), w - pad.r, Y(1)); // hip level
        ctx.strokeStyle = GREEN; line(ctx, pad.l, Y(countP), w - pad.r, Y(countP)); // count threshold
        ctx.setLineDash([]);

        drawSeries(ctx, grid, pL, N, X, Y, BLUE, durationS);
        drawSeries(ctx, grid, pR, N, X, Y, ORANGE, durationS);

        // counted-peak markers
        res.steps.filter(s => s.counted).forEach(s => {
            const col = s.leg === 'right' ? ORANGE : BLUE;
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.arc(X(s.t_peak_s), Y(s.peak_progress), 2.5, 0, 6.2832); ctx.fill();
        });
    }
    function drawSeries(ctx, grid, arr, N, X, Y, color, durationS) {
        ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.beginPath();
        let started = false;
        for (let i = 0; i < N; i++) {
            if (grid[i] < 0 || grid[i] > durationS) continue;
            const x = X(grid[i]), y = Y(arr[i]);
            if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    // (2) steps per 30 s grouped bars (L/R)
    function stepsPerQuarter(canvas, res) {
        const { ctx, w, h } = setup(canvas);
        const pad = { l: 34, r: 10, t: 20, b: 22 };
        const s = res.summary;
        const R = [s.steps_right_q1, s.steps_right_q2, s.steps_right_q3, s.steps_right_q4];
        const L = [s.steps_left_q1, s.steps_left_q2, s.steps_left_q3, s.steps_left_q4];
        const maxV = Math.max(1, ...R, ...L);
        axes(ctx, w, h, pad, { title: 'STEPS PER 30 s', xlabel: 'quarter' });
        legend(ctx, w, pad, [{ label: 'R', color: ORANGE }, { label: 'L', color: BLUE }]);
        const plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b;
        const groupW = plotW / 4, barW = groupW * 0.3;
        for (let q = 0; q < 4; q++) {
            const gx = pad.l + q * groupW + groupW * 0.15;
            const rh = (R[q] / maxV) * plotH, lh = (L[q] / maxV) * plotH;
            ctx.fillStyle = BLUE; ctx.fillRect(gx, pad.t + plotH - lh, barW, lh);
            ctx.fillStyle = ORANGE; ctx.fillRect(gx + barW + 4, pad.t + plotH - rh, barW, rh);
            ctx.fillStyle = DIM; ctx.font = FONT; ctx.textAlign = 'center';
            ctx.fillText('Q' + (q + 1), gx + barW, h - 8);
        }
    }

    // (3) step interval per step with trend line
    function stepInterval(canvas, res) {
        const { ctx, w, h } = setup(canvas);
        const pad = { l: 34, r: 10, t: 20, b: 22 };
        const counted = res.steps.filter(s => s.counted).sort((a, b) => a.t_peak_s - b.t_peak_s);
        const pts = [];
        for (let i = 1; i < counted.length; i++) pts.push(counted[i].t_peak_s - counted[i - 1].t_peak_s);
        axes(ctx, w, h, pad, { title: 'STEP INTERVAL', xlabel: 'step #', ylabel: 's' });
        if (!pts.length) { emptyNote(ctx, w, h); return; }
        const maxV = Math.max(...pts) * 1.1, minV = 0;
        const X = i => pad.l + (pts.length <= 1 ? 0.5 : i / (pts.length - 1)) * (w - pad.l - pad.r);
        const Y = v => pad.t + (1 - (v - minV) / (maxV - minV || 1)) * (h - pad.t - pad.b);
        ctx.strokeStyle = ORANGE; ctx.lineWidth = 1.4; ctx.beginPath();
        pts.forEach((v, i) => { const x = X(i), y = Y(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); ctx.fillStyle = ORANGE; ctx.fillRect(x - 1.5, y - 1.5, 3, 3); });
        ctx.stroke();
        // trend
        const slope = ols(pts), m0 = mean(pts);
        if (slope != null) {
            const mx = (pts.length - 1) / 2;
            ctx.strokeStyle = GREEN; ctx.setLineDash([5, 4]); ctx.beginPath();
            ctx.moveTo(X(0), Y(m0 + slope * (0 - mx)));
            ctx.lineTo(X(pts.length - 1), Y(m0 + slope * (pts.length - 1 - mx)));
            ctx.stroke(); ctx.setLineDash([]);
        }
    }

    // (4) lateral sway (hip-mid x vs time) + trunk lean
    function swayTrunk(canvas, res) {
        const { ctx, w, h } = setup(canvas);
        const pad = { l: 36, r: 10, t: 20, b: 22 };
        const frames = res.frames;
        const durationS = CONFIG.protocol.durationS;
        const xs = frames.filter(f => f.t_s >= 0 && f.t_s <= durationS);
        axes(ctx, w, h, pad, { title: 'SWAY & TRUNK LEAN', xlabel: 'time (s)' });
        legend(ctx, w, pad, [{ label: 'SWAY cm', color: BLUE }, { label: 'LEAN °', color: ORANGE }]);
        if (!xs.length) { emptyNote(ctx, w, h); return; }
        const sway = xs.map(f => f.hip_mid_x_cm || 0), lean = xs.map(f => f.trunk_lean_deg || 0);
        const sr = niceRange(sway), lr = niceRange(lean);
        const X = t => pad.l + (t / durationS) * (w - pad.l - pad.r);
        const Ys = v => pad.t + (1 - (v - sr.lo) / (sr.hi - sr.lo || 1)) * (h - pad.t - pad.b);
        const Yl = v => pad.t + (1 - (v - lr.lo) / (lr.hi - lr.lo || 1)) * (h - pad.t - pad.b);
        plot(ctx, xs, X, Ys, f => f.hip_mid_x_cm || 0, BLUE);
        plot(ctx, xs, X, Yl, f => f.trunk_lean_deg || 0, ORANGE);
    }

    // (5) optional lift height per step
    function liftHeight(canvas, res) {
        const { ctx, w, h } = setup(canvas);
        const pad = { l: 36, r: 10, t: 20, b: 22 };
        const counted = res.steps.filter(s => s.counted).sort((a, b) => a.t_peak_s - b.t_peak_s);
        axes(ctx, w, h, pad, { title: 'LIFT HEIGHT PER STEP', xlabel: 'step #', ylabel: 'cm' });
        if (!counted.length) { emptyNote(ctx, w, h); return; }
        const vals = counted.map(s => s.knee_rise_cm || 0);
        const maxV = Math.max(...vals) * 1.1 || 1;
        const bw = (w - pad.l - pad.r) / counted.length;
        counted.forEach((s, i) => {
            const bh = (s.knee_rise_cm / maxV) * (h - pad.t - pad.b);
            ctx.fillStyle = s.leg === 'right' ? ORANGE : BLUE;
            ctx.fillRect(pad.l + i * bw + 1, pad.t + (h - pad.t - pad.b) - bh, Math.max(1, bw - 2), bh);
        });
    }

    // ---- helpers ----
    function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
    function plot(ctx, arr, X, Y, acc, color) {
        ctx.strokeStyle = color; ctx.lineWidth = 1.3; ctx.beginPath();
        arr.forEach((f, i) => { const x = X(f.t_s), y = Y(acc(f)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke();
    }
    function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
    function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
    function ols(y) {
        const n = y.length; if (n < 2) return null;
        let sx = 0, sy = 0, sxx = 0, sxy = 0;
        for (let i = 0; i < n; i++) { sx += i; sy += y[i]; sxx += i * i; sxy += i * y[i]; }
        const d = n * sxx - sx * sx; return d === 0 ? null : (n * sxy - sx * sy) / d;
    }
    function niceRange(a) {
        if (!a.length) return { lo: -1, hi: 1 };
        let lo = Math.min(...a), hi = Math.max(...a);
        if (lo === hi) { lo -= 1; hi += 1; }
        const pad = (hi - lo) * 0.1; return { lo: lo - pad, hi: hi + pad };
    }
    function emptyNote(ctx, w, h) { ctx.fillStyle = DIM; ctx.font = FONT; ctx.textAlign = 'center'; ctx.fillText('No counted steps', w / 2, h / 2); }
    function App_() { return global.App; }

    global.Charts = {
        progressOverTime, stepsPerQuarter, stepInterval, swayTrunk, liftHeight
    };
})(typeof window !== 'undefined' ? window : globalThis);
