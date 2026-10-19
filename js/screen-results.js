/**
 * SIP//LAB — S4 Results + S5 History (ResultsScreen)
 *
 * Runs the authoritative offline analysis, renders the score, chips, norm/QC
 * badges, metric grids, charts, step table and the Flutter-parity dialog flow
 * (submit / cannot-do / retry / keep-previous vs use-current / exit warning).
 *
 * Exposes App().runAnalysisAndShowResults, App().renderResults, App().renderHistory,
 * App().toUnableResult (replaces the Phase-1 placeholder).
 *
 * Depends on App, SIPAnalysis, Charts, Exporter (Phase 7), CONFIG, SCHEMA.
 */
(function (global) {
    'use strict';

    function App() { return global.App; }
    const C = CONFIG;

    // charts registered for redraw on resize/rotation
    let chartJobs = [];
    function registerChart(canvas, fn, res) { chartJobs.push(() => fn(canvas, res)); }
    function redrawCharts() { chartJobs.forEach(j => { try { j(); } catch (e) {} }); }
    window.addEventListener('resize', () => { if (App().state.screen === 'S4') redrawCharts(); });
    window.addEventListener('orientationchange', () => { setTimeout(() => { if (App().state.screen === 'S4') redrawCharts(); }, 200); });

    // ---- run analysis then render ----
    function runAnalysisAndShowResults() {
        const st = App().state;
        let res;
        try {
            res = SIPAnalysis.run(st.rawBuffer, st.calibration, st.participant, CONFIG);
        } catch (e) {
            console.error('analysis failed', e);
            document.body.classList.remove('live');
            App().mount(App().el('section', { class: 'screen center' }, [
                App().el('div', { class: 'panel brackets' }, [
                    App().el('h3', { text: 'Analysis error' }),
                    App().el('p', { text: 'The analysis could not complete: ' + (e && e.message) }),
                    App().el('button', { class: 'btn', type: 'button', onclick: () => { if (global.LiveScreens) LiveScreens.teardown(); App().renderS1(); } }, 'New participant')
                ])
            ]));
            return;
        }
        // build the full session record (schema sessions) and persist to history
        const record = buildSessionRecord(res, st);
        st.results = { res, record };
        if (global.Exporter && Exporter.saveHistory) {
            try { Exporter.saveHistory(record, res); } catch (e) { console.warn('history save failed', e); }
        }
        // auto-upload if consented + configured
        maybeUpload(record, res);
        renderResults();
    }

    // ---- assemble the sessions row (adds session/participant/device/protocol fields) ----
    function buildSessionRecord(res, st) {
        const p = st.participant, cal = st.calibration, meta = st.testMeta || {};
        const now = new Date();
        const sid = st.sessionId || makeSessionId();
        st.sessionId = sid;
        const rec = Object.assign({}, res.summary);
        // session & participant
        rec.session_id = sid;
        rec.timestamp_utc = now.toISOString();
        rec.utc_offset_min = -now.getTimezoneOffset();
        rec.app_version = C.app.version; rec.analysis_version = C.app.analysisVersion; rec.schema_version = C.app.schemaVersion;
        rec.participant_id = p.participant_id;
        rec.age_years = numOrNull(p.age_years); rec.sex = p.sex;
        rec.height_cm = numOrNull(p.height_cm); rec.body_mass_kg = numOrNull(p.body_mass_kg);
        rec.site = p.site; rec.operator_notes = p.operator_notes;
        rec.attempt_number = st.attemptNumber || 1;
        rec.previous_session_id = st.previousSessionId || null;
        rec.selected_as_final = false;
        rec.unable_to_perform = !!p.unable_to_perform;
        rec.support_used = !!p.support_used;
        rec.camera_height_cm = numOrNull(p.camera_height_cm);
        // device & pose
        rec.pose_model = p.pose_model; rec.pose_delegate = meta.pose_delegate || null;
        rec.camera_facing = p.camera_facing; rec.camera_view = C.protocol.view;
        rec.camera_pitch_deg = cal.camera_pitch_deg; rec.camera_roll_deg = cal.camera_roll_deg;
        rec.hip_y_norm_calib = cal.hip_y_norm;
        rec.video_width_px = meta.video_width_px || cal.vw; rec.video_height_px = meta.video_height_px || cal.vh;
        rec.screen_width_px = window.screen ? window.screen.width : null;
        rec.screen_height_px = window.screen ? window.screen.height : null;
        rec.user_agent = navigator.userAgent;
        // protocol
        rec.planned_duration_s = C.protocol.durationS;
        rec.manual_stop = !!meta.manual_stop;
        rec.protocol_briefed = !!p.protocol_briefed;
        rec.count_threshold_preset = cal.threshold_preset;
        rec.count_threshold_p = cal.threshold_p;
        rec.release_threshold_p = C.events.releaseP;
        rec.filter_cutoff_hz = C.signal.cutoffHz;
        rec.resample_hz = C.signal.resampleHz;
        return rec;
    }
    function numOrNull(v) { const n = Number(v); return (v === '' || v == null || !isFinite(n)) ? null : n; }
    function makeSessionId() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }

    function maybeUpload(record, res) {
        // Automatic upload — no consent gate. Fires as soon as the analysis completes.
        if (!C.sheets.webhookUrl) return;
        if (global.Exporter && Exporter.queueUpload) {
            try { Exporter.queueUpload(record, res); } catch (e) { console.warn('upload queue failed', e); }
        }
    }

    // ============================================================= S4 render
    function renderResults() {
        const st = App().state;
        const { res, record } = st.results;
        const s = res.summary;
        document.body.classList.remove('live', 'landscape-warn');
        App().state.screen = 'S4';
        chartJobs = [];

        const el = App().el, esc = App().esc;
        const screen = el('section', { class: 'screen' });

        screen.appendChild(el('div', { class: 'center' }, [
            el('div', { class: 'logo', html: 'SIP<span class="slash">//</span>LAB' }),
            el('div', { class: 'subtitle', text: 'Results · ' + esc(st.participant.participant_id) + (st.attemptNumber > 1 ? ' · attempt ' + st.attemptNumber : '') })
        ]));

        // big score
        screen.appendChild(el('div', { class: 'panel brackets center' }, [
            el('div', { class: 'big-score' }, [
                el('div', { class: 'big-number', text: String(s.steps_right) }),
                el('div', { class: 'big-label', text: 'Right knee lifts · official score' })
            ]),
            el('div', { class: 'chips' }, [
                chip('left', s.steps_left, 'LEFT'),
                chip('total', s.steps_total, 'TOTAL'),
                chip('dur', fmtDur(s.total_duration), 'DURATION')
            ]),
            badgesRow(s)
        ]));

        // QC flags
        if (s.qc_flags) {
            const flags = s.qc_flags.split(';').filter(Boolean);
            if (flags.length) {
                const box = el('div', { class: 'panel' }, [el('h3', { text: 'Quality control' })]);
                flags.forEach(f => {
                    const blocking = C.qc.blocking.indexOf(f) >= 0;
                    box.appendChild(el('div', { class: 'flag' + (blocking ? ' block' : '') },
                        [el('b', { text: f }), document.createTextNode(' — ' + flagText(f))]));
                });
                screen.appendChild(box);
            }
        }

        // metric grids
        screen.appendChild(metricGroup('Pacing', [
            m('Cadence', s.cadence_total_steps_per_min, 'steps/min', 1),
            m('Right cadence', s.cadence_right_steps_per_min, 'steps/min', 1, 'r'),
            m('Step interval R', s.step_interval_mean_s_right, 's', 2, 'r'),
            m('Step interval L', s.step_interval_mean_s_left, 's', 2),
            m('Interval CV R', s.step_interval_cv_pct_right, '%', 1, 'r'),
            m('Time to 1st step', s.time_to_first_step_s, 's', 1),
            m('Rate change Q1→Q4', s.rate_change_pct_q1_q4, '%', 1),
            m('Alternation', s.alternation_interval_mean_s, 's', 2)
        ]));
        screen.appendChild(metricGroup('Step height', [
            m('Knee rise R', s.knee_rise_mean_cm_right, 'cm', 1, 'r'),
            m('Knee rise L', s.knee_rise_mean_cm_left, 'cm', 1),
            m('Peak progress R', s.lift_progress_mean_right, '', 2, 'r'),
            m('Peak progress L', s.lift_progress_mean_left, '', 2),
            m('% hip level R', s.pct_steps_hip_level_right, '%', 0, 'r'),
            m('% hip level L', s.pct_steps_hip_level_left, '%', 0),
            m('Height change R', s.lift_height_change_pct_right, '%', 0, 'r'),
            m('Height change L', s.lift_height_change_pct_left, '%', 0)
        ]));
        screen.appendChild(metricGroup('Symmetry', [
            m('Step count', s.symmetry_step_count_pct, '%', 1),
            m('Lift height', s.symmetry_lift_height_pct, '%', 1),
            m('Lifting time', s.symmetry_lifting_time_pct, '%', 1)
        ]));
        screen.appendChild(metricGroup('Velocity', [
            m('Peak up vel R', s.peak_up_velocity_mean_m_s_right, 'm/s', 2, 'r'),
            m('Peak up vel L', s.peak_up_velocity_mean_m_s_left, 'm/s', 2),
            m('Max up vel', s.peak_standing_vertical_velocity_m_s, 'm/s', 2),
            m('Peak down vel R', s.peak_down_velocity_mean_m_s_right, 'm/s', 2, 'r')
        ]));
        screen.appendChild(metricGroup('Balance & posture', [
            m('Sway RMS', s.sway_ml_rms_cm, 'cm', 1),
            m('Sway range', s.sway_ml_range_cm, 'cm', 1),
            m('Sway path', s.sway_path_length_cm, 'cm', 0),
            m('Trunk lean peak', s.trunk_lean_peak_deg, '°', 1),
            m('Pelvis tilt peak', s.pelvis_tilt_peak_deg, '°', 1),
            m('Hip-mid drift', s.hip_mid_drift_cm, 'cm', 1)
        ]));
        screen.appendChild(metricGroup('Rest', [
            m('Rest count', s.rest_count, '', 0),
            m('Rest total', s.rest_total_s, 's', 1),
            m('Longest rest', s.longest_rest_s, 's', 1),
            m('Active time', s.active_time_pct, '%', 0)
        ]));

        // Flutter-parity block (collapsible)
        screen.appendChild(flutterParityDetails(s));

        // charts
        screen.appendChild(chartsPanel(res));

        // step table
        screen.appendChild(stepTable(res));

        // actions
        screen.appendChild(actionsRow(res, record));

        screen.appendChild(el('div', { class: 'footer-limits', html:
            'Offline (authoritative) counts shown. Frontal view · right knee = official score. Not a medical device.' }));

        App().mount(screen);
        // draw charts after layout
        setTimeout(redrawCharts, 30);
    }

    // ---- building blocks ----
    function chip(kind, value, label) {
        const el = App().el;
        return el('div', { class: 'chip ' + kind }, [
            el('div', { class: 'n', text: String(value) }),
            el('div', { class: 't', text: label })
        ]);
    }
    function badgesRow(s) {
        const el = App().el;
        const row = el('div', { style: 'margin-top:8px' });
        // norm badge
        const cls = s.norm_classification === 'ABOVE AVERAGE' ? 'above'
            : s.norm_classification === 'AVERAGE' ? 'average'
            : s.norm_classification === 'BELOW AVERAGE' ? 'below' : 'neutral';
        let normLabel = s.norm_classification || 'NOT CLASSIFIED';
        if (s.norm_cutoff_below_average != null && s.norm_classification !== 'NOT CLASSIFIED') {
            normLabel += ` (${s.norm_cutoff_below_average}–${s.norm_cutoff_above_average})`;
        }
        row.appendChild(el('span', { class: 'badge ' + cls, text: normLabel }));
        row.appendChild(el('span', { class: 'badge ' + (s.qc_pass ? 'ok' : 'review'), text: s.qc_pass ? 'QC OK' : 'QC REVIEW' }));
        return row;
    }
    function metricGroup(title, metrics) {
        const el = App().el;
        const panel = el('div', { class: 'panel' }, [el('h3', { text: title })]);
        const grid = el('div', { class: 'metrics' });
        metrics.forEach(mm => grid.appendChild(mm));
        panel.appendChild(grid);
        return panel;
    }
    function m(label, value, unit, dp, side) {
        const el = App().el;
        const txt = (value == null || !isFinite(value)) ? '—' : (dp != null ? Number(value).toFixed(dp) : String(value));
        return el('div', { class: 'metric' + (side === 'r' ? ' r' : '') }, [
            el('div', { class: 't', text: label }),
            el('div', { class: 'v', html: esc(txt) + (unit ? ' <small>' + esc(unit) + '</small>' : '') })
        ]);
    }
    function esc(s) { return App().esc(s); }

    function flutterParityDetails(s) {
        const el = App().el;
        const d = el('details');
        d.appendChild(el('summary', { text: 'Flutter-parity metrics' }));
        const grid = el('div', { class: 'metrics', style: 'margin-top:10px' });
        [
            ['Avg transition R', s.avg_transition_time_right, 's', 2, 'r'],
            ['Avg transition L', s.avg_transition_time_left, 's', 2],
            ['SD transition R', s.std_transition_time_right, 's', 2, 'r'],
            ['SD transition L', s.std_transition_time_left, 's', 2],
            ['Avg lifting R', s.avg_lifting_time_right_s, 's', 2, 'r'],
            ['Avg lifting L', s.avg_lifting_time_left_s, 's', 2],
            ['Peak vel', s.peak_standing_vertical_velocity_m_s, 'm/s', 2],
            ['n steps R', s.n_steps_right, '', 0, 'r'],
            ['n steps L', s.n_steps_left, '', 0]
        ].forEach(a => grid.appendChild(m(a[0], a[1], a[2], a[3], a[4])));
        d.appendChild(grid);
        return d;
    }

    function chartsPanel(res) {
        const el = App().el;
        const panel = el('div', { class: 'panel' }, [el('h3', { text: 'Charts' })]);
        const defs = [
            Charts.progressOverTime, Charts.stepsPerQuarter, Charts.stepInterval,
            Charts.swayTrunk, Charts.liftHeight
        ];
        defs.forEach(fn => {
            const canvas = el('canvas', { class: 'chart' });
            panel.appendChild(canvas);
            registerChart(canvas, fn, res);
        });
        return panel;
    }

    function stepTable(res) {
        const el = App().el;
        const panel = el('div', { class: 'panel' }, [el('h3', { text: 'Step detail' })]);
        const wrap = el('div', { class: 'tablewrap' });
        const table = el('table');
        const head = el('tr');
        ['#', 'Leg', 'Counted', 'Peak p', 't_peak', 'Lift s', 'Rise cm', 'Up m/s'].forEach(h => head.appendChild(el('th', { text: h })));
        table.appendChild(head);
        res.steps.forEach(st => {
            const tr = el('tr', { class: st.counted ? '' : 'uncounted' });
            const cells = [
                st.step_index,
                (st.leg === 'right' ? 'R' : 'L'),
                st.counted ? '✓' : '·',
                fx(st.peak_progress, 2),
                fx(st.t_peak_s, 1),
                fx(st.lifting_time_s, 2),
                fx(st.knee_rise_cm, 1),
                fx(st.peak_up_velocity_m_s, 2)
            ];
            cells.forEach(c => tr.appendChild(el('td', { text: String(c) })));
            table.appendChild(tr);
        });
        wrap.appendChild(table); panel.appendChild(wrap);
        return panel;
    }
    function fx(v, d) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(d); }
    function fmtDur(s) { s = Math.round(s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

    // ---- actions + dialogs ----
    function actionsRow(res, record) {
        const el = App().el;
        const st = App().state;
        const panel = el('div', { class: 'panel' }, [el('h3', { text: 'Actions' })]);
        // full-width stacked buttons so labels never wrap into letter-columns
        const stack = el('div', { class: 'action-stack' });

        if (st.attemptNumber > 1 && st.previousResult) {
            stack.appendChild(el('button', { class: 'btn btn-primary btn-large', type: 'button', onclick: () => keepUseDialog() }, 'Keep / Use result'));
        } else {
            stack.appendChild(el('button', { class: 'btn btn-primary btn-large', type: 'button', onclick: () => submitDialog() }, 'Use this result'));
        }

        // ---- Google Sheets panel (automatic upload; manual re-send available) ----
        if (C.sheets.webhookUrl) {
            const sheetBox = el('div', { class: 'panel', style: 'margin:8px 0;padding:12px' });
            sheetBox.appendChild(el('div', { class: 'status', id: 'upload-status', style: 'margin-bottom:8px' }, uploadStatusText()));
            sheetBox.appendChild(el('button', { class: 'btn btn-large', type: 'button', id: 'btn-upload', onclick: () => uploadNow() }, 'Upload to Google Sheets again'));
            stack.appendChild(sheetBox);
        }

        stack.appendChild(el('button', { class: 'btn btn-large', type: 'button', onclick: () => downloadZip() }, 'Download ZIP'));
        stack.appendChild(el('button', { class: 'btn btn-large', type: 'button', onclick: () => retryDialog() }, 'Retry test'));
        stack.appendChild(el('button', { class: 'btn btn-large', type: 'button', onclick: () => App().renderHistory() }, 'History'));
        stack.appendChild(el('button', { class: 'btn btn-large', type: 'button', onclick: () => newParticipantGuard() }, 'New participant'));
        panel.appendChild(stack);

        if (!C.sheets.webhookUrl) {
            panel.appendChild(el('div', { class: 'status', id: 'upload-status', style: 'margin-top:8px' }, uploadStatusText()));
        }
        return panel;
    }

    // Manual re-send from the results screen (upload is already automatic).
    function uploadNow() {
        const st = App().state;
        const us = document.getElementById('upload-status');
        if (!C.sheets.webhookUrl) { if (us) us.textContent = uploadStatusText(); return; }
        if (global.Exporter) {
            if (Exporter.saveHistory) Exporter.saveHistory(st.results.record, st.results.res);
            if (Exporter.retryUpload) Exporter.retryUpload(st.results.record.session_id);
            if (Exporter.queueUpload) Exporter.queueUpload(st.results.record, st.results.res);
        }
        if (us) us.textContent = 'Uploading…';
        setTimeout(() => { if (us) us.textContent = 'Sheets: ' + (Exporter.outboxStatus ? Exporter.outboxStatus() : 'sent'); }, 1500);
    }

    function uploadStatusText() {
        if (!C.sheets.webhookUrl) return 'Sheets: not configured (local ZIP export only).';
        const q = global.Exporter && Exporter.outboxStatus ? Exporter.outboxStatus() : null;
        return 'Sheets: ' + (q == null ? 'uploaded automatically' : q);
    }

    function submitDialog() {
        const s = App().state.results.res.summary;
        App().modal({
            title: 'Submit result', body: `Submit <b>${s.steps_right}</b> right-knee steps as the final result?`,
            buttons: [
                { label: 'Cancel', class: 'btn', onClick: c => c() },
                { label: 'Submit', class: 'btn btn-primary', onClick: c => { c(); markFinal(); } }
            ]
        });
    }
    function markFinal() {
        const st = App().state;
        st.results.record.selected_as_final = true;
        if (global.Exporter) {
            if (Exporter.saveHistory) Exporter.saveHistory(st.results.record, st.results.res);
            if (C.sheets.webhookUrl && Exporter.queueUpload) Exporter.queueUpload(st.results.record, st.results.res);
        }
        const up = document.getElementById('upload-status');
        if (up) up.textContent = 'Marked as final. ' + uploadStatusText();
        App().modal({ title: 'Saved', body: 'This attempt is marked as the final result.', buttons: [{ label: 'OK', class: 'btn btn-primary', onClick: c => c() }] });
    }

    function retryDialog() {
        App().modal({
            title: 'Try again?', body: 'Run another attempt? The previous attempt is kept until you choose.',
            buttons: [
                { label: 'Cancel', class: 'btn', onClick: c => c() },
                { label: 'Retry', class: 'btn btn-primary', onClick: c => { c(); doRetry(); } }
            ]
        });
    }
    function doRetry() {
        const st = App().state;
        st.previousResult = st.results.res.summary;
        st.previousSessionId = st.sessionId;
        st.attemptNumber = (st.attemptNumber || 1) + 1;
        st.sessionId = null;
        // re-enter S2 (recalibrate) with same participant — replaces, not stacks
        if (global.LiveScreens) LiveScreens.enterS2(st.participant);
    }

    function keepUseDialog() {
        const st = App().state;
        const cur = st.results.res.summary.steps_right;
        const prev = st.previousResult ? st.previousResult.steps_right : 0;
        App().modal({
            title: 'Keep previous or use current?',
            compare: [{ label: 'PREVIOUS', value: prev }, { label: 'CURRENT', value: cur }],
            body: 'Which attempt should be the final result?',
            buttons: [
                { label: 'Keep previous', class: 'btn', onClick: c => { c(); /* previous already stored as final elsewhere */ markFinalUsing(st.previousResult); } },
                { label: 'Use current', class: 'btn btn-primary', onClick: c => { c(); markFinal(); } }
            ]
        });
    }
    function markFinalUsing(summary) {
        App().modal({ title: 'Kept previous', body: `Previous attempt (<b>${summary.steps_right}</b> steps) kept as final.`, buttons: [{ label: 'OK', class: 'btn btn-primary', onClick: c => c() }] });
    }

    function downloadZip() {
        if (global.Exporter && Exporter.downloadZip) {
            Exporter.downloadZip(App().state.results.record, App().state.results.res, App().state.participant);
        } else {
            App().modal({ title: 'Export', body: 'ZIP export is wired in Phase 7.', buttons: [{ label: 'OK', class: 'btn', onClick: c => c() }] });
        }
    }

    function newParticipantGuard() {
        const st = App().state;
        if (st.results && !st.results.record.selected_as_final) {
            App().modal({
                title: 'Leave without selecting a result?',
                body: 'You have not marked a final result for this participant. Leave anyway?',
                buttons: [
                    { label: 'Stay', class: 'btn', onClick: c => c() },
                    { label: 'Leave', class: 'btn btn-danger', onClick: c => { c(); resetAndHome(); } }
                ]
            });
        } else { resetAndHome(); }
    }
    function resetAndHome() {
        const st = App().state;
        st.participant = null; st.calibration = null; st.rawBuffer = null; st.results = null;
        st.attemptNumber = 1; st.previousResult = null; st.previousSessionId = null; st.sessionId = null;
        if (global.LiveScreens) LiveScreens.teardown();
        App().renderS1();
    }

    // ---- unable-to-perform result (replaces Phase-1 placeholder) ----
    function toUnableResult(participant) {
        const st = App().state;
        document.body.classList.remove('live');
        st.screen = 'S4';
        const sid = makeSessionId();
        const record = zeroRecord(participant, sid);
        st.results = { res: { summary: record, steps: [], frames: [] }, record };
        st.sessionId = sid;
        if (global.Exporter) {
            try { if (Exporter.saveHistory) Exporter.saveHistory(record, st.results.res); } catch (e) {}
            try { if (C.sheets.webhookUrl && Exporter.queueUpload) Exporter.queueUpload(record, st.results.res); } catch (e) {}
        }
        const el = App().el;
        App().mount(el('section', { class: 'screen center' }, [
            el('div', { class: 'logo', html: 'SIP<span class="slash">//</span>LAB' }),
            el('div', { class: 'panel brackets' }, [
                el('h3', { text: 'Unable to perform' }),
                el('div', { class: 'big-score' }, [el('div', { class: 'big-number', text: '0' }), el('div', { class: 'big-label', text: 'steps recorded' })]),
                el('p', { html: `Recorded <b>0 steps</b> for <b>${App().esc(participant.participant_id)}</b>.` }),
                el('div', { class: 'row' }, [
                    el('button', { class: 'btn', type: 'button', onclick: () => downloadZip() }, 'Download ZIP'),
                    el('button', { class: 'btn', type: 'button', onclick: () => App().renderHistory() }, 'History'),
                    el('button', { class: 'btn btn-primary', type: 'button', onclick: () => resetAndHome() }, 'New participant')
                ])
            ])
        ]));
    }
    function zeroRecord(participant, sid) {
        const now = new Date();
        const rec = {};
        SCHEMA.keys.sessions.forEach(k => rec[k] = null);
        rec.session_id = sid; rec.timestamp_utc = now.toISOString(); rec.utc_offset_min = -now.getTimezoneOffset();
        rec.app_version = C.app.version; rec.analysis_version = C.app.analysisVersion; rec.schema_version = C.app.schemaVersion;
        rec.participant_id = participant.participant_id; rec.age_years = numOrNull(participant.age_years); rec.sex = participant.sex;
        rec.height_cm = numOrNull(participant.height_cm); rec.unable_to_perform = true;
        rec.camera_view = C.protocol.view;
        rec.steps_right = 0; rec.steps_left = 0; rec.steps_total = 0; rec.total_repetitions = 0;
        rec.total_duration = 0; rec.test_duration_s = 0;
        rec.qc_flags = 'NO_STEPS'; rec.qc_pass = false; rec.valid_for_norm = false;
        rec.norm_reference = C.norms.reference; rec.norm_classification = 'NOT CLASSIFIED';
        rec.attempt_number = 1; rec.selected_as_final = true;
        return rec;
    }

    // ============================================================= S5 history
    function renderHistory() {
        const el = App().el;
        App().state.screen = 'S5';
        document.body.classList.remove('live');
        const list = (global.Exporter && Exporter.listHistory) ? Exporter.listHistory() : [];
        const screen = el('section', { class: 'screen' });
        screen.appendChild(el('div', { class: 'center' }, [
            el('div', { class: 'logo', html: 'SIP<span class="slash">//</span>LAB' }),
            el('div', { class: 'subtitle', text: 'History' })
        ]));
        const panel = el('div', { class: 'panel hist' });
        if (!list.length) panel.appendChild(el('p', { text: 'No saved sessions on this device yet.' }));
        list.forEach(item => {
            const card = el('div', { class: 'card' }, [
                el('div', { html: `<b>${App().esc(item.participant_id || '—')}</b> · R <b style="color:var(--orange)">${item.steps_right}</b> · L ${item.steps_left} · ${new Date(item.timestamp_utc).toLocaleString()}` }),
                el('div', { class: 'status', text: (item.norm_classification || '') + ' · ' + (item.qc_pass ? 'QC OK' : 'QC REVIEW') + (item.upload_status ? ' · ' + item.upload_status : '') }),
                el('div', { class: 'row', style: 'margin-top:8px' }, [
                    el('button', { class: 'btn btn-small', type: 'button', onclick: () => Exporter.redownload && Exporter.redownload(item.session_id) }, 'ZIP'),
                    C.sheets.webhookUrl ? el('button', { class: 'btn btn-small', type: 'button', onclick: () => { Exporter.retryUpload && Exporter.retryUpload(item.session_id); App().renderHistory(); } }, 'Retry upload') : null,
                    el('button', { class: 'btn btn-small btn-danger', type: 'button', onclick: () => { if (Exporter.deleteHistory) Exporter.deleteHistory(item.session_id); App().renderHistory(); } }, 'Delete')
                ])
            ]);
            panel.appendChild(card);
        });
        screen.appendChild(panel);
        screen.appendChild(el('div', { class: 'row' }, [
            el('button', { class: 'btn btn-primary', type: 'button', onclick: () => { if (App().state.results) renderResults(); else App().renderS1(); } }, '← Back')
        ]));
        App().mount(screen);
    }

    // ---- flag descriptions for the UI ----
    function flagText(f) {
        const map = {
            LOW_FPS: 'frame rate below 15 fps', LOW_VALID_FRAMES: 'too many frames missing key landmarks',
            TRACKING_GAPS: 'tracking gaps too long/frequent', FEET_OUT_OF_FRAME: 'feet left the frame',
            CAMERA_OR_FEET_SHIFT: 'camera or feet moved during the test', MANUAL_STOP: 'operator stopped early',
            TAB_HIDDEN: 'app was backgrounded mid-test', NO_STEPS: 'no steps detected',
            CAL_NOT_STILL: 'participant not still during calibration', HEIGHT_IMPLAUSIBLE: 'scale-derived height disagrees with entered height',
            BOTH_KNEES_UP: 'both knees up simultaneously (jumping/tracking error)', OBLIQUE_VIEW: 'body rotated from frontal',
            CAMERA_TILT: 'camera not level', CAMERA_HEIGHT_OFF: 'camera not at hip height',
            LIFT_2D_3D_DISAGREE: '2-D and 3-D lift estimates disagree', LONG_REST: 'long resting period',
            CAL_FALLBACK: 'calibration fell back to auto-estimate', SUPPORT_USED: 'participant used support (declared)'
        };
        return map[f] || '';
    }

    // ---- expose ----
    const api = { runAnalysisAndShowResults, renderResults, renderHistory, toUnableResult };
    function install() { Object.assign(global.App, api); }
    if (global.App) install();
    else document.addEventListener('DOMContentLoaded', () => { if (global.App) install(); });
    global.ResultsScreen = { install };
})(typeof window !== 'undefined' ? window : globalThis);
