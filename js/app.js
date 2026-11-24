import { store } from './store.js';
import { GOOGLE_CLIENT_ID } from './config.js';
import {
  GROUPS, DEFAULT_RULES, buildContext, videoTags, autoTags, groupOfTag, relevance, similarity,
  formatDuration, normalizeText, channelKey, channelOf,
} from './tagger.js';
import { parseWatchLater, parseHistory, readFileText } from './importers.js';
import {
  importWatchLater, importHistory, syncSubscriptions, enrichVideos, queueRemoval, unqueue,
  markPurged, setProgress, toggleManualTag, addManualTag, videosByStatus, rulesToText, textToRules,
} from './data.js';
import { auth, driveLoad, driveSave, fetchMyPlaylists, addToPlaylist, createPlaylist } from './google.js';
import { Player } from './player.js';
import { BOOKMARKLETS } from './bookmarklets.js';

// ---------------------------------------------------------------- utilitaires
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const st = () => store.state;
const settings = () => store.state.settings;
const clientId = () => settings().clientId || GOOGLE_CLIENT_ID;
const thumbOf = (v) => v.thumb || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`;
const fmtDate = (t) => (t ? new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const SPEEDS = [1, 1.25, 1.5, 1.75, 2];

const ui = {
  view: 'library',
  filters: [],        // { type: 'tag'|'channel', value, label, neg }
  search: '',
  sort: 'relevance',
  limit: 60,
  panel: false,
  setupStep: 0,
  seed: Math.random(),
};

let ctx = null;
let tagCache = new Map();
function getCtx() {
  if (!ctx) {
    ctx = buildContext(st());
    tagCache = new Map();
  }
  return ctx;
}
function tagsOf(v) {
  getCtx();
  let t = tagCache.get(v.id);
  if (!t) { t = videoTags(v, ctx); tagCache.set(v.id, t); }
  return t;
}

function toast(msg, action) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { action.fn(); el.remove(); };
    el.appendChild(b);
  }
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), action ? 6000 : 3500);
  setTimeout(() => el.remove(), action ? 6600 : 4100);
}

function confirmBox(msg) { return Promise.resolve(window.confirm(msg)); }

// ---------------------------------------------------------------- synchro Drive
let syncTimer = null;
let syncState = 'off'; // off | idle | saving | error
function setSync(s) { syncState = s; renderHeader(); }

store.on((reason) => {
  if (reason !== 'progress') ctx = null;
  if (reason === 'persisted') scheduleSync();
});

function scheduleSync() {
  if (!auth.signedIn || !settings().sync) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try { setSync('saving'); await driveSave(st()); setSync('idle'); }
    catch (e) { console.warn(e); setSync('error'); }
  }, 4000);
}

async function pullSync() {
  if (!settings().sync) return;
  try {
    setSync('saving');
    const remote = await driveLoad();
    setSync('idle');
    if (!remote) { scheduleSync(); return; }
    const local = st();
    if ((remote.updatedAt || 0) > (local.updatedAt || 0)) {
      const hasLocal = Object.keys(local.videos).length > 0;
      if (!hasLocal || await confirmBox(`Une version plus récente de tes tags existe sur ton Google Drive (${fmtDate(remote.updatedAt)}). La charger sur cet appareil ?`)) {
        const keepClient = local.settings.clientId;
        store.replace(remote);
        if (keepClient && !store.state.settings.clientId) store.state.settings.clientId = keepClient;
        toast('Données synchronisées depuis Google Drive');
        render();
      }
    } else if ((remote.updatedAt || 0) < (local.updatedAt || 0)) {
      scheduleSync();
    }
  } catch (e) { console.warn(e); setSync('error'); }
}

async function signIn() {
  if (!clientId()) {
    toast('Renseigne d\'abord ton Client ID Google dans Réglages.');
    go('settings');
    return false;
  }
  try {
    await auth.signIn(clientId());
    toast('Connecté' + (auth.user?.title ? ' : ' + auth.user.title : ''));
    renderHeader();
    await pullSync();
    return true;
  } catch (e) {
    toast('Connexion impossible : ' + e.message);
    return false;
  }
}

async function needAuth() {
  if (auth.signedIn) return true;
  return signIn();
}

// ---------------------------------------------------------------- navigation
function go(view) {
  ui.view = view;
  window.scrollTo(0, 0);
  render();
}

function render() {
  renderHeader();
  document.body.dataset.view = ui.view;
  const main = $('#main');
  if (ui.view === 'setup') main.innerHTML = renderSetup();
  else if (ui.view === 'queue') main.innerHTML = renderQueue();
  else if (ui.view === 'import') main.innerHTML = renderImport();
  else if (ui.view === 'settings') main.innerHTML = renderSettings();
  else main.innerHTML = renderLibrary();
  afterRender();
}

function renderHeader() {
  const q = videosByStatus('queued').length;
  const a = videosByStatus('active').length;
  $('#nav').innerHTML = [
    ['library', `Liste <small>${a}</small>`],
    ['queue', `À retirer ${q ? `<small class="hot">${q}</small>` : ''}`],
    ['import', 'Import'],
    ['settings', 'Réglages'],
  ].map(([v, l]) => `<button class="${ui.view === v ? 'on' : ''}" data-go="${v}">${l}</button>`).join('');
  const syncIcon = { off: '', idle: '☁︎', saving: '⟳', error: '⚠︎' }[auth.signedIn && settings().sync ? syncState : 'off'];
  $('#account').innerHTML = auth.signedIn
    ? `<span class="sync ${syncState}" title="Synchro Google Drive">${syncIcon}</span><button class="ghost" data-act="signout" title="Se déconnecter">${esc(auth.user?.title || 'Connecté')}</button>`
    : `<button class="primary small" data-act="signin">Connexion Google</button>`;
}

// ---------------------------------------------------------------- bibliothèque
function matchesSearch(v, tags, terms) {
  if (!terms.length) return true;
  const hay = normalizeText([v.title, v.channelTitle, tags.join(' ')].join(' '));
  return terms.every((t) => hay.includes(t));
}

function applyFilters(list) {
  const c = getCtx();
  const terms = normalizeText(ui.search).split(/\s+/).filter(Boolean);
  return list.filter((v) => {
    const tags = tagsOf(v);
    if (!matchesSearch(v, tags, terms)) return false;
    for (const f of ui.filters) {
      let hit;
      if (f.type === 'tag') hit = tags.includes(f.value);
      else hit = channelKey(v, c) === f.value || (!channelKey(v, c) && v.channelTitle === f.label);
      if (hit === !!f.neg) return false;
    }
    return true;
  });
}

function sortList(list) {
  const c = getCtx();
  const by = {
    relevance: (a, b) => relevance(b, tagsOf(b), c) - relevance(a, tagsOf(a), c),
    order: (a, b) => (a.position ?? 1e9) - (b.position ?? 1e9),
    reverse: (a, b) => (b.position ?? -1) - (a.position ?? -1),
    short: (a, b) => (a.duration ?? 1e9) - (b.duration ?? 1e9),
    long: (a, b) => (b.duration ?? -1) - (a.duration ?? -1),
    published: (a, b) => (Date.parse(b.publishedAt || 0) || 0) - (Date.parse(a.publishedAt || 0) || 0),
    random: (a, b) => hashRand(a.id) - hashRand(b.id),
  }[ui.sort];
  return [...list].sort(by);
}

function hashRand(id) {
  let h = Math.floor(ui.seed * 1e9);
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 2654435761);
  return (h >>> 0) / 4294967296;
}

function currentList() {
  return sortList(applyFilters(videosByStatus('active')));
}

function chip(tag, { active, neg, count, removable, small } = {}) {
  const g = groupOfTag(tag, getCtx());
  return `<button class="chip g-${g} ${active ? 'on' : ''} ${neg ? 'neg' : ''} ${small ? 'sm' : ''}" data-act="tag" data-tag="${esc(tag)}">${neg ? '− ' : ''}${esc(tag)}${count != null ? ` <i>${count}</i>` : ''}${removable ? ' <b data-act="unfilter" data-tag="' + esc(tag) + '">×</b>' : ''}</button>`;
}

function renderLibrary() {
  const all = videosByStatus('active');
  if (!all.length) {
    return `<section class="empty">
      <h2>Ta liste est vide</h2>
      <p>Commence par importer ta playlist « À regarder plus tard ».</p>
      <button class="primary" data-go="${settings().setupDone ? 'import' : 'setup'}">Importer ma liste</button>
    </section>`;
  }
  const list = currentList();
  const shown = list.slice(0, ui.limit);
  const totalTime = list.reduce((s, v) => s + (v.duration || 0), 0);

  const active = ui.filters.map((f) => f.type === 'tag'
    ? chip(f.value, { active: true, neg: f.neg, removable: true })
    : `<button class="chip g-chan on ${f.neg ? 'neg' : ''}" data-act="unfilter-chan" data-chan="${esc(f.value)}">${f.neg ? '− ' : ''}▶ ${esc(f.label)} <b>×</b></button>`).join('');

  return `
  <section class="toolbar">
    <div class="searchrow">
      <input id="search" type="search" placeholder="Rechercher un titre, une chaîne, un tag…" value="${esc(ui.search)}" autocomplete="off">
      <select id="sort" aria-label="Trier">
        ${[['relevance', 'Pour moi'], ['order', 'Ordre de la liste'], ['reverse', 'Ordre inversé'], ['short', 'Plus courtes'], ['long', 'Plus longues'], ['published', 'Publiées récemment'], ['random', 'Aléatoire']]
          .map(([k, l]) => `<option value="${k}" ${ui.sort === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="filterrow">
      <button class="chip tagsbtn ${ui.panel ? 'on' : ''}" data-act="panel">🏷 Tags</button>
      ${active}
      ${ui.filters.length || ui.search ? '<button class="linkbtn" data-act="clear">Tout effacer</button>' : ''}
    </div>
    ${ui.panel ? renderFacets(list) : ''}
    <div class="summary">
      <span><b>${list.length}</b> vidéo${list.length > 1 ? 's' : ''}${totalTime ? ` · ${Math.round(totalTime / 3600)} h` : ''}</span>
      <span class="actions">
        <button class="ghost small" data-act="surprise">🎲 Surprends-moi</button>
        ${(ui.filters.length || ui.search) && list.length ? `<button class="ghost small" data-act="bulkqueue">Retirer ces ${list.length}</button>` : ''}
      </span>
    </div>
  </section>
  <section class="grid">${shown.map(card).join('')}</section>
  ${list.length > shown.length ? `<div class="more"><button class="ghost" data-act="more">Afficher plus (${list.length - shown.length})</button></div>` : ''}
  ${!list.length ? '<p class="empty">Aucune vidéo ne correspond. Essaie d\'enlever un filtre.</p>' : ''}`;
}

function renderFacets(list) {
  const c = getCtx();
  const counts = {};
  for (const v of list) for (const t of tagsOf(v)) counts[t] = (counts[t] || 0) + 1;
  const activeTags = new Map(ui.filters.filter((f) => f.type === 'tag').map((f) => [f.value, f]));
  const byGroup = {};
  for (const [t, n] of Object.entries(counts)) (byGroup[groupOfTag(t, c)] ||= []).push([t, n]);
  return `<div class="facets">
    <p class="hint">Touche un tag pour filtrer, touche-le à nouveau pour l'exclure, une 3ᵉ fois pour l'enlever.</p>
    ${GROUPS.filter((g) => byGroup[g.id]).map((g) => `
      <div class="facet"><h4>${g.label}</h4><div>
        ${byGroup[g.id].sort((a, b) => b[1] - a[1]).map(([t, n]) => chip(t, { count: n, active: activeTags.has(t), neg: activeTags.get(t)?.neg })).join('')}
      </div></div>`).join('')}
  </div>`;
}

function card(v) {
  const tags = tagsOf(v);
  const shownTags = tags.filter((t) => !['Rapide', 'Court', 'Moyen', 'Long', 'Très long'].includes(t)).slice(0, 4);
  return `<article class="card" data-id="${v.id}">
    <button class="thumb" data-act="open" aria-label="Lire">
      <img loading="lazy" src="${esc(thumbOf(v))}" alt="" onerror="this.style.visibility='hidden'">
      ${v.duration != null ? `<span class="dur">${formatDuration(v.duration)}</span>` : ''}
      ${v.progress > 0.02 ? `<span class="prog" style="width:${Math.round(v.progress * 100)}%"></span>` : ''}
    </button>
    <div class="meta">
      <h3 data-act="open">${esc(v.title || 'Vidéo ' + v.id)}</h3>
      <button class="chan" data-act="channel">${esc(v.channelTitle || 'Chaîne inconnue')}</button>
      <div class="tags">${shownTags.map((t) => chip(t, { small: true })).join('')}</div>
    </div>
    <button class="rm" data-act="queue" title="Retirer de la liste" aria-label="Retirer de la liste">✕</button>
  </article>`;
}

function toggleTagFilter(tag) {
  const i = ui.filters.findIndex((f) => f.type === 'tag' && f.value === tag);
  if (i === -1) ui.filters.push({ type: 'tag', value: tag });
  else if (!ui.filters[i].neg) ui.filters[i].neg = true;
  else ui.filters.splice(i, 1);
  ui.limit = 60;
}

// ---------------------------------------------------------------- lecteur
let player = null;
let current = null;
let playlistsCache = null;

function openVideo(id) {
  const v = st().videos[id];
  if (!v) return;
  current = v;
  const dlg = $('#video');
  const tags = tagsOf(v);
  const auto = new Set(autoTags(v, getCtx()));
  const hidden = v.hiddenTags || [];
  const c = getCtx();
  const similar = videosByStatus('active')
    .map((o) => [o, similarity(v, tags, o, tagsOf(o), c)])
    .filter(([, s]) => s > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([o]) => o);
  const allTags = new Set();
  for (const o of Object.values(st().videos)) (o.manualTags || []).forEach((t) => allTags.add(t));
  for (const r of st().rules || DEFAULT_RULES) allTags.add(r.tag);
  const ch = channelOf(v, c);

  dlg.innerHTML = `
  <div class="vwrap">
    <div class="vtop">
      <button class="ghost" data-act="close" aria-label="Fermer">← Retour</button>
      <div class="speeds">${SPEEDS.map((s) => `<button class="speed ${s === (settings().defaultSpeed || 1) ? 'on' : ''}" data-act="speed" data-speed="${s}">×${String(s).replace('.', ',')}</button>`).join('')}</div>
    </div>
    <div class="frame"><div id="yt"></div></div>
    <div id="endsheet" hidden></div>
    <div class="vbody">
      <h2>${esc(v.title || v.id)}</h2>
      <p class="sub"><button class="chan" data-act="channel-modal">${esc(v.channelTitle || '')}</button>
        ${ch?.views ? ` · ${ch.views} vue${ch.views > 1 ? 's' : ''} dans ton historique` : ''}
        ${v.duration != null ? ` · ${formatDuration(v.duration)}` : ''}
        ${v.publishedAt ? ` · publiée le ${fmtDate(v.publishedAt)}` : ''}</p>
      <div class="vactions">
        <button class="primary" data-act="done">✓ Vue, retirer de la liste</button>
        <button class="ghost" data-act="playlist">＋ Playlist…</button>
        <a class="ghost btn" href="https://www.youtube.com/watch?v=${v.id}${v.progress > 0.02 && v.duration ? '&t=' + Math.floor(v.progress * v.duration) : ''}" target="_blank" rel="noopener">Ouvrir dans YouTube ↗</a>
      </div>
      <div class="vtags">
        ${tags.map((t) => `<span class="chip g-${groupOfTag(t, c)}"><span data-act="tag-modal" data-tag="${esc(t)}">${esc(t)}</span><b data-act="toggletag" data-tag="${esc(t)}" data-auto="${auto.has(t) ? 1 : 0}" title="Retirer ce tag">×</b></span>`).join('')}
        ${hidden.map((t) => `<span class="chip ghosted"><span data-act="toggletag" data-tag="${esc(t)}" data-auto="1" title="Remettre ce tag">↺ ${esc(t)}</span></span>`).join('')}
        <form class="addtag" data-act="addtag"><input list="alltags" placeholder="+ tag" aria-label="Ajouter un tag"><datalist id="alltags">${[...allTags].sort().map((t) => `<option value="${esc(t)}">`).join('')}</datalist></form>
      </div>
      ${v.desc ? `<p class="desc">${esc(v.desc)}…</p>` : ''}
      ${similar.length ? `<h3>Dans le même genre</h3><div class="grid small">${similar.map(card).join('')}</div>` : ''}
    </div>
  </div>`;
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  startPlayer(v);
}

function startPlayer(v) {
  player?.destroy();
  const start = v.progress > 0.02 && v.progress < 0.97 && v.duration ? v.progress * v.duration - 3 : 0;
  player = new Player($('#yt'), {
    videoId: v.id,
    start: Math.max(0, start),
    speed: settings().defaultSpeed || 1,
    threshold: settings().watchedThreshold,
    onProgress: (frac) => setProgress(v.id, frac),
    onThreshold: (frac) => onWatched(v, frac),
    onEnded: () => showEndSheet(v, true),
    onError: (code) => {
      const msg = code === 101 || code === 150 ? 'Le créateur a désactivé la lecture en dehors de YouTube.' : 'Lecture impossible ici (code ' + code + ').';
      $('#yt').outerHTML = `<div class="playerror"><p>${msg}</p><a class="primary btn" href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener">Regarder sur YouTube ↗</a></div>`;
    },
  });
}

function onWatched(v, frac) {
  if (v.status === 'active') queueRemoval(v.id, `vue à ${Math.round(frac * 100)} %`);
  showEndSheet(v, false);
}

function showEndSheet(v, ended) {
  const sheet = $('#endsheet');
  if (!sheet || current?.id !== v.id) return;
  if (v.status === 'active' && ended) queueRemoval(v.id, 'vue en entier');
  const c = getCtx();
  const next = videosByStatus('active')
    .filter((o) => o.id !== v.id)
    .map((o) => [o, similarity(v, tagsOf(v), o, tagsOf(o), c)])
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  const last = settings().lastPlaylist;
  sheet.hidden = false;
  sheet.classList.toggle('full', ended);
  sheet.innerHTML = `
    <p><b>${v.status === 'queued' ? 'Vidéo vue : retirée de ta liste.' : 'Vidéo terminée.'}</b></p>
    <div class="row">
      ${v.status === 'queued' ? '<button class="ghost small" data-act="keep">Garder dans la liste</button>' : ''}
      ${last ? `<button class="ghost small" data-act="addlast">＋ ${esc(last.title)}</button>` : ''}
      <button class="ghost small" data-act="playlist">＋ Autre playlist…</button>
      ${next ? `<button class="primary small" data-act="next" data-id="${next.id}">Suivante : ${esc(next.title.slice(0, 40))}${next.title.length > 40 ? '…' : ''} →</button>` : ''}
      <button class="linkbtn" data-act="hidesheet">Masquer</button>
    </div>`;
}

function closeVideo() {
  player?.destroy();
  player = null;
  current = null;
  const dlg = $('#video');
  if (dlg.open) dlg.close();
  dlg.innerHTML = '';
  render();
}

async function choosePlaylist(v) {
  if (!(await needAuth())) return;
  const dlg = $('#picker');
  dlg.innerHTML = '<div class="pick"><p>Chargement de tes playlists…</p></div>';
  dlg.showModal();
  try {
    playlistsCache ||= await fetchMyPlaylists();
  } catch (e) {
    dlg.innerHTML = `<div class="pick"><p>Erreur : ${esc(e.message)}</p><button class="ghost" data-act="pickclose">Fermer</button></div>`;
    return;
  }
  dlg.innerHTML = `<div class="pick">
    <h3>Ajouter à une playlist</h3>
    <div class="plist">${playlistsCache.map((p) => `<button class="ghost" data-act="pick" data-pl="${esc(p.id)}" data-title="${esc(p.title)}">${esc(p.title)} <i>${p.count ?? ''}</i></button>`).join('') || '<p>Aucune playlist.</p>'}</div>
    <form data-act="newpl" class="row"><input placeholder="Nouvelle playlist (privée)" required><button class="primary small">Créer</button></form>
    <button class="linkbtn" data-act="pickclose">Annuler</button>
  </div>`;
  dlg.dataset.video = v.id;
}

async function addTo(pl, title, videoId) {
  try {
    await addToPlaylist(pl, videoId);
    settings().lastPlaylist = { id: pl, title };
    store.changed('settings');
    toast(`Ajoutée à « ${title} »`);
    const p = playlistsCache?.find((x) => x.id === pl); if (p && p.count != null) p.count++;
  } catch (e) { toast('Ajout impossible : ' + e.message); }
}

// ---------------------------------------------------------------- file de retrait
function renderQueue() {
  const q = videosByStatus('queued').sort((a, b) => (b.queuedAt || 0) - (a.queuedAt || 0));
  const removed = videosByStatus('removed').length;
  return `<section class="panel">
    <h2>À retirer de YouTube</h2>
    <p>L'API YouTube ne permet pas de modifier « À regarder plus tard ». Les vidéos retirées ici sont donc masquées dans l'app, puis supprimées de YouTube en une fois depuis un ordinateur :</p>
    <ol class="steps">
      <li>Installe le favori <a class="bm" href="${esc(BOOKMARKLETS.purge.href)}" onclick="return false" draggable="true">${BOOKMARKLETS.purge.name}</a> (glisse-le dans ta barre de favoris) — ou <button class="linkbtn" data-act="copycode" data-bm="purge">copie le code</button> pour la console.</li>
      <li><button class="primary small" data-act="copyids" ${q.length ? '' : 'disabled'}>Copier la liste (${q.length})</button></li>
      <li>Sur youtube.com, clique sur le favori et colle la liste.</li>
      <li><button class="ghost small" data-act="purged" ${q.length ? '' : 'disabled'}>C'est fait : marquer comme retirées</button></li>
    </ol>
    <p class="hint">Astuce : au prochain import de ta liste, les vidéos qui n'y sont plus sont automatiquement marquées comme retirées.${removed ? ` ${removed} vidéo(s) déjà retirée(s) au total.` : ''}</p>
  </section>
  ${q.length ? `<section class="qlist">${q.map((v) => `<div class="qrow" data-id="${v.id}">
      <img loading="lazy" src="${esc(thumbOf(v))}" alt="">
      <div><b>${esc(v.title || v.id)}</b><small>${esc(v.channelTitle)} · ${esc(v.queuedReason || '')}</small></div>
      <button class="ghost small" data-act="unqueue">Garder</button>
    </div>`).join('')}</section>` : '<p class="empty">Rien à retirer pour l\'instant.</p>'}`;
}

// ---------------------------------------------------------------- import
function bookmarkletBlock(kind, label) {
  const b = BOOKMARKLETS[kind];
  return `<div class="bmblock">
    <a class="bm" href="${esc(b.href)}" onclick="return false" draggable="true">${b.name}</a>
    <span>${label}</span>
    <button class="linkbtn" data-act="copycode" data-bm="${kind}">Copier le code</button>
  </div>`;
}

function wlSteps() {
  return `<ol class="steps">
    <li>Sur un <b>ordinateur</b>, glisse ce bouton dans ta barre de favoris :
      ${bookmarkletBlock('export', '')}</li>
    <li>Ouvre <a href="https://www.youtube.com/playlist?list=WL" target="_blank" rel="noopener">youtube.com/playlist?list=WL</a>, connecté à ton compte, puis clique sur le favori. La page défile toute seule (1 à 2 min pour 3 000 vidéos) et un fichier JSON est téléchargé.</li>
    <li>Importe ce fichier ici. Tu peux aussi utiliser le CSV « À regarder plus tard » de Google Takeout s'il figure dans ton export.</li>
  </ol>
  <label class="drop" data-drop="wl"><input type="file" accept=".json,.csv,.txt" data-file="wl" hidden><span>📂 Choisir le fichier de ma liste</span></label>`;
}

function historySteps() {
  return `<ol class="steps">
    <li>Va sur <a href="https://takeout.google.com/" target="_blank" rel="noopener">takeout.google.com</a>, clique « Tout désélectionner » puis coche seulement <b>YouTube et YouTube Music</b>.</li>
    <li>Dans « Toutes les données YouTube incluses », garde <b>historique</b> ; dans « Formats multiples », choisis <b>JSON</b> pour l'historique.</li>
    <li>Une fois l'archive reçue par e-mail, décompresse-la et importe <code>Takeout/YouTube…/historique/watch-history.json</code> (ou .html).</li>
  </ol>
  <label class="drop" data-drop="history"><input type="file" accept=".json,.html" data-file="history" hidden><span>📂 Choisir watch-history.json</span></label>`;
}

function googleBlock() {
  const n = videosByStatus('active', 'queued').length;
  const todo = Object.values(st().videos).filter((v) => !v.enriched && v.status !== 'removed').length;
  const subs = Object.values(st().channels).filter((c) => c.subscribed).length;
  return `<p>La connexion Google récupère la durée, les tags et la catégorie de chaque vidéo, ainsi que tes abonnements (pour « Créateur préféré » / « Abonné »).</p>
  <ul class="stats">
    <li>${n} vidéos dans ta liste, <b>${todo}</b> sans infos détaillées</li>
    <li>${subs} abonnements connus</li>
  </ul>
  <div class="row">
    <button class="primary" data-act="enrich">${auth.signedIn ? 'Mettre à jour depuis YouTube' : 'Se connecter et récupérer les infos'}</button>
    ${n ? '<button class="ghost small" data-act="enrichall">Tout rafraîchir</button>' : ''}
  </div>
  <div id="enrichprog"></div>`;
}

function renderImport() {
  const h = st().history;
  return `<section class="panel">
    <h2>1. Ta liste « À regarder plus tard »</h2>
    <p class="hint">Dernier import : ${fmtDate(st().wlImportedAt)}</p>
    ${wlSteps()}
  </section>
  <section class="panel">
    <h2>2. Ton historique</h2>
    <p class="hint">${h.total ? `${h.total} visionnages importés le ${fmtDate(h.importedAt)}` : 'Pas encore importé.'} Il sert à repérer tes créateurs habituels, les « Aliens », les vidéos déjà vues et tes thèmes favoris.</p>
    ${historySteps()}
  </section>
  <section class="panel">
    <h2>3. Infos YouTube</h2>
    ${googleBlock()}
  </section>`;
}

async function handleFile(kind, file) {
  try {
    const text = await readFileText(file);
    if (kind === 'wl') {
      const items = parseWatchLater(text, file.name);
      if (!items.length) throw new Error('aucune vidéo trouvée dans ce fichier');
      const r = importWatchLater(items);
      toast(`${r.total} vidéos : ${r.added} nouvelles${r.gone ? `, ${r.gone} disparues de la liste` : ''}${r.purged ? `, ${r.purged} retraits confirmés` : ''}`);
    } else {
      const entries = parseHistory(text);
      if (!entries.length) throw new Error('aucun visionnage trouvé (as-tu choisi le format JSON ?)');
      const r = importHistory(entries);
      toast(`Historique : ${r.entries} visionnages, ${r.channels} chaînes`);
    }
    render();
  } catch (e) {
    toast('Import impossible : ' + e.message);
  }
}

async function runEnrich(all = false) {
  if (!(await needAuth())) return;
  const prog = $('#enrichprog');
  const say = (t) => { if (prog) prog.innerHTML = `<p class="hint">${t}</p>`; };
  try {
    say('Abonnements…');
    const subs = await syncSubscriptions();
    const r = await enrichVideos({ all, onProgress: (d, t) => say(`Infos vidéos : ${d} / ${t}`) });
    toast(`${subs} abonnements, ${r.done} vidéos mises à jour${r.missing ? `, ${r.missing} indisponibles` : ''}`);
    if (ui.view === 'setup') { ui.setupStep++; }
    render();
  } catch (e) {
    say('Erreur : ' + esc(e.message));
    if (e.status === 403) toast('Quota YouTube dépassé ou API non activée dans Google Cloud.');
  }
}

// ---------------------------------------------------------------- réglages
function topChannels(n = 30) {
  return Object.entries(st().channels)
    .filter(([, c]) => c.views || c.subscribed)
    .sort((a, b) => (b[1].views || 0) - (a[1].views || 0))
    .slice(0, n);
}

function renderSettings() {
  const s = settings();
  const fav = new Set(s.favChannels), ban = new Set(s.bannedChannels);
  const rules = st().rules || DEFAULT_RULES;
  return `<section class="panel">
    <h2>Compte Google</h2>
    <label class="field">Client ID OAuth
      <input id="clientId" value="${esc(s.clientId)}" placeholder="${GOOGLE_CLIENT_ID ? 'Celui de l\'app est utilisé par défaut' : 'xxxx.apps.googleusercontent.com'}">
    </label>
    <p class="hint">Nécessaire seulement si tu héberges ta propre copie de l'app. Voir le README pour le créer.</p>
    <label class="check"><input type="checkbox" id="sync" ${s.sync ? 'checked' : ''}> Synchroniser mes tags entre mes appareils (dossier caché de mon Google Drive)</label>
  </section>
  <section class="panel">
    <h2>Règles automatiques</h2>
    <div class="fields">
      ${numField('quickMax', 'Vidéo « Rapide » jusqu\'à (minutes)', s.quickMax / 60)}
      ${numField('favMinViews', '« Préféré » / « Habitué » à partir de (vues dans l\'historique)', s.favMinViews)}
      ${numField('alienMaxViews', '« Alien » jusqu\'à (vues de la chaîne)', s.alienMaxViews)}
      ${numField('watchedThreshold', 'Retirer automatiquement après (% regardé)', Math.round(s.watchedThreshold * 100))}
      <label class="field">Vitesse par défaut
        <select id="defaultSpeed">${SPEEDS.map((x) => `<option value="${x}" ${x === s.defaultSpeed ? 'selected' : ''}>×${x}</option>`).join('')}</select>
      </label>
    </div>
  </section>
  <section class="panel">
    <h2>Créateurs</h2>
    <p class="hint">★ = toujours préféré · ⊘ = jamais préféré. Classés par nombre de vues dans ton historique.</p>
    <div class="chans">${topChannels(40).map(([id, c]) => `<div class="chanrow" data-chan="${esc(id)}">
      <span>${esc(c.title)} <small>${c.views || 0} vues${c.subscribed ? ' · abonné' : ''}</small></span>
      <button class="ghost small ${fav.has(id) ? 'on' : ''}" data-act="fav">★</button>
      <button class="ghost small ${ban.has(id) ? 'on' : ''}" data-act="ban">⊘</button>
    </div>`).join('') || '<p class="hint">Importe ton historique pour voir tes créateurs.</p>'}</div>
  </section>
  <section class="panel">
    <h2>Thèmes et mots-clés</h2>
    <p class="hint">Une ligne par tag : <code>groupe | Tag : mot-clé, autre mot-clé</code>. Groupes : logiciel, techno, sujet, mood (ou un groupe à toi). Les mots-clés sont cherchés dans le titre, les tags YouTube et le nom de la chaîne.</p>
    <textarea id="rules" rows="14" spellcheck="false">${esc(rulesToText(rules))}</textarea>
    <div class="row"><button class="primary small" data-act="saverules">Enregistrer les règles</button><button class="linkbtn" data-act="resetrules">Revenir aux règles par défaut</button></div>
  </section>
  <section class="panel">
    <h2>Données</h2>
    <div class="row">
      <button class="ghost small" data-act="backup">Exporter une sauvegarde</button>
      <label class="ghost small btn">Restaurer…<input type="file" accept=".json" data-file="backup" hidden></label>
      <button class="ghost small" data-act="rerunsetup">Relancer la configuration</button>
      <button class="ghost small danger" data-act="reset">Tout effacer</button>
    </div>
  </section>`;
}

function numField(id, label, value) {
  return `<label class="field">${label}<input type="number" min="0" step="1" data-setting="${id}" value="${value}"></label>`;
}

function saveSetting(id, raw) {
  const s = settings();
  const n = Number(raw);
  if (id === 'quickMax') s.quickMax = Math.max(0, n) * 60;
  else if (id === 'watchedThreshold') s.watchedThreshold = Math.min(1, Math.max(0.3, n / 100));
  else s[id] = Math.max(0, n);
  store.changed('settings');
}

function toggleChannelList(listName, id) {
  const s = settings();
  const other = listName === 'favChannels' ? 'bannedChannels' : 'favChannels';
  s[other] = s[other].filter((x) => x !== id);
  s[listName] = s[listName].includes(id) ? s[listName].filter((x) => x !== id) : [...s[listName], id];
  store.changed('settings');
}

// ---------------------------------------------------------------- configuration guidée
const SETUP_STEPS = ['Bienvenue', 'Ta liste', 'Ton historique', 'Infos YouTube', 'Tes goûts'];

function renderSetup() {
  const i = ui.setupStep;
  const s = settings();
  const nVideos = Object.keys(st().videos).length;
  let body = '';
  if (i === 0) {
    body = `<h2>Range enfin ta liste « À regarder plus tard »</h2>
      <p>YouTube Companion importe ta liste et ton historique, tague chaque vidéo (durée, créateur, sujet, logiciel, format…) et t'aide à choisir quoi regarder. Quand une vidéo est vue à plus de ${Math.round(s.watchedThreshold * 100)} %, elle sort de la liste.</p>
      <p class="hint">Tes données restent dans ton navigateur (et, si tu le souhaites, dans un dossier caché de ton Google Drive). Rien n'est envoyé ailleurs.</p>
      ${clientId() ? '' : `<label class="field">Client ID Google (voir README)<input id="clientId" placeholder="xxxx.apps.googleusercontent.com" value="${esc(s.clientId)}"></label>`}
      <div class="row">${auth.signedIn ? `<p>✓ Connecté : ${esc(auth.user?.title || '')}</p>` : '<button class="primary" data-act="signin">Se connecter avec Google</button>'}</div>`;
  } else if (i === 1) {
    body = `<h2>Importe ta liste</h2>${nVideos ? `<p>✓ ${nVideos} vidéos importées.</p>` : ''}${wlSteps()}`;
  } else if (i === 2) {
    const h = st().history;
    body = `<h2>Importe ton historique <small>(optionnel mais conseillé)</small></h2>
      <p>C'est ce qui permet de repérer tes créateurs préférés, les « Aliens » et les vidéos déjà vues. L'export Takeout peut prendre de quelques minutes à quelques heures : tu peux passer cette étape et revenir plus tard dans Import.</p>
      ${h.total ? `<p>✓ ${h.total} visionnages importés.</p>` : ''}${historySteps()}`;
  } else if (i === 3) {
    body = `<h2>Récupère les infos des vidéos</h2>${googleBlock()}`;
  } else {
    body = renderTasteQuestions();
  }
  return `<section class="setup">
    <ol class="progress">${SETUP_STEPS.map((l, k) => `<li class="${k === i ? 'on' : ''} ${k < i ? 'done' : ''}">${l}</li>`).join('')}</ol>
    <div class="panel">${body}</div>
    <div class="row setupnav">
      ${i > 0 ? '<button class="ghost" data-act="setup-prev">← Précédent</button>' : '<span></span>'}
      ${i < SETUP_STEPS.length - 1
        ? `<button class="primary" data-act="setup-next">${(i === 1 && !nVideos) || i === 2 || i === 3 ? 'Passer / continuer →' : 'Continuer →'}</button>`
        : '<button class="primary" data-act="setup-done">C\'est parti !</button>'}
    </div>
  </section>`;
}

function renderTasteQuestions() {
  const s = settings();
  const c = getCtx();
  const counts = {};
  for (const v of videosByStatus('active')) {
    for (const t of tagsOf(v)) {
      const g = groupOfTag(t, c);
      if (['logiciel', 'techno', 'sujet', 'mood'].includes(g)) counts[t] = (counts[t] || 0) + 1;
    }
  }
  const themes = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 30);
  const interests = new Set(s.interests);
  const fav = new Set(s.favChannels);
  const radio = (name, options, value) => `<div class="radios">${options.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}" ${v == value ? 'checked' : ''}> ${l}</label>`).join('')}</div>`;
  return `<h2>Quelques questions</h2>
    <h4>Une vidéo « rapide », c'est moins de…</h4>
    ${radio('q-quickMax', [[180, '3 min'], [300, '5 min'], [600, '10 min'], [900, '15 min']], s.quickMax)}
    <h4>On retire une vidéo de la liste quand tu en as vu…</h4>
    ${radio('q-watchedThreshold', [[0.7, '70 %'], [0.8, '80 %'], [0.9, '90 %'], [0.98, 'Toute la vidéo']], s.watchedThreshold)}
    <h4>Un créateur devient « préféré » (si tu es abonné) ou « habitué » à partir de…</h4>
    ${radio('q-favMinViews', [[3, '3 vidéos vues'], [5, '5 vidéos'], [10, '10 vidéos'], [20, '20 vidéos']], s.favMinViews)}
    <h4>Ce qui t'intéresse le plus en ce moment <small>(mis en avant dans « Pour moi »)</small></h4>
    <div class="tags">${themes.map(([t, n]) => `<button class="chip g-${groupOfTag(t, c)} ${interests.has(t) ? 'on' : ''}" data-act="interest" data-tag="${esc(t)}">${esc(t)} <i>${n}</i></button>`).join('') || '<p class="hint">Les thèmes apparaîtront après l\'import de ta liste.</p>'}</div>
    <h4>Tes créateurs préférés</h4>
    <div class="tags">${topChannels(20).map(([id, ch]) => `<button class="chip g-createur ${fav.has(id) ? 'on' : ''}" data-act="favchip" data-chan="${esc(id)}">${esc(ch.title)} <i>${ch.views || 0}</i></button>`).join('') || '<p class="hint">Importe ton historique pour avoir des suggestions.</p>'}</div>
    <p class="hint">Tout se modifie ensuite dans Réglages, y compris les mots-clés de chaque thème.</p>`;
}

// ---------------------------------------------------------------- événements
function afterRender() {
  const search = $('#search');
  if (search) {
    search.oninput = debounce(() => { ui.search = search.value; ui.limit = 60; rerenderKeepFocus(); }, 200);
  }
  const sort = $('#sort');
  if (sort) sort.onchange = () => { ui.sort = sort.value; ui.seed = Math.random(); render(); };
  document.querySelectorAll('[data-setting]').forEach((el) => { el.onchange = () => saveSetting(el.dataset.setting, el.value); });
  const cid = $('#clientId');
  if (cid) cid.onchange = () => { settings().clientId = cid.value.trim(); store.changed('settings'); };
  const sync = $('#sync');
  if (sync) sync.onchange = () => { settings().sync = sync.checked; store.changed('settings'); if (sync.checked) pullSync(); };
  const sp = $('#defaultSpeed');
  if (sp) sp.onchange = () => { settings().defaultSpeed = Number(sp.value); store.changed('settings'); };
  document.querySelectorAll('input[type=radio][name^="q-"]').forEach((el) => {
    el.onchange = () => { settings()[el.name.slice(2)] = Number(el.value); store.changed('settings'); };
  });
  document.querySelectorAll('.drop').forEach((el) => {
    el.ondragover = (e) => { e.preventDefault(); el.classList.add('over'); };
    el.ondragleave = () => el.classList.remove('over');
    el.ondrop = (e) => { e.preventDefault(); el.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) handleFile(el.dataset.drop, f); };
  });
}

function rerenderKeepFocus() {
  const pos = $('#search')?.selectionStart;
  render();
  const s = $('#search');
  if (s) { s.focus(); try { s.setSelectionRange(pos, pos); } catch { /* rien */ } }
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

document.addEventListener('change', (e) => {
  const inp = e.target.closest('input[type=file][data-file]');
  if (!inp || !inp.files[0]) return;
  const kind = inp.dataset.file;
  const f = inp.files[0];
  inp.value = '';
  if (kind === 'backup') restoreBackup(f); else handleFile(kind, f);
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  e.preventDefault();
  if (form.dataset.act === 'addtag' && current) {
    const val = form.querySelector('input').value;
    addManualTag(current.id, val);
    refreshModalTags();
  } else if (form.dataset.act === 'newpl') {
    const title = form.querySelector('input').value.trim();
    const vid = $('#picker').dataset.video;
    if (!title) return;
    createPlaylist(title).then((p) => {
      playlistsCache = null;
      $('#picker').close();
      return addTo(p.id, title, vid);
    }).catch((err) => toast('Création impossible : ' + err.message));
  }
});

function refreshModalTags() {
  if (!current) return;
  // Re-render léger : on garde le lecteur, on remplace seulement la zone des tags.
  ctx = null;
  const v = current;
  const c = getCtx();
  const tags = tagsOf(v);
  const auto = new Set(autoTags(v, c));
  const wrap = $('#video .vtags');
  const form = wrap.querySelector('form');
  wrap.querySelectorAll('.chip').forEach((el) => el.remove());
  const html = tags.map((t) => `<span class="chip g-${groupOfTag(t, c)}"><span data-act="tag-modal" data-tag="${esc(t)}">${esc(t)}</span><b data-act="toggletag" data-tag="${esc(t)}" data-auto="${auto.has(t) ? 1 : 0}">×</b></span>`).join('')
    + (v.hiddenTags || []).map((t) => `<span class="chip ghosted"><span data-act="toggletag" data-tag="${esc(t)}" data-auto="1">↺ ${esc(t)}</span></span>`).join('');
  form.insertAdjacentHTML('beforebegin', html);
  form.querySelector('input').value = '';
}

document.addEventListener('click', async (e) => {
  const goBtn = e.target.closest('[data-go]');
  if (goBtn) { if ($('#video').open) closeVideo(); go(goBtn.dataset.go); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const cardEl = el.closest('[data-id]');
  const id = el.dataset.id || cardEl?.dataset.id;

  switch (act) {
    case 'signin': await signIn(); render(); break;
    case 'signout': if (await confirmBox('Se déconnecter de Google ?')) { auth.signOut(); render(); } break;
    case 'open': if ($('#video').open) { player?.destroy(); } openVideo(id); break;
    case 'queue': {
      queueRemoval(id, 'manuel');
      render();
      toast('Retirée de la liste', { label: 'Annuler', fn: () => { unqueue(id); render(); } });
      break;
    }
    case 'unqueue': unqueue(id); render(); break;
    case 'tag': {
      toggleTagFilter(el.dataset.tag);
      if (ui.view !== 'library') ui.view = 'library';
      render();
      break;
    }
    case 'unfilter': ui.filters = ui.filters.filter((f) => !(f.type === 'tag' && f.value === el.dataset.tag)); render(); break;
    case 'unfilter-chan': ui.filters = ui.filters.filter((f) => !(f.type === 'channel' && f.value === el.dataset.chan)); render(); break;
    case 'channel': case 'channel-modal': {
      const v = st().videos[id || current?.id];
      if (!v) break;
      const key = channelKey(v, getCtx()) || 'title:' + v.channelTitle;
      if (!ui.filters.some((f) => f.type === 'channel' && f.value === key)) ui.filters.push({ type: 'channel', value: key, label: v.channelTitle });
      if (act === 'channel-modal') closeVideo();
      ui.view = 'library';
      render();
      break;
    }
    case 'tag-modal': closeVideo(); ui.filters = [{ type: 'tag', value: el.dataset.tag }]; go('library'); break;
    case 'toggletag': toggleManualTag(current.id, el.dataset.tag, el.dataset.auto === '1'); refreshModalTags(); break;
    case 'panel': ui.panel = !ui.panel; render(); break;
    case 'clear': ui.filters = []; ui.search = ''; render(); break;
    case 'more': ui.limit += 60; render(); break;
    case 'surprise': {
      const list = currentList();
      if (list.length) openVideo(list[Math.floor(Math.random() * Math.min(list.length, ui.sort === 'relevance' ? 40 : list.length))].id);
      break;
    }
    case 'bulkqueue': {
      const list = currentList();
      if (await confirmBox(`Retirer ces ${list.length} vidéos de ta liste ? (Annulable depuis l'onglet « À retirer »)`)) {
        list.forEach((v) => queueRemoval(v.id, 'retrait groupé'));
        ui.filters = []; ui.search = '';
        render();
        toast(`${list.length} vidéos ajoutées à « À retirer »`);
      }
      break;
    }
    case 'close': closeVideo(); break;
    case 'speed': {
      const s = Number(el.dataset.speed);
      player?.setSpeed(s);
      document.querySelectorAll('.speed').forEach((b) => b.classList.toggle('on', b === el));
      break;
    }
    case 'done': {
      const v = current;
      queueRemoval(v.id, 'marquée vue');
      showEndSheet(v, false);
      break;
    }
    case 'keep': unqueue(current.id); $('#endsheet').hidden = true; toast('Gardée dans ta liste'); break;
    case 'hidesheet': $('#endsheet').hidden = true; break;
    case 'next': openVideo(el.dataset.id); break;
    case 'playlist': choosePlaylist(current); break;
    case 'addlast': { const l = settings().lastPlaylist; if (await needAuth()) addTo(l.id, l.title, current.id); break; }
    case 'pick': { const d = $('#picker'); d.close(); addTo(el.dataset.pl, el.dataset.title, d.dataset.video); break; }
    case 'pickclose': $('#picker').close(); break;
    case 'copyids': {
      const ids = videosByStatus('queued').map((v) => v.id).join(',');
      await copy(ids, `${videosByStatus('queued').length} identifiants copiés`);
      break;
    }
    case 'copycode': await copy(BOOKMARKLETS[el.dataset.bm].code, 'Code copié. Dans la console de youtube.com, tape d\'abord « allow pasting » si Chrome le demande.'); break;
    case 'purged': {
      if (await confirmBox('Confirmer que la purge a bien été faite sur YouTube ?')) { const n = markPurged(); toast(`${n} vidéos marquées comme retirées`); render(); }
      break;
    }
    case 'enrich': runEnrich(false); break;
    case 'enrichall': runEnrich(true); break;
    case 'fav': case 'ban': toggleChannelList(act === 'fav' ? 'favChannels' : 'bannedChannels', el.closest('[data-chan]').dataset.chan); render(); break;
    case 'favchip': toggleChannelList('favChannels', el.dataset.chan); el.classList.toggle('on'); break;
    case 'interest': {
      const s = settings();
      const t = el.dataset.tag;
      s.interests = s.interests.includes(t) ? s.interests.filter((x) => x !== t) : [...s.interests, t];
      store.changed('settings');
      el.classList.toggle('on');
      break;
    }
    case 'saverules': {
      const rules = textToRules($('#rules').value);
      if (!rules.length) { toast('Aucune règle valide.'); break; }
      st().rules = rules;
      store.changed('rules');
      toast(`${rules.length} règles enregistrées`);
      render();
      break;
    }
    case 'resetrules': if (await confirmBox('Revenir aux règles par défaut ?')) { st().rules = null; store.changed('rules'); render(); } break;
    case 'backup': downloadBackup(); break;
    case 'rerunsetup': ui.setupStep = 0; go('setup'); break;
    case 'reset': if (await confirmBox('Effacer toutes les données de cet appareil ? (La copie Google Drive n\'est pas supprimée.)')) { await store.reset(); go('setup'); } break;
    case 'setup-prev': ui.setupStep = Math.max(0, ui.setupStep - 1); render(); break;
    case 'setup-next': ui.setupStep++; render(); break;
    case 'setup-done': settings().setupDone = true; store.changed('settings'); go('library'); break;
    default: break;
  }
});

async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch { window.prompt('Copie ce texte :', text); }
}

function downloadBackup() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(st())], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `youtube-companion-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function restoreBackup(file) {
  try {
    const data = JSON.parse(await readFileText(file));
    if (!data.videos) throw new Error('fichier non reconnu');
    if (!(await confirmBox('Remplacer les données actuelles par cette sauvegarde ?'))) return;
    store.replace(data);
    store.changed('restore');
    toast('Sauvegarde restaurée');
    render();
  } catch (e) { toast('Restauration impossible : ' + e.message); }
}

// Fermeture du lecteur avec Échap / geste retour
$('#video').addEventListener('cancel', (e) => { e.preventDefault(); closeVideo(); });

// ---------------------------------------------------------------- démarrage
(async function init() {
  await store.load();
  auth.restore();
  if (!settings().setupDone && !Object.keys(st().videos).length) ui.view = 'setup';
  render();
  if (auth.signedIn) pullSync();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.__yc = { store, ui, render }; // pratique pour déboguer
})();

