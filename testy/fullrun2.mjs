// Pełny zapis przebiegu przez interfejs, na siatce użytkownika: przycisk „Save run” z historią 56 stacji z 6 lat (dorobioną), wczytanie ze strony tytułowej i z Settings, dalszy przebieg, restart.
// Użycie: serwer Vite, `node fullrun2.mjs` (PORT, QUERY, OUTDIR – pobrany plik i zrzuty ekranu)
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import os from 'os';
import path from 'path';
const PORT = process.env.PORT || 5240, QUERY = process.env.QUERY || '?dx=7500&nx=96&ny=92&start=51.84,19.19,0', OUT = process.env.OUTDIR || fs.mkdtempSync(path.join(os.tmpdir(), 'w3drun-'));
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--disable-gpu-sandbox', '--ignore-gpu-blocklist', '--window-size=1400,900'], protocolTimeout: 0,
  userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'w3d-')) });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
await page.setRequestInterception(true);
page.on('request', (r) => { if (/open-meteo/.test(r.url())) r.abort(); else r.continue(); });
page.on('console', (m) => { const t = m.text(); if (/error|Error/i.test(t) && !/open-meteo|ERR_FAILED|Failed to load/i.test(t)) console.log('PAGE:', t.slice(0, 400)); });
page.on('pageerror', (e) => console.log('PAGEERR:', e.message));
page.on('dialog', (d) => { console.log('okno:', d.message().slice(0, 90)); d.accept(); });
const cdp = await browser.target().createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT, eventsEnabled: true });
const log = (...a) => console.log(...a);
const ready = () => page.waitForFunction(() => window.__sim && window.__sim.ready(), { timeout: 900000 });
const clock = () => page.evaluate(() => document.getElementById('clockDate').textContent + ' ' + document.getElementById('chipSpeed').textContent);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let t = Date.now();
await page.goto(`http://localhost:${PORT}/${QUERY}`, { waitUntil: 'load' });
await ready();
log(`start ${((Date.now() - t) / 1000).toFixed(0)} s`, await page.evaluate(() => document.getElementById('err').textContent));
await page.evaluate(() => { document.getElementById('speed').value = 'max'; });
await page.evaluate(() => {
  const st = [];
  for (let i = 0; i < 56; i++) st.push({ name: `S${i}`, xkm: 30 + (i % 8) * 80, ykm: 30 + Math.floor(i / 8) * 80, zs: 100 + 20 * i });
  window.__sim.stations().importList(st);
});
await wait(25000);
log('przebieg', await clock());
// historia 6 lat: kopie prawdziwych wpisów (rozmiar pliku i czas zapisu jak po długim przebiegu)
log('historia', await page.evaluate(() => {
  const s = window.__sim.stations(), f = s.exportFull();
  const pad = (a, n) => { const o = []; if (a.length) for (let i = 0; i < n; i++) o.push({ ...a[i % a.length], T2: (a[i % a.length].T2 ?? 0) + Math.random(), Tmean: (a[i % a.length].Tmean ?? 0) + Math.random() }); return o; };
  f.hist = f.hist.map((h) => ({ h10: pad(h.h10, 432), h1: pad(h.h1, 2880), d: pad(h.d, 2282) }));
  s.importFull(f);
  const h = s.history(0);
  return `stacji ${f.hist.length}, doby ${h.d.length}, godziny ${h.h1}, 10 min ${h.h10}`;
}));
await page.evaluate(() => document.querySelector('#tabs button[data-tab=set]').click());
await wait(500);
await page.screenshot({ path: path.join(OUT, 'settings.png') });
t = Date.now();
const before = await clock();
await page.evaluate(() => document.getElementById('runSave').click());
await page.waitForFunction(() => /^(Saved|Could not)/.test(document.getElementById('runInfo').textContent), { timeout: 600000 });
log(`zapis ${((Date.now() - t) / 1000).toFixed(1)} s:`, await page.evaluate(() => document.getElementById('runInfo').textContent));
log('zegar przed / po zapisie', before, '/', await clock());
let file = null;
for (let i = 0; i < 30 && !file; i++) { file = fs.readdirSync(OUT).find((f) => f.endsWith('.w3drun')); if (!file) await wait(500); }
if (!file) {
  // pobieranie w trybie bez okna bywa blokowane: ten sam plik przez API, kawalkami
  log('(bez pobrania - plik z API)');
  file = 'api.w3drun';
  await page.evaluate(async () => { window.__b = (await window.__sim.runBlob()).blob; });
  const size = await page.evaluate(() => window.__b.size), fd = fs.openSync(path.join(OUT, file), 'w');
  for (let o = 0; o < size; o += 24 << 20) {
    const b64 = await page.evaluate(async (a, n) => { const u = new Uint8Array(await window.__b.slice(a, a + n).arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768)); return btoa(s); }, o, 24 << 20);
    fs.writeSync(fd, Buffer.from(b64, 'base64'));
  }
  fs.closeSync(fd);
}
const fp = path.join(OUT, file);
log('plik', file, (fs.statSync(fp).size / 1048576).toFixed(1), 'MB');
await page.evaluate(() => { window.__sim.stop(); });
const saved = await page.evaluate(() => { const s = window.__sim; return { ana: s.ana('m').filter((x) => !x.cur), days: s.stations().history(0).d.length, n: s.stations().exportFull().live.length }; });
// wczytanie ze strony tytułowej
await page.goto(`http://localhost:${PORT}/?title`, { waitUntil: 'load' });
await page.waitForSelector('#ttResume', { visible: true, timeout: 60000 });
await wait(1500);
await page.screenshot({ path: path.join(OUT, 'title.png') });
t = Date.now();
await (await page.$('#ttRunFile')).uploadFile(fp);
await page.waitForFunction(() => /resume=1/.test(location.search) || /Could not/.test(document.getElementById('ttRunInfo')?.textContent || ''), { timeout: 300000 });
log(`plik przekazany ${((Date.now() - t) / 1000).toFixed(1)} s`, await page.evaluate(() => location.search));
await ready();
log(`wczytanie razem ${((Date.now() - t) / 1000).toFixed(1)} s, adres`, await page.evaluate(() => location.search), 'błąd:', await page.evaluate(() => document.getElementById('err').textContent));
const after = await page.evaluate(() => { const s = window.__sim; return { ana: s.ana('m').filter((x) => !x.cur), days: s.stations().history(0).d.length, n: s.stations().exportFull().live.length, speed: document.getElementById('speed').value }; });
log('analizy zgodne:', JSON.stringify(saved.ana) === JSON.stringify(after.ana), 'stacje', saved.n, after.n, 'doby', saved.days, after.days, 'prędkość', after.speed);
await wait(4000);
log('po wczytaniu', await clock());
await page.evaluate(() => document.querySelector('#tabs button[data-tab=wx]').click());
await wait(15000);
await page.screenshot({ path: path.join(OUT, 'weather.png') });
log('po 19 s', await clock(), 'prognoza:', await page.evaluate(() => { const s = window.__sim.syn(); return s ? s.fc : null; }));
await page.evaluate(() => document.querySelector('#tabs button[data-tab=mon]').click());
await wait(1500);
await page.screenshot({ path: path.join(OUT, 'mon.png') });
// wczytanie z Settings (ten sam plik, z oknem potwierdzenia)
await page.evaluate(() => document.querySelector('#tabs button[data-tab=set]').click());
t = Date.now();
await (await page.$('#runFile')).uploadFile(fp);
await page.waitForFunction(() => /resume=1/.test(location.search), { timeout: 300000 });
await ready();
log(`wczytanie z Settings ${((Date.now() - t) / 1000).toFixed(1)} s`, await clock(), 'błąd:', await page.evaluate(() => document.getElementById('err').textContent));
// restart po wczytaniu: nowy rozbieg, bez błędów
t = Date.now();
await page.evaluate(() => window.__sim.reset());
await ready();
log(`restart ${((Date.now() - t) / 1000).toFixed(0)} s`, await clock(), 'błąd:', await page.evaluate(() => document.getElementById('err').textContent));
await wait(3000);
log('po restarcie', await clock());
log('katalog', OUT);
await browser.close();
