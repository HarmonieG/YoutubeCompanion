// Tests sans navigateur : node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWatchLater, parseHistory, extractId, parseDurationText } from '../js/importers.js';
import { explain, buildContext, autoTags, containsKeyword, normalizeText, parseIsoDuration, matchRules, compileRules } from '../js/tagger.js';
import { emptyState } from '../js/store.js';

test('extractId', () => {
  assert.equal(extractId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=WL'), 'dQw4w9WgXcQ');
  assert.equal(extractId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});

test('durées', () => {
  assert.equal(parseDurationText('4:05'), 245);
  assert.equal(parseDurationText('1:02:03'), 3723);
  assert.equal(parseIsoDuration('PT1H2M3S'), 3723);
  assert.equal(parseIsoDuration('PT45S'), 45);
});

test('export bookmarklet', () => {
  const json = JSON.stringify({ source: 'plustard-wl', items: [{ id: 'aaaaaaaaaaa', title: 'Blender tuto', channelTitle: 'X', durationText: '3:00', index: 0 }] });
  const r = parseWatchLater(json);
  assert.equal(r.length, 1);
  assert.equal(r[0].duration, 180);
});

test('CSV Takeout', () => {
  const csv = 'ID de la vidéo,Horodatage de la création de la vidéo de la playlist\naaaaaaaaaaa,2021-03-04T10:00:00+00:00\nbbbbbbbbbbb,2022-01-01T00:00:00+00:00\n';
  const r = parseWatchLater(csv, 'À regarder plus tard-vidéos.csv');
  assert.equal(r.length, 2);
  assert.ok(r[0].addedAt > 0);
});

test('historique JSON', () => {
  const h = JSON.stringify([
    { header: 'YouTube', title: 'Vous avez regardé Mon devlog Godot', titleUrl: 'https://www.youtube.com/watch?v=ccccccccccc', subtitles: [{ name: 'Chaîne', url: 'https://www.youtube.com/channel/UC123' }], time: '2025-01-01T00:00:00Z' },
    { header: 'YouTube Music', title: 'Watched song', titleUrl: 'https://www.youtube.com/watch?v=ddddddddddd' },
    { header: 'YouTube', title: 'Pub', titleUrl: 'https://www.youtube.com/watch?v=eeeeeeeeeee', details: [{ name: 'From Google Ads' }] },
  ]);
  const r = parseHistory(h);
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'Mon devlog Godot');
  assert.equal(r[0].channelId, 'UC123');
});

test('historique HTML', () => {
  const html = '<div>Vous avez regardé <a href="https://www.youtube.com/watch?v=ccccccccccc">Titre &amp; co</a><br><a href="https://www.youtube.com/channel/UCabc">Chaîne</a><br>1 janv. 2025</div>';
  const r = parseHistory(html);
  assert.equal(r[0].title, 'Titre & co');
});

test('mots-clés avec frontières', () => {
  assert.ok(containsKeyword(normalizeText('Learn C# in 1 hour'), 'c#'));
  assert.ok(!containsKeyword(normalizeText('Nintendo Switch'), 'nes'));
  assert.ok(containsKeyword(normalizeText('My NES game'), 'nes'));
  assert.ok(!containsKeyword(normalizeText('Paint like this'), 'ai'));
  assert.ok(containsKeyword(normalizeText('Peindre des Figurines'), 'figurines'));
  const t = matchRules('Tutoriel Blender : sculpter un dragon', compileRules());
  assert.ok(t.includes('Blender') && t.includes('Tuto'));
});

const DAY = 864e5;
const today = Math.floor(Date.now() / DAY);
const times = (n, daysAgo = 0, step = 3) => Array.from({ length: n }, (_, i) => today - daysAgo - i * step);

test('tags auto : durée, créateur, déjà vue', () => {
  const s = emptyState();
  s.channels = { UCfav: { title: 'Fav', views: 12, times: times(6), subscribed: true }, UCalien: { title: 'Alien', views: 0 } };
  s.history.watchedIds = ['vvvvvvvvvvv']; s.history.total = 1;
  const ctx = buildContext(s);
  const a = autoTags({ id: 'vvvvvvvvvvv', title: 'Godot devlog', channelId: 'UCfav', duration: 200 }, ctx);
  assert.ok(a.includes('Rapide') && a.includes('Favori') && a.includes('Déjà vue') && a.includes('Godot') && a.includes('Gamedev'), a.join());
  const b = autoTags({ id: 'xxxxxxxxxxx', title: 'Long video essay', channelTitle: 'Inconnu', duration: 4000 }, ctx);
  assert.ok(b.includes('Très long') && b.includes('Alien') && b.includes('Analyse / essai'));
});

test('niveaux Favori > Aimé > Apprécié selon les vues récentes, et Perdu de vue', () => {
  const s = emptyState();
  s.history.total = 1;
  s.settings.tierFav = 1; s.settings.tierLiked = 1; s.settings.tierAppr = 1;
  s.channels = {
    UCa: { title: 'A', views: 20, times: times(20, 0, 2) },          // très regardée en ce moment
    UCb: { title: 'B', views: 6, times: times(6, 0, 10) },           // régulièrement
    UCc: { title: 'C', views: 2, times: times(2, 30, 20) },          // de temps en temps
    UCold: { title: 'Old', views: 80, times: times(60, 300, 1), lastView: Date.now() - 300 * DAY, subscribed: true }, // plus vue depuis 10 mois
    UCsub: { title: 'Sub', views: 0, times: [], subscribed: true },
  };
  const ctx = buildContext(s);
  const tag = (ch) => autoTags({ id: 'x', title: 't', channelId: ch }, ctx).find((t) => ['Favori', 'Aimé', 'Apprécié', 'Perdu de vue', 'Abonné', 'Alien'].includes(t));
  assert.equal(tag('UCa'), 'Favori');
  assert.equal(tag('UCb'), 'Aimé');
  assert.equal(tag('UCc'), 'Apprécié');
  assert.equal(tag('UCold'), 'Perdu de vue');
  assert.equal(tag('UCsub'), 'Abonné');
  // Un favori épinglé à la main passe devant
  s.settings.favChannels = ['UCc'];
  assert.equal(autoTags({ id: 'x', title: 't', channelId: 'UCc' }, buildContext(s)).includes('Favori'), true);
});

test('historique : dates de visionnage conservées, la temporalité compte', async () => {
  const { importHistory, recordView } = await import('../js/data.js');
  const { store } = await import('../js/store.js');
  const now = Date.now();
  const e = (ch, daysAgo) => ({ id: 'id' + Math.random().toString(36).slice(2, 11), title: 't', channelId: ch, channelTitle: ch, time: now - daysAgo * DAY });
  importHistory([
    ...Array.from({ length: 50 }, (_, i) => e('UCold', 400 + i)),   // beaucoup, il y a plus d'un an
    ...Array.from({ length: 5 }, (_, i) => e('UCnew', i * 10)),      // peu, mais récemment
  ]);
  let ctx = buildContext(store.state);
  assert.equal(ctx.stats.UCold.views, 50);
  assert.equal(ctx.stats.UCold.recent, 0);
  assert.equal(ctx.stats.UCnew.recentViews, 5);
  assert.ok(ctx.stats.UCnew.heat > ctx.stats.UCold.heat);
  const tag = (c) => autoTags({ id: 'x', title: 't', channelId: c }, ctx);
  assert.ok(tag('UCnew').includes('Favori'));
  assert.ok(tag('UCold').includes('Perdu de vue'));
  // Regarder une vidéo dans l'app réchauffe la chaîne
  store.state.videos.zz = { id: 'zz', channelId: 'UCold', channelTitle: 'UCold', status: 'active' };
  recordView('zz');
  ctx = buildContext(store.state);
  assert.equal(ctx.stats.UCold.recentViews, 1);
  assert.ok(!autoTags({ id: 'x', title: 't', channelId: 'UCold' }, ctx).includes('Perdu de vue'));
});

test('le temps compte, pas le nombre : 20 Shorts < 3 vidéos longues', () => {
  const s = emptyState();
  s.history.total = 1;
  s.settings.tierFav = 1; s.settings.tierLiked = 0; s.settings.tierAppr = 5;
  s.channels = {
    UCshorts: { title: 'Shorts', views: 20, times: Array.from({ length: 20 }, (_, i) => [today - i, 0.5]) },  // 20 × 30 s
    UClong: { title: 'Long', views: 3, times: [[today - 2, 60], [today - 9, 60], [today - 20, 45]] },         // 3 longues vidéos
  };
  const ctx = buildContext(s);
  assert.ok(ctx.stats.UClong.heat > ctx.stats.UCshorts.heat);
  assert.ok(autoTags({ id: 'x', title: 't', channelId: 'UClong' }, ctx).includes('Favori'));
  assert.ok(!autoTags({ id: 'x', title: 't', channelId: 'UCshorts' }, ctx).includes('Favori'));
  const why = explain({ id: 'x', title: 't', channelId: 'UCshorts', channelTitle: 'Shorts' }, autoTags({ id: 'x', title: 't', channelId: 'UCshorts' }, ctx), ctx);
  assert.ok(why.reasons.some((r) => /surtout des Shorts/.test(r.text)), JSON.stringify(why.reasons));
});

test('pondération de l\'historique par la durée (API simulée)', async () => {
  const google = await import('../js/google.js');
  const { importHistory, weightHistoryByDuration, historyDurationsTodo } = await import('../js/data.js');
  const { store } = await import('../js/store.js');
  importHistory([
    { id: 'short000001', title: 's', channelId: 'UCs', channelTitle: 'S', time: Date.now() - DAY },
    { id: 'longvid0001', title: 'l', channelId: 'UCl', channelTitle: 'L', time: Date.now() - DAY },
    { id: 'gonevid0001', title: 'g', channelId: 'UCl', channelTitle: 'L', time: Date.now() - DAY },
  ]);
  assert.equal(historyDurationsTodo().length, 3);
  void google;
  // fetchDurations est appelé via google.js : on simule fetch
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ items: [
    { id: 'short000001', contentDetails: { duration: 'PT45S' } },
    { id: 'longvid0001', contentDetails: { duration: 'PT1H30M' } },
  ] }) });
  const mem = { 'yc-token': JSON.stringify({ access_token: 't', expires_at: Date.now() + 3600e3 }) };
  globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: (k) => { delete mem[k]; } };
  google.auth.restore();
  await weightHistoryByDuration();
  const ch = store.state.channels;
  assert.deepEqual(ch.UCs.times[0].slice(1), [0.8]);
  assert.ok(ch.UCl.times.some((t) => t[1] === 60), JSON.stringify(ch.UCl.times));   // plafonné à 60 min
  assert.ok(ch.UCl.times.some((t) => t[1] === 10), JSON.stringify(ch.UCl.times));   // supprimée : 10 min par défaut
  assert.equal(historyDurationsTodo().length, 0);
});

test('journal des nouveautés : lecture de CHANGELOG.md', async () => {
  const fs = await import('node:fs');
  const { parseChangelog } = await import('../js/changelog.js');
  const entries = parseChangelog(fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'));
  assert.ok(entries.length >= 3);
  assert.match(entries[0].version, /^\d+\.\d+\.\d+$/);
  assert.ok(entries[0].date && entries[0].title && entries[0].items.length);
  // les versions sont rangées de la plus récente à la plus ancienne
  const n = (v) => v.split('.').reduce((a, x) => a * 1000 + Number(x), 0);
  for (let i = 1; i < entries.length; i++) assert.ok(n(entries[i - 1].version) > n(entries[i].version));
});

test('« Déjà vue » seulement à partir de 50 % regardés', () => {
  const s = emptyState();
  s.history.watchedIds = ['a0000000000', 'b0000000000', 'c0000000000'];
  const ctx = buildContext(s);
  const t = (v) => autoTags({ title: 't', ...v }, ctx);
  assert.ok(!t({ id: 'a0000000000', ytProgress: 0.04 }).includes('Déjà vue'), 'juste ouverte : pas vue');
  assert.ok(t({ id: 'a0000000000', ytProgress: 0.04 }).length >= 0);
  assert.ok(t({ id: 'b0000000000', ytProgress: 0.3 }).includes('Commencée'));
  assert.ok(!t({ id: 'b0000000000', ytProgress: 0.3 }).includes('Déjà vue'));
  assert.ok(t({ id: 'x0000000000', ytProgress: 0.55 }).includes('Déjà vue'));
  assert.ok(t({ id: 'x0000000000', progress: 0.6 }).includes('Déjà vue'));
  // progression inconnue (ancien script) : on se rabat sur l'historique
  assert.ok(t({ id: 'c0000000000' }).includes('Déjà vue'));
  s.settings.seenThreshold = 0.9;
  assert.ok(!autoTags({ id: 'x0000000000', title: 't', ytProgress: 0.55 }, buildContext(s)).includes('Déjà vue'));
});
