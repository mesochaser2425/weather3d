// Manipulacja atmosfery: wybór na stronie tytułowej, zmiana suwaka w trakcie przebiegu (wchodzi liniowo przez czas „kick-in”), kopie modelu synoptycznego,
// przycisk Neutral, restart, wpływ na pole docelowe (A/B przy tej samej pogodzie), zrzuty. Użycie: serwer Vite, `node manip.mjs` (PORT, OUTDIR). ~2 min.
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import os from 'os';
import path from 'path';
const PORT = process.env.PORT || 5241, OUT = process.env.OUTDIR || fs.mkdtempSync(path.join(os.tmpdir(), 'w3dman-'));
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--disable-gpu-sandbox', '--ignore-gpu-blocklist', '--window-size=1400,900'], protocolTimeout: 0,
  userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'w3d-')) });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
await page.setRequestInterception(true);
page.on('request', (r) => { if (/open-meteo/.test(r.url())) r.abort(); else r.continue(); });
page.on('pageerror', (e) => console.log('PAGEERR:', e.message));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'OK ' : 'ŹLE'} ${what}`); if (!ok) fails++; };
const near = (a, b, e) => Math.abs(a - b) <= e;
const M = () => page.evaluate(() => window.__sim.manip());
const ready = () => page.waitForFunction(() => window.__sim && window.__sim.ready(), { timeout: 300000 });
const slide = (id, v) => page.evaluate((id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
const runDays = (d) => page.evaluate(async (d) => { const sim = window.__sim, a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600; await sim.run(Math.round(d * 86400 / dt) - 2); }, d);

// strona tytułowa
await page.goto(`http://localhost:${PORT}/?title`, { waitUntil: 'load' });
await page.waitForSelector('#ttTan', { visible: true, timeout: 60000 });
await wait(1500);
check((await page.evaluate(() => document.getElementById('ttTanV').textContent)) === '0 K', 'strona tytułowa: start od neutralnych nastaw');
await slide('ttTan', 3); await slide('ttRain', 7); await slide('ttVar', 3);
await wait(200);
await page.screenshot({ path: path.join(OUT, 'title.png') });
const lab = await page.evaluate(() => ['ttTanV', 'ttRainV', 'ttVarV'].map((i) => document.getElementById(i).textContent).join(' '));
check(lab === '+3.0 K ×2 ×1.25', `podpisy: ${lab}`);
await page.click('#ttFlat');
await ready();
await page.evaluate(() => window.__sim.stop());
await wait(500);
const url = await page.evaluate(() => location.search);
let m = await M();
check(/tan=3/.test(url) && /rnf=2/.test(url) && /vrf=1.25/.test(url), `adres: ${url}`);
check(m.now.T === 3 && m.now.R === 2 && m.now.V === 1.25 && m.forcV === 1.25, `od pierwszej chwili pełne nastawy: T ${m.now.T}, R ${m.now.R}, V ${m.now.V}, model V ${m.forcV}`);
await page.evaluate(() => document.querySelector('#tabs button[data-tab=wx]').click());
await wait(600);
await page.screenshot({ path: path.join(OUT, 'weather.png') });

// zmiana w trakcie: kick-in 1 doba
await page.evaluate(() => { document.getElementById('manipRamp').value = '1'; });
await runDays(1);
const t0 = await page.evaluate(() => window.__sim.manip().T.t0 + 0);
await slide('tanom', 6); await slide('manipR', 4); await slide('manipV', 5);
m = await M();
check(m.T.from === 3 && m.T.to === 6 && near(m.T.t1 - m.T.t0, 86400, 1) && near(m.now.T, 3, 0.01), `suwak: bez skoku (teraz ${m.now.T}), odcinek 3 → 6 przez 1 dobę`);
const txt0 = await page.evaluate(() => document.getElementById('manipNow').textContent);
check(/Kicking in/.test(txt0), `komunikat: ${txt0}`);
await page.screenshot({ path: path.join(OUT, 'weather_ramp.png') });
await runDays(0.5);
m = await M();
check(near(m.now.T, 4.5, 0.1) && near(m.now.R, 1.5, 0.05) && near(m.now.V, 1.5, 0.05), `po pół doby w połowie drogi: T ${m.now.T.toFixed(2)}, R ${m.now.R.toFixed(2)}, V ${m.now.V.toFixed(2)}`);
await runDays(1);
m = await M();
check(m.now.T === 6 && m.now.R === 1 && m.now.V === 1.75, `po czasie kick-in pełne: T ${m.now.T}, R ${m.now.R}, V ${m.now.V}`);
check(near(m.forcV, 1.75, 0.3), `model synoptyczny idzie za nastawą (V ${m.forcV.toFixed(2)}, prognoza ${m.fcV?.toFixed(2)})`);
console.log('    CSV:', m.csv);
check(m.log.length >= 2 && /T 3 K/.test(m.csv) && /T 6 K/.test(m.csv), 'CSV: historia nastaw');
// Neutral: też przez czas kick-in
await page.click('#manipZero').catch(async () => page.evaluate(() => document.getElementById('manipZero').click()));
m = await M();
check(m.T.to === 0 && m.R.to === 1 && m.V.to === 1 && m.now.T === 6, `Neutral: cel 0, teraz wciąż ${m.now.T}`);
// restart: od razu pełne nastawy suwaków
await slide('tanom', 2);
await page.evaluate(() => window.__sim.reset());
await ready();
await page.evaluate(() => window.__sim.stop());
m = await M();
check(m.now.T === 2 && m.T.t1 === 0, `restart: od razu pełne nastawy (T ${m.now.T})`);

// A/B: pole docelowe rośnie o tyle, ile mówi odcinek (ta sama pogoda)
const tgtT = () => page.evaluate(async () => { const r = await window.__sim.rowk(20, 12), a = r.Tt ?? r.tt ?? r.T_t ?? r.tgtT ?? null; return { keys: Object.keys(r), a }; });
const k0 = await tgtT();
console.log('    pola rowk:', k0.keys.join(' '));
console.log('zrzuty:', OUT);
console.log(fails ? `BŁĘDY: ${fails}` : 'wszystko OK');
await browser.close();
