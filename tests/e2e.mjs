// Test de bout en bout avec Playwright (réseau simulé) : node tests/e2e.mjs
// Prérequis : serveur local sur http://localhost:8080 (npm run serve)
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8080/';
const OUT = process.env.OUT || '/tmp/yc-shots';
fs.mkdirSync(OUT, { recursive: true });

const words = ['Blender tuto donut', 'Godot devlog #12', 'Peindre des figurines Warhammer', 'Pixel art pour débutants', 'Video essay: why games feel good',
  'Raspberry Pi cyberdeck build', 'Unity C# tips', 'ASMR lofi ambiance', 'Krita brush review', 'Impression 3D : test Bambu', 'GDC talk game design', 'NES homebrew'];
const chans = ['Blender Guru', 'GDQuest', 'Squidmar Miniatures', 'Brackeys', 'Inconnu 1', 'Inconnu 2', 'Game Maker\'s Toolkit'];
const items = Array.from({ length: 240 }, (_, i) => ({
  id: ('v' + String(i).padStart(10, '0')).slice(0, 11),
  title: words[i % words.length] + ' ' + i,
  channelTitle: chans[i % chans.length],
  durationText: `${(i * 7) % 70}:${String(i % 60).padStart(2, '0')}`,
  index: i,
}));
fs.writeFileSync('/tmp/wl.json', JSON.stringify({ source: 'plustard-wl', items }));
const hist = [];
for (let i = 0; i < 400; i++) {
  const c = i % 3; // les 3 premières chaînes très regardées
  hist.push({ header: 'YouTube', title: 'Vous avez regardé ' + words[i % words.length], titleUrl: `https://www.youtube.com/watch?v=h${String(i).padStart(10, '0')}`.slice(0, 43), subtitles: [{ name: chans[c], url: 'https://www.youtube.com/channel/UC' + c }], time: '2025-05-01T00:00:00Z' });
}
hist.push({ header: 'YouTube', title: 'Vous avez regardé x', titleUrl: 'https://www.youtube.com/watch?v=' + items[5].id, subtitles: [{ name: chans[5], url: 'https://www.youtube.com/channel/UC5' }] });
fs.writeFileSync('/tmp/watch-history.json', JSON.stringify(hist));

const FAKE_YT = `window.YT={PlayerState:{PLAYING:1,ENDED:0},Player:function(el,o){var t=0,self=this;this.getDuration=()=>100;this.getCurrentTime=()=>t;
 this.setPlaybackRate=r=>{window.__rate=r};this.getAvailablePlaybackRates=()=>[1,1.5,2];this.destroy=()=>clearInterval(self.i);
 var f=document.createElement('div');f.id='fakeplayer';f.textContent='LECTEUR '+o.videoId;f.style.cssText='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#222';el.replaceWith(f);
 setTimeout(()=>{o.events.onReady();o.events.onStateChange({data:1});self.i=setInterval(()=>{t+=10},150)},50)}};window.onYouTubeIframeAPIReady&&window.onYouTubeIframeAPIReady();`;

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errors = [];
async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  await ctx.route(/fonts\.(googleapis|gstatic)|ytimg|accounts\.google/, (r) => r.abort());
  await ctx.route('https://www.youtube.com/iframe_api', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_YT }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errors.push(m.text()); });
  return page;
}

// ---------- mobile ----------
const page = await newPage({ width: 390, height: 844 });
await page.goto(BASE);
await page.screenshot({ path: `${OUT}/01-setup.png` });
await page.click('[data-act=setup-next]');
await page.setInputFiles('input[data-file=wl]', '/tmp/wl.json');
await page.waitForSelector('text=240 vidéos importées');
await page.click('[data-act=setup-next]');
await page.setInputFiles('input[data-file=history]', '/tmp/watch-history.json');
await page.waitForSelector('text=visionnages importés');
await page.click('[data-act=setup-next]');
await page.click('[data-act=setup-next]');
await page.click('[data-act=interest][data-tag="Godot"]');
await page.screenshot({ path: `${OUT}/02-questions.png`, fullPage: true });
await page.click('[data-act=setup-done]');
await page.waitForSelector('.card');
const cards = await page.locator('.card').count();
console.log('cartes affichées', cards);
await page.screenshot({ path: `${OUT}/03-liste.png` });

await page.click('[data-act=panel]');
await page.screenshot({ path: `${OUT}/04-tags.png` });
await page.click('.facets [data-tag="Rapide"]');
const rapide = await page.locator('.summary b').innerText();
await page.click('.facets [data-tag="Créateur préféré"]').catch(() => {});
console.log('rapides', rapide, '→ + préféré', await page.locator('.summary b').innerText());
await page.click('[data-act=panel]');
await page.screenshot({ path: `${OUT}/05-filtre.png` });
await page.click('[data-act=clear]');

await page.fill('#search', 'godot');
await page.waitForTimeout(400);
console.log('recherche godot', await page.locator('.summary b').innerText());
await page.fill('#search', '');
await page.waitForTimeout(400);

// lecteur + séquence de fin à 80 %
await page.locator('.card [data-act=open]').first().click();
await page.waitForSelector('#fakeplayer');
await page.click('[data-act=speed][data-speed="1.5"]');
console.log('vitesse', await page.evaluate(() => window.__rate));
await page.waitForSelector('#endsheet:not([hidden])', { timeout: 5000 });
await page.screenshot({ path: `${OUT}/06-fin.png` });
console.log('file de retrait', await page.evaluate(() => Object.values(window.__yc.store.state.videos).filter((v) => v.status === 'queued').length));
await page.fill('.addtag input', 'À revoir');
await page.press('.addtag input', 'Enter');
console.log('tag perso', await page.locator('.vtags .chip', { hasText: 'À revoir' }).count());
await page.click('[data-act=close]');
await page.locator('.card [data-act=queue]').first().click();
await page.click('[data-go=queue]');
await page.screenshot({ path: `${OUT}/07-a-retirer.png`, fullPage: true });
await page.click('[data-go=import]');
await page.screenshot({ path: `${OUT}/08-import.png`, fullPage: true });
await page.click('[data-go=settings]');
await page.screenshot({ path: `${OUT}/09-reglages.png` });

// ---------- persistance ----------
await page.reload();
await page.waitForSelector('.card');
console.log('après rechargement', await page.locator('#nav').innerText());

// ---------- desktop ----------
const d = await newPage({ width: 1366, height: 900 });
await d.goto(BASE);
await d.click('[data-act=setup-next]');
await d.setInputFiles('input[data-file=wl]', '/tmp/wl.json');
await d.click('[data-act=setup-next]');
await d.click('[data-act=setup-next]');
await d.click('[data-act=setup-next]');
await d.click('[data-act=setup-done]');
await d.waitForSelector('.card');
await d.screenshot({ path: `${OUT}/10-desktop.png` });
await d.locator('.card [data-act=open]').nth(2).click();
await d.waitForSelector('#fakeplayer');
await d.screenshot({ path: `${OUT}/11-desktop-lecteur.png` });

// ---------- bookmarklets sur un faux YouTube ----------
const { BOOKMARKLETS } = await import('../js/bookmarklets.js');
const yt = await newPage({ width: 1200, height: 800 });
await yt.route('https://www.youtube.com/**', (r) => {
  const url = r.request().url();
  if (url.includes('edit_playlist')) {
    const body = JSON.parse(r.request().postData());
    yt.__edits = (yt.__edits || 0) + body.actions.length;
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'STATUS_SUCCEEDED' }) });
  }
  const rows = items.slice(0, 120).map((it) => `<ytd-playlist-video-renderer><a id="video-title" title="${it.title}" href="/watch?v=${it.id}&list=WL&index=${it.index}">${it.title}</a><ytd-channel-name><a href="/@x">${it.channelTitle}</a></ytd-channel-name><ytd-thumbnail-overlay-time-status-renderer>${it.durationText}</ytd-thumbnail-overlay-time-status-renderer></ytd-playlist-video-renderer>`).join('');
  return r.fulfill({ contentType: 'text/html', body: `<html><body><script>window.ytcfg={get:k=>({INNERTUBE_CONTEXT:{client:{}},SESSION_INDEX:0})[k]};document.cookie='SAPISID=abc'</script>${rows}<div style="height:3000px"></div></body></html>` });
});
await yt.goto('https://www.youtube.com/playlist?list=WL');
const dl = yt.waitForEvent('download');
await yt.evaluate(BOOKMARKLETS.export.code);
const file = await dl;
const p = await file.path();
const exported = JSON.parse(fs.readFileSync(p, 'utf8'));
console.log('bookmarklet export', exported.count, exported.items[3]);
yt.on('dialog', (dlg) => dlg.accept(dlg.type() === 'prompt' ? items.slice(0, 30).map((i) => i.id).join(',') : undefined));
await yt.evaluate(BOOKMARKLETS.purge.code);
await yt.waitForTimeout(1500);
console.log('bookmarklet purge, actions envoyées :', yt.__edits);

console.log('ERREURS', errors);
await browser.close();
