// Connexion Google (Google Identity Services, flux « token » côté navigateur),
// appels YouTube Data API v3 et synchro Google Drive (dossier caché de l'app).
import { parseIsoDuration } from './tagger.js';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube',        // lire infos vidéos/abonnements + ajouter à une playlist
  'https://www.googleapis.com/auth/drive.appdata',  // synchro des tags entre appareils
].join(' ');

const YT = 'https://www.googleapis.com/youtube/v3';
const SYNC_FILE = 'youtube-companion.json';

let tokenClient = null;
let token = null;      // { access_token, expires_at }
let pending = null;

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Impossible de charger Google Identity Services'));
    document.head.appendChild(s);
  });
}

export const auth = {
  get signedIn() { return !!token && token.expires_at > Date.now(); },
  user: null,

  restore() {
    try {
      const t = JSON.parse(sessionStorage.getItem('yc-token') || 'null');
      if (t && t.expires_at > Date.now() + 60e3) token = t;
      this.user = JSON.parse(localStorage.getItem('yc-user') || 'null');
    } catch { /* rien */ }
    return this.signedIn;
  },

  async signIn(clientId, { silent = false } = {}) {
    if (!clientId) throw new Error('Client ID Google manquant (voir Réglages).');
    await loadGis();
    if (!tokenClient || tokenClient._cid !== clientId) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        callback: (resp) => {
          const p = pending; pending = null;
          if (resp.error) return p?.reject(new Error(resp.error_description || resp.error));
          token = { access_token: resp.access_token, expires_at: Date.now() + (resp.expires_in - 60) * 1000 };
          sessionStorage.setItem('yc-token', JSON.stringify(token));
          p?.resolve(token);
        },
        error_callback: (err) => { const p = pending; pending = null; p?.reject(new Error(err.message || err.type)); },
      });
      tokenClient._cid = clientId;
    }
    const prom = new Promise((resolve, reject) => { pending = { resolve, reject }; });
    tokenClient.requestAccessToken({ prompt: silent ? '' : (this.user ? '' : 'consent') });
    await prom;
    try {
      const me = await ytGet('channels', { part: 'snippet', mine: 'true' });
      const c = me.items?.[0];
      this.user = c ? { channelId: c.id, title: c.snippet.title, thumb: c.snippet.thumbnails?.default?.url } : { title: 'Compte Google' };
      localStorage.setItem('yc-user', JSON.stringify(this.user));
    } catch { /* pas de chaîne : pas grave */ }
    return token;
  },

  signOut() {
    if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token.access_token, () => {});
    token = null; this.user = null;
    sessionStorage.removeItem('yc-token');
    localStorage.removeItem('yc-user');
  },

  async ensure(clientId) {
    if (this.signedIn) return;
    await this.signIn(clientId, { silent: true });
  },
};

async function call(url, opts = {}) {
  if (!auth.signedIn) throw new Error('Connexion Google requise');
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token.access_token}`, ...(opts.headers || {}) },
  });
  if (!res.ok) {
    let msg = res.status + '';
    try { const j = await res.json(); msg = j.error?.message || msg; } catch { /* rien */ }
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return res.status === 204 ? null : res.json();
}

function ytGet(path, params) {
  return call(`${YT}/${path}?${new URLSearchParams(params)}`);
}

// Infos détaillées par paquets de 50 (1 unité de quota par paquet).
export async function fetchVideos(ids, onProgress) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const r = await ytGet('videos', { part: 'snippet,contentDetails', id: chunk.join(','), maxResults: 50 });
    for (const it of r.items || []) {
      const sn = it.snippet;
      out[it.id] = {
        title: sn.title,
        channelId: sn.channelId,
        channelTitle: sn.channelTitle,
        publishedAt: sn.publishedAt,
        categoryId: +sn.categoryId,
        ytTags: (sn.tags || []).slice(0, 30),
        desc: (sn.description || '').slice(0, 280),
        thumb: (sn.thumbnails?.medium || sn.thumbnails?.default)?.url,
        duration: parseIsoDuration(it.contentDetails?.duration),
        live: sn.liveBroadcastContent !== 'none' ? sn.liveBroadcastContent : undefined,
      };
    }
    onProgress?.(Math.min(ids.length, i + 50), ids.length);
  }
  return out;
}

export async function fetchSubscriptions() {
  const out = {};
  let pageToken = '';
  do {
    const r = await ytGet('subscriptions', { part: 'snippet', mine: 'true', maxResults: 50, ...(pageToken && { pageToken }) });
    for (const it of r.items || []) out[it.snippet.resourceId.channelId] = it.snippet.title;
    pageToken = r.nextPageToken || '';
  } while (pageToken);
  return out;
}

export async function fetchMyPlaylists() {
  const out = [];
  let pageToken = '';
  do {
    const r = await ytGet('playlists', { part: 'snippet,contentDetails', mine: 'true', maxResults: 50, ...(pageToken && { pageToken }) });
    for (const it of r.items || []) out.push({ id: it.id, title: it.snippet.title, count: it.contentDetails?.itemCount });
    pageToken = r.nextPageToken || '';
  } while (pageToken);
  return out;
}

export function addToPlaylist(playlistId, videoId) {
  return call(`${YT}/playlistItems?part=snippet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } } }),
  });
}

export function createPlaylist(title) {
  return call(`${YT}/playlists?part=snippet,status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snippet: { title }, status: { privacyStatus: 'private' } }),
  });
}

// ---------- Synchro Drive (appDataFolder, invisible dans le Drive de l'utilisateur) ----------
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
let syncFileId = null;

async function findSyncFile() {
  if (syncFileId) return syncFileId;
  const r = await call(`${DRIVE}/files?${new URLSearchParams({ spaces: 'appDataFolder', q: `name='${SYNC_FILE}'`, fields: 'files(id,modifiedTime)' })}`);
  syncFileId = r.files?.[0]?.id || null;
  return syncFileId;
}

export async function driveLoad() {
  const id = await findSyncFile();
  if (!id) return null;
  return call(`${DRIVE}/files/${id}?alt=media`);
}

export async function driveSave(state) {
  const id = await findSyncFile();
  const body = JSON.stringify(state);
  if (id) {
    await call(`${UPLOAD}/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
    return;
  }
  const boundary = 'yc' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: SYNC_FILE, parents: ['appDataFolder'], mimeType: 'application/json' });
  const multipart = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const r = await call(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart,
  });
  syncFileId = r.id;
}
