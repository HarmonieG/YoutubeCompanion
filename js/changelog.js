// Journal des nouveautés : lit CHANGELOG.md (source unique) et suit ce qui a déjà été lu.
const SEEN_KEY = 'yc-changelog-seen';

// « ## 0.8.0 — 24 novembre 2026 — Résumé » puis des lignes « - … »
export function parseChangelog(md) {
  const out = [];
  let cur = null;
  for (const line of md.split('\n')) {
    const h = line.match(/^##\s+([\d.]+)\s*(?:[—–-]\s*([^—–]+?))?\s*(?:[—–-]\s*(.+))?\s*$/);
    if (h) {
      cur = { version: h[1], date: (h[2] || '').trim(), title: (h[3] || '').trim(), items: [] };
      out.push(cur);
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.+)$/);
    if (li && cur) cur.items.push(li[1].trim());
    else if (cur && line.trim() && cur.items.length && /^\s{2,}\S/.test(line)) cur.items[cur.items.length - 1] += ' ' + line.trim();
  }
  return out;
}

const cmp = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

export const changelog = {
  entries: [],
  async load() {
    try {
      const res = await fetch('CHANGELOG.md', { cache: 'no-cache' });
      if (res.ok) this.entries = parseChangelog(await res.text());
    } catch { /* hors ligne : pas grave */ }
    return this.entries;
  },
  get latest() { return this.entries[0]?.version || ''; },
  get seen() { try { return localStorage.getItem(SEEN_KEY) || ''; } catch { return ''; } },
  // Nouvelles versions pas encore lues (à la toute première ouverture, rien n'est signalé).
  unread() {
    const seen = this.seen;
    if (!seen) return [];
    return this.entries.filter((e) => cmp(e.version, seen) > 0);
  },
  markSeen() { try { localStorage.setItem(SEEN_KEY, this.latest); } catch { /* rien */ } },
  // Premier passage : un nouvel utilisateur n'a rien à « rattraper » ; un utilisateur qui avait déjà
  // des données découvre la dernière version.
  initSeen(hasData) {
    if (this.seen || !this.latest) return;
    const base = hasData ? this.entries[1]?.version : this.latest;
    try { localStorage.setItem(SEEN_KEY, base || this.latest); } catch { /* rien */ }
  },
};
