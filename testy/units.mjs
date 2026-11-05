// Przełącznik jednostek: strona tytułowa i symulacja – zrzuty zakładek i paneli w obu trybach, błędy strony, „NaN” i „undefined” w tekstach, zapamiętanie wyboru.
// Użycie: serwer Vite, `node units.mjs` (PORT, OUTDIR). ~1 min.
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import os from 'os';
import path from 'path';
const PORT = process.env.PORT || 5241, OUT = process.env.OUTDIR || fs.mkdtempSync(path.join(os.tmpdir(), 'w3dun-'));
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--disable-gpu-sandbox', '--ignore-gpu-blocklist', '--window-size=1400,900'], protocolTimeout: 0,
  userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'w3d-')) });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
await page.setRequestInterception(true);
page.on('request', (r) => { if (/open-meteo/.test(r.url())) r.abort(); else r.continue(); });
let errs = 0;
page.on('pageerror', (e) => { console.log('PAGEERR:', e.message); errs++; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (n) => page.screenshot({ path: path.join(OUT, n), captureBeyondViewport: false });
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'OK ' : 'ŹLE'} ${what}`); if (!ok) fails++; };
const bad = () => page.evaluate(() => { const t = document.body.innerText; return (t.match(/.{0,30}(NaN|undefined).{0,20}/g) || []).slice(0, 6); });
const seg = (id, u) => page.evaluate((id, u) => document.querySelector(`#${id} button[data-u=${u}]`).click(), id, u);
const tab = (k) => page.evaluate((k) => document.querySelector(`#tabs button[data-tab=${k}]`).click(), k);
const ana = (k) => page.evaluate((k) => document.querySelector(`#anaSeg button[data-a=${k}]`).click(), k);

await page.goto(`http://localhost:${PORT}/?title`, { waitUntil: 'load' });
await page.waitForSelector('#ttUnits', { visible: true, timeout: 60000 });
await wait(1000);
await seg('ttUnits', 'imperial');
await wait(300);
await shot('title_imp.png');
const tt = await page.evaluate(() => [document.getElementById('ttLxL').textContent, document.getElementById('ttInfo').innerText.split('\n')[0], document.getElementById('ttLx').value]);
check(/mi/.test(tt[0]) && /mi/.test(tt[1]), `strona tytułowa: ${tt.join(' | ')}`);
await page.click('#ttFlat');
await page.waitForFunction(() => window.__sim && window.__sim.ready(), { timeout: 300000 });
await page.evaluate(() => { document.getElementById('speed').value = 'max'; });
await page.evaluate(() => window.__sim.stations().importList([{ name: 'A', xkm: 100, ykm: 100, zs: 300 }, { name: 'B', xkm: 300, ykm: 200 }]));
await page.waitForFunction(() => /day [3-9]/.test(document.getElementById('clockDate').textContent), { timeout: 180000 });
const pick = async (name) => {
  for (const [k, f] of [['wx', 'wx'], ['atm', 'atm'], ['ter', 'ter'], ['mon', 'mon'], ['set', 'set'], ['view', 'view']]) { await tab(k); await wait(700); await shot(`${name}_${f}.png`); }
  for (const a of ['st', 'prof', 'xz']) { await ana(a); await wait(700); await shot(`${name}_ana_${a}.png`); }
};
check((await page.evaluate(() => document.getElementById('unitBtn').textContent)) === '°F', 'wybór ze strony tytułowej przechodzi do symulacji');
await pick('imp');
const b1 = await bad();
check(!b1.length, `imperialne: bez NaN i undefined ${b1.join(' ; ')}`);
const chip = await page.evaluate(() => document.getElementById('chipT2').textContent);
check(/°F/.test(chip), `pasek: ${chip}`);
const legends = await page.evaluate(() => document.querySelector('#legXY .hi').textContent);
check(/°F/.test(legends), `legenda: ${legends}`);
await page.click('#unitBtn');
await wait(600);
const chip2 = await page.evaluate(() => document.getElementById('chipT2').textContent);
check(/°C/.test(chip2) && /km/.test(await page.evaluate(() => document.getElementById('scaleTxt').textContent)), `przełączenie bez restartu: ${chip2}`);
await pick('met');
const b2 = await bad();
check(!b2.length, `metryczne: bez NaN i undefined ${b2.join(' ; ')}`);
console.log('zrzuty:', OUT);
console.log(fails || errs ? `BŁĘDY: ${fails}, błędy strony ${errs}` : 'wszystko OK');
await browser.close();
