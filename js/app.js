import { store } from './store.js';
import { GOOGLE_CLIENT_ID } from './config.js';
import {
  GROUPS, DEFAULT_RULES, buildContext, videoTags, autoTags, groupOfTag, explain, similarity, creatorTag,
  formatDuration, normalizeText, channelKey, channelOf, fmtMinutes, seenReason, seenCertainty,
} from './tagger.js';
import { buildShelves, buildSequence, matchesFilter } from './curation.js';
import { parseWatchLater, parseHistory, readFileText } from './importers.js';
import {
  importWatchLater, importHistory, syncSubscriptions, enrichVideos, queueRemoval, unqueue,
  markPurged, setProgress, toggleManualTag, recordView, keepVideo, weightHistoryByDuration, historyDurationsTodo, addManualTag, videosByStatus, rulesToText, textToRules,
} from './data.js';
import { auth, driveLoad, driveSave, fetchMyPlaylists, addToPlaylist, createPlaylist } from './google.js';
import { Player } from './player.js';
import { BOOKMARKLETS } from './bookmarklets.js';
import { changelog } from './changelog.js';

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
  view: 'home',
  filters: [],        // { type: 'tag'|'channel'|'dur', value, label, neg }
  budget: 0,          // durée de session en secondes (0 = libre)
  session: null,      // { ids, index } : lecture enchaînée en cours
  search: '',
  sort: 'relevance',
  limit: 60,
  panel: false,
  seed: Math.random(),
};

let ctx = null;
let tagCache = new Map();
let whyCache = new Map();
function getCtx() {
  if (!ctx) {
    ctx = buildContext(st());
    tagCache = new Map();
    whyCache = new Map();
  }
  return ctx;
}
function whyOf(v) {
  getCtx();
  let w = whyCache.get(v.id);
  if (!w) { w = explain(v, tagsOf(v), ctx); whyCache.set(v.id, w); }
  return w;
}
const scoreOf = (v) => whyOf(v).score;
const channelHelpers = {
  channelMatches: (v, f) => channelKey(v, getCtx()) === f.value || (!channelKey(v, getCtx()) && v.channelTitle === f.label),
  certainty: (v) => (seenCertainty(v, getCtx()) || (tagsOf(v).includes('Indisponible') ? 2.5 : 0)),
};

// Vidéos encore dans « À regarder plus tard » mais déjà vues (ou indisponibles), sauf celles gardées.
function removalSuggestions() {
  return videosByStatus('active')
    .filter((v) => !v.keep && (tagsOf(v).includes('Déjà vue') || tagsOf(v).includes('Indisponible')))
    .map((v) => ({ v, certainty: channelHelpers.certainty(v), reason: tagsOf(v).includes('Indisponible') ? 'Vidéo supprimée ou devenue privée' : seenReason(v, getCtx()) }))
    .sort((a, b) => b.certainty - a.certainty);
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
    ui.loginError = '';
    toast('Connecté' + (auth.user?.title ? ' : ' + auth.user.title : ''));
    renderHeader();
    await pullSync();
    return true;
  } catch (e) {
    ui.loginError = 'Connexion impossible : ' + e.message;
    toast(ui.loginError);
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
  const main = $('#main');
  // Mur de connexion : rien n'est accessible sans compte Google.
  // Une fois débloquée, la session reste ouverte même si le jeton expire en cours d'usage.
  if (!auth.signedIn && !ui.unlocked) {
    document.body.dataset.view = 'login';
    $('#nav').innerHTML = '';
    $('#account').innerHTML = '';
    main.innerHTML = renderLogin();
    return;
  }
  ui.unlocked = true;
  if (ui.view === 'import') ui.view = 'settings';
  renderHeader();
  document.body.dataset.view = ui.view;
  if (ui.view === 'setup') main.innerHTML = renderSetup();
  else if (ui.view === 'queue') main.innerHTML = renderQueue();
  else if (ui.view === 'seen') main.innerHTML = renderSeen();
  else if (ui.view === 'settings') main.innerHTML = renderImport() + renderSettings();
  else if (ui.view === 'library') main.innerHTML = renderLibrary();
  else main.innerHTML = renderHome();
  afterRender();
}

function renderLogin() {
  return `<section class="login">
    <img src="icon.svg" alt="" width="72" height="72">
    <h1>Companion</h1>
    <p>Tague, filtre et regarde ta playlist « À regarder plus tard ».</p>
    <button class="primary" data-act="signin">Se connecter avec Google</button>
    ${ui.loginError ? `<p class="hint err">${esc(ui.loginError)}</p>` : ''}
  </section>`;
}

function renderHeader() {
  const q = videosByStatus('queued').length;
  const a = videosByStatus('active').length;
  const sugN = settings().setupDone ? removalSuggestions().length : 0;
  $('#nav').innerHTML = ui.view === 'setup' ? '' : [
    ['home', 'Accueil'],
    ['library', `Liste <small>${a}</small>`],
    ['seen', `Déjà vues ${sugN ? `<small class="hot">${sugN}</small>` : ''}`],
    ['queue', `À retirer ${q ? `<small class="hot">${q}</small>` : ''}`],
    ['settings', '<span class="gear" aria-hidden="true">⚙︎</span><span class="lbl-settings">Réglages</span>'],
  ].map(([v, l]) => `<button class="${ui.view === v ? 'on' : ''}" data-go="${v}" ${v === 'settings' ? 'title="Réglages" aria-label="Réglages"' : ''}>${l}</button>`).join('');
  const syncIcon = { off: '', idle: '☁︎', saving: '⟳', error: '⚠︎' }[auth.signedIn && settings().sync ? syncState : 'off'];
  const unread = changelog.unread().length;
  const bell = `<button class="bell ${unread ? 'new' : ''}" data-act="changelog" title="Nouveautés${unread ? ` (${unread} non lue${unread > 1 ? 's' : ''})` : ''}" aria-label="Nouveautés">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-1.7 1.7A1 1 0 0 0 4 19.4h16a1 1 0 0 0 .7-1.7Z"/></svg>
      ${unread ? `<span class="dot">${unread}</span>` : ''}</button>`;
  $('#account').innerHTML = auth.signedIn
    ? `<span class="sync ${syncState}" title="Synchro Google Drive">${syncIcon}</span>${bell}<button class="ghost" data-act="signout" title="Se déconnecter">${esc(auth.user?.title || 'Connecté')}</button>`
    : `<button class="primary small" data-act="signin">Connexion Google</button>`;
}

const fmtTotal = (sec) => (sec >= 3600 ? `${Math.round(sec / 360) / 10} h` : `${Math.max(1, Math.round(sec / 60))} min`).replace('.', ',');

function emptyList() {
  return `<section class="empty">
    <h2>Ta liste est vide</h2>
    <p>Commence par synchroniser ta playlist « À regarder plus tard ».</p>
    <button class="primary" data-go="${settings().setupDone ? 'settings' : 'setup'}">Synchroniser ma liste</button>
  </section>`;
}

// ---------------------------------------------------------------- accueil (curation)
function renderHome() {
  const active = videosByStatus('active');
  if (!active.length) return emptyList();
  const items = active.map((v) => ({ v, tags: tagsOf(v), score: scoreOf(v) }));
  const shelves = buildShelves(items, { interests: settings().interests, ctx: getCtx(), helpers: channelHelpers });
  ui.shelves = Object.fromEntries(shelves.map((sh) => [sh.id, sh]));
  const total = active.reduce((t, v) => t + (v.duration || 0), 0);
  const q = videosByStatus('queued').length;
  return `<section class="hero">
      <div>
        <h2>${active.length.toLocaleString('fr-FR')} vidéos à regarder</h2>
        <p class="hint">${total ? `Environ ${fmtTotal(total)} de visionnage. ` : ''}${st().wlImportedAt ? `Dernière synchro : ${fmtDate(st().wlImportedAt)}.` : ''}</p>
      </div>
      <div class="row">
        <a class="ghost small btn" href="${syncUrl()}" data-act="syncyt">⟳ Synchroniser${q ? ` (−${q})` : ''}</a>
        <button class="ghost small" data-act="surprise">🎲 Surprends-moi</button>
      </div>
    </section>
    ${(() => { const n = removalSuggestions().length; return n ? `<button class="seenbanner" data-go="seen">🧹 <b>${n} vidéo${n > 1 ? 's' : ''} déjà vue${n > 1 ? 's' : ''}</b> traîne${n > 1 ? 'nt' : ''} encore dans ta liste <span>Trier →</span></button>` : ''; })()}
    ${shelves.map(renderShelf).join('')}`;
}

function renderShelf(sh) {
  return `<section class="shelf" data-shelf="${esc(sh.id)}">
    <header>
      <h3><span class="ico">${sh.icon}</span> ${esc(sh.title)} <small>${sh.total}</small></h3>
      <div class="row tight">
        ${sh.cleanup ? `<button class="ghost small" data-act="shelf-clean">Tout retirer</button>` : ''}
        <button class="linkbtn" data-act="shelf-all">Tout voir →</button>
      </div>
    </header>
    <p class="why">${esc(sh.why)}</p>
    <div class="rail">${sh.items.map(({ v }) => card(v, { mini: true, shelf: sh.id })).join('')}</div>
  </section>`;
}

function shelfToList(sh) {
  ui.filters = sh.filters.map((f) => ({ ...f }));
  ui.search = '';
  ui.sort = { score: 'relevance', recent: 'relevance', published: 'published', shuffle: 'random' }[sh.sort] || 'relevance';
  ui.listTitle = `${sh.icon} ${sh.title}`;
  ui.limit = 60;
  go('library');
}

// ---------------------------------------------------------------- liste (enchaînement)
function matchesSearch(v, tags, terms) {
  if (!terms.length) return true;
  const hay = normalizeText([v.title, v.channelTitle, tags.join(' ')].join(' '));
  return terms.every((t) => hay.includes(t));
}

function applyFilters(list) {
  const terms = normalizeText(ui.search).split(/\s+/).filter(Boolean);
  return list.filter((v) => {
    const tags = tagsOf(v);
    if (!matchesSearch(v, tags, terms)) return false;
    for (const f of ui.filters) {
      const hit = matchesFilter(v, tags, f, channelHelpers);
      if (hit === !!f.neg) return false;
    }
    return true;
  });
}

function sortList(list) {
  const by = {
    relevance: (a, b) => scoreOf(b) - scoreOf(a),
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

// La liste affichée = un enchaînement : varié (pas deux fois la même chaîne d'affilée) et,
// si un temps est choisi, limité à ce temps.
function currentSequence() {
  const list = currentList();
  const diversify = ui.sort === 'relevance' || ui.budget;
  if (!diversify) return { items: list, total: list.reduce((t, v) => t + (v.duration || 0), 0), matched: list.length };
  const seq = buildSequence(list.map((v) => ({ v })), { budget: ui.budget, keyOf: (v) => channelKey(v, getCtx()) || v.channelTitle });
  return { items: seq.items.map((it) => it.v), total: seq.total, matched: list.length };
}

function chip(tag, { active, neg, count, removable, small } = {}) {
  const g = groupOfTag(tag, getCtx());
  return `<button class="chip g-${g} ${active ? 'on' : ''} ${neg ? 'neg' : ''} ${small ? 'sm' : ''}" data-act="tag" data-tag="${esc(tag)}">${neg ? '− ' : ''}${esc(tag)}${count != null ? ` <i>${count}</i>` : ''}${removable ? ' <b data-act="unfilter" data-tag="' + esc(tag) + '">×</b>' : ''}</button>`;
}

const BUDGETS = [[0, 'Libre'], [15 * 60, '15 min'], [30 * 60, '30 min'], [3600, '1 h'], [7200, '2 h']];

function renderLibrary() {
  if (!videosByStatus('active').length) return emptyList();
  const seq = currentSequence();
  const shown = ui.budget ? seq.items : seq.items.slice(0, ui.limit);
  const active = ui.filters.map((f, i) => {
    if (f.type === 'tag') return chip(f.value, { active: true, neg: f.neg, removable: true });
    const label = f.type === 'dur' ? `⏱ ${f.label}` : `▶ ${f.label}`;
    return `<button class="chip ${f.type === 'dur' ? 'g-duree' : 'g-chan'} on ${f.neg ? 'neg' : ''}" data-act="unfilter-i" data-i="${i}">${f.neg ? '− ' : ''}${esc(label)} <b>×</b></button>`;
  }).join('');

  return `
  <section class="toolbar">
    ${ui.listTitle && ui.filters.length ? `<h2 class="listtitle">${esc(ui.listTitle)}</h2>` : ''}
    <div class="searchrow">
      <input id="search" type="search" placeholder="Rechercher…" value="${esc(ui.search)}" autocomplete="off">
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
    ${ui.panel ? renderFacets(applyFilters(videosByStatus('active'))) : ''}
    <div class="session">
      <span class="lbl">J'ai</span>
      ${BUDGETS.map(([b, l]) => `<button class="chip g-duree ${ui.budget === b ? 'on' : ''}" data-act="budget" data-b="${b}">${l}</button>`).join('')}
    </div>
    <div class="summary">
      <span>${ui.budget
        ? `<b>${seq.items.length}</b> vidéo${seq.items.length > 1 ? 's' : ''} · ${fmtTotal(seq.total)} <small>(sur ${seq.matched})</small>`
        : `<b>${seq.matched}</b> vidéo${seq.matched > 1 ? 's' : ''}${seq.total ? ` · ${fmtTotal(seq.total)}` : ''}`}</span>
      <span class="actions">
        ${seq.items.length ? `<button class="primary small" data-act="playall">▶ ${ui.budget ? 'Lancer la session' : 'Tout lire'}</button>` : ''}
        ${(ui.filters.length || ui.search) && seq.matched ? `<button class="ghost small" data-act="bulkqueue">Retirer ces ${seq.matched}</button>` : ''}
      </span>
    </div>
  </section>
  <section class="grid seq">${shown.map((v, i) => card(v, { num: i + 1 })).join('')}</section>
  ${!ui.budget && seq.items.length > shown.length ? `<div class="more"><button class="ghost" data-act="more">Afficher plus (${seq.items.length - shown.length})</button></div>` : ''}
  ${!seq.matched ? '<p class="empty">Aucune vidéo ne correspond. Essaie d\'enlever un filtre.</p>' : ''}
  ${seq.matched && !seq.items.length ? '<p class="empty">Rien ne tient dans ce temps-là. Essaie une durée plus longue.</p>' : ''}`;
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

function card(v, { mini = false, num = 0, shelf = '' } = {}) {
  const tags = tagsOf(v);
  const shownTags = tags.filter((t) => !['Rapide', 'Court', 'Moyen', 'Long', 'Très long'].includes(t)).slice(0, mini ? 2 : 4);
  return `<article class="card ${mini ? 'mini' : ''}" data-id="${v.id}" ${shelf ? `data-shelf="${esc(shelf)}"` : ''}>
    <button class="thumb" data-act="open" aria-label="Lire">
      <img loading="lazy" src="${esc(thumbOf(v))}" alt="" onerror="this.style.visibility='hidden'">
      ${num ? `<span class="num">${num}</span>` : ''}
      ${v.duration != null ? `<span class="dur">${formatDuration(v.duration)}</span>` : ''}
      ${v.progress > 0.02 ? `<span class="prog" style="width:${Math.round(v.progress * 100)}%"></span>` : ''}
    </button>
    <button class="why-btn" data-act="why" title="Pourquoi cette vidéo ?" aria-label="Pourquoi cette vidéo ?">i</button>
    <div class="meta">
      <h3 data-act="open">${esc(v.title || 'Vidéo ' + v.id)}</h3>
      <button class="chan" data-act="channel">${esc(v.channelTitle || 'Chaîne inconnue')}</button>
      <div class="tags">${shownTags.map((t) => chip(t, { small: true })).join('')}</div>
    </div>
    ${mini ? '' : '<button class="rm" data-act="queue" title="Retirer de la liste" aria-label="Retirer de la liste">✕</button>'}
  </article>`;
}

function toggleTagFilter(tag) {
  const i = ui.filters.findIndex((f) => f.type === 'tag' && f.value === tag);
  if (i === -1) ui.filters.push({ type: 'tag', value: tag });
  else if (!ui.filters[i].neg) ui.filters[i].neg = true;
  else ui.filters.splice(i, 1);
  ui.limit = 60;
}

// ---------------------------------------------------------------- nouveautés
function renderChangelog() {
  const unread = new Set(changelog.unread().map((e) => e.version));
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
  return `<div class="pick changelog">
    <h3>🔔 Nouveautés</h3>
    ${changelog.entries.length ? changelog.entries.map((e) => `<section class="cl ${unread.has(e.version) ? 'unread' : ''}">
      <h4>${e.title ? esc(e.title) : 'Version ' + esc(e.version)} ${unread.has(e.version) ? '<span class="newtag">Nouveau</span>' : ''}</h4>
      <p class="hint">v${esc(e.version)}${e.date ? ' · ' + esc(e.date) : ''}</p>
      <ul>${e.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>
    </section>`).join('') : '<p class="hint">Impossible de charger le journal pour l\'instant.</p>'}
    <div class="row"><button class="primary small" data-act="pickclose">OK</button></div>
  </div>`;
}

async function openChangelog() {
  if (!changelog.entries.length) await changelog.load();
  const dlg = $('#picker');
  dlg.dataset.mode = 'changelog';
  dlg.innerHTML = renderChangelog();
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  changelog.markSeen();
  renderHeader();
}

// ---------------------------------------------------------------- « Pourquoi cette vidéo ? »
const ADJUSTABLE = new Set(['logiciel', 'techno', 'sujet', 'mood', 'categorie', 'perso']);

function renderWhy(v, shelfId) {
  const { score, reasons } = whyOf(v);
  const c = getCtx();
  const boosts = settings().boosts || {};
  const sh = shelfId && ui.shelves?.[shelfId];
  const key = channelKey(v, c);
  const adjust = tagsOf(v).filter((t) => ADJUSTABLE.has(groupOfTag(t, c))).slice(0, 6).map((t) => ({ k: t, label: t }));
  if (key) adjust.unshift({ k: 'ch:' + key, label: v.channelTitle || 'Cette chaîne' });
  const sign = (w) => (w > 0 ? `+${String(w).replace('.', ',')}` : w < 0 ? `−${String(-w).replace('.', ',')}` : '•');
  return `<div class="pick why">
    <h3>Pourquoi cette vidéo ?</h3>
    <p class="vt">${esc(v.title)}</p>
    ${sh ? `<p class="shelfwhy"><b>${sh.icon} ${esc(sh.title)}</b> — ${esc(sh.why)}</p>` : ''}
    <ul class="reasons">
      ${reasons.length ? reasons.map((r) => `<li class="${r.w > 0 ? 'plus' : r.w < 0 ? 'minus' : 'neutral'}"><b>${sign(r.w)}</b><span>${esc(r.text)}</span></li>`).join('')
        : '<li class="neutral"><b>•</b><span>Rien de particulier : ni créateur connu, ni thème habituel.</span></li>'}
    </ul>
    <p class="hint">Score « Pour moi » : <b>${String(Math.round(score * 10) / 10).replace('.', ',')}</b>. Les vidéos au score le plus haut remontent en premier.</p>
    ${adjust.length ? `<h4>Plus ou moins de ça ?</h4>
    <div class="adjust">${adjust.map((a) => {
      const b = boosts[a.k] || 0;
      return `<div class="adj" data-k="${esc(a.k)}">
        <button class="ghost small" data-act="boost" data-d="-1" aria-label="Moins de ${esc(a.label)}">−</button>
        <span>${esc(a.label)}${b ? ` <i class="${b > 0 ? 'plus' : 'minus'}">${b > 0 ? '+' : '−'}${Math.abs(b)}</i>` : ''}</span>
        <button class="ghost small" data-act="boost" data-d="1" aria-label="Plus de ${esc(a.label)}">+</button>
      </div>`;
    }).join('')}</div>` : ''}
    <div class="row"><button class="primary small" data-act="pickclose">OK</button></div>
  </div>`;
}

function openWhy(id, shelfId) {
  const v = st().videos[id];
  if (!v) return;
  const dlg = $('#picker');
  dlg.dataset.video = id;
  dlg.dataset.shelf = shelfId || '';
  dlg.dataset.mode = 'why';
  dlg.innerHTML = renderWhy(v, shelfId);
  if (!dlg.open) dlg.showModal();
}

function applyBoost(k, d) {
  const s = settings();
  s.boosts ||= {};
  const val = Math.max(-3, Math.min(3, (s.boosts[k] || 0) + d));
  if (val) s.boosts[k] = val; else delete s.boosts[k];
  store.changed('boost');
  ctx = null;
}

// ---------------------------------------------------------------- lecteur
let player = null;
let current = null;
let playlistsCache = null;

// session : liste d'ids lue dans l'ordre (rayon de l'accueil, enchaînement de la Liste)
function openVideo(id, session) {
  const v = st().videos[id];
  if (!v) return;
  if (session !== undefined) ui.session = session;
  if (ui.session && !ui.session.ids.includes(id)) ui.session = null;
  if (ui.session) ui.session.index = ui.session.ids.indexOf(id);
  clearTimeout(autoNextTimer);
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
      ${ui.session ? `<span class="sesspos">${ui.session.index + 1}/${ui.session.ids.length}</span>` : ''}
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
        <button class="ghost" data-act="why-modal" title="Pourquoi cette vidéo ?">ⓘ Pourquoi ?</button>
        <a class="ghost btn" href="https://www.youtube.com/watch?v=${v.id}${v.progress > 0.02 && v.duration ? '&t=' + Math.floor(v.progress * v.duration) : ''}" target="_blank" rel="noopener">Ouvrir dans YouTube ↗</a>
      </div>
      <div class="vtags">
        ${tags.map((t) => `<span class="chip g-${groupOfTag(t, c)}"><span data-act="tag-modal" data-tag="${esc(t)}">${esc(t)}</span><b data-act="toggletag" data-tag="${esc(t)}" data-auto="${auto.has(t) ? 1 : 0}" title="Retirer ce tag">×</b></span>`).join('')}
        ${hidden.map((t) => `<span class="chip ghosted"><span data-act="toggletag" data-tag="${esc(t)}" data-auto="1" title="Remettre ce tag">↺ ${esc(t)}</span></span>`).join('')}
        <form class="addtag" data-act="addtag"><input list="alltags" placeholder="+ tag" aria-label="Ajouter un tag"><datalist id="alltags">${[...allTags].sort().map((t) => `<option value="${esc(t)}">`).join('')}</datalist></form>
      </div>
      ${v.desc ? `<p class="desc">${esc(v.desc)}…</p>` : ''}
      ${upNext().length ? `<h3>Ensuite dans ta session</h3><div class="grid small">${upNext().map((o, i) => card(o, { num: ui.session.index + 2 + i })).join('')}</div>` : ''}
      ${similar.length ? `<h3>Dans le même genre</h3><div class="grid small">${similar.map((o) => card(o)).join('')}</div>` : ''}
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
  if (v.status === 'active') { recordView(v.id); queueRemoval(v.id, `vue à ${Math.round(frac * 100)} %`); }
  showEndSheet(v, false);
}

let autoNextTimer = null;

function upNext() {
  if (!ui.session) return [];
  return ui.session.ids.slice(ui.session.index + 1, ui.session.index + 4).map((id) => st().videos[id]).filter((o) => o && o.status === 'active');
}

function nextVideo(v) {
  if (ui.session) {
    const nxt = ui.session.ids.slice(ui.session.index + 1).map((id) => st().videos[id]).find((o) => o && o.status === 'active');
    if (nxt) return { v: nxt, fromSession: true };
  }
  const c = getCtx();
  const o = videosByStatus('active')
    .filter((x) => x.id !== v.id)
    .map((x) => [x, similarity(v, tagsOf(v), x, tagsOf(x), c)])
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  return o ? { v: o, fromSession: false } : null;
}

function showEndSheet(v, ended) {
  const sheet = $('#endsheet');
  if (!sheet || current?.id !== v.id) return;
  if (v.status === 'active' && ended) queueRemoval(v.id, 'vue en entier');
  const nx = nextVideo(v);
  const next = nx?.v;
  const last = settings().lastPlaylist;
  sheet.hidden = false;
  sheet.classList.toggle('full', ended);
  sheet.innerHTML = `
    <p><b>${v.status === 'queued' ? 'Vidéo vue : retirée de ta liste.' : 'Vidéo terminée.'}</b></p>
    <div class="row">
      ${v.status === 'queued' ? '<button class="ghost small" data-act="keep">Garder dans la liste</button>' : ''}
      ${last ? `<button class="ghost small" data-act="addlast">＋ ${esc(last.title)}</button>` : ''}
      <button class="ghost small" data-act="playlist">＋ Autre playlist…</button>
      ${next ? `<button class="primary small" data-act="next" data-id="${next.id}">${nx.fromSession ? 'Suivante' : 'Dans le même genre'} : ${esc(next.title.slice(0, 40))}${next.title.length > 40 ? '…' : ''} →</button>` : ''}
      <button class="linkbtn" data-act="hidesheet">Masquer</button>
    </div>
    ${ended && nx?.fromSession ? '<p class="hint countdown">Suivante dans <b>5</b> s… <button class="linkbtn" data-act="stopauto">Annuler</button></p>' : ''}`;
  // En session, la vidéo suivante démarre toute seule après 5 s.
  if (ended && nx?.fromSession) {
    let n = 5;
    const tick = () => {
      if (current?.id !== v.id) return;
      const b = sheet.querySelector('.countdown b');
      if (!b) return;
      if (--n <= 0) { openVideo(next.id); return; }
      b.textContent = n;
      autoNextTimer = setTimeout(tick, 1000);
    };
    autoNextTimer = setTimeout(tick, 1000);
  }
}

function closeVideo() {
  clearTimeout(autoNextTimer);
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
  dlg.dataset.mode = 'playlist';
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
function renderSeen() {
  const sug = removalSuggestions();
  if (!sug.length) {
    return `<section class="empty">
      <h2>🧹 Rien à trier</h2>
      <p>Aucune vidéo déjà vue ne traîne dans ta liste « À regarder plus tard ».</p>
      <p class="hint">Une vidéo compte comme vue à partir de ${Math.round((settings().seenThreshold ?? 0.5) * 100)} % regardés, d'après la barre de progression YouTube (lue à chaque synchro) ou ta lecture dans Companion.</p>
    </section>`;
  }
  const sure = sug.filter((x) => x.certainty >= 2).length;
  const unknown = sug.length - sure;
  const pct = Math.round((settings().seenThreshold ?? 0.5) * 100);
  const badge = (v, c) => (c === 2.5 ? 'Indisponible' : c === 1 ? 'Probable' : `${Math.round(Math.max(v.progress || 0, v.ytProgress || 0) * 100)} %`);
  return `<section class="panel">
    <h2>🧹 Déjà vues, mais encore dans « À regarder plus tard »</h2>
    <p><b>${sure}</b> vidéo${sure > 1 ? 's' : ''} regardée${sure > 1 ? 's' : ''} à au moins ${pct} % (ou devenue${sure > 1 ? 's' : ''} indisponible${sure > 1 ? 's' : ''}).${unknown ? ` ${unknown} autre${unknown > 1 ? 's' : ''} apparai${unknown > 1 ? 'ssent' : 't'} dans ton historique sans progression connue : resynchronise avec le script à jour (v1.2) pour trancher.` : ''}</p>
    <p class="hint">Seuil réglable dans Réglages (« Déjà vue » à partir de ${pct} %).</p>
    <div class="row">
      ${sure ? `<button class="primary small" data-act="sug-all" data-min="2">Retirer ${unknown ? `les ${sure} vues` : `les ${sure}`}</button>` : ''}
      ${unknown ? `<button class="${sure ? 'ghost' : 'primary'} small" data-act="sug-all" data-min="0">Tout retirer (${sug.length})</button>` : ''}
    </div>
  </section>
  <section class="qlist sug">${sug.slice(0, 200).map(({ v, certainty, reason }) => `<div class="qrow" data-id="${v.id}">
      <img loading="lazy" src="${esc(thumbOf(v))}" alt="" onerror="this.style.visibility='hidden'">
      <div><b data-act="open">${esc(v.title || v.id)}</b><small><span class="cert c${String(certainty).replace('.', '')}">${badge(v, certainty)}</span> ${esc(reason)}</small></div>
      <button class="ghost small" data-act="keep-sug">Garder</button>
      <button class="primary small" data-act="queue-sug">Retirer</button>
    </div>`).join('')}${sug.length > 200 ? `<p class="hint">… et ${sug.length - 200} autres.</p>` : ''}</section>`;
}

function renderQueue() {
  const q = videosByStatus('queued').sort((a, b) => (b.queuedAt || 0) - (a.queuedAt || 0));
  const removed = videosByStatus('removed').length;
  return `<section class="panel">
    <h2>Prêtes à être retirées de YouTube ${q.length ? `<small>${q.length}</small>` : ''}</h2>
    <p>Ces vidéos sont masquées dans l'app. Elles seront retirées de « À regarder plus tard » à la prochaine synchro, grâce au script Companion.</p>
    <div class="row">
      <a class="primary btn ${q.length ? '' : 'disabled'}" href="${syncUrl()}" data-act="syncyt">⟳ Synchroniser et retirer (${q.length})</a>
      <button class="linkbtn" data-go="settings">Installer le script</button>
    </div>
    <details class="manual">
      <summary>Sans le script (favori sur ordinateur)</summary>
      <ol class="steps">
        <li>Installe le favori <a class="bm" href="${esc(BOOKMARKLETS.purge.href)}" onclick="return false" draggable="true">${BOOKMARKLETS.purge.name}</a> (glisse-le dans ta barre de favoris) — ou <button class="linkbtn" data-act="copycode" data-bm="purge">copie le code</button> pour la console.</li>
        <li><button class="ghost small" data-act="copyids" ${q.length ? '' : 'disabled'}>Copier la liste (${q.length})</button> puis, sur youtube.com, clique sur le favori et colle-la.</li>
        <li><button class="ghost small" data-act="purged" ${q.length ? '' : 'disabled'}>C'est fait : marquer comme retirées</button></li>
      </ol>
    </details>
    <p class="hint">À chaque synchro, les vidéos qui ne sont plus dans ta liste YouTube sont marquées comme retirées.${removed ? ` ${removed} vidéo(s) retirée(s) au total.` : ''}</p>
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

const USERSCRIPT_URL = new URL('companion.user.js', location.href).href;

function syncUrl() {
  const ids = videosByStatus('queued').map((v) => v.id);
  return 'https://www.youtube.com/playlist?list=WL#yc-sync' + (ids.length ? '=' + ids.join(',') : '');
}

const UA = navigator.userAgent;
const IS_IOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_OPERA = /OPR\//.test(UA);
const IS_EDGE = /Edg\//.test(UA);
const IS_FIREFOX = /Firefox\//.test(UA);
const IS_SAFARI_MAC = !IS_IOS && /Safari\//.test(UA) && !/Chrome|Chromium|OPR|Edg/.test(UA);

function installSteps() {
  if (IS_IOS) {
    return `<ol class="steps">
      <li>Installe l'app gratuite <a href="https://apps.apple.com/app/userscripts/id1463298887" target="_blank" rel="noopener"><b>Userscripts</b></a> depuis l'App Store et ouvre-la une fois.</li>
      <li>Dans <b>Réglages iOS → Apps → Safari → Extensions → Userscripts</b>, active l'extension et autorise-la sur <b>youtube.com</b> (ou « Autres sites web : Autoriser »).</li>
      <li>Dans Safari, ouvre <a class="bm" href="${USERSCRIPT_URL}" target="_blank" rel="noopener">⟳ Script Companion</a>, touche l'icône <b>Userscripts</b> (ou « aA ») dans la barre d'adresse, puis <b>Install</b>.</li>
    </ol>`;
  }
  const ext = IS_FIREFOX ? 'addons.mozilla.org' : IS_EDGE ? 'Edge Add-ons' : IS_SAFARI_MAC ? 'l\'App Store (version Safari)' : 'le Chrome Web Store';
  const page = IS_OPERA ? 'opera://extensions' : IS_EDGE ? 'edge://extensions' : 'chrome://extensions';
  return `<ol class="steps">
    <li>Installe l'extension <a href="https://www.tampermonkey.net/" target="_blank" rel="noopener"><b>Tampermonkey</b></a> (depuis ${ext}).</li>
    ${IS_FIREFOX || IS_SAFARI_MAC ? '' : `<li><b>Important</b> : ouvre <code>${page}</code>, active le <b>Mode développeur</b> (en haut à droite), puis dans <b>Détails</b> de Tampermonkey active <b>« Autoriser les scripts utilisateur »</b>. Redémarre le navigateur.</li>`}
    <li>Ouvre <a class="bm" href="${USERSCRIPT_URL}" target="_blank" rel="noopener">⟳ Script Companion</a> : Tampermonkey affiche une page d'installation, clique sur <b>Installer</b>.</li>
  </ol>`;
}

function syncSteps() {
  const q = videosByStatus('queued').length;
  return `<ol class="steps">
    <li>Touche <b>⟳ Synchroniser</b> : ta page « À regarder plus tard » de YouTube s'ouvre.</li>
    <li>Ne touche à rien : un <b>panneau sombre</b> apparaît en bas de la page, ${q ? `retire les ${q} vidéo(s) marquée(s), puis ` : ''}compte tes vidéos (quelques secondes).</li>
    <li>Quand il affiche « ✓ … vidéos récupérées », touche <b>Envoyer à Companion</b> : Companion s'ouvre avec ta liste à jour.</li>
  </ol>
  <div class="row">
    <a class="primary btn" href="${syncUrl()}" data-act="syncyt">⟳ Synchroniser${q ? ` (et retirer ${q})` : ''}</a>
    <button class="ghost small" data-act="paste">Coller depuis le presse-papiers</button>
  </div>
  <p class="hint">${IS_IOS ? 'Si l\'app YouTube s\'ouvre à la place de Safari : appui long sur « Synchroniser » → « Ouvrir dans un nouvel onglet ». ' : ''}Pas de panneau sur YouTube ? Le script n'est pas actif : revois l'installation. L'envoi n'arrive pas ? Touche « Copier » dans le panneau, puis « Coller » ici.</p>`;
}

function wlSteps() {
  return `<h3>Synchro</h3>
  ${syncSteps()}
  <details class="manual">
    <summary>Installer le script ${IS_IOS ? '(iPhone / iPad)' : '(ordinateur)'}</summary>
    ${installSteps()}
  </details>
  <details class="manual">
    <summary>Sans script (fichier, favori)</summary>
    <ol class="steps">
      <li>Sur ordinateur, glisse ce bouton dans ta barre de favoris : ${bookmarkletBlock('export', '')}</li>
      <li>Ouvre <a href="https://www.youtube.com/playlist?list=WL" target="_blank" rel="noopener">youtube.com/playlist?list=WL</a> et clique sur le favori : un fichier JSON est téléchargé.</li>
      <li>Importe ce fichier ici (le CSV « À regarder plus tard » de Google Takeout marche aussi).</li>
    </ol>
    <label class="drop" data-drop="wl"><input type="file" accept=".json,.csv,.txt" data-file="wl" hidden><span>📂 Choisir un fichier</span></label>
  </details>`;
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
  return `<p>La connexion Google récupère la durée, les tags et la catégorie de chaque vidéo, ainsi que tes abonnements (ils comptent pour « Abonné »).</p>
  <ul class="stats">
    <li>${n} vidéos dans ta liste, <b>${todo}</b> sans infos détaillées</li>
    <li>${subs} abonnements connus</li>
    ${historyDurationsTodo().length ? `<li><b>${historyDurationsTodo().length}</b> vidéos de ton historique sans durée (pour compter le temps regardé plutôt que le nombre de vidéos)</li>` : ''}
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
    <h2>Ta liste « À regarder plus tard »</h2>
    <p class="hint">Dernière synchro : ${fmtDate(st().wlImportedAt)}</p>
    ${wlSteps()}
  </section>
  <section class="panel">
    <h2>Ton historique <small>(optionnel)</small></h2>
    <p class="hint">${h.total ? `${h.total} visionnages importés le ${fmtDate(h.importedAt)}.` : 'Pas encore importé.'} Il sert à repérer tes créateurs habituels, les « Aliens », les vidéos déjà vues et tes thèmes favoris.</p>
    ${historySteps()}
  </section>
  <section class="panel">
    <h2>Infos YouTube</h2>
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
      render();
      weighHistory();
      return;
    }
    render();
  } catch (e) {
    toast('Import impossible : ' + e.message);
  }
}

// Le temps regardé compte, pas le nombre de vidéos : on récupère la durée des vidéos de l'historique.
let weighing = false;
async function weighHistory(say) {
  if (weighing || !historyDurationsTodo().length) return;
  if (!auth.signedIn) { toast('Connecte-toi pour pondérer ton historique par la durée des vidéos.'); return; }
  weighing = true;
  const n = historyDurationsTodo().length;
  const info = (t) => (say ? say(t) : null);
  if (!say) toast(`Récupération de la durée de ${n} vidéos de ton historique…`);
  try {
    await weightHistoryByDuration((d, t) => info(`Durées de l'historique : ${d} / ${t}`));
    ctx = null;
    toast('Historique pondéré par le temps de visionnage');
    render();
  } catch (e) {
    toast('Durées de l\'historique : ' + e.message);
  } finally { weighing = false; }
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
    if (historyDurationsTodo().length) await weighHistory(say);
    render();
  } catch (e) {
    say('Erreur : ' + esc(e.message));
    if (e.status === 403) toast('Quota YouTube dépassé ou API non activée dans Google Cloud.');
  }
}

// ---------------------------------------------------------------- réglages
function topChannels(n = 30) {
  const c = getCtx();
  return Object.entries(st().channels)
    .filter(([k, ch]) => c.stats[k]?.views || ch.subscribed)
    .sort((a, b) => c.stats[b[0]].heat - c.stats[a[0]].heat || c.stats[b[0]].views - c.stats[a[0]].views)
    .slice(0, n);
}

const TIER_ICON = { 'Favori': '❤️', 'Aimé': '💛', 'Apprécié': '👍', 'Perdu de vue': '🕰️' };
function channelTier(k) {
  const c = getCtx();
  return c.tiers[k] || creatorTagFor(k);
}
function creatorTagFor(k) {
  const ch = st().channels[k];
  return creatorTag({ id: '', channelId: k.startsWith('name:') ? undefined : k, channelTitle: ch?.title || '' }, getCtx());
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
      ${numField('tierFav', '❤️ Favoris : nombre de créateurs', s.tierFav)}
      ${numField('tierLiked', '💛 Aimés : nombre de créateurs', s.tierLiked)}
      ${numField('tierAppr', '👍 Appréciés : nombre de créateurs', s.tierAppr)}
      ${numField('lostDays', '🕰️ « Perdu de vue » après (jours sans le regarder)', s.lostDays)}
      ${numField('alienMaxViews', '« Alien » jusqu\'à (vues de la chaîne)', s.alienMaxViews)}
      ${numField('seenThreshold', '« Déjà vue » à partir de (% regardé)', Math.round((s.seenThreshold ?? 0.5) * 100))}
      ${numField('watchedThreshold', 'Retirer automatiquement en fin de lecture après (% regardé)', Math.round(s.watchedThreshold * 100))}
      <label class="field">Vitesse par défaut
        <select id="defaultSpeed">${SPEEDS.map((x) => `<option value="${x}" ${x === s.defaultSpeed ? 'selected' : ''}>×${x}</option>`).join('')}</select>
      </label>
    </div>
  </section>
  <section class="panel">
    <h2>Créateurs</h2>
    <p class="hint">❤️ Favori · 💛 Aimé · 👍 Apprécié · 🕰️ Perdu de vue. Classés selon le <b>temps</b> que tu passes sur chaque chaîne ces derniers temps (une minute d'il y a 45 jours compte moitié moins qu'une minute d'hier ; une vidéo compte au plus 1 h). ★ = toujours favori · ⊘ = jamais.</p>
    <div class="chans">${topChannels(40).map(([id, c]) => `<div class="chanrow" data-chan="${esc(id)}">
      <span>${TIER_ICON[channelTier(id)] || ''} ${esc(c.title)} <small>${fmtMinutes(getCtx().stats[id].recent)} ces 3 mois · ${c.views || 0} vidéos au total${c.subscribed ? ' · abonné' : ''}</small></span>
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
  else if (id === 'seenThreshold') s.seenThreshold = Math.min(1, Math.max(0.1, n / 100));
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
const SETUP_STEPS = ['Le script', 'Ta liste', 'Tes goûts'];
const setupStep = () => Math.min(settings().setupStep || 0, SETUP_STEPS.length - 1);
function setSetupStep(n) { settings().setupStep = Math.max(0, Math.min(n, SETUP_STEPS.length - 1)); store.changed('settings'); }

function renderSetup() {
  const i = setupStep();
  const nVideos = videosByStatus('active', 'queued').length;
  let body = '';
  if (i === 0) {
    body = `<h2>Bienvenue ${esc((auth.user?.title || '').split(' ')[0])} 👋</h2>
      <p>YouTube ne laisse aucune app lire « À regarder plus tard ». Pour la récupérer, Companion s'appuie sur un petit script qui tourne sur youtube.com, dans ton navigateur. Il ne s'installe qu'une fois.</p>
      <p class="hint">${IS_IOS ? 'Tu es sur iPhone / iPad : voici la marche à suivre dans Safari.' : 'Tu es sur ordinateur : voici la marche à suivre.'}</p>
      ${installSteps()}`;
  } else if (i === 1) {
    body = nVideos
      ? `<h2>✓ ${nVideos.toLocaleString('fr-FR')} vidéos reçues</h2>
         <p>Companion récupère maintenant leurs durées, catégories et tags YouTube${Object.values(st().videos).some((v) => !v.enriched) ? '… <span class="spin">⟳</span>' : '.'}</p>
         <p class="hint">Tu peux continuer : ça se termine en arrière-plan.</p>`
      : `<h2>Synchronise ta liste</h2>${syncSteps()}`;
  } else {
    body = renderTasteQuestions() + `<details class="manual">
      <summary>Encore mieux : importe ton historique YouTube (optionnel, possible plus tard dans Réglages)</summary>
      <p class="hint">L'historique permet de repérer tes créateurs préférés, les « Aliens » et les vidéos déjà vues. Google met de quelques minutes à quelques heures à préparer l'export.</p>
      ${historySteps()}
    </details>`;
  }
  const canNext = i !== 1 || nVideos;
  return `<section class="setup">
    <ol class="progress">${SETUP_STEPS.map((l, k) => `<li class="${k === i ? 'on' : ''} ${k < i ? 'done' : ''}">${k + 1}. ${l}</li>`).join('')}</ol>
    <div class="panel">${body}</div>
    <div class="row setupnav">
      ${i > 0 ? '<button class="ghost" data-act="setup-prev">← Précédent</button>' : '<span></span>'}
      ${i < SETUP_STEPS.length - 1
        ? `<button class="${canNext ? 'primary' : 'ghost'}" data-act="setup-next">${i === 0 ? 'C\'est installé →' : canNext ? 'Continuer →' : 'Passer →'}</button>`
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
    <h4>Combien de créateurs ❤️ favoris ?</h4>
    ${radio('q-tierFav', [[3, '3'], [5, '5'], [8, '8'], [12, '12']], s.tierFav)}
    <p class="hint">Ce sont ceux que tu regardes le plus <b>ces derniers temps</b>, abonné ou pas. Viennent ensuite 💛 Aimés et 👍 Appréciés. Le classement bouge tout seul avec ce que tu regardes. Tu peux aussi épingler des favoris à la main ci-dessous.</p>
    <h4>Ce qui t'intéresse le plus en ce moment <small>(mis en avant dans « Pour moi »)</small></h4>
    <div class="tags">${themes.map(([t, n]) => `<button class="chip g-${groupOfTag(t, c)} ${interests.has(t) ? 'on' : ''}" data-act="interest" data-tag="${esc(t)}">${esc(t)} <i>${n}</i></button>`).join('') || '<p class="hint">Les thèmes apparaîtront après l\'import de ta liste.</p>'}</div>
    <h4>Tes créateurs préférés</h4>
    <div class="tags">${topChannels(20).map(([id, ch]) => `<button class="chip g-createur ${fav.has(id) ? 'on' : ''}" data-act="favchip" data-chan="${esc(id)}">${TIER_ICON[channelTier(id)] || ''} ${esc(ch.title)} <i>${fmtMinutes(getCtx().stats[id].recent)}</i></button>`).join('') || '<p class="hint">Importe ton historique pour avoir des suggestions.</p>'}</div>
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
    case 'signout': if (await confirmBox('Se déconnecter de Google ?')) { auth.signOut(); ui.unlocked = false; render(); } break;
    case 'open': {
      if ($('#video').open) { player?.destroy(); openVideo(id); break; }
      // La lecture suit l'ordre du rayon ou de l'enchaînement d'où l'on vient.
      const shelfId = cardEl?.dataset.shelf;
      let ids = null;
      if (shelfId && ui.shelves?.[shelfId]) ids = ui.shelves[shelfId].items.map((it) => it.v.id);
      else if (ui.view === 'library') ids = currentSequence().items.map((v) => v.id);
      openVideo(id, ids ? { ids, index: ids.indexOf(id) } : null);
      break;
    }
    case 'why': e.stopPropagation(); openWhy(id, cardEl?.dataset.shelf); break;
    case 'changelog': openChangelog(); break;
    case 'why-modal': if (current) openWhy(current.id); break;
    case 'boost': {
      const k = el.closest('[data-k]').dataset.k;
      applyBoost(k, Number(el.dataset.d));
      const dlg = $('#picker');
      dlg.innerHTML = renderWhy(st().videos[dlg.dataset.video], dlg.dataset.shelf);
      break;
    }
    case 'budget': ui.budget = Number(el.dataset.b); render(); break;
    case 'playall': {
      const ids = currentSequence().items.map((v) => v.id);
      if (ids.length) openVideo(ids[0], { ids, index: 0 });
      break;
    }
    case 'shelf-all': {
      const sh = ui.shelves[el.closest('[data-shelf]').dataset.shelf];
      if (sh.suggestions) go('queue'); else shelfToList(sh);
      break;
    }
    case 'keep-sug': keepVideo(id); render(); toast('Gardée : elle ne sera plus proposée au retrait'); break;
    case 'queue-sug': {
      queueRemoval(id, seenReason(st().videos[id], getCtx()) || 'déjà vue');
      render();
      toast('Ajoutée à « À retirer »', { label: 'Annuler', fn: () => { unqueue(id); st().videos[id].keep = false; render(); } });
      break;
    }
    case 'sug-all': {
      const min = Number(el.dataset.min);
      const list = removalSuggestions().filter((x) => x.certainty >= min);
      if (await confirmBox(`Retirer ces ${list.length} vidéos de ta liste ? Elles partiront de YouTube à la prochaine synchro.`)) {
        list.forEach(({ v, reason }) => queueRemoval(v.id, reason || 'déjà vue'));
        render();
        toast(`${list.length} vidéos prêtes à être retirées`);
      }
      break;
    }
    case 'shelf-clean': {
      const sh = ui.shelves[el.closest('[data-shelf]').dataset.shelf];
      if (sh.suggestions) {
        const list = removalSuggestions();
        if (await confirmBox(`Retirer ces ${list.length} vidéos de ta liste ? Elles partiront de YouTube à la prochaine synchro.`)) {
          list.forEach(({ v, reason }) => queueRemoval(v.id, reason || 'déjà vue'));
          render();
          toast(`${list.length} vidéos prêtes à être retirées`);
        }
        break;
      }
      const list = videosByStatus('active').filter((v) => sh.filters.every((f) => matchesFilter(v, tagsOf(v), f, channelHelpers)));
      if (await confirmBox(`Retirer ces ${list.length} vidéos de ta liste ? (Annulable depuis « À retirer »)`)) {
        list.forEach((v) => queueRemoval(v.id, sh.title));
        render();
        toast(`${list.length} vidéos ajoutées à « À retirer »`);
      }
      break;
    }
    case 'unfilter-i': ui.filters.splice(Number(el.dataset.i), 1); render(); break;
    case 'stopauto': clearTimeout(autoNextTimer); el.closest('.countdown')?.remove(); break;
    case 'queue': {
      queueRemoval(id, 'manuel');
      render();
      toast('Retirée de la liste', { label: 'Annuler', fn: () => { unqueue(id); render(); } });
      break;
    }
    case 'unqueue': unqueue(id); render(); break;
    case 'tag': {
      if ($('#video').open) closeVideo();
      if (ui.view !== 'library') { ui.filters = []; ui.listTitle = ''; }
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
    case 'clear': ui.filters = []; ui.search = ''; ui.listTitle = ''; render(); break;
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
    case 'paste': pasteFromClipboard(); break;
    case 'syncyt': if (!videosByStatus('queued').length && el.classList.contains('disabled')) e.preventDefault(); break;
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
    case 'rerunsetup': settings().setupDone = false; setSetupStep(0); go('setup'); break;
    case 'reset': if (await confirmBox('Effacer toutes les données de cet appareil ? (La copie Google Drive n\'est pas supprimée.)')) { await store.reset(); go('setup'); } break;
    case 'setup-prev': setSetupStep(setupStep() - 1); render(); break;
    case 'setup-next': setSetupStep(setupStep() + 1); render(); break;
    case 'setup-done': settings().setupDone = true; store.changed('settings'); go('home'); break;
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

// ---------------------------------------------------------------- réception depuis le script YouTube
const YT_ORIGINS = ['https://www.youtube.com', 'https://m.youtube.com'];
const bc = 'BroadcastChannel' in window ? new BroadcastChannel('yc') : null;
if (bc) bc.onmessage = async (e) => { if (e.data === 'reload') { await store.load(); ctx = null; render(); } };

function applyPayload(payload, how) {
  if (!payload || payload.source !== 'plustard-wl' || !Array.isArray(payload.items)) throw new Error('données non reconnues');
  const items = parseWatchLater(JSON.stringify(payload));
  if (!items.length) throw new Error('liste vide');
  const r = importWatchLater(items);
  store.persistNow(true).then(() => bc?.postMessage('reload'));
  toast(`${how} : ${r.total} vidéos, ${r.added} nouvelles${r.purged ? `, ${r.purged} retirées de YouTube` : ''}${r.gone ? `, ${r.gone} disparues` : ''}`);
  if (Object.values(st().videos).some((v) => !v.enriched) && auth.signedIn) {
    enrichVideos().then(() => render()).catch(() => {});
  }
  if (!settings().setupDone) { setSetupStep(1); ui.view = 'setup'; }
  render();
}

function listenForScript() {
  if (location.hash !== '#yc-recv') return;
  history.replaceState(null, '', location.pathname + location.search);
  let done = false;
  toast('Réception de ta liste depuis YouTube…');
  window.addEventListener('message', (e) => {
    if (!YT_ORIGINS.includes(e.origin) || e.data?.type !== 'yc-wl' || done) return;
    done = true;
    try { applyPayload(e.data.payload, 'Synchro YouTube'); } catch (err) { toast('Synchro impossible : ' + err.message); }
    try { e.source.postMessage({ type: 'yc-ack' }, e.origin); } catch { /* onglet fermé */ }
  });
  const ping = () => {
    if (done || !window.opener) return;
    for (const o of YT_ORIGINS) { try { window.opener.postMessage({ type: 'yc-ready' }, o); } catch { /* rien */ } }
    setTimeout(ping, 600);
  };
  ping();
  setTimeout(() => { if (!done) toast('Rien reçu de YouTube. Utilise « Copier » dans le script puis « Coller depuis le presse-papiers » ici.'); }, 15000);
}

async function pasteFromClipboard() {
  let text = '';
  try { text = await navigator.clipboard.readText(); }
  catch { text = window.prompt('Colle ici les données copiées depuis YouTube :') || ''; }
  if (!text.trim()) return;
  try {
    const data = JSON.parse(text);
    applyPayload(data, 'Import');
  } catch (e) { toast('Collage impossible : ' + e.message); }
}

// Fermer la bulle « Pourquoi » rafraîchit la vue : les +/− ont pu changer l'ordre.
$('#picker').addEventListener('close', () => {
  const dlg = $('#picker');
  if (dlg.dataset.mode === 'why') { dlg.dataset.mode = ''; if (!$('#video').open) render(); }
});
// Clic à côté de la bulle = fermer
$('#picker').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

// Fermeture du lecteur avec Échap / geste retour
$('#video').addEventListener('cancel', (e) => { e.preventDefault(); closeVideo(); });

// ---------------------------------------------------------------- démarrage
(async function init() {
  await store.load();
  auth.restore();
  changelog.load().then(() => { changelog.initSeen(Object.keys(st().videos).length > 0); renderHeader(); });
  listenForScript();
  if (!settings().setupDone) ui.view = 'setup';
  render();
  if (auth.signedIn) pullSync();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.__yc = { store, ui, render, applyPayload }; // pratique pour déboguer (et les tests)
})();

