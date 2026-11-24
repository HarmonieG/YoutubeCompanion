// Scripts à lancer SUR youtube.com (favori « javascript: » ou console du navigateur).
// L'API officielle ne donne pas accès à « À regarder plus tard » : ces scripts
// utilisent la session YouTube déjà ouverte dans le navigateur.
// Attention : YouTube impose Trusted Types → pas d'innerHTML ici.

/* eslint-disable no-undef */
function wlExport() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (!/youtube\.com$/.test(location.hostname) || !location.search.includes('list=WL')) {
    if (confirm('Ce script doit être lancé sur la page « À regarder plus tard ». L\'ouvrir maintenant ?\n(Relance le favori une fois la page chargée.)')) {
      location.href = 'https://www.youtube.com/playlist?list=WL';
    }
    return;
  }
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:99999;top:16px;right:16px;background:#1F2226;color:#F2EDE4;padding:14px 18px;border-radius:12px;font:14px sans-serif;box-shadow:0 6px 24px #0008;max-width:320px';
  document.body.appendChild(box);
  const say = (t) => { box.textContent = t; };
  const rowsSel = 'ytd-playlist-video-renderer';
  (async () => {
    let last = -1, still = 0, rounds = 0;
    while (rounds < 2000) {
      rounds++;
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(900);
      const n = document.querySelectorAll(rowsSel).length;
      const loading = document.querySelector('ytd-continuation-item-renderer');
      say('YouTube Companion — chargement de la liste… ' + n + ' vidéos');
      if (n === last) still++; else still = 0;
      last = n;
      if ((!loading && still >= 2) || still >= 25) break;
    }
    const items = [];
    const seen = new Set();
    const rows = document.querySelectorAll(rowsSel);
    rows.forEach((r, idx) => {
      const a = r.querySelector('a#video-title') || r.querySelector('a[href*="watch?v="]');
      if (!a) return;
      const m = (a.getAttribute('href') || '').match(/[?&]v=([\w-]{11})/);
      if (!m || seen.has(m[1])) return;
      seen.add(m[1]);
      const ch = r.querySelector('ytd-channel-name a, #channel-name a, a[href^="/@"], a[href^="/channel/"]');
      let dur = '';
      r.querySelectorAll('ytd-thumbnail-overlay-time-status-renderer, badge-shape, [class*="badge"]').forEach((el) => {
        const t = (el.textContent || '').trim().match(/\d+(?::\d{2}){1,2}/);
        if (t && !dur) dur = t[0];
      });
      items.push({
        id: m[1],
        title: (a.getAttribute('title') || a.textContent || '').trim(),
        channelTitle: ch ? ch.textContent.trim() : '',
        channelUrl: ch ? ch.href : '',
        durationText: dur,
        index: idx,
      });
    });
    const data = { source: 'plustard-wl', exportedAt: new Date().toISOString(), count: items.length, items };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const dl = document.createElement('a');
    dl.href = url;
    dl.download = 'a-regarder-plus-tard-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(dl);
    dl.click();
    say('✓ ' + items.length + ' vidéos exportées. Importe le fichier téléchargé dans YouTube Companion.');
    setTimeout(() => box.remove(), 15000);
  })().catch((e) => say('Erreur : ' + e.message));
}

function wlPurge() {
  if (!/youtube\.com$/.test(location.hostname)) {
    alert('Lance ce script sur youtube.com (connecté à ton compte).');
    return;
  }
  const raw = prompt('Colle ici la liste copiée depuis YouTube Companion (identifiants des vidéos à retirer) :');
  if (!raw) return;
  const ids = [...new Set(raw.match(/[\w-]{11}/g) || [])];
  if (!ids.length) { alert('Aucun identifiant trouvé.'); return; }
  if (!confirm('Retirer ' + ids.length + ' vidéo(s) de « À regarder plus tard » ?')) return;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:99999;top:16px;right:16px;background:#1F2226;color:#F2EDE4;padding:14px 18px;border-radius:12px;font:14px sans-serif;box-shadow:0 6px 24px #0008;max-width:320px';
  document.body.appendChild(box);
  const say = (t) => { box.textContent = t; };
  (async () => {
    const cookie = (n) => (document.cookie.match('(?:^|; )' + n + '=([^;]*)') || [])[1];
    const sapisid = cookie('SAPISID') || cookie('__Secure-3PAPISID');
    if (!sapisid) throw new Error('Session YouTube introuvable : es-tu bien connecté ?');
    const ts = Math.floor(Date.now() / 1000);
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(ts + ' ' + sapisid + ' ' + location.origin));
    const hash = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const cfg = window.ytcfg;
    const context = cfg && cfg.get('INNERTUBE_CONTEXT');
    if (!context) throw new Error('Configuration YouTube introuvable, recharge la page et réessaie.');
    let done = 0;
    const failed = [];
    for (let i = 0; i < ids.length; i += 25) {
      const batch = ids.slice(i, i + 25);
      say('Retrait en cours… ' + done + ' / ' + ids.length);
      const res = await fetch('/youtubei/v1/browse/edit_playlist?prettyPrint=false', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'SAPISIDHASH ' + ts + '_' + hash,
          'X-Origin': location.origin,
          'X-Goog-AuthUser': String(cfg.get('SESSION_INDEX') || 0),
        },
        body: JSON.stringify({
          context,
          playlistId: 'WL',
          actions: batch.map((id) => ({ action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: id })),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.status === 'STATUS_SUCCEEDED') done += batch.length;
      else failed.push(...batch);
      await new Promise((r) => setTimeout(r, 400));
    }
    say('✓ ' + done + ' vidéo(s) retirée(s)' + (failed.length ? ' — ' + failed.length + ' en échec.' : '.') + ' Recharge la page pour voir la liste à jour.');
    if (failed.length) console.warn('YouTube Companion — échecs :', failed.join(','));
  })().catch((e) => say('Erreur : ' + e.message));
}
/* eslint-enable no-undef */

const src = (fn) => '(' + fn.toString() + ')();';
export const BOOKMARKLETS = {
  export: { name: '⤓ Export Plus Tard', code: src(wlExport), href: 'javascript:' + encodeURIComponent(src(wlExport)) },
  purge: { name: '✕ Purge Plus Tard', code: src(wlPurge), href: 'javascript:' + encodeURIComponent(src(wlPurge)) },
};
