// Tests sans navigateur : node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWatchLater, parseHistory, extractId, parseDurationText } from '../js/importers.js';
import { buildContext, autoTags, containsKeyword, normalizeText, parseIsoDuration, matchRules, compileRules } from '../js/tagger.js';
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

test('tags auto : durée, créateur, déjà vue', () => {
  const s = emptyState();
  s.channels = { UCfav: { title: 'Fav', views: 12, recent: 6, heat: 5, subscribed: true }, UCalien: { title: 'Alien', views: 0 } };
  s.history.watchedIds = ['vvvvvvvvvvv']; s.history.total = 1;
  const ctx = buildContext(s);
  const a = autoTags({ id: 'vvvvvvvvvvv', title: 'Godot devlog', channelId: 'UCfav', duration: 200 }, ctx);
  assert.ok(a.includes('Rapide') && a.includes('Créateur préféré') && a.includes('Déjà vue') && a.includes('Godot') && a.includes('Gamedev'));
  const b = autoTags({ id: 'xxxxxxxxxxx', title: 'Long video essay', channelTitle: 'Inconnu', duration: 4000 }, ctx);
  assert.ok(b.includes('Très long') && b.includes('Alien') && b.includes('Analyse / essai'));
});

test('créateur préféré = vues récentes, pas seulement l\'abonnement', async () => {
  const s = emptyState();
  s.history.total = 1;
  s.channels = {
    UCold: { title: 'Ancien chouchou', views: 80, recent: 0, heat: 0.1, subscribed: true },
    UCnew: { title: 'Découverte', views: 6, recent: 6, heat: 5.5, subscribed: false },
    UCsub: { title: 'Abonné oublié', views: 1, recent: 0, heat: 0, subscribed: true },
  };
  const ctx = buildContext(s);
  const tag = (ch) => autoTags({ id: 'x', title: 't', channelId: ch }, ctx).find((t) => ['Créateur préféré', 'Habitué', 'Abonné', 'Alien'].includes(t));
  assert.equal(tag('UCold'), 'Habitué');
  assert.equal(tag('UCnew'), 'Créateur préféré');
  assert.equal(tag('UCsub'), 'Abonné');
});

test('historique : vues récentes et pondération par l\'ancienneté', async () => {
  const { importHistory } = await import('../js/data.js');
  const { store } = await import('../js/store.js');
  const day = 864e5, now = Date.parse('2026-11-01');
  const e = (ch, daysAgo) => ({ id: 'id' + Math.random().toString(36).slice(2, 11), title: 't', channelId: ch, channelTitle: ch, time: now - daysAgo * day });
  const entries = [
    ...Array.from({ length: 50 }, (_, i) => e('UCold', 400 + i)),   // beaucoup, mais il y a plus d'un an
    ...Array.from({ length: 5 }, (_, i) => e('UCnew', i * 10)),      // peu, mais récemment
  ];
  importHistory(entries);
  const ch = store.state.channels;
  assert.equal(ch.UCold.views, 50);
  assert.equal(ch.UCold.recent, 0);
  assert.equal(ch.UCnew.recent, 5);
  assert.ok(ch.UCnew.heat > ch.UCold.heat, 'les vues récentes pèsent plus');
  const ctx = buildContext(store.state);
  const tag = (c) => autoTags({ id: 'x', title: 't', channelId: c }, ctx);
  assert.ok(tag('UCnew').includes('Créateur préféré'));
  assert.ok(tag('UCold').includes('Habitué'));
});
