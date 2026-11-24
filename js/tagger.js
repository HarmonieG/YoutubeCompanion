// Tags automatiques : durée, relation au créateur, statut, catégorie YouTube, mots-clés.

export const GROUPS = [
  { id: 'duree', label: 'Durée' },
  { id: 'createur', label: 'Créateur' },
  { id: 'statut', label: 'Statut' },
  { id: 'logiciel', label: 'Logiciel' },
  { id: 'techno', label: 'Techno' },
  { id: 'sujet', label: 'Sujet' },
  { id: 'mood', label: 'Format / mood' },
  { id: 'categorie', label: 'Catégorie YouTube' },
  { id: 'perso', label: 'Mes tags' },
];

export const FIXED_TAGS = {
  'Short': 'duree', 'Rapide': 'duree', 'Court': 'duree', 'Moyen': 'duree', 'Long': 'duree', 'Très long': 'duree',
  'Créateur préféré': 'createur', 'Abonné': 'createur', 'Habitué': 'createur', 'Alien': 'createur',
  'Déjà vue': 'statut', 'Commencée': 'statut', 'Indisponible': 'statut', 'Récente': 'statut', 'Vieille de la liste': 'statut',
};

export const CATEGORIES = {
  1: 'Films & animation', 2: 'Autos & véhicules', 10: 'Musique', 15: 'Animaux', 17: 'Sport',
  19: 'Voyages', 20: 'Jeux vidéo', 22: 'Vlogs', 23: 'Humour', 24: 'Divertissement',
  25: 'Actualités', 26: 'Vie pratique', 27: 'Éducation', 28: 'Science & tech', 29: 'Associatif',
};

const R = (group, tag, keywords) => ({ group, tag, keywords });
export const DEFAULT_RULES = [
  R('logiciel', 'Blender', ['blender']),
  R('logiciel', 'Unity', ['unity', 'unity3d', 'unity 6']),
  R('logiciel', 'Godot', ['godot', 'gdscript']),
  R('logiciel', 'Unreal', ['unreal', 'ue5', 'ue4']),
  R('logiciel', 'Krita', ['krita']),
  R('logiciel', 'Photoshop', ['photoshop']),
  R('logiciel', 'Aseprite', ['aseprite']),
  R('logiciel', 'Figma', ['figma']),
  R('logiciel', 'ZBrush', ['zbrush']),
  R('logiciel', 'Substance', ['substance painter', 'substance designer']),
  R('logiciel', 'Procreate', ['procreate']),
  R('logiciel', 'DaVinci Resolve', ['davinci', 'resolve']),
  R('logiciel', 'Home Assistant', ['home assistant']),
  R('techno', 'IA', ['ia', 'ai', 'chatgpt', 'claude', 'llm', 'midjourney', 'stable diffusion', 'intelligence artificielle', 'openai', 'gpt', 'gemini', 'agent ia', 'ai agent']),
  R('techno', 'C#', ['c#', 'csharp']),
  R('techno', 'Python', ['python']),
  R('techno', 'Web / JS', ['javascript', 'typescript', 'react', 'nodejs', 'node.js', 'css', 'html', 'svelte', 'vue.js']),
  R('techno', 'Raspberry Pi', ['raspberry pi', 'raspberry', 'rpi']),
  R('techno', 'Arduino / ESP32', ['arduino', 'esp32', 'microcontroller']),
  R('techno', 'Impression 3D', ['impression 3d', '3d print', '3d printing', '3d printed', 'imprimante 3d', 'bambu', 'resin printer', 'prusa']),
  R('techno', 'Rétro', ['nes', 'snes', 'game boy', 'gameboy', 'famicom', 'retro gaming', 'retrogaming', 'rétro', 'megadrive', 'mega drive', 'sega', 'pico-8', 'pico8', 'fantasy console']),
  R('sujet', 'Gamedev', ['gamedev', 'game dev', 'devlog', 'game design', 'indie game', 'jeu indé', 'développement de jeu', 'making a game', 'game jam', 'game developer', 'indie dev']),
  R('sujet', 'Pixel art', ['pixel art', 'pixelart', 'pixel-art', 'sprite', 'sprites']),
  R('sujet', 'Figurines', ['miniature', 'miniatures', 'warhammer', 'figurine', 'figurines', 'mini painting', 'kitbash', 'age of sigmar', '40k', 'wargame', 'wargaming', 'diorama']),
  R('sujet', 'Peinture', ['painting', 'peinture', 'aquarelle', 'watercolor', 'gouache', 'acrylic', 'oil painting']),
  R('sujet', 'Dessin', ['drawing', 'dessin', 'sketch', 'sketchbook', 'illustration', 'croquis', 'concept art']),
  R('sujet', 'Sculpture', ['sculpt', 'sculpting', 'sculpture', 'modelage']),
  R('sujet', 'JDR', ['jdr', 'jeu de rôle', 'jeux de rôle', 'd&d', 'dnd', 'dungeons', 'solo rpg', 'ttrpg', 'tabletop rpg']),
  R('sujet', 'Jeux de société', ['board game', 'boardgame', 'jeu de société', 'jeux de société']),
  R('sujet', 'Musique', ['music', 'musique', 'synth', 'synthesizer', 'chiptune', 'midi', 'ableton', 'sound design']),
  R('sujet', 'Cuisine', ['recette', 'recipe', 'cooking', 'cuisine']),
  R('sujet', 'DIY / Maker', ['diy', 'maker', 'bricolage', 'cyberdeck', 'homelab', 'synology', 'nas', 'soldering', 'build log']),
  R('sujet', 'Science', ['science', 'physique', 'physics', 'astronomie', 'astronomy', 'biology', 'biologie']),
  R('sujet', 'Histoire', ['histoire', 'history', 'historique']),
  R('sujet', 'Jeux vidéo', ['gameplay', 'let\'s play', 'speedrun', 'walkthrough', 'playthrough', 'jeu vidéo', 'video game']),
  R('mood', 'Tuto', ['tuto', 'tutorial', 'tutoriel', 'how to', 'comment faire', 'guide', 'beginner', 'débutant', 'step by step', 'course', 'cours', 'learn', 'apprendre', 'tips']),
  R('mood', 'Analyse / essai', ['video essay', 'essay', 'analyse', 'analysis', 'explained', 'expliqué', 'deep dive', 'why', 'pourquoi', 'the history of', 'documentary', 'documentaire']),
  R('mood', 'Review / test', ['review', 'test', 'critique', 'avis', 'unboxing', 'vs', 'comparison', 'comparatif']),
  R('mood', 'Actu', ['news', 'actu', 'actualité', 'announced', 'annonce', 'update', 'what\'s new', 'nouveautés']),
  R('mood', 'Détente', ['asmr', 'lofi', 'lo-fi', 'ambiance', 'relax', 'chill', 'cozy', 'timelapse', 'speedpaint', 'speed paint', 'satisfying']),
  R('mood', 'Podcast / interview', ['podcast', 'interview', 'entretien', 'talk', 'conférence', 'conference', 'gdc', 'panel']),
  R('mood', 'Making-of', ['making of', 'behind the scenes', 'post mortem', 'postmortem', 'coulisses']),
  R('mood', 'Live / VOD', ['live', 'stream', 'vod', 'rediff', 'livestream']),
];

export function normalizeText(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const isWordChar = (c) => !!c && /[a-z0-9]/.test(c);

export function containsKeyword(text, kw) {
  if (!kw) return false;
  let i = text.indexOf(kw);
  while (i !== -1) {
    const before = text[i - 1];
    const after = text[i + kw.length];
    const startOk = !isWordChar(kw[0]) || !isWordChar(before);
    const endOk = !isWordChar(kw[kw.length - 1]) || !isWordChar(after);
    if (startOk && endOk) return true;
    i = text.indexOf(kw, i + 1);
  }
  return false;
}

export function compileRules(rules) {
  return (rules || DEFAULT_RULES).map((r) => ({
    ...r,
    norm: r.keywords.map(normalizeText).filter(Boolean),
  }));
}

export function matchRules(text, compiled) {
  const t = normalizeText(text);
  const out = [];
  for (const r of compiled) if (r.norm.some((k) => containsKeyword(t, k))) out.push(r.tag);
  return out;
}

// Contexte partagé pour le calcul des tags (à reconstruire quand l'état change).
export function buildContext(state) {
  const compiled = compileRules(state.rules);
  const groupOf = { ...FIXED_TAGS };
  for (const r of compiled) groupOf[r.tag] = r.group;
  for (const c of Object.values(CATEGORIES)) groupOf[c] = 'categorie';
  const nameIndex = {};
  for (const [id, c] of Object.entries(state.channels)) {
    if (c.title) nameIndex[normalizeText(c.title)] = id;
  }
  return {
    state,
    compiled,
    groupOf,
    nameIndex,
    watched: new Set(state.history.watchedIds || []),
    fav: new Set(state.settings.favChannels || []),
    banned: new Set(state.settings.bannedChannels || []),
    interests: new Set(state.settings.interests || []),
  };
}

export function channelOf(video, ctx) {
  if (video.channelId && ctx.state.channels[video.channelId]) return ctx.state.channels[video.channelId];
  const id = ctx.nameIndex[normalizeText(video.channelTitle)];
  return id ? ctx.state.channels[id] : null;
}

export function channelKey(video, ctx) {
  if (video.channelId) return video.channelId;
  return ctx.nameIndex[normalizeText(video.channelTitle)] || null;
}

export function creatorTag(video, ctx) {
  const s = ctx.state.settings;
  const key = channelKey(video, ctx);
  const c = channelOf(video, ctx);
  const views = c ? c.views || 0 : 0;
  if (key && ctx.banned.has(key)) return views <= s.alienMaxViews ? 'Alien' : null;
  if (key && ctx.fav.has(key)) return 'Créateur préféré';
  if (c && c.subscribed && views >= s.favMinViews) return 'Créateur préféré';
  if (c && c.subscribed) return 'Abonné';
  if (views >= s.favMinViews) return 'Habitué';
  // « Alien » n'a de sens que si l'historique a été importé.
  if (ctx.state.history.total && views <= s.alienMaxViews) return 'Alien';
  return null;
}

export function autoTags(video, ctx) {
  const s = ctx.state.settings;
  const tags = [];
  const d = video.duration;
  if (d != null) {
    if (d <= 60) tags.push('Short');
    if (d <= s.quickMax) tags.push('Rapide');
    else if (d <= 15 * 60) tags.push('Court');
    else if (d <= 30 * 60) tags.push('Moyen');
    else if (d <= 60 * 60) tags.push('Long');
    else tags.push('Très long');
  }
  const ct = creatorTag(video, ctx);
  if (ct) tags.push(ct);
  if (ctx.watched.has(video.id)) tags.push('Déjà vue');
  if (video.progress > 0.05 && video.progress < s.watchedThreshold) tags.push('Commencée');
  if (video.unavailable) tags.push('Indisponible');
  if (video.publishedAt && Date.now() - Date.parse(video.publishedAt) < 30 * 864e5) tags.push('Récente');
  if (video.addedAt && Date.now() - video.addedAt > 2 * 365 * 864e5) tags.push('Vieille de la liste');
  if (video.categoryId && CATEGORIES[video.categoryId]) tags.push(CATEGORIES[video.categoryId]);
  const text = [video.title, (video.ytTags || []).join(' , '), video.channelTitle].join(' | ');
  for (const t of matchRules(text, ctx.compiled)) if (!tags.includes(t)) tags.push(t);
  return tags;
}

export function videoTags(video, ctx) {
  const hidden = new Set(video.hiddenTags || []);
  const tags = autoTags(video, ctx).filter((t) => !hidden.has(t));
  for (const t of video.manualTags || []) if (!tags.includes(t)) tags.push(t);
  return tags;
}

export function groupOfTag(tag, ctx) {
  return ctx.groupOf[tag] || 'perso';
}

// Affinité thématique calculée depuis l'historique (titres seulement).
export function historyAffinity(entries, compiled) {
  const counts = {};
  let n = 0;
  for (const e of entries) {
    const tags = matchRules(e.title + ' | ' + e.channelTitle, compiled);
    if (tags.length) n++;
    for (const t of tags) counts[t] = (counts[t] || 0) + 1;
  }
  const out = {};
  for (const [t, c] of Object.entries(counts)) out[t] = c / Math.max(1, entries.length);
  return out;
}

// Score « Pour moi » : affinité créateur + thèmes habituels + centres d'intérêt.
export function relevance(video, tags, ctx) {
  const c = channelOf(video, ctx);
  const views = c ? c.views || 0 : 0;
  let score = Math.log2(1 + views) * 1.5;
  if (tags.includes('Créateur préféré')) score += 4;
  else if (tags.includes('Abonné')) score += 1.5;
  const aff = ctx.state.history.tagAffinity || {};
  for (const t of tags) {
    if (aff[t]) score += Math.min(3, aff[t] * 40);
    if (ctx.interests.has(t)) score += 3;
  }
  if (tags.includes('Commencée')) score += 2;
  if (tags.includes('Indisponible')) score -= 10;
  if (tags.includes('Déjà vue')) score -= 2;
  return score;
}

const SIMILAR_WEIGHT = { logiciel: 3, techno: 2.5, sujet: 2, mood: 1, categorie: 0.5, perso: 2.5, createur: 0, duree: 0, statut: 0 };

export function similarity(a, aTags, b, bTags, ctx) {
  if (a.id === b.id) return -1;
  let s = 0;
  const set = new Set(aTags);
  for (const t of bTags) if (set.has(t)) s += SIMILAR_WEIGHT[groupOfTag(t, ctx)] ?? 1;
  const ka = channelKey(a, ctx), kb = channelKey(b, ctx);
  if (ka && ka === kb) s += 2;
  return s;
}

export function formatDuration(sec) {
  if (sec == null) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function parseIsoDuration(iso) {
  const m = (iso || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + (+(m[4] || 0));
}
