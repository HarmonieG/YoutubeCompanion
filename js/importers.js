// Lecture des fichiers importés : liste « À regarder plus tard » et historique YouTube.
// Formats acceptés :
//  - export JSON du bookmarklet Plus Tard (source: 'plustard-wl')
//  - CSV de playlist Google Takeout (« À regarder plus tard-vidéos.csv » / « Watch later-videos.csv »)
//  - n'importe quel JSON / texte contenant des liens youtube (repli générique)
//  - historique Takeout : watch-history.json ou watch-history.html

const ID_RE = /^[\w-]{11}$/;
const URL_ID_RE = /(?:youtube\.com\/(?:watch\?(?:[^"'\s<>]*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/g;

export function extractId(str) {
  if (!str) return null;
  if (ID_RE.test(str)) return str;
  URL_ID_RE.lastIndex = 0;
  const m = URL_ID_RE.exec(str);
  return m ? m[1] : null;
}

export function parseDurationText(t) {
  if (!t) return null;
  const m = String(t).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]);
}

// ---------- « À regarder plus tard » ----------
export function parseWatchLater(text, fileName = '') {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(trimmed);
      if (data && data.source === 'plustard-wl' && Array.isArray(data.items)) {
        return data.items.filter((i) => ID_RE.test(i.id)).map((i, idx) => ({
          id: i.id,
          title: i.title || '',
          channelTitle: i.channelTitle || '',
          channelId: /^UC[\w-]{22}$/.test(i.channelId || '') ? i.channelId : '',
          channelUrl: i.channelUrl || '',
          duration: i.duration ?? parseDurationText(i.durationText),
          position: i.index ?? idx,
        }));
      }
      return genericFromJson(data);
    } catch { /* on tente le texte brut */ }
  }
  if (/\.csv$/i.test(fileName) || /video id|id de la vid/i.test(trimmed.slice(0, 2000))) {
    const rows = parseCsv(trimmed);
    const out = [];
    rows.forEach((r) => {
      const id = r[0] && r[0].trim();
      if (ID_RE.test(id)) {
        const added = r[1] ? Date.parse(r[1].trim()) : NaN;
        out.push({ id, addedAt: isNaN(added) ? undefined : added, position: out.length });
      }
    });
    if (out.length) return out;
  }
  return genericFromText(trimmed);
}

function genericFromJson(data) {
  const out = [];
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const id = extractId(node.videoId || node.id || node.url || node.link || node.href || '');
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push({
        id,
        title: node.title || node.name || '',
        channelTitle: node.channelTitle || node.channel || node.author || node.uploader || '',
        duration: typeof node.duration === 'number' ? node.duration : parseDurationText(node.duration),
        position: out.length,
      });
      return;
    }
    Object.values(node).forEach(walk);
  };
  walk(data);
  return out;
}

function genericFromText(text) {
  const out = [];
  const seen = new Set();
  URL_ID_RE.lastIndex = 0;
  let m;
  while ((m = URL_ID_RE.exec(text))) {
    if (!seen.has(m[1])) { seen.add(m[1]); out.push({ id: m[1], position: out.length }); }
  }
  return out;
}

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ---------- Historique ----------
const WATCHED_PREFIX = /^(watched|vous avez regardé|vous avez regarde|has visto|hai guardato|angesehen:?|assistiu a|bekeken)\s+/i;

// Retourne [{ id, title, channelId, channelTitle, time }]
export function parseHistory(text) {
  const t = text.trim();
  if (t.startsWith('[')) {
    const data = JSON.parse(t);
    const out = [];
    for (const e of data) {
      if (e.header && !/^youtube$/i.test(e.header)) continue; // ignore YouTube Music
      if (e.details && e.details.some((d) => /ads|annonces/i.test(d.name || ''))) continue;
      const id = extractId(e.titleUrl || '');
      if (!id) continue;
      const sub = (e.subtitles && e.subtitles[0]) || {};
      const ch = (sub.url || '').match(/channel\/([\w-]+)/);
      out.push({
        id,
        title: (e.title || '').replace(WATCHED_PREFIX, ''),
        channelId: ch ? ch[1] : null,
        channelTitle: sub.name || '',
        time: e.time ? Date.parse(e.time) : 0,
      });
    }
    return out;
  }
  // Version HTML de Takeout
  const out = [];
  const re = /<a href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})">([^<]*)<\/a><br><a href="https:\/\/www\.youtube\.com\/channel\/([\w-]+)">([^<]*)<\/a>/g;
  let m;
  while ((m = re.exec(t))) {
    out.push({ id: m[1], title: decodeHtml(m[2]), channelId: m[3], channelTitle: decodeHtml(m[4]), time: 0 });
  }
  return out;
}

function decodeHtml(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}
