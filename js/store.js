// Stockage local (IndexedDB) de tout l'état de l'app, en mémoire + persistance différée.
const DB_NAME = 'plus-tard';
const STORE = 'kv';
const KEY = 'state';

export const DEFAULT_SETTINGS = {
  clientId: '',
  quickMax: 300,          // secondes : en dessous = « Rapide »
  favMinViews: 5,         // vues dans l'historique pour devenir « Préféré » / « Habitué »
  alienMaxViews: 0,       // vues max pour être un « Alien »
  watchedThreshold: 0.8,  // part regardée qui déclenche le retrait
  favChannels: [],        // ids de chaînes ajoutées à la main
  bannedChannels: [],     // chaînes marquées « jamais préféré »
  interests: [],          // tags mis en avant (boost de pertinence)
  defaultSpeed: 1,
  setupDone: false,
  sync: true,
};

export function emptyState() {
  return {
    version: 1,
    updatedAt: 0,
    videos: {},           // id -> vidéo
    channels: {},         // channelId -> { title, views, lastView, subscribed }
    history: { importedAt: 0, total: 0, watchedIds: [], tagAffinity: {} },
    settings: { ...DEFAULT_SETTINGS },
    rules: null,          // null = règles par défaut (voir tagger.js)
    wlImportedAt: 0,
  };
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const r = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(r && r.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const store = {
  state: emptyState(),
  listeners: new Set(),
  _timer: null,

  async load() {
    try {
      const saved = await idb('readonly', (s) => s.get(KEY));
      if (saved) this.state = normalize(saved);
    } catch (e) {
      console.warn('IndexedDB indisponible', e);
    }
    return this.state;
  },

  replace(newState) {
    this.state = normalize(newState);
    this.persistNow(false);
    this.emit('replace');
  },

  // Signale un changement : sauvegarde différée + notification.
  changed(reason = 'change', { touch = true } = {}) {
    if (touch) this.state.updatedAt = Date.now();
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.persistNow(true), 400);
    this.emit(reason);
  },

  async persistNow(notifySync = true) {
    clearTimeout(this._timer);
    try {
      await idb('readwrite', (s) => s.put(this.state, KEY));
    } catch (e) {
      console.warn('Sauvegarde locale impossible', e);
    }
    if (notifySync) this.emit('persisted');
  },

  async reset() {
    this.state = emptyState();
    await this.persistNow(false);
    this.emit('replace');
  },

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit(reason) { for (const fn of this.listeners) fn(reason); },
};

function normalize(s) {
  const base = emptyState();
  return {
    ...base,
    ...s,
    settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) },
    history: { ...base.history, ...(s.history || {}) },
    videos: s.videos || {},
    channels: s.channels || {},
  };
}
