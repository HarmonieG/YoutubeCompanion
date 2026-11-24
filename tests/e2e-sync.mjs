// Test du script Companion sur un faux youtube.com : node tests/e2e-sync.mjs (serveur local sur :8080)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://localhost:8080/';
const OUT = process.env.OUT || '/tmp/yc-shots';
fs.mkdirSync(OUT, { recursive: true });
const USERSCRIPT = fs.readFileSync(path.join(ROOT, 'companion.user.js'), 'utf8');

// 240 vidéos réparties sur 3 pages (100 + 100 + 40)
const all = Array.from({ length: 240 }, (_, i) => ({
  videoId: ('w' + String(i).padStart(10, '0')).slice(0, 11),
  title: { runs: [{ text: ['Godot devlog', 'Blender tuto', 'Pixel art', 'Warhammer painting'][i % 4] + ' ' + i }] },
  shortBylineText: { runs: [{ text: 'Chaîne ' + (i % 5), navigationEndpoint: { browseEndpoint: { browseId: 'UC' + String(i % 5).padStart(22, 'x') } } }] },
  lengthSeconds: String(60 + i * 13),
}));
let removed = new Set();
const page = (start, n, token) => {
  const items = all.filter((v) => !removed.has(v.videoId)).slice(start, start + n).map((v) => ({ playlistVideoRenderer: v }));
  if (token) items.push({ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token } } } });
  return items;
};

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
let authSeen = '';
let isoContext = null;
await ctx.route(/fonts\.(googleapis|gstatic)|ytimg|accounts\.google|googleapis\.com/, (r) => r.abort());
await ctx.addInitScript(() => {
  if (location.hostname === 'localhost') localStorage.setItem('yc-token', JSON.stringify({ access_token: 't', expires_at: Date.now() + 3600e3 }));
  if (location.hostname === 'www.youtube.com') window.__YC_APP = 'http://localhost:8080/';
});
await ctx.route('https://www.youtube.com/**', async (r) => {
  const url = r.request().url();
  if (url.includes('/youtubei/v1/browse/edit_playlist')) {
    const body = JSON.parse(r.request().postData());
    body.actions.forEach((a) => removed.add(a.removedVideoId));
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'STATUS_SUCCEEDED' }) });
  }
  if (url.includes('/youtubei/v1/browse')) {
    authSeen = r.request().headers().authorization || '';
    const body = JSON.parse(r.request().postData());
    if (url.includes('key=AIzaFake')) isoContext = body.context;
    let json;
    if (body.browseId === 'VLWL') {
      json = { contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [{ playlistVideoListRenderer: { contents: page(0, 100, 'p1') } }] } }] } } } }] } } };
    } else if (body.continuation === 'p1') {
      json = { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: page(100, 100, 'p2') } }] };
    } else {
      json = { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: page(200, 100, null) } }] };
    }
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify(json) });
  }
  if (url.includes('iso=1')) {
    return r.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<html><body><h1>Faux YouTube (isolé)</h1><script>document.cookie='SAPISID=abc;path=/';var cfgset=function(){};cfgset({"INNERTUBE_API_KEY":"AIzaFake","INNERTUBE_CONTEXT":{"client":{"clientName":"MWEB","clientVersion":"2.2026","hl":"fr"},"user":{"note":"a \\"quoted\\" } brace"}},"INNERTUBE_CLIENT_VERSION":"2.2026"});</script></body></html>`,
    });
  }
  return r.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<html><body><h1>Faux YouTube</h1><script>document.cookie='SAPISID=abc;path=/';window.ytcfg={get:k=>({INNERTUBE_CONTEXT:{client:{clientName:'WEB',clientVersion:'2.2026'}},SESSION_INDEX:0,INNERTUBE_CONTEXT_CLIENT_NAME:1})[k]}</script></body></html>`,
  });
});

// 1) L'app connaît déjà 2 vidéos, dont une marquée « à retirer »
const app = await ctx.newPage();
app.on('pageerror', (e) => errors.push('app: ' + e.message));
await app.goto(BASE);
await app.waitForFunction(() => window.__yc);
await app.evaluate(async () => {
  const { store } = window.__yc;
  store.state.settings.setupDone = true;
  store.state.videos = {
    w0000000003: { id: 'w0000000003', title: 'ancienne', status: 'queued', manualTags: [], hiddenTags: [] },
    w0000000004: { id: 'w0000000004', title: 'gardée', status: 'active', manualTags: ['À revoir'], hiddenTags: [] },
  };
  store.changed('test');
  await store.persistNow();
});
await app.reload();
await app.waitForSelector('[data-go=import]');
await app.click('[data-go=import]');
const syncHref = await app.getAttribute('[data-act=syncyt]', 'href');
console.log('lien de synchro', syncHref);
await app.screenshot({ path: `${OUT}/20-import-sync.png`, fullPage: true });

// 2) On suit le lien vers YouTube, le script se lance tout seul
const yt = await ctx.newPage();
yt.on('pageerror', (e) => errors.push('yt: ' + e.message));
await yt.goto(syncHref);
await yt.evaluate(USERSCRIPT);
await yt.waitForSelector('text=Envoyer à Companion', { timeout: 15000 });
console.log('panneau :', await yt.locator('text=vidéos récupérées').innerText(), '| retirées côté YouTube :', [...removed], '| auth :', authSeen.slice(0, 24));
await yt.screenshot({ path: `${OUT}/21-script-pret.png` });

// 3) Envoi vers l'app (nouvel onglet ouvert par le script)
const popupP = ctx.waitForEvent('page');
await yt.click('text=Envoyer à Companion');
const popup = await popupP;
popup.on('pageerror', (e) => errors.push('popup: ' + e.message));
await popup.waitForSelector('text=Synchro YouTube', { timeout: 15000 });
await yt.waitForSelector('text=Envoyé à Companion', { timeout: 5000 });
const res = await popup.evaluate(() => {
  const v = Object.values(window.__yc.store.state.videos);
  const by = (s) => v.filter((x) => x.status === s).length;
  const kept = window.__yc.store.state.videos.w0000000004;
  return { total: v.length, active: by('active'), removed: by('removed'), queued: by('queued'), keptTags: kept.manualTags, channelId: v.find((x) => x.id === 'w0000000010').channelId, duration: v.find((x) => x.id === 'w0000000010').duration };
});
console.log('app après synchro', res);
await popup.screenshot({ path: `${OUT}/22-app-apres-synchro.png` });

// 4) L'ancien onglet de l'app s'est mis à jour (BroadcastChannel)
await app.waitForTimeout(800);
console.log('ancien onglet', (await app.locator('#nav').innerText()).replace(/\n/g, ' '));

// 5) Repli presse-papiers
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
await popup.evaluate((p) => navigator.clipboard.writeText(JSON.stringify(p)), { source: 'plustard-wl', items: [{ id: 'zzzzzzzzzzz', title: 'collée', duration: 30 }] });
await popup.click('[data-go=import]');
await popup.click('[data-act=paste]');
await popup.waitForSelector('text=Import :', { timeout: 5000 });
console.log('collage OK');

// 6) Script dans un espace isolé (cas Userscripts sur iOS) : config lue dans le HTML
const iso = await ctx.newPage();
iso.on('pageerror', (e) => errors.push('iso: ' + e.message));
await iso.goto('https://www.youtube.com/playlist?list=WL&iso=1#yc-sync');
await iso.evaluate(USERSCRIPT);
await iso.waitForSelector('text=Préparation de la synchro', { timeout: 3000 });
console.log('panneau immédiat OK');
await iso.waitForSelector('text=vidéos récupérées', { timeout: 15000 });
console.log('espace isolé : contexte lu dans le HTML', JSON.stringify(isoContext));

console.log('ERREURS', errors);
await browser.close();
