/**
 * SIP//LAB — Google Sheets receiver (Apps Script web app)
 *
 * Setup (all in the browser, no install):
 *   1. Create a Google Sheet.
 *   2. Extensions → Apps Script. Paste this file. Save.
 *   3. Deploy → New deployment → type "Web app".
 *        Execute as: Me.   Who has access: Anyone.
 *   4. Copy the /exec URL and paste it into js/config.js (sheets.webhookUrl).
 *   5. After ANY change here, Deploy → Manage deployments → New version.
 *
 * The web app:
 *   - GET  returns {"status":"active","service":"sip-lab"} (health check).
 *   - POST accepts {schemaVersion, summary:{...}, steps:[...], frames?:[...]}.
 *   - Matches columns BY NAME and appends new columns automatically.
 *   - De-duplicates Sessions by session_id. Frames may arrive in chunks, so the
 *     Frames sheet is NOT de-duplicated (send a `chunk` field if you split them).
 */
var SERVICE = 'sip-lab';

function doGet() {
  return json_({ status: 'active', service: SERVICE });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var body = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sum = body.summary || {};

    var sessions = sheet_(ss, 'Sessions');
    if (sum.session_id && exists_(sessions, 'session_id', sum.session_id)) {
      // Session already recorded. Steps/summary are not re-appended, but allow
      // Frames chunks for the same session to continue.
      if (body.frames && body.frames.length) {
        appendObjects_(sheet_(ss, 'Frames'), body.frames);
      }
      return json_({ status: 'duplicate', session_id: sum.session_id });
    }

    if (sum.session_id) appendObjects_(sessions, [sum]);
    if (body.steps && body.steps.length) appendObjects_(sheet_(ss, 'Steps'), body.steps);
    if (body.frames && body.frames.length) appendObjects_(sheet_(ss, 'Frames'), body.frames);

    return json_({ status: 'ok', service: SERVICE, session_id: sum.session_id });
  } catch (err) {
    return json_({ status: 'error', message: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function header_(sh) {
  var n = sh.getLastColumn();
  return n ? sh.getRange(1, 1, 1, n).getValues()[0].map(String) : [];
}

function exists_(sh, col, val) {
  if (!val || sh.getLastRow() < 2) return false;
  var i = header_(sh).indexOf(col);
  if (i < 0) return false;
  var values = sh.getRange(2, i + 1, sh.getLastRow() - 1, 1).getValues();
  for (var r = 0; r < values.length; r++) {
    if (String(values[r][0]) === String(val)) return true;
  }
  return false;
}

function appendObjects_(sh, objs) {
  var h = header_(sh);
  var need = [];
  objs.forEach(function (o) {
    Object.keys(o).forEach(function (k) {
      if (h.indexOf(k) < 0 && need.indexOf(k) < 0) need.push(k);
    });
  });
  if (need.length) {
    sh.getRange(1, h.length + 1, 1, need.length).setValues([need]);
    h = h.concat(need);
  }
  var rows = objs.map(function (o) {
    return h.map(function (k) {
      return (o[k] === undefined || o[k] === null) ? '' : o[k];
    });
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, h.length).setValues(rows);
}
