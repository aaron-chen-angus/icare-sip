/**
 * SIP//LAB — Exporter (CSV / ZIP / session.json / Google Sheets / outbox)
 *
 * No external libraries: a minimal "stored" (uncompressed) ZIP writer with a
 * hand-rolled CRC32 builds the download in the browser. localStorage holds the
 * session history and the Sheets upload outbox (auto-retry on `online`).
 *
 * Only numeric results are ever uploaded, and only when consent was given and a
 * webhook URL is configured. Video and raw landmarks never leave the device.
 *
 * Exposes global `Exporter`.
 */
(function (global) {
    'use strict';

    const C = CONFIG;
    const HIST_KEY = 'siplab.history.v1';
    const OUTBOX_KEY = 'siplab.outbox.v1';
    const BLOB_PREFIX = 'siplab.blob.';   // per-session cached ZIP payload for re-download

    // ---------------------------------------------------------------- CSV
    function csvCell(v) {
        if (v == null) return '';
        const s = String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    function csvFromRows(headerKeys, rows) {
        const lines = [headerKeys.join(',')];
        rows.forEach(r => lines.push(headerKeys.map(k => csvCell(r[k])).join(',')));
        return lines.join('\r\n') + '\r\n';
    }
    function summaryCSV(record) { return csvFromRows(SCHEMA.keys.sessions, [record]); }
    function stepsCSV(steps, sessionId) {
        const rows = steps.map(s => Object.assign({ session_id: sessionId }, s));
        return csvFromRows(SCHEMA.keys.steps, rows);
    }
    function framesAnalysisCSV(frames, sessionId) {
        const rows = frames.map(f => Object.assign({ session_id: sessionId }, f));
        return csvFromRows(SCHEMA.keys.framesAnalysis, rows);
    }
    function framesRawCSV(raw, sessionId) {
        if (!raw || !raw.data) return 'session_id,' + SCHEMA.keys.framesRaw.join(',') + '\r\n';
        const keys = SCHEMA.keys.framesRaw; // t_ms + 17*7
        const header = ['session_id'].concat(keys).join(',');
        const lines = [header];
        const { data, n, cols } = raw;
        for (let k = 0; k < n; k++) {
            const base = k * cols;
            const vals = [sessionId];
            for (let c = 0; c < cols; c++) { const v = data[base + c]; vals.push(isFinite(v) ? round(v, 5) : ''); }
            lines.push(vals.join(','));
        }
        return lines.join('\r\n') + '\r\n';
    }
    function round(x, d) { const f = Math.pow(10, d); return Math.round(x * f) / f; }

    function readmeTxt(record) {
        return [
            'SIP//LAB — 2-Minute Step in Place Biomechanics Lab',
            'Session export',
            '',
            'session_id: ' + record.session_id,
            'participant_id: ' + record.participant_id,
            'timestamp_utc: ' + record.timestamp_utc,
            'app_version: ' + record.app_version + '  analysis_version: ' + record.analysis_version + '  schema_version: ' + record.schema_version,
            'camera_view: ' + record.camera_view + ' (frontal)  pose_model: ' + record.pose_model,
            '',
            'Primary outcome: steps_right (official) = ' + record.steps_right,
            'steps_left = ' + record.steps_left + '   steps_total = ' + record.steps_total,
            'norm_classification = ' + record.norm_classification,
            'qc_pass = ' + record.qc_pass + '   qc_flags = ' + (record.qc_flags || ''),
            '',
            'Files:',
            '  *_summary.csv           one row, every session column (see DATA_DICTIONARY.md)',
            '  *_steps.csv             one row per detected lift',
            '  *_frames_analysis.csv   30 Hz analysed series',
            '  *_frames_raw.csv        device-rate raw landmarks (t_ms + 17 markers x 7)',
            '  *_session.json          summary + config snapshot + QC',
            '',
            'Not a medical device. For research and education only.',
            ''
        ].join('\n');
    }

    // ---------------------------------------------------------------- filename
    function baseName(record) {
        const ts = (record.timestamp_utc || new Date().toISOString()).replace(/[:.]/g, '-');
        const sex = (record.sex || 'na');
        const age = (record.age_years != null ? record.age_years : 'na');
        return `${ts}_${sex}_${age}_SIP`;
    }

    // ---------------------------------------------------------------- ZIP (stored)
    // CRC32
    const CRC_TABLE = (function () {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c >>> 0;
        }
        return t;
    })();
    function crc32(bytes) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }
    function strBytes(s) { return new TextEncoder().encode(s); }

    // Build a stored (compression method 0) ZIP from [{name, bytes}]
    function buildZip(files) {
        const enc = files.map(f => ({ name: f.name, nameBytes: strBytes(f.name), data: f.bytes, crc: crc32(f.bytes) }));
        const chunks = [];
        const central = [];
        let offset = 0;

        function u16(n) { return [n & 0xFF, (n >>> 8) & 0xFF]; }
        function u32(n) { return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]; }

        enc.forEach(f => {
            const local = [].concat(
                u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
                u32(f.crc), u32(f.data.length), u32(f.data.length),
                u16(f.nameBytes.length), u16(0)
            );
            const localHeader = new Uint8Array(local);
            chunks.push(localHeader, f.nameBytes, f.data);
            const localSize = localHeader.length + f.nameBytes.length + f.data.length;

            const cen = [].concat(
                u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
                u32(f.crc), u32(f.data.length), u32(f.data.length),
                u16(f.nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0),
                u32(offset)
            );
            central.push({ header: new Uint8Array(cen), nameBytes: f.nameBytes });
            offset += localSize;
        });

        const centralStart = offset;
        let centralSize = 0;
        central.forEach(c => { chunks.push(c.header, c.nameBytes); centralSize += c.header.length + c.nameBytes.length; });

        const end = [].concat(
            u32(0x06054b50), u16(0), u16(0), u16(enc.length), u16(enc.length),
            u32(centralSize), u32(centralStart), u16(0)
        );
        chunks.push(new Uint8Array(end));

        let total = 0; chunks.forEach(c => total += c.length);
        const out = new Uint8Array(total);
        let p = 0; chunks.forEach(c => { out.set(c, p); p += c.length; });
        return out;
    }

    function buildSessionFiles(record, res, participant, raw) {
        const name = baseName(record);
        const sid = record.session_id;
        const sessionJson = {
            schemaVersion: C.app.schemaVersion,
            summary: record,
            config: C,
            steps: res.steps,
            qc: { qc_flags: record.qc_flags, qc_pass: record.qc_pass, valid_for_norm: record.valid_for_norm }
        };
        const files = [
            { name: `${name}_summary.csv`, bytes: strBytes(summaryCSV(record)) },
            { name: `${name}_steps.csv`, bytes: strBytes(stepsCSV(res.steps, sid)) },
            { name: `${name}_frames_analysis.csv`, bytes: strBytes(framesAnalysisCSV(res.frames, sid)) },
            { name: `${name}_session.json`, bytes: strBytes(JSON.stringify(sessionJson, null, 2)) },
            { name: `README.txt`, bytes: strBytes(readmeTxt(record)) }
        ];
        // raw frames only if we still hold the buffer (not from history)
        if (raw && raw.data) files.splice(3, 0, { name: `${name}_frames_raw.csv`, bytes: strBytes(framesRawCSV(raw, sid)) });
        return { files, name };
    }

    function downloadZip(record, res, participant) {
        const raw = (global.App && App.state && App.state.rawBuffer) || null;
        const { files, name } = buildSessionFiles(record, res, participant, raw);
        const zip = buildZip(files);
        triggerDownload(zip, name + '.zip');
        // cache a lightweight re-download payload (summary+steps+frames, no raw to save space)
        cacheBlob(record.session_id, { record, steps: res.steps, frames: res.frames });
    }

    function triggerDownload(bytes, filename) {
        try {
            const blob = new Blob([bytes], { type: 'application/zip' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
        } catch (e) { console.error('download failed', e); alert('Download failed: ' + e.message); }
    }

    // ---------------------------------------------------------------- localStorage history
    function safeGet(key, fallback) {
        try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
        catch (e) { return fallback; }
    }
    function safeSet(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); return true; }
        catch (e) { console.warn('storage quota?', e); return false; }
    }

    function saveHistory(record, res) {
        const list = safeGet(HIST_KEY, []);
        const item = {
            session_id: record.session_id, participant_id: record.participant_id,
            timestamp_utc: record.timestamp_utc, steps_right: record.steps_right,
            steps_left: record.steps_left, steps_total: record.steps_total,
            norm_classification: record.norm_classification, qc_pass: record.qc_pass,
            selected_as_final: record.selected_as_final, attempt_number: record.attempt_number,
            upload_status: record._upload_status || ''
        };
        const i = list.findIndex(x => x.session_id === item.session_id);
        if (i >= 0) list[i] = Object.assign(list[i], item); else list.unshift(item);
        // keep last 50
        while (list.length > 50) { const old = list.pop(); clearBlob(old.session_id); }
        safeSet(HIST_KEY, list);
        // cache the full record + steps + frames for re-download
        if (res) cacheBlob(record.session_id, { record, steps: res.steps, frames: res.frames });
    }
    function listHistory() { return safeGet(HIST_KEY, []); }
    function deleteHistory(sid) {
        const list = safeGet(HIST_KEY, []).filter(x => x.session_id !== sid);
        safeSet(HIST_KEY, list); clearBlob(sid);
        // also drop from outbox
        const ob = safeGet(OUTBOX_KEY, []).filter(x => x.session_id !== sid);
        safeSet(OUTBOX_KEY, ob);
    }
    function cacheBlob(sid, payload) { safeSet(BLOB_PREFIX + sid, payload); }
    function getBlob(sid) { return safeGet(BLOB_PREFIX + sid, null); }
    function clearBlob(sid) { try { localStorage.removeItem(BLOB_PREFIX + sid); } catch (e) {} }

    function redownload(sid) {
        const blob = getBlob(sid);
        if (!blob) { alert('No cached data for this session (raw frames are not retained after reload).'); return; }
        const res = { steps: blob.steps || [], frames: blob.frames || [] };
        const { files, name } = buildSessionFiles(blob.record, res, null, null);
        triggerDownload(buildZip(files), name + '.zip');
    }

    // ---------------------------------------------------------------- Google Sheets outbox
    function queueUpload(record, res) {
        if (!C.sheets.webhookUrl) return;
        const payload = {
            schemaVersion: C.app.schemaVersion,
            summary: record,
            steps: res && res.steps ? res.steps.map(s => Object.assign({ session_id: record.session_id }, s)) : []
        };
        if (C.sheets.uploadFrames && res && res.frames) {
            payload.frames = res.frames.map(f => Object.assign({ session_id: record.session_id }, f));
        }
        const ob = safeGet(OUTBOX_KEY, []);
        if (!ob.find(x => x.session_id === record.session_id)) {
            ob.push({ session_id: record.session_id, payload, status: 'queued', tries: 0 });
            safeSet(OUTBOX_KEY, ob);
        }
        flushOutbox();
    }

    function retryUpload(sid) {
        const ob = safeGet(OUTBOX_KEY, []);
        const item = ob.find(x => x.session_id === sid);
        if (item) { item.status = 'queued'; safeSet(OUTBOX_KEY, ob); flushOutbox(); }
    }

    function outboxStatus() {
        const ob = safeGet(OUTBOX_KEY, []);
        if (!ob.length) return 'all sent';
        const queued = ob.filter(x => x.status !== 'sent').length;
        return queued ? (queued + ' queued') : 'all sent';
    }

    let flushing = false;
    async function flushOutbox() {
        if (flushing) return;
        if (!C.sheets.webhookUrl) return;
        if (!navigator.onLine) return;
        flushing = true;
        const ob = safeGet(OUTBOX_KEY, []);
        for (const item of ob) {
            if (item.status === 'sent') continue;
            try {
                item.tries = (item.tries || 0) + 1;
                const resp = await postJSON(C.sheets.webhookUrl, item.payload);
                if (resp && resp.ok) {
                    item.status = 'sent';
                    updateHistUpload(item.session_id, resp.duplicate ? 'sent (duplicate)' : 'sent');
                } else if (resp && resp.noCors) {
                    // cannot confirm due to CORS; mark best-effort
                    item.status = 'sent';
                    updateHistUpload(item.session_id, 'sent (cannot confirm — CORS)');
                } else {
                    item.status = 'error';
                    updateHistUpload(item.session_id, 'error');
                }
            } catch (e) {
                item.status = 'queued'; // keep for later retry
                updateHistUpload(item.session_id, 'queued offline');
            }
        }
        safeSet(OUTBOX_KEY, ob);
        flushing = false;
    }

    function updateHistUpload(sid, status) {
        const list = safeGet(HIST_KEY, []);
        const it = list.find(x => x.session_id === sid);
        if (it) { it.upload_status = status; safeSet(HIST_KEY, list); }
    }

    // POST text/plain (avoids a CORS preflight, matching the STS pattern). We try a
    // normal fetch first (to read the JSON reply); if CORS blocks reading it, we
    // retry with no-cors and report "cannot confirm".
    async function postJSON(url, obj) {
        const body = JSON.stringify(obj);
        try {
            const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body });
            if (r.ok) {
                let json = null; try { json = await r.json(); } catch (e) {}
                return { ok: true, duplicate: json && json.status === 'duplicate', json };
            }
            return { ok: false };
        } catch (e) {
            // likely CORS or offline — try opaque no-cors as a best effort
            try {
                await fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body });
                return { ok: false, noCors: true };
            } catch (e2) {
                throw e2;
            }
        }
    }

    // auto-retry when connectivity returns
    if (typeof window !== 'undefined') {
        window.addEventListener('online', () => flushOutbox());
    }

    global.Exporter = {
        // CSV builders (also used by replay/dictionary tools + tests)
        summaryCSV, stepsCSV, framesAnalysisCSV, framesRawCSV, readmeTxt, baseName,
        // ZIP
        buildZip, crc32, downloadZip, buildSessionFiles,
        // history
        saveHistory, listHistory, deleteHistory, redownload,
        // sheets
        queueUpload, retryUpload, outboxStatus, flushOutbox
    };
    if (typeof module !== 'undefined') module.exports = global.Exporter;
})(typeof window !== 'undefined' ? window : globalThis);
