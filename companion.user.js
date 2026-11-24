// ==UserScript==
// @name         YouTube Companion — synchro « À regarder plus tard »
// @namespace    https://harmonieg.github.io/YoutubeCompanion/
// @version      1.2.0
// @description  Récupère ta playlist « À regarder plus tard » en quelques secondes, retire les vidéos déjà vues et envoie le tout à YouTube Companion.
// @author       Harmonie Games
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @icon         https://harmonieg.github.io/YoutubeCompanion/icon-180.png
// @updateURL    https://harmonieg.github.io/YoutubeCompanion/companion.user.js
// @downloadURL  https://harmonieg.github.io/YoutubeCompanion/companion.user.js
// @grant        none
// @inject-into  auto
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  if (window.__ycCompanion) return;
  window.__ycCompanion = true;

  const APP_URL = window.__YC_APP || 'https://harmonieg.github.io/YoutubeCompanion/';
  const APP_ORIGIN = new URL(APP_URL).origin;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------- interface (sans innerHTML : YouTube impose Trusted Types)
  const css = 'position:fixed;z-index:2147483647;font:14px/1.4 system-ui,sans-serif;color:#F2EDE4;';
  function el(tag, style, text) {
    const e = document.createElement(tag);
    if (style) e.style.cssText = style;
    if (text != null) e.textContent = text;
    return e;
  }
  function btn(label, primary, onclick) {
    const b = el('button', 'all:unset;cursor:pointer;padding:8px 14px;border-radius:999px;margin:6px 6px 0 0;font-weight:600;'
      + (primary ? 'background:#F2EDE4;color:#1F2226;' : 'border:1px solid #555;color:#F2EDE4;'), label);
    b.onclick = onclick;
    return b;
  }

  let panel = null, msg = null, actions = null;
  function openPanel() {
    if (panel) return;
    panel = el('div', css + 'right:16px;bottom:16px;max-width:min(340px,calc(100vw - 32px));background:#1F2226;border:1px solid #3A4049;border-radius:14px;padding:14px 16px;box-shadow:0 10px 40px #000a;');
    const head = el('div', 'display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:6px;');
    head.appendChild(el('b', 'color:#3EC6A0;font-size:15px;', 'YouTube Companion'));
    const close = el('button', 'all:unset;cursor:pointer;opacity:.7;padding:0 4px;', '✕');
    close.onclick = () => { panel.remove(); panel = null; };
    head.appendChild(close);
    msg = el('div', '');
    actions = el('div', 'margin-top:4px;');
    panel.append(head, msg, actions);
    (document.body || document.documentElement).appendChild(panel);
  }
  const say = (t) => { openPanel(); msg.textContent = t; };
  const setActions = (...buttons) => { openPanel(); actions.replaceChildren(...buttons); };

  // Petit bouton flottant, seulement sur la page de la playlist.
  let fab = null;
  function updateFab() {
    const onWL = /[?&]list=WL\b/.test(location.search);
    if (onWL && !fab) {
      fab = el('button', css + 'all:unset;' + css + 'left:16px;bottom:16px;background:#D9764A;color:#1F2226;font-weight:700;padding:10px 16px;border-radius:999px;cursor:pointer;box-shadow:0 6px 20px #0008;', '⟳ Companion');
      fab.onclick = () => run([]);
      document.body.appendChild(fab);
    } else if (!onWL && fab) { fab.remove(); fab = null; }
  }
  setInterval(updateFab, 1500);
  updateFab();

  // ---------------------------------------------------------------- API interne de youtube.com
  function cookie(n) { const m = document.cookie.match('(?:^|; )' + n.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'); return m && m[1]; }
  async function sha1(s) {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  async function authHeader() {
    const ts = Math.floor(Date.now() / 1000);
    const origin = location.origin;
    const parts = [];
    const sap = cookie('SAPISID') || cookie('__Secure-3PAPISID');
    if (!sap) throw new Error('Session YouTube introuvable : connecte-toi à ton compte YouTube.');
    parts.push('SAPISIDHASH ' + ts + '_' + await sha1(ts + ' ' + sap + ' ' + origin));
    const p1 = cookie('__Secure-1PAPISID');
    if (p1) parts.push('SAPISID1PHASH ' + ts + '_' + await sha1(ts + ' ' + p1 + ' ' + origin));
    const p3 = cookie('__Secure-3PAPISID');
    if (p3) parts.push('SAPISID3PHASH ' + ts + '_' + await sha1(ts + ' ' + p3 + ' ' + origin));
    return parts.join(' ');
  }
  // Configuration de youtube.com. Selon l'extension (Userscripts sur iOS, Tampermonkey…), le script peut
  // tourner dans un espace isolé sans accès à window.ytcfg : on la relit alors dans le HTML de la page.
  let pageCfg = null;
  function readCfgFromHtml() {
    const out = {};
    for (const sc of document.querySelectorAll('script')) {
      const t = sc.textContent || '';
      if (!t.includes('INNERTUBE')) continue;
      const ctxAt = t.indexOf('"INNERTUBE_CONTEXT":');
      if (ctxAt !== -1 && !out.INNERTUBE_CONTEXT) {
        let i = t.indexOf('{', ctxAt), depth = 0, inStr = false;
        for (let j = i; j < t.length; j++) {
          const c = t[j];
          if (inStr) { if (c === '\\') j++; else if (c === '"') inStr = false; continue; }
          if (c === '"') inStr = true;
          else if (c === '{') depth++;
          else if (c === '}' && --depth === 0) { try { out.INNERTUBE_CONTEXT = JSON.parse(t.slice(i, j + 1)); } catch (e) { /* rien */ } break; }
        }
      }
      for (const k of ['INNERTUBE_API_KEY', 'INNERTUBE_CLIENT_VERSION', 'INNERTUBE_CONTEXT_CLIENT_NAME', 'SESSION_INDEX']) {
        if (out[k] != null) continue;
        const m = t.match(new RegExp('"' + k + '":\\s*"?([\\w.-]+)"?'));
        if (m) out[k] = m[1];
      }
    }
    if (!out.INNERTUBE_CONTEXT) {
      const mobile = location.hostname.startsWith('m.');
      out.INNERTUBE_CONTEXT = {
        client: {
          clientName: mobile ? 'MWEB' : 'WEB',
          clientVersion: out.INNERTUBE_CLIENT_VERSION || '2.20261120.00.00',
          hl: (document.documentElement.lang || 'fr').slice(0, 2),
          gl: 'FR',
        },
      };
      out.INNERTUBE_CONTEXT_CLIENT_NAME = out.INNERTUBE_CONTEXT_CLIENT_NAME || (mobile ? 2 : 1);
    }
    return out;
  }
  function cfg(k) {
    try { if (window.ytcfg && window.ytcfg.get) { const v = window.ytcfg.get(k); if (v != null) return v; } } catch (e) { /* espace isolé */ }
    pageCfg ||= readCfgFromHtml();
    return pageCfg[k];
  }

  async function innertube(endpoint, body) {
    const context = cfg('INNERTUBE_CONTEXT');
    if (!context) throw new Error('Configuration YouTube introuvable. Recharge la page et réessaie.');
    const key = cfg('INNERTUBE_API_KEY');
    const res = await fetch('/youtubei/v1/' + endpoint + '?prettyPrint=false' + (key ? '&key=' + key : ''), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: await authHeader(),
        'X-Origin': location.origin,
        'X-Goog-AuthUser': String(cfg('SESSION_INDEX') || 0),
        'X-Youtube-Client-Name': String(cfg('INNERTUBE_CONTEXT_CLIENT_NAME') || 1),
        'X-Youtube-Client-Version': String(cfg('INNERTUBE_CLIENT_VERSION') || context.client?.clientVersion || ''),
      },
      body: JSON.stringify(Object.assign({ context }, body)),
    });
    if (!res.ok) throw new Error('YouTube a répondu ' + res.status);
    return res.json();
  }

  const text = (t) => (t ? (t.simpleText || (t.runs || []).map((r) => r.text).join('') || t.content || '') : '');

  // Pourcentage déjà regardé, tel qu'affiché par la barre rouge sous la miniature.
  function watchedPct(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 12) return null;
    if (typeof node.percentDurationWatched === 'number') return node.percentDurationWatched;
    if (typeof node.startPercent === 'number' && node.startPercent > 0) return node.startPercent;
    for (const k in node) {
      const r = watchedPct(node[k], depth + 1);
      if (r != null) return r;
    }
    return null;
  }

  // Parcours générique : on ne dépend pas de la structure exacte (bureau / mobile / nouveaux composants).
  function harvest(node, items, state) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) harvest(n, items, state); return; }
    const pv = node.playlistVideoRenderer;
    if (pv && pv.videoId) {
      const by = pv.shortBylineText || {};
      const run = (by.runs || [])[0] || {};
      items.push({
        id: pv.videoId,
        title: text(pv.title),
        channelTitle: text(by),
        channelId: run.navigationEndpoint?.browseEndpoint?.browseId || '',
        duration: pv.lengthSeconds ? Number(pv.lengthSeconds) : null,
        watched: watchedPct(pv.thumbnailOverlays) ?? 0,
        index: items.length,
      });
      return;
    }
    const lv = node.lockupViewModel;
    if (lv && lv.contentId && /VIDEO/i.test(lv.contentType || 'VIDEO')) {
      const meta = lv.metadata?.lockupMetadataViewModel || {};
      items.push({ id: lv.contentId, title: meta.title?.content || '', channelTitle: '', channelId: '', duration: null, watched: watchedPct(lv.contentImage) ?? 0, index: items.length });
      return;
    }
    if (node.continuationCommand?.token) state.token = node.continuationCommand.token;
    for (const k in node) if (k !== 'frameworkUpdates') harvest(node[k], items, state);
  }

  async function fetchWatchLater(onProgress) {
    const items = [];
    const seen = new Set();
    let state = { token: null };
    let data = await innertube('browse', { browseId: 'VLWL' });
    for (let page = 0; page < 400; page++) {
      const before = items.length;
      const found = [];
      state = { token: null };
      harvest(data, found, state);
      for (const it of found) if (!seen.has(it.id)) { seen.add(it.id); it.index = items.length; items.push(it); }
      onProgress(items.length);
      if (!state.token || items.length === before) break;
      await sleep(150);
      data = await innertube('browse', { continuation: state.token });
    }
    return items;
  }

  async function removeFromWatchLater(ids, onProgress) {
    let done = 0;
    const failed = [];
    for (let i = 0; i < ids.length; i += 25) {
      const batch = ids.slice(i, i + 25);
      try {
        const j = await innertube('browse/edit_playlist', {
          playlistId: 'WL',
          actions: batch.map((id) => ({ action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: id })),
        });
        if (j.status === 'STATUS_SUCCEEDED') done += batch.length; else failed.push(...batch);
      } catch (e) { failed.push(...batch); }
      onProgress(done);
      await sleep(300);
    }
    return { done, failed };
  }

  // ---------------------------------------------------------------- envoi vers l'app
  function sendToApp(payload) {
    const w = window.open(APP_URL + '#yc-recv', '_blank');
    if (!w) { say('Le navigateur a bloqué l\'ouverture de Companion. Utilise « Copier » à la place.'); return; }
    let acked = false;
    const onMsg = (e) => {
      if (e.origin !== APP_ORIGIN || !e.data) return;
      if (e.data.type === 'yc-ready') w.postMessage({ type: 'yc-wl', payload }, APP_ORIGIN);
      if (e.data.type === 'yc-ack') {
        acked = true;
        window.removeEventListener('message', onMsg);
        say('✓ Envoyé à Companion (' + payload.items.length + ' vidéos).');
        setActions();
      }
    };
    window.addEventListener('message', onMsg);
    // Au cas où l'app serait prête avant notre écoute.
    const iv = setInterval(() => { if (acked) return clearInterval(iv); try { w.postMessage({ type: 'yc-wl', payload }, APP_ORIGIN); } catch (e) { /* pas encore chargée */ } }, 700);
    setTimeout(() => clearInterval(iv), 30000);
    say('Envoi à Companion… (garde cet onglet ouvert quelques secondes)');
  }

  async function copyPayload(payload) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload));
      say('✓ Copié. Dans Companion : Import → « Coller depuis le presse-papiers ».');
    } catch (e) {
      say('Copie impossible : ' + e.message + '. Utilise « Fichier ».');
    }
  }

  function downloadPayload(payload) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    a.download = 'a-regarder-plus-tard-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---------------------------------------------------------------- scénario principal
  let running = false;
  async function run(toRemove) {
    if (running) return;
    running = true;
    setActions();
    try {
      let purged = [];
      if (toRemove.length) {
        say('Retrait des vidéos vues… 0 / ' + toRemove.length);
        const r = await removeFromWatchLater(toRemove, (n) => say('Retrait des vidéos vues… ' + n + ' / ' + toRemove.length));
        purged = toRemove.filter((id) => !r.failed.includes(id));
        if (r.failed.length) console.warn('[Companion] retraits en échec', r.failed);
      }
      say('Lecture de « À regarder plus tard »…');
      const items = await fetchWatchLater((n) => say('Lecture de « À regarder plus tard »… ' + n + ' vidéos'));
      if (!items.length) throw new Error('Aucune vidéo trouvée. La liste est vide, ou YouTube a changé son format.');
      const payload = { source: 'plustard-wl', v: 2, exportedAt: new Date().toISOString(), count: items.length, items, purged };
      say((purged.length ? purged.length + ' vidéo(s) retirée(s). ' : '') + '✓ ' + items.length + ' vidéos récupérées.');
      setActions(
        btn('Envoyer à Companion', true, () => sendToApp(payload)),
        btn('Copier', false, () => copyPayload(payload)),
        btn('Fichier', false, () => downloadPayload(payload)),
      );
      window.__ycLastPayload = payload;
    } catch (e) {
      say('Erreur : ' + e.message);
      setActions(btn('Réessayer', true, () => run(toRemove)));
    } finally {
      running = false;
    }
  }

  // Lancement automatique quand l'app nous ouvre : #yc-sync=id1,id2…
  const m = location.hash.match(/^#yc-sync(?:=([\w,-]*))?/);
  if (m) {
    const ids = (m[1] || '').split(',').filter((x) => /^[\w-]{11}$/.test(x));
    history.replaceState(null, '', location.pathname + location.search);
    say('Préparation de la synchro…');
    // Laisse YouTube finir de charger, puis on y va (la config a toujours une valeur de repli).
    setTimeout(() => run(ids), window.ytcfg ? 300 : 1500);
  }
})();
