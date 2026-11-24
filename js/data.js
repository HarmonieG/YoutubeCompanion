// Opérations sur l'état : imports, enrichissement, file de retrait.
import { store } from './store.js';
import { compileRules, historyAffinity, normalizeText, viewMinutes } from './tagger.js';
import { fetchVideos, fetchSubscriptions, fetchDurations } from './google.js';

const S = () => store.state;

export function videosByStatus(...statuses) {
  return Object.values(S().videos).filter((v) => statuses.includes(v.status));
}

// Fusionne un nouvel export de « À regarder plus tard ».
export function importWatchLater(items) {
  const st = S();
  const incoming = new Set(items.map((i) => i.id));
  const res = { added: 0, updated: 0, gone: 0, purged: 0, total: items.length };
  const now = Date.now();
  for (const it of items) {
    const v = st.videos[it.id];
    if (!v) {
      st.videos[it.id] = {
        id: it.id,
        title: it.title || '',
        channelTitle: it.channelTitle || '',
        channelId: it.channelId || undefined,
        channelUrl: it.channelUrl || '',
        duration: it.duration ?? null,
        addedAt: it.addedAt || null,
        firstSeenAt: now,
        position: it.position,
        ytProgress: it.watched != null ? it.watched / 100 : undefined,
        status: 'active',
        progress: 0,
        manualTags: [],
        hiddenTags: [],
      };
      res.added++;
    } else {
      v.position = it.position;
      if (it.watched != null) v.ytProgress = it.watched / 100;
      if (it.title && !v.enriched) v.title = it.title;
      if (it.channelTitle && !v.channelTitle) v.channelTitle = it.channelTitle;
      if (it.channelId && !v.channelId) v.channelId = it.channelId;
      if (v.duration == null && it.duration != null) v.duration = it.duration;
      if (it.addedAt && !v.addedAt) v.addedAt = it.addedAt;
      if (v.status === 'gone' || v.status === 'removed') v.status = 'active';
      res.updated++;
    }
  }
  for (const v of Object.values(st.videos)) {
    if (incoming.has(v.id)) continue;
    if (v.status === 'active') { v.status = 'gone'; res.gone++; }
    else if (v.status === 'queued') { v.status = 'removed'; v.removedAt = now; res.purged++; }
  }
  st.wlImportedAt = now;
  store.changed('import');
  return res;
}

// Remplace les statistiques d'historique par celles du fichier importé.
export function importHistory(entries) {
  const st = S();
  const counts = {};
  const watched = new Set();
  // Sans dates (export HTML), on considère l'historique comme d'aujourd'hui.
  const fallbackDay = Math.floor(Date.now() / 864e5);
  for (const e of entries) {
    watched.add(e.id);
    const key = e.channelId || 'name:' + normalizeText(e.channelTitle);
    if (!e.channelTitle && !e.channelId) continue;
    const c = counts[key] || (counts[key] = { title: e.channelTitle, views: 0, lastView: 0, times: [] });
    c.views++;
    if (e.time > c.lastView) c.lastView = e.time;
    // [jour, minutes (inconnues pour l'instant), id de la vidéo pour aller chercher sa durée]
    c.times.push([e.time ? Math.floor(e.time / 864e5) : fallbackDay, null, e.id]);
  }
  for (const c of Object.values(st.channels)) { c.views = 0; c.lastView = 0; c.times = []; delete c.recent; delete c.heat; }
  for (const [key, c] of Object.entries(counts)) {
    const prev = st.channels[key] || {};
    // On garde les 60 visionnages les plus récents : largement assez pour la « chaleur ».
    const times = c.times.sort((a, b) => b[0] - a[0]).slice(0, 60);
    st.channels[key] = { ...prev, title: c.title || prev.title, views: c.views, lastView: c.lastView, times };
  }
  st.history = {
    importedAt: Date.now(),
    total: entries.length,
    watchedIds: [...watched],
    tagAffinity: historyAffinity(entries, compileRules(st.rules)),
  };
  store.changed('history');
  return { entries: entries.length, channels: Object.keys(counts).length, unique: watched.size };
}

// Durées des vidéos de l'historique (1 unité de quota par paquet de 50) : seulement la dernière
// année, au-delà la pondération temporelle les rend négligeables.
export function historyDurationsTodo() {
  const minDay = Math.floor(Date.now() / 864e5) - 400;
  const ids = new Set();
  for (const c of Object.values(S().channels)) {
    for (const t of c.times || []) if (Array.isArray(t) && t[1] == null && t[2] && t[0] >= minDay) ids.add(t[2]);
  }
  return [...ids];
}

export async function weightHistoryByDuration(onProgress) {
  const ids = historyDurationsTodo().slice(0, 25000);
  if (!ids.length) return { done: 0 };
  const asked = new Set(ids);
  const known = {};
  for (const v of Object.values(S().videos)) if (v.duration != null) known[v.id] = v.duration;
  const toFetch = ids.filter((id) => known[id] == null);
  const fetched = toFetch.length ? await fetchDurations(toFetch, onProgress) : {};
  Object.assign(known, fetched);
  for (const c of Object.values(S().channels)) {
    if (!Array.isArray(c.times)) continue;
    c.times = c.times.map((t) => {
      if (!Array.isArray(t) || t[1] != null) return t;
      const sec = t[2] ? known[t[2]] : undefined;
      if (sec == null && t[2] && asked.has(t[2])) return [t[0], viewMinutes(null)]; // supprimée / privée : 10 min
      if (sec === undefined) return t; // trop ancienne, durée non demandée
      return [t[0], Math.round(viewMinutes(sec) * 10) / 10];
    });
  }
  store.changed('history');
  return { done: ids.length };
}

export async function syncSubscriptions() {
  const subs = await fetchSubscriptions();
  const st = S();
  for (const c of Object.values(st.channels)) c.subscribed = false;
  for (const [id, title] of Object.entries(subs)) {
    st.channels[id] = { views: 0, lastView: 0, ...(st.channels[id] || {}), title, subscribed: true };
  }
  store.changed('subs');
  return Object.keys(subs).length;
}

// Récupère durée, tags, catégorie… pour les vidéos pas encore enrichies.
export async function enrichVideos({ all = false, onProgress } = {}) {
  const st = S();
  const ids = Object.values(st.videos)
    .filter((v) => v.status !== 'removed' && (all || !v.enriched))
    .map((v) => v.id);
  if (!ids.length) return { done: 0, missing: 0 };
  const info = await fetchVideos(ids, onProgress);
  let missing = 0;
  for (const id of ids) {
    const v = st.videos[id];
    const i = info[id];
    if (i) {
      Object.assign(v, i, { enriched: true, unavailable: false });
      // Fusion de l'éventuelle entrée « par nom » de l'historique avec l'id de chaîne.
      const nameKey = 'name:' + normalizeText(i.channelTitle);
      if (st.channels[nameKey] && !st.channels[i.channelId]) {
        st.channels[i.channelId] = st.channels[nameKey];
        delete st.channels[nameKey];
      } else if (!st.channels[i.channelId]) {
        st.channels[i.channelId] = { title: i.channelTitle, views: 0, lastView: 0 };
      }
    } else {
      v.enriched = true;
      v.unavailable = true;
      missing++;
    }
  }
  store.changed('enrich');
  return { done: ids.length, missing };
}

// Une vidéo regardée dans l'app compte aussi : les niveaux de créateurs bougent sans réimporter l'historique.
export function recordView(id) {
  const st = S();
  const v = st.videos[id];
  if (!v) return;
  const key = v.channelId || (v.channelTitle ? 'name:' + normalizeText(v.channelTitle) : null);
  if (!key) return;
  const c = st.channels[key] || (st.channels[key] = { title: v.channelTitle, views: 0, lastView: 0, times: [] });
  if (!Array.isArray(c.times)) c.times = [];
  c.views = (c.views || 0) + 1;
  c.lastView = Date.now();
  c.times.unshift([Math.floor(Date.now() / 864e5), Math.round(viewMinutes(v.duration) * 10) / 10]);
  c.times = c.times.slice(0, 60);
  st.history.watchedIds ||= [];
  if (!st.history.watchedIds.includes(id)) st.history.watchedIds.push(id);
  store.changed('view');
}

export function queueRemoval(id, reason = 'manuel') {
  const v = S().videos[id];
  if (!v || v.status === 'removed') return;
  v.status = 'queued';
  v.queuedReason = reason;
  v.queuedAt = Date.now();
  store.changed('queue');
}

// « Garder » une vidéo signalée comme déjà vue : elle ne sera plus proposée au retrait.
export function keepVideo(id) {
  const v = S().videos[id];
  if (!v) return;
  v.keep = true;
  store.changed('keep');
}

export function unqueue(id) {
  const v = S().videos[id];
  if (!v) return;
  v.status = 'active';
  v.keep = true;
  delete v.queuedReason;
  store.changed('queue');
}

export function markPurged() {
  const now = Date.now();
  let n = 0;
  for (const v of videosByStatus('queued')) { v.status = 'removed'; v.removedAt = now; n++; }
  store.changed('purge');
  return n;
}

export function setProgress(id, frac) {
  const v = S().videos[id];
  if (!v) return;
  if (frac > (v.progress || 0)) v.progress = Math.round(frac * 1000) / 1000;
  v.lastPlayedAt = Date.now();
  store.changed('progress', { touch: true });
}

export function toggleManualTag(id, tag, isAuto) {
  const v = S().videos[id];
  if (!v) return;
  v.manualTags ||= []; v.hiddenTags ||= [];
  if (v.manualTags.includes(tag)) v.manualTags = v.manualTags.filter((t) => t !== tag);
  else if (isAuto) {
    if (v.hiddenTags.includes(tag)) v.hiddenTags = v.hiddenTags.filter((t) => t !== tag);
    else v.hiddenTags.push(tag);
  } else v.manualTags.push(tag);
  store.changed('tags');
}

export function addManualTag(id, tag) {
  const v = S().videos[id];
  tag = tag.trim();
  if (!v || !tag) return;
  v.manualTags ||= []; v.hiddenTags ||= [];
  v.hiddenTags = v.hiddenTags.filter((t) => t !== tag);
  if (!v.manualTags.includes(tag)) v.manualTags.push(tag);
  store.changed('tags');
}

// Format texte éditable des règles : « groupe | Tag : mot1, mot2 »
export function rulesToText(rules) {
  return rules.map((r) => `${r.group} | ${r.tag} : ${r.keywords.join(', ')}`).join('\n');
}

export function textToRules(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([\w-]+)\s*\|\s*([^:]+?)\s*:\s*(.*)$/);
    if (!m) continue;
    const keywords = m[3].split(',').map((k) => k.trim()).filter(Boolean);
    if (keywords.length) out.push({ group: m[1].toLowerCase(), tag: m[2], keywords });
  }
  return out;
}
