// Curation automatique : rayons de la page Accueil et enchaînements de la page Liste.
import { groupOfTag } from './tagger.js';

const MIN = 60;

// Rayon lié au moment de la journée.
export function contextShelf(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 6 && h < 11) return { id: 'ctx', icon: '☕', title: 'Pour le café', why: 'C\'est le matin : des vidéos de moins de 10 min.', filter: { type: 'dur', max: 10 * MIN, label: '< 10 min' } };
  if (h >= 11.5 && h < 14) return { id: 'ctx', icon: '🥪', title: 'Pause déj', why: 'C\'est l\'heure du déjeuner : des vidéos de 8 à 30 min.', filter: { type: 'dur', min: 8 * MIN, max: 30 * MIN, label: '8–30 min' } };
  if (h >= 18 && h < 23) return { id: 'ctx', icon: '🛋️', title: 'Pour la soirée', why: 'Le soir, place aux vidéos longues (plus de 20 min).', filter: { type: 'dur', min: 20 * MIN, label: '> 20 min' } };
  if (h >= 23 || h < 6) return { id: 'ctx', icon: '🌙', title: 'Avant de dormir', why: 'Tard le soir : des vidéos de moins de 15 min.', filter: { type: 'dur', max: 15 * MIN, label: '< 15 min' } };
  return { id: 'ctx', icon: '⏱️', title: 'Entre deux tâches', why: 'En journée : des vidéos de moins de 15 min.', filter: { type: 'dur', max: 15 * MIN, label: '< 15 min' } };
}

export function matchesFilter(v, tags, f, ctxHelpers) {
  if (f.type === 'tag') return tags.includes(f.value);
  if (f.type === 'dur') {
    if (v.duration == null) return false;
    return (f.min == null || v.duration >= f.min) && (f.max == null || v.duration <= f.max);
  }
  if (f.type === 'channel') return ctxHelpers.channelMatches(v, f);
  return true;
}

const THEME_ICONS = {
  logiciel: '🧰', techno: '🔌', sujet: '🎨', mood: '🎬',
  Gamedev: '🎮', 'Pixel art': '👾', Figurines: '🛡️', Peinture: '🖌️', Dessin: '✏️', Sculpture: '🗿', JDR: '🎲', 'Jeux de société': '♟️',
  Musique: '🎹', Cuisine: '🍳', 'DIY / Maker': '🔧', Science: '🔭', Histoire: '📜', 'Jeux vidéo': '🕹️', IA: '🤖', 'Rétro': '📼',
  'Impression 3D': '🖨️', 'Raspberry Pi': '🍓', Blender: '🧊', Godot: '🤖', Unity: '🧩',
};

/**
 * Construit les rayons de l'accueil.
 * items : [{ v, tags, score }] pour les vidéos actives.
 */
export function buildShelves(items, { interests = [], ctx, helpers, now = new Date() }) {
  const shelves = [];
  const pick = (filters, sort = 'score') => {
    let list = items.filter(({ v, tags }) => filters.every((f) => matchesFilter(v, tags, f, helpers)));
    if (sort === 'score') list = [...list].sort((a, b) => b.score - a.score);
    if (sort === 'recent') list = [...list].sort((a, b) => (b.v.lastPlayedAt || 0) - (a.v.lastPlayedAt || 0));
    if (sort === 'published') list = [...list].sort((a, b) => (Date.parse(b.v.publishedAt || 0) || 0) - (Date.parse(a.v.publishedAt || 0) || 0));
    if (sort === 'shuffle') list = shuffleDaily(list);
    return list;
  };
  const push = (def, filters, sort, min = 3) => {
    const list = pick(filters, sort);
    if (list.length >= min) shelves.push({ ...def, filters, sort, total: list.length, items: list.slice(0, 15) });
  };
  const tag = (value) => ({ type: 'tag', value });

  push({ id: 'resume', icon: '▶️', title: 'À reprendre', why: 'Tu les as commencées sans les finir.' }, [tag('Commencée')], 'recent', 1);
  const c = contextShelf(now);
  push(c, [c.filter], 'score');
  push({ id: 'foryou', icon: '✨', title: 'Pour toi', why: 'Les mieux notées d\'après tes créateurs, tes thèmes et tes réglages. Touche ⓘ sur une vidéo pour voir le détail.' }, [], 'score');
  push({ id: 'quick', icon: '⚡', title: 'Vite vu', why: 'Moins de 5 minutes : de quoi vider la liste rapidement.' }, [tag('Rapide')], 'score');
  push({ id: 'fav', icon: '❤️', title: 'Tes créateurs préférés', why: 'Les chaînes que tu regardes le plus ces 3 derniers mois, abonné ou pas.' }, [tag('Créateur préféré')], 'score', 2);
  push({ id: 'habit', icon: '🔁', title: 'Tes habitués', why: 'Des chaînes que tu as beaucoup regardées, mais moins ces derniers temps.' }, [tag('Habitué')], 'score');

  // Thèmes : centres d'intérêt d'abord, puis les plus présents dans la liste.
  const counts = {};
  for (const { tags } of items) for (const t of tags) {
    const g = groupOfTag(t, ctx);
    if (g === 'sujet' || g === 'logiciel' || g === 'techno') counts[t] = (counts[t] || 0) + 1;
  }
  const themes = [...new Set([...interests.filter((t) => counts[t]), ...Object.keys(counts).sort((a, b) => counts[b] - counts[a])])].slice(0, 5);
  for (const t of themes) {
    push({ id: 'theme:' + t, icon: THEME_ICONS[t] || THEME_ICONS[groupOfTag(t, ctx)] || '🏷️', title: t, why: interests.includes(t) ? `Un de tes centres d'intérêt (${counts[t]} vidéos).` : `Un des thèmes les plus présents dans ta liste (${counts[t]} vidéos).` }, [tag(t)], 'score');
  }

  push({ id: 'aliens', icon: '👽', title: 'Les Aliens', why: 'Des chaînes que tu n\'as jamais regardées. La sélection change chaque jour.' }, [tag('Alien')], 'shuffle');
  push({ id: 'learn', icon: '🎓', title: 'Apprendre', why: 'Tutos et cours.' }, [tag('Tuto')], 'score');
  push({ id: 'think', icon: '🧠', title: 'À méditer', why: 'Analyses, video essays et documentaires.' }, [tag('Analyse / essai')], 'score');
  push({ id: 'chill', icon: '😌', title: 'Détente', why: 'ASMR, lofi, timelapses… à regarder sans réfléchir.' }, [tag('Détente')], 'score');
  push({ id: 'new', icon: '🆕', title: 'Fraîchement publiées', why: 'Publiées il y a moins d\'un mois.' }, [tag('Récente')], 'published', 2);
  push({ id: 'seen', icon: '🧹', title: 'Déjà vues ?', why: 'Ces vidéos apparaissent dans ton historique : tu peux sans doute les retirer.', cleanup: true }, [tag('Déjà vue')], 'score', 1);
  push({ id: 'gone', icon: '🚫', title: 'Indisponibles', why: 'Supprimées ou devenues privées : à retirer.', cleanup: true }, [tag('Indisponible')], 'score', 1);
  return shelves;
}

// Mélange stable sur la journée (même ordre tant qu'on ne change pas de jour).
function shuffleDaily(list) {
  const day = new Date().toISOString().slice(0, 10);
  const h = (s) => { let x = 2166136261; for (const ch of day + s) x = Math.imul(x ^ ch.charCodeAt(0), 16777619); return x >>> 0; };
  return [...list].sort((a, b) => h(a.v.id) - h(b.v.id));
}

/**
 * Enchaînement : garde l'ordre de pertinence mais évite deux vidéos de la même chaîne
 * à la suite, et respecte un budget de temps (en secondes) s'il est fourni.
 */
export function buildSequence(items, { budget = 0, keyOf }) {
  const pool = [...items];
  const out = [];
  let total = 0;
  let prev = null;
  while (pool.length) {
    let idx = pool.findIndex((it, i) => i < 6 && keyOf(it.v) !== prev);
    if (idx === -1) idx = 0;
    if (budget) {
      const remaining = budget - total;
      if (remaining < 120) break;
      // Parmi les mieux notées, on préfère une vidéo qui laisse de la place aux autres
      // (≤ 60 % du temps total) et d'une autre chaîne que la précédente.
      const dur = (it) => it.v.duration ?? 600;
      const cap = Math.min(remaining, budget * 0.6);
      const tries = [
        (it, i) => i < 40 && dur(it) <= cap && keyOf(it.v) !== prev,
        (it, i) => i < 40 && dur(it) <= remaining && keyOf(it.v) !== prev,
        (it) => dur(it) <= remaining && keyOf(it.v) !== prev,
        (it) => dur(it) <= remaining,
      ];
      idx = -1;
      for (const t of tries) { idx = pool.findIndex(t); if (idx !== -1) break; }
      if (idx === -1) break;
    }
    const [it] = pool.splice(idx, 1);
    out.push(it);
    total += it.v.duration ?? 0;
    prev = keyOf(it.v);
  }
  return { items: out, total };
}
