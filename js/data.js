// Opérations sur l'état : imports, enrichissement, file de retrait.
import { store } from './store.js';
import { compileRules, historyAffinity, normalizeText } from './tagger.js';
import { fetchVideos, fetchSubscriptions } from './google.js';

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
        status: 'active',
        progress: 0,
        manualTags: [],
        hiddenTags: [],
      };
      res.added++;
    } else {
      v.position = it.position;
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
  // « Maintenant » = date du visionnage le plus récent de l'export (un export de la semaine
  // dernière reste pertinent). Sans dates (export HTML), tout compte comme récent.
  const ref = entries.reduce((m, e) => Math.max(m, e.time || 0), 0);
  const days = st.settings.recentDays || 90;
  const HALF_LIFE = 45 * 864e5;
  for (const e of entries) {
    watched.add(e.id);
    const key = e.channelId || 'name:' + normalizeText(e.channelTitle);
    if (!e.channelTitle && !e.channelId) continue;
    const c = counts[key] || (counts[key] = { title: e.channelTitle, views: 0, lastView: 0, recent: 0, heat: 0 });
    c.views++;
    if (e.time > c.lastView) c.lastView = e.time;
    const age = ref && e.time ? ref - e.time : 0;
    if (age <= days * 864e5) c.recent++;
    c.heat += Math.pow(0.5, age / HALF_LIFE);
  }
  for (const c of Object.values(st.channels)) { c.views = 0; c.lastView = 0; c.recent = 0; c.heat = 0; }
  for (const [key, c] of Object.entries(counts)) {
    const prev = st.channels[key] || {};
    st.channels[key] = { ...prev, title: c.title || prev.title, views: c.views, lastView: c.lastView, recent: c.recent, heat: Math.round(c.heat * 100) / 100 };
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

export function queueRemoval(id, reason = 'manuel') {
  const v = S().videos[id];
  if (!v || v.status === 'removed') return;
  v.status = 'queued';
  v.queuedReason = reason;
  v.queuedAt = Date.now();
  store.changed('queue');
}

export function unqueue(id) {
  const v = S().videos[id];
  if (!v) return;
  v.status = 'active';
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
