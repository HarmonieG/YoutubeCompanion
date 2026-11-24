// Test de bout en bout avec Playwright (YouTube et Google simulés) : node tests/e2e.mjs
// Prérequis : serveur local sur http://localhost:8080 (npm run serve)
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8080/';
const OUT = process.env.OUT || '/tmp/yc-shots';
fs.mkdirSync(OUT, { recursive: true });

const words = ['Blender tuto donut', 'Godot devlog #12', 'Peindre des figurines Warhammer', 'Pixel art pour débutants', 'Video essay: why games feel good',
  'Raspberry Pi cyberdeck build', 'Unity C# tips', 'ASMR lofi ambiance', 'Krita brush review', 'Impression 3D : test Bambu', 'GDC talk game design', 'NES homebrew'];
const chans = ['Blender Guru', 'GDQuest', 'Squidmar Miniatures', 'Brackeys', 'Inconnu 1', 'Inconnu 2', 'Game Maker\'s Toolkit'];
const chanId = (i) => 'UC' + String(i).padStart(22, 'c');
const items = Array.from({ length: 240 }, (_, i) => ({
  id: ('v' + String(i).padStart(10, '0')).slice(0, 11),
  title: words[i % words.length] + ' ' + i,
  channelTitle: chans[i % chans.length],
  channelId: chanId(i % chans.length),
  duration: 40 + ((i * 397) % 4200),
  watched: i % 20 === 7 ? 100 : i % 20 === 8 ? 40 : 0,   // barre de progression YouTube
  index: i,
}));
const payload = { source: 'plustard-wl', v: 2, items };
const hist = [];
for (let i = 0; i < 400; i++) {
  const c = i % 3; // les 3 premières chaînes très regardées
  hist.push({ header: 'YouTube', title: 'Vous avez regardé ' + words[i % words.length], titleUrl: 'https://www.youtube.com/watch?v=h' + String(i).padStart(10, '0'), subtitles: [{ name: chans[c], url: 'https://www.youtube.com/channel/' + chanId(c) }], time: '2025-05-01T00:00:00Z' });
}
hist.push({ header: 'YouTube', title: 'Vous avez regardé x', titleUrl: 'https://www.youtube.com/watch?v=' + items[5].id, subtitles: [{ name: chans[5], url: 'https://www.youtube.com/channel/' + chanId(5) }] });
fs.writeFileSync('/tmp/watch-history.json', JSON.stringify(hist));

// Faux lecteur YouTube : la vidéo « dure » 100 s et avance de 10 s toutes les 60 ms, puis se termine.
const FAKE_YT = `window.YT={PlayerState:{PLAYING:1,ENDED:0},Player:function(el,o){var t=0,self=this,ended=false;this.getDuration=()=>100;this.getCurrentTime=()=>t;
 this.setPlaybackRate=r=>{window.__rate=r};this.getAvailablePlaybackRates=()=>[1,1.5,2];this.destroy=()=>clearInterval(self.i);
 var f=document.createElement('div');f.id='fakeplayer';f.textContent='LECTEUR '+o.videoId;f.style.cssText='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#222';el.replaceWith(f);
 setTimeout(()=>{o.events.onReady();o.events.onStateChange({data:1});self.i=setInterval(()=>{t+=10;if(t>=100&&!ended){ended=true;t=100;o.events.onStateChange({data:0})}},60)},50)}};window.onYouTubeIframeAPIReady&&window.onYouTubeIframeAPIReady();`;

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errors = [];
async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  await ctx.route(/fonts\.(googleapis|gstatic)|ytimg|accounts\.google/, (r) => r.abort());
  await ctx.route(/googleapis\.com/, (r) => r.fulfill({ status: 404, body: '{}' }));
  await ctx.route('https://www.youtube.com/iframe_api', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_YT }));
  // Faux jeton pour passer le mur de connexion
  await ctx.addInitScript(() => { if (location.hostname === 'localhost') localStorage.setItem('yc-token', JSON.stringify({ access_token: 'test', expires_at: Date.now() + 3600e3 })); });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|404/.test(m.text())) errors.push(m.text()); });
  return page;
}
const log = (...a) => console.log('•', ...a);

// ---------- mur de connexion ----------
{
  const ctx0 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx0.route(/fonts\.(googleapis|gstatic)|accounts\.google/, (r) => r.abort());
  const p0 = await ctx0.newPage();
  await p0.goto(BASE);
  await p0.waitForSelector('.login');
  log('mur de connexion', await p0.locator('.login [data-act=signin]').count(), 'nav', await p0.locator('#nav button').count());
}

// ---------- onboarding (mobile) ----------
const page = await newPage({ width: 390, height: 844 });
await page.goto(BASE);
await page.waitForSelector('.setup');
await page.screenshot({ path: `${OUT}/01-onboarding-script.png`, fullPage: true });
await page.click('[data-act=setup-next]');
await page.screenshot({ path: `${OUT}/02-onboarding-synchro.png`, fullPage: true });
// la liste arrive du script
await page.evaluate((p) => window.__yc.applyPayload(p, 'Synchro YouTube'), payload);
await page.waitForSelector('text=vidéos reçues');
log('onboarding après réception :', await page.locator('.setup h2').innerText());
await page.click('[data-act=setup-next]');
await page.setInputFiles('input[data-file=history]', '/tmp/watch-history.json');
await page.waitForSelector('.toast >> text=Historique');
await page.click('[data-act=interest][data-tag="Godot"]');
await page.screenshot({ path: `${OUT}/03-onboarding-gouts.png`, fullPage: true });
await page.click('[data-act=setup-done]');

// ---------- accueil ----------
await page.waitForSelector('.shelf');
const shelves = await page.locator('.shelf > header h3').allInnerTexts();
log('rayons', shelves.map((s) => s.replace(/\s+/g, ' ')).join(' | '));
await page.screenshot({ path: `${OUT}/04-accueil.png` });
await page.screenshot({ path: `${OUT}/04b-accueil-full.png`, fullPage: true });

// ⓘ pourquoi
await page.locator('.shelf[data-shelf=foryou] .why-btn').first().click();
await page.waitForSelector('#picker .reasons');
log('raisons', (await page.locator('#picker .reasons').innerText()).replace(/\n/g, ' / '));
await page.screenshot({ path: `${OUT}/05-pourquoi.png` });
const before = await page.locator('#picker .why .hint b').innerText();
await page.locator('#picker .adj').nth(1).locator('[data-d="1"]').click();
log('score avant/après +', before, '→', await page.locator('#picker .why .hint b').innerText());
await page.click('#picker [data-act=pickclose]');

// rayon → liste
await page.locator('.shelf[data-shelf=quick] [data-act=shelf-all]').click();
await page.waitForSelector('.listtitle');
log('liste depuis rayon', await page.locator('.listtitle').innerText(), '|', (await page.locator('.summary').innerText()).replace(/\n/g, ' '));

// ---------- liste : session de 30 min ----------
await page.click('[data-act=clear]');
await page.click('[data-act=budget][data-b="1800"]');
const summary = await page.locator('.summary span').first().innerText();
const chansSeq = await page.locator('.grid.seq .card .chan').allInnerTexts();
const consecutive = chansSeq.some((c, i) => i && c === chansSeq[i - 1]);
log('session 30 min :', summary, '| même chaîne deux fois de suite ?', consecutive);
await page.screenshot({ path: `${OUT}/06-liste-session.png` });

// lecture enchaînée : fin de vidéo → compte à rebours → suivante
await page.click('[data-act=playall]');
await page.waitForSelector('#fakeplayer');
const first = await page.locator('#fakeplayer').innerText();
log('position', await page.locator('.sesspos').innerText());
await page.waitForSelector('.countdown', { timeout: 8000 });
await page.screenshot({ path: `${OUT}/07-fin-compte-a-rebours.png` });
await page.waitForFunction((f) => document.querySelector('#fakeplayer')?.textContent !== f, first, { timeout: 9000 });
log('suivante lancée automatiquement :', await page.locator('.sesspos').innerText());
await page.click('[data-act=close]');
log('à retirer', await page.evaluate(() => Object.values(window.__yc.store.state.videos).filter((v) => v.status === 'queued').length));

// ---------- suggestions de retrait ----------
await page.click('[data-go=home]');
log('rappel accueil :', (await page.locator('.seenbanner').innerText()).replace(/\n/g, ' '));
await page.click('.seenbanner');
await page.waitForSelector('.qlist.sug');
log('onglet', (await page.locator('#nav [data-go=seen]').innerText()).replace(/\n/g, ' '), '|', (await page.locator('.panel p').first().innerText()).slice(0, 90));
log('1re suggestion :', (await page.locator('.qlist.sug .qrow small').first().innerText()));
await page.screenshot({ path: `${OUT}/09-suggestions.png` });
await page.locator('.qlist.sug [data-act=keep-sug]').first().click();
await page.click('[data-act=sug-all][data-min="2"]');
log('après « retirer les sûres » :', await page.evaluate(() => Object.values(window.__yc.store.state.videos).filter((v) => v.status === 'queued').length), 'en file');

// ---------- nouveautés ----------
await page.evaluate(() => localStorage.setItem('yc-changelog-seen', '0.1.0'));
await page.evaluate(() => window.__yc.render());
log('cloche :', await page.locator('.bell .dot').innerText(), 'non lues');
await page.click('.bell');
await page.waitForSelector('.changelog .cl');
log('journal :', await page.locator('.changelog .cl').count(), 'versions, première :', await page.locator('.changelog h4').first().innerText());
await page.screenshot({ path: `${OUT}/12-nouveautes.png` });
await page.click('#picker [data-act=pickclose]');
log('après lecture, pastille :', await page.locator('.bell .dot').count());

await page.click('[data-go=settings]');
await page.screenshot({ path: `${OUT}/08-reglages.png` });

// ---------- desktop ----------
const d = await newPage({ width: 1366, height: 900 });
await d.goto(BASE);
await d.waitForFunction(() => window.__yc);
await d.evaluate(async (p) => { window.__yc.store.state.settings.setupDone = true; window.__yc.ui.view = 'home'; window.__yc.applyPayload(p, 'test'); }, payload);
await d.click('[data-go=home]');
await d.waitForSelector('.shelf');
await d.screenshot({ path: `${OUT}/10-desktop-accueil.png` });
await d.click('[data-go=library]');
await d.screenshot({ path: `${OUT}/11-desktop-liste.png` });

log('ERREURS', errors);
await browser.close();
