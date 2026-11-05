// Meteogramy stacji: przyblizanie w trzech zakresach na dorobionej historii 6 lat (kolko, przeciaganie, dwuklik, przyciski), okno przy nowych danych, zrzuty.
// Uzycie: serwer Vite, `node stzoom.mjs` (PORT, OUTDIR). ~40 s.
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import os from 'os';
import path from 'path';
const PORT = process.env.PORT || 5240, OUT = process.env.OUTDIR || fs.mkdtempSync(path.join(os.tmpdir(), 'w3dst-'));
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--disable-gpu-sandbox', '--ignore-gpu-blocklist', '--window-size=1400,900'], protocolTimeout: 0,
  userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'w3d-')) });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
await page.setRequestInterception(true);
page.on('request', (r) => { if (/open-meteo/.test(r.url())) r.abort(); else r.continue(); });
page.on('pageerror', (e) => console.log('PAGEERR:', e.message));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'OK ' : 'ZLE'} ${what}`); if (!ok) fails++; };
const view = (r) => page.evaluate((r) => { const v = window.__sim.stations().viewOf(r); return { span: v.span, end: v.end, last: v.last }; }, r);
await page.goto(`http://localhost:${PORT}/?dx=8000&nx=40&ny=40`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__sim && window.__sim.ready(), { timeout: 300000 });
await page.evaluate(() => window.__sim.stop());
await page.evaluate(() => {
  const S = window.__sim.stations();
  S.importList([{ name: 'Test', xkm: 100, ykm: 100, zs: 200 }]);
  const f = S.exportFull(), M = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const d = [], h1 = [], h10 = [];
  const clim = (t) => 9 + 11 * Math.sin(2 * Math.PI * (t / 86400 - 110) / 365.25) + 4 * Math.sin(t / 86400 * 1.3);
  for (let n = 0; n < 2282; n++) {
    const T = clim(n * 86400), q = new Date(Date.UTC(2026, 0, 1 + n));
    d.push({ day: n, date: `${q.getUTCDate()} ${M[q.getUTCMonth()]}`, full: true, Tmin: T - 5, Tmax: T + 5, Tmean: T, pr: n % 7 ? 0.5 : 8 + (n % 30), sn: T < 0 ? 3 : 0 });
  }
  const t1 = 2282 * 86400, row = (t) => { const hour = (t / 3600) % 24, T = clim(t) + 5 * Math.sin(2 * Math.PI * (hour - 9) / 24); return { t, hour, T2: T, Td2: T - 4, ws: 3, gust: 7, PR: hour < 3 ? 1.5 : 0, sn: 0, PSL: 1013 + 6 * Math.sin(t / 3e5), cov: 0.5 }; };
  for (let k = 2880; k > 0; k--) h1.push(row(t1 - k * 3600));
  for (let k = 432; k > 0; k--) h10.push(row(t1 - k * 600));
  f.hist = [{ h10, h1, d }];
  S.importFull(f);
});
await page.evaluate(() => document.querySelector('#anaSeg button[data-a=st]').click());
await wait(500);
await page.evaluate(() => document.getElementById('cmetSt').scrollIntoView({ block: 'center' }));
await wait(800);
const b = await (await page.$('#cmetSt')).boundingBox();
const clip = { x: b.x - 4, y: b.y - 34, width: b.width + 8, height: b.height + 38 };
const shot = (n) => page.screenshot({ path: path.join(OUT, n), clip, captureBeyondViewport: false });
const px = b.x + b.width / 2, py = b.y + b.height / 2;
const setR = async (r) => { await page.evaluate((r) => { const e = document.getElementById('stRange'); e.value = r; e.dispatchEvent(new Event('change')); }, r); await wait(200); };
const L = 34, R = 40, fr = (px - b.x - L) / (b.width - L - R);
for (const [r, name, fullHint] of [['all', 'dobowy', 2282], ['d120', 'godzinowy', 2880 * 3600], ['d3', '10 min', 432 * 600]]) {
  await setR(r);
  await shot(`${r}_full.png`);
  const v0 = await view(r);
  check(v0.span === null && Math.abs(v0.last.b - v0.last.a - fullHint) / fullHint < 0.01, `${name}: start cały zakres`);
  await page.mouse.move(px, py);
  const tc = v0.last.a + fr * (v0.last.b - v0.last.a);
  await page.mouse.wheel({ deltaY: -1000 });
  await wait(200);
  const v1 = await view(r);
  check(v1.span < fullHint && Math.abs(v1.last.a + fr * v1.span - tc) / fullHint < 1e-3, `${name}: kółko, czas pod kursorem bez zmian (okno ${(v1.span / fullHint * 100).toFixed(0)}%)`);
  await shot(`${r}_zoom1.png`);
  await page.mouse.wheel({ deltaY: -4000 });
  await wait(200);
  const v2 = await view(r);
  await shot(`${r}_zoomMax.png`);
  await page.mouse.wheel({ deltaY: 700 });
  await wait(200);
  const v3 = await view(r);
  await page.mouse.down(); await page.mouse.move(px + 50, py, { steps: 3 }); await page.mouse.up();
  await wait(200);
  const v4 = await view(r);
  const want = v3.last.b - 50 / (b.width - L - R) * v3.span;
  check(Math.abs(v4.last.b - want) / v3.span < 0.02 && v4.span === v3.span, `${name}: przeciąganie cofa okno`);
  await page.mouse.down({ clickCount: 1 }); await page.mouse.up({ clickCount: 1 });
  await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 });
  await wait(200);
  const v5 = await view(r);
  check(v5.span === null, `${name}: dwuklik wraca do całości`);
  console.log(`     najmniejsze okno: ${v2.span}`);
}
// przyciski: + przy całym zakresie przybliża do najnowszych danych
await setR('all');
await page.click('#stZp');
await wait(200);
const p1 = await view('all');
check(p1.span < 2282 && p1.end === null, 'przycisk +: najnowsze dane, okno idzie za nimi');
await page.click('#stZm');
await wait(200);
const p2 = await view('all');
check(p2.span === null, 'przycisk −: znów cały zakres');
// nowa doba przy oknie w przeszłości: okno stoi; przy najnowszych: idzie
await page.mouse.move(px, py);
await page.mouse.wheel({ deltaY: -2000 });
await wait(200);
const q1 = await view('all');
await page.evaluate(() => { const S = window.__sim.stations(), f = S.exportFull(), d = f.hist[0].d; d.push({ ...d.at(-1), day: d.at(-1).day + 1 }); S.importFull(f); });
await wait(200);
const q2 = await view('all');
check(q1.end !== null && q2.last.b === q1.last.b, `okno w przeszłości stoi przy nowej dobie (${q1.last.b.toFixed(1)} → ${q2.last.b.toFixed(1)})`);
console.log('zrzuty:', OUT);
console.log(fails ? `BLEDY: ${fails}` : 'wszystko OK');
await browser.close();
