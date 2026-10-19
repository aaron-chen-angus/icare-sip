/**
 * SIP//LAB — UI controller / screens (App)
 *
 * Screen router + shared state + reusable helpers. Screens are rendered into
 * <main id="app">. S1 built in Phase 1; S2–S5 added in later phases.
 *
 * Exposes global `App`.
 */
(function (global) {
    'use strict';

    // ---- tiny DOM helpers ----------------------------------------------------
    const $ = sel => document.querySelector(sel);
    const el = (tag, attrs = {}, kids = []) => {
        const n = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (v == null) continue;
            if (k === 'class') n.className = v;
            else if (k === 'html') n.innerHTML = v;
            else if (k === 'text') n.textContent = v;
            else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
            else if (k === 'dataset') Object.assign(n.dataset, v);
            else n.setAttribute(k, v);
        }
        (Array.isArray(kids) ? kids : [kids]).forEach(c => {
            if (c == null) return;
            n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return n;
    };
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // ---- shared session state ------------------------------------------------
    const state = {
        screen: null,
        lang: null,                 // 'en' | 'zh' | 'yue'
        participant: null,          // validated form payload
        calibration: null,          // set in S2
        rawBuffer: null,            // set in S3
        liveCounts: null,           // { left, right } from S3
        results: null,              // { summary, steps, frames } from analysis
        attemptNumber: 1,
        previousSessionId: null,
        previousResult: null        // prior attempt summary for keep/use flow
    };

    const LANGS = {
        en:  { label: 'ENGLISH',             sub: '',             ytid: 'TdGhSFC_xA4' },
        zh:  { label: '中文',                 sub: 'MANDARIN',     ytid: 'sSwqgRn8PQk' },
        yue: { label: '廣東話',               sub: 'CANTONESE',    ytid: 'l8sWujIbgtU' }
    };

    // ---- setup diagram (inline SVG, TRON) ------------------------------------
    function setupDiagramSVG() {
        // phone on a stand at hip height, level, 2.5–3 m, participant facing it
        return `
<svg viewBox="0 0 400 200" role="img" aria-label="Setup: phone on a stand at hip height, level, 2.5 to 3 metres in front of the participant who faces it">
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" fill="#00d4ff"/>
    </marker>
  </defs>
  <!-- floor -->
  <line x1="10" y1="170" x2="390" y2="170" stroke="#0a2a3a" stroke-width="2"/>
  <!-- phone + stand (left) -->
  <line x1="60" y1="170" x2="60" y2="120" stroke="#8fa6c8" stroke-width="2"/>
  <rect x="48" y="86" width="24" height="42" rx="3" fill="none" stroke="#ff6a00" stroke-width="2"/>
  <circle cx="60" cy="118" r="1.6" fill="#ff6a00"/>
  <text x="60" y="78" fill="#ff6a00" font-family="Orbitron,sans-serif" font-size="9" text-anchor="middle">PHONE</text>
  <!-- level indicator -->
  <line x1="44" y1="107" x2="76" y2="107" stroke="#4cdf7c" stroke-width="1.5" stroke-dasharray="3 2"/>
  <!-- hip-height dashed line -->
  <line x1="60" y1="118" x2="320" y2="118" stroke="#00d4ff" stroke-width="1" stroke-dasharray="5 4" opacity="0.7"/>
  <text x="190" y="112" fill="#00d4ff" font-family="Rajdhani,sans-serif" font-size="9" text-anchor="middle">HIP HEIGHT · LEVEL</text>
  <!-- distance arrow -->
  <line x1="60" y1="185" x2="320" y2="185" stroke="#00d4ff" stroke-width="1" marker-start="url(#arr)" marker-end="url(#arr)"/>
  <text x="190" y="198" fill="#8fa6c8" font-family="Rajdhani,sans-serif" font-size="9" text-anchor="middle">2.5 – 3 m</text>
  <!-- participant facing the phone (right) -->
  <g stroke="#dfe9ff" stroke-width="2.5" fill="none" stroke-linecap="round">
    <circle cx="320" cy="60" r="10"/>
    <line x1="320" y1="70" x2="320" y2="120"/>
    <line x1="320" y1="84" x2="304" y2="100"/>
    <line x1="320" y1="84" x2="336" y2="100"/>
    <line x1="320" y1="120" x2="308" y2="150"/>
    <line x1="320" y1="120" x2="332" y2="150"/>
    <!-- raised knee hint -->
    <line x1="332" y1="150" x2="330" y2="134" stroke="#ff6a00"/>
  </g>
  <text x="320" y="166" fill="#dfe9ff" font-family="Rajdhani,sans-serif" font-size="9" text-anchor="middle">FACE THE PHONE</text>
</svg>`;
    }

    // ---- screen mount --------------------------------------------------------
    function mount(node) {
        const app = $('#app');
        app.innerHTML = '';
        app.appendChild(node);
        app.scrollTop = 0;
        window.scrollTo(0, 0);
    }

    // =========================================================================
    // S1 — ENTRY (instructions + video + participant form)
    // =========================================================================
    function renderS1() {
        state.screen = 'S1';
        document.body.classList.remove('live', 'landscape-warn');

        const screen = el('section', { class: 'screen' });

        // header
        screen.appendChild(el('div', { class: 'center' }, [
            el('div', { class: 'logo', html: 'SIP<span class="slash">//</span>LAB' }),
            el('div', { class: 'subtitle', text: '2-Minute Step in Place · Computer Vision' })
        ]));

        // clinical disclaimer
        screen.appendChild(el('div', { class: 'note', html:
            '<b>Not a medical device.</b> For research and education only. Results do not constitute a medical diagnosis. Ensure the participant is fit and supervised.' }));

        // instructions panel with setup diagram
        const instr = el('div', { class: 'panel brackets' });
        instr.appendChild(el('h3', { text: 'Setup & instructions' }));
        instr.appendChild(el('div', { class: 'setup-diagram', html: setupDiagramSVG() }));
        const ol = el('ol', { class: 'instructions' });
        [
            'Place the phone on a stand <b>directly in front</b> of the participant, at <b>hip height</b> and <b>level</b>, 2.5–3 m away.',
            'Fit the <b>whole body including both feet</b> in frame. The participant <b>faces the phone</b>.',
            'Stand still for a short <b>calibration</b> (arms relaxed).',
            'March in place for <b>2 minutes</b>, lifting each knee to about <b>hip height</b>.',
            'Resting and holding a wall or stable chair are allowed. Keep going until the timer ends.'
        ].forEach(t => ol.appendChild(el('li', { html: t })));
        instr.appendChild(ol);
        screen.appendChild(instr);

        // language + video panel
        screen.appendChild(renderLangVideo());

        // participant form
        screen.appendChild(renderForm());

        // PROCEED lives at the BOTTOM, after the form (hidden until a language is chosen).
        // "Cannot do test" is a SEPARATE action, visually distinct, never part of the checklist.
        const proceedWrap = el('div', { id: 'proceed-wrap', style: 'display:none;margin-top:4px' }, [
            el('button', {
                class: 'btn btn-primary btn-large', type: 'button', id: 'proceed-btn',
                onclick: onProceed
            }, 'Proceed to Test →'),
            el('button', {
                class: 'btn btn-danger', type: 'button', id: 'cannot-btn',
                style: 'width:100%;margin-top:10px', onclick: onCannotDoTest
            }, 'Cannot do test (record 0)')
        ]);
        screen.appendChild(proceedWrap);

        // known-limits footer
        screen.appendChild(el('div', { class: 'footer-limits', html:
            'Frontal view · knee height vs hip height · right knee = official score. ' +
            'No depth angles. Camera height/tilt affects apparent knee height — see on-screen checks. Not a medical device.' }));

        mount(screen);
        // if a language was already chosen this session, reflect it
        if (state.lang) revealProceed();
    }

    function renderLangVideo() {
        const panel = el('div', { class: 'panel' });
        panel.appendChild(el('h3', { text: 'Choose a language to watch the demo' }));
        panel.appendChild(el('p', { text: 'Pick a language. The demo video appears, then the PROCEED button shows below it.' }));

        const grid = el('div', { class: 'lang-grid' });
        Object.entries(LANGS).forEach(([key, L]) => {
            grid.appendChild(el('button', {
                class: 'btn lang-btn', type: 'button', 'data-lang': key,
                onclick: () => selectLang(key)
            }, [
                el('span', { text: L.label }),
                L.sub ? el('span', { class: 'sub', text: L.sub }) : null
            ]));
        });
        panel.appendChild(grid);

        // video container (iframe inserted on selection; single iframe, swap src)
        const vwrap = el('div', { class: 'video-panel', id: 'video-panel', style: 'display:none' });
        panel.appendChild(vwrap);

        return panel;
    }

    function selectLang(key) {
        state.lang = key;
        const L = LANGS[key];
        document.querySelectorAll('.lang-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.lang === key));

        const vwrap = $('#video-panel');
        vwrap.style.display = 'flex';
        vwrap.innerHTML = '';

        const frame = el('div', { class: 'video-frame' });
        const iframe = el('iframe', {
            id: 'yt-iframe',
            src: `https://www.youtube.com/embed/${L.ytid}?playsinline=1&rel=0&modestbranding=1`,
            title: 'Step-in-place demonstration',
            allow: 'accelerometer; autoplay; encrypted-media; picture-in-picture',
            allowfullscreen: '', loading: 'lazy'
        });
        frame.appendChild(iframe);
        vwrap.appendChild(frame);

        vwrap.appendChild(el('a', {
            class: 'yt-fallback', target: '_blank', rel: 'noopener',
            href: `https://youtube.com/shorts/${L.ytid}`, text: 'Open on YouTube ↗'
        }));

        // compact language switcher
        const switcher = el('div', { class: 'lang-switch' });
        Object.entries(LANGS).forEach(([k, LL]) => {
            switcher.appendChild(el('button', {
                class: 'btn btn-small' + (k === key ? ' active' : ''), type: 'button',
                text: LL.sub || LL.label, onclick: () => selectLang(k)
            }));
        });
        vwrap.appendChild(switcher);

        // reveal the PROCEED button that lives below the form
        revealProceed();
    }

    function revealProceed() {
        const w = document.getElementById('proceed-wrap');
        if (w) w.style.display = '';
    }

    // ---- participant form ----------------------------------------------------
    function renderForm() {
        const panel = el('div', { class: 'panel brackets' });
        panel.appendChild(el('h3', { text: 'Participant' }));

        const form = el('form', { class: 'form', id: 'participant-form', onsubmit: e => e.preventDefault() });
        const sheetsConfigured = !!(CONFIG.sheets && CONFIG.sheets.webhookUrl);

        form.innerHTML = `
            <div class="fg">
                <label for="pid">Participant ID</label>
                <input id="pid" name="pid" type="text" inputmode="text" autocomplete="off" placeholder="e.g. P001 (no names)">
                <div class="err" id="err-pid"></div>
            </div>
            <div class="grid2">
                <div class="fg">
                    <label for="age">Age (years)</label>
                    <input id="age" name="age" type="number" inputmode="numeric" min="18" max="120" placeholder="60">
                    <div class="err" id="err-age"></div>
                </div>
                <div class="fg">
                    <label for="sex">Sex</label>
                    <select id="sex" name="sex">
                        <option value="">Select…</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                    </select>
                    <div class="err" id="err-sex"></div>
                </div>
            </div>
            <div class="grid2">
                <div class="fg">
                    <label for="height">Height (cm)</label>
                    <input id="height" name="height" type="number" inputmode="decimal" min="120" max="210" placeholder="165">
                    <div class="hint">Required — drives the scale.</div>
                    <div class="err" id="err-height"></div>
                </div>
                <div class="fg">
                    <label for="mass">Body mass (kg)</label>
                    <input id="mass" name="mass" type="number" inputmode="decimal" min="20" max="300" placeholder="optional">
                </div>
            </div>
            <div class="fg">
                <label for="site">Site / session label</label>
                <input id="site" name="site" type="text" autocomplete="off" placeholder="optional">
            </div>
            <div class="fg">
                <label for="notes">Operator notes</label>
                <textarea id="notes" name="notes" rows="2" placeholder="optional"></textarea>
            </div>
            <div class="grid2">
                <div class="fg">
                    <label for="facing">Camera</label>
                    <select id="facing" name="facing">
                        <option value="environment">Rear (default)</option>
                        <option value="user">Front</option>
                    </select>
                </div>
                <div class="fg">
                    <label for="model">Pose model</label>
                    <select id="model" name="model">
                        <option value="lite">Lite (fastest)</option>
                        <option value="full" selected>Full (default)</option>
                        <option value="heavy">Heavy (most accurate)</option>
                    </select>
                </div>
            </div>
            <div class="grid2">
                <div class="fg">
                    <label for="camh">Camera height (cm)</label>
                    <input id="camh" name="camh" type="number" inputmode="decimal" min="30" max="200" placeholder="optional covariate">
                </div>
                <div class="fg">
                    <label for="preset">Count threshold</label>
                    <select id="preset" name="preset">
                        <option value="hip_level" selected>Hip level (default)</option>
                        <option value="official_midpoint">Official midpoint</option>
                    </select>
                </div>
            </div>
            <label class="check"><input type="checkbox" id="c-safety"> <span>Safety: participant is fit for the test and supervised.</span></label>
            <label class="check"><input type="checkbox" id="c-briefed"> <span>Protocol briefed: marching, knee height, rest allowed.</span></label>
            <label class="check check-covariate"><input type="checkbox" id="c-support"> <span>Support used (wall/chair) — optional covariate, not penalised.</span></label>
            ${sheetsConfigured ? '<div class="note info" style="margin-top:4px">Results are uploaded to Google Sheets automatically when the test completes.</div>' : ''}
            <div class="err" id="err-checks"></div>
            <details class="more-info">
                <summary>Privacy & limits</summary>
                <p>Pseudonymous IDs only — no names. No video or raw landmarks leave the device; only numeric results are uploaded, and only with consent. Frontal view has known limits: no flexion angles or forward lean, and camera height/tilt can bias apparent knee height (on-screen checks mitigate this).</p>
            </details>
        `;
        panel.appendChild(form);
        return panel;
    }

    // ---- validation + proceed ------------------------------------------------
    function readForm() {
        const g = id => { const n = document.getElementById(id); return n ? n.value.trim() : ''; };
        const c = id => { const n = document.getElementById(id); return n ? n.checked : false; };
        return {
            participant_id: g('pid'),
            age_years: g('age'),
            sex: g('sex'),
            height_cm: g('height'),
            body_mass_kg: g('mass'),
            site: g('site'),
            operator_notes: g('notes'),
            camera_facing: g('facing') || CONFIG.camera.defaultFacing,
            pose_model: g('model') || CONFIG.pose.defaultModel,
            camera_height_cm: g('camh'),
            count_threshold_preset: g('preset') || 'hip_level',
            safety: c('c-safety'),
            protocol_briefed: c('c-briefed'),
            support_used: c('c-support'),
            unable_to_perform: false,   // set only via the separate "Cannot do test" button
            consent_upload: true        // upload is automatic (no consent gate)
        };
    }

    function clearErrors() {
        ['pid', 'age', 'sex', 'height', 'checks'].forEach(k => {
            const n = document.getElementById('err-' + k); if (n) n.textContent = '';
        });
    }

    function validate(v) {
        clearErrors();
        let ok = true;
        const setErr = (k, msg) => { const n = document.getElementById('err-' + k); if (n) n.textContent = msg; ok = false; };

        if (!v.participant_id) setErr('pid', 'Participant ID is required.');

        // "Unable to perform" short-circuits most validation
        if (v.unable_to_perform) {
            if (!v.safety) setErr('checks', 'Tick Safety to continue.');
            return ok;
        }

        const age = Number(v.age_years);
        if (!v.age_years || !Number.isFinite(age) || age < 18 || age > 120)
            setErr('age', 'Age must be 18–120 (norms apply 60–94).');

        if (!v.sex) setErr('sex', 'Select a sex.');

        const h = Number(v.height_cm);
        const [hmin, hmax] = CONFIG.calibration.heightRangeCm;
        if (!v.height_cm || !Number.isFinite(h) || h < hmin || h > hmax)
            setErr('height', `Height must be ${hmin}–${hmax} cm.`);

        if (!v.safety || !v.protocol_briefed)
            setErr('checks', 'Tick Safety and Protocol briefed to continue.');

        return ok;
    }

    function onProceed() {
        const v = readForm();
        if (!validate(v)) {
            const firstErr = document.querySelector('.err:not(:empty)');
            if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        state.participant = v;
        App.toS2(v);
    }

    // Separate, deliberate action — only an ID is required, then a confirmation.
    function onCannotDoTest() {
        const v = readForm();
        clearErrors();
        if (!v.participant_id) {
            const n = document.getElementById('err-pid');
            if (n) { n.textContent = 'Participant ID is required.'; n.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
            return;
        }
        v.unable_to_perform = true;
        modal({
            title: 'Cannot do test?',
            body: `Record <b>0 steps</b> for <b>${esc(v.participant_id)}</b> and skip the camera?`,
            buttons: [
                { label: 'Cancel', class: 'btn', onClick: c => c() },
                { label: 'Record 0', class: 'btn btn-danger', onClick: c => { c(); state.participant = v; App.toUnableResult(v); } }
            ]
        });
    }

    // ---- orientation handling ------------------------------------------------
    function updateOrientation() {
        const landscape = window.matchMedia('(orientation: landscape)').matches && window.innerHeight < 500;
        const running = state.screen === 'S3' && document.body.classList.contains('live');
        if (running) {
            // keep running, show a small banner instead of blocking
            document.body.classList.toggle('landscape-warn', landscape);
            document.body.classList.remove('allow-rotate-overlay');
        } else {
            document.body.classList.toggle('allow-rotate-overlay', landscape);
            document.body.classList.remove('landscape-warn');
        }
    }
    function tryLockPortrait() {
        try {
            if (screen.orientation && screen.orientation.lock) {
                screen.orientation.lock('portrait').catch(() => {});
            }
        } catch (e) { /* not supported outside fullscreen/PWA */ }
    }

    // ---- reusable TRON modal -------------------------------------------------
    // opts: { title, body (string|Node), compare?, buttons:[{label,class,onClick(close)}], onBackdrop? }
    function modal(opts) {
        const backdrop = el('div', { class: 'modal-backdrop' });
        const box = el('div', { class: 'modal brackets' });
        if (opts.title) box.appendChild(el('h3', { text: opts.title }));
        if (opts.body != null) {
            box.appendChild(typeof opts.body === 'string'
                ? el('p', { html: opts.body }) : opts.body);
        }
        if (opts.compare) {
            const cmp = el('div', { class: 'compare' });
            opts.compare.forEach(c => cmp.appendChild(el('div', { class: 'box' }, [
                el('div', { class: 'n', text: String(c.value) }),
                el('div', { class: 'status', text: c.label })
            ])));
            box.appendChild(cmp);
        }
        const close = () => { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); };
        const row = el('div', { class: 'row' });
        (opts.buttons || [{ label: 'OK', class: 'btn' }]).forEach(b => {
            row.appendChild(el('button', {
                class: b.class || 'btn', type: 'button',
                onclick: () => { if (b.onClick) b.onClick(close); else close(); }
            }, b.label));
        });
        box.appendChild(row);
        backdrop.appendChild(box);
        backdrop.addEventListener('click', e => {
            if (e.target === backdrop) { if (opts.onBackdrop) opts.onBackdrop(close); else if (opts.dismissible !== false) close(); }
        });
        document.body.appendChild(backdrop);
        return close;
    }

    // ---- public API (screens filled in by later phases) ----------------------
    const App = {
        state, el, $, esc, mount, LANGS, modal,
        start() {
            window.addEventListener('resize', updateOrientation);
            window.addEventListener('orientationchange', updateOrientation);
            updateOrientation();
            tryLockPortrait();
            renderS1();
        },
        renderS1,
        // S2 live camera + overlay (LiveScreens owns the camera/MediaPipe lifecycle)
        toS2(participant) {
            if (global.LiveScreens && typeof LiveScreens.enterS2 === 'function') {
                LiveScreens.enterS2(participant);
            } else {
                mount(el('section', { class: 'screen center' }, [
                    el('div', { class: 'panel brackets' }, [el('p', { text: 'Live module not loaded.' })])
                ]));
            }
        },
        // placeholder until Phase 4 builds the real S3 test loop
        toS3Preview(participant) {
            const cal = state.calibration || {};
            const s0 = cal.S0 || {};
            mount(el('section', { class: 'screen center' }, [
                el('div', { class: 'logo', html: 'SIP<span class="slash">//</span>LAB' }),
                el('div', { class: 'panel brackets' }, [
                    el('h3', { text: 'Calibrated — ready to test' }),
                    el('p', { html: `Calibration captured (${esc(cal.mode || 'standstill')}). ` +
                        `Thigh L <b>${s0.l != null ? s0.l.toFixed(0) : '—'}px</b> · R <b>${s0.r != null ? s0.r.toFixed(0) : '—'}px</b> · ` +
                        `scale <b>${cal.scale_m_per_px != null ? (cal.scale_m_per_px * 1000).toFixed(2) : '—'} mm/px</b>.` }),
                    el('p', { class: 'status', text: 'The 120 s live test loop (S3) is built in Phase 4.' }),
                    el('button', { class: 'btn', type: 'button', onclick: () => { if (global.LiveScreens) LiveScreens.enterS2(participant); } }, '← Back to camera'),
                    el('button', { class: 'btn', type: 'button', onclick: () => { if (global.LiveScreens) LiveScreens.teardown(); renderS1(); } }, 'New participant')
                ])
            ]));
        },
        toUnableResult(participant) {
            mount(el('section', { class: 'screen center' }, [
                el('div', { class: 'logo', html: 'SIP<span class="slash">//</span>LAB' }),
                el('div', { class: 'panel brackets' }, [
                    el('h3', { text: 'Unable to perform' }),
                    el('p', { html: `Recorded <b>0 steps</b> for <b>${esc(participant.participant_id)}</b>. ` +
                        'Full results/export wired in later phases.' }),
                    el('button', { class: 'btn', type: 'button', onclick: () => renderS1() }, '← New participant')
                ])
            ]));
        }
    };

    global.App = App;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => App.start());
    else App.start();
})(typeof window !== 'undefined' ? window : globalThis);
