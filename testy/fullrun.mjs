// Test pełnego zapisu przebiegu (plik .w3drun): dwie ścieżki od tego samego zapisu powinny dać identyczny stan.
//   A: zapis → dalszy przebieg N kroków;  B: zapis → przeładowanie strony z ?resume → N kroków. Sumy kontrolne buforów GPU tuż po wczytaniu i po N krokach.
// Użycie: serwer Vite, potem `node fullrun.mjs "?dx=8000&nx=40&ny=40"` (PORT, BLOCK_OM=1, DAYS – doby przed zapisem, N – kroki po zapisie, OUT – plik zapisu).
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import os from 'os';
import path from 'path';
const query = process.argv[2] || '?dx=8000&nx=40&ny=40', PORT = process.env.PORT || 5240, DAYS = +(process.env.DAYS || 12), STEPS = +(process.env.N || 400);
const browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--disable-gpu-sandbox', '--ignore-gpu-blocklist', '--window-size=1400,900'], protocolTimeout: 0,
  userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'w3d-')) });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
if (process.env.BLOCK_OM) {
  await page.setRequestInterception(true);
  page.on('request', (r) => { if (/open-meteo/.test(r.url())) r.abort(); else r.continue(); });
}
page.on('console', (m) => { const t = m.text(); if (/error|Error|warn/i.test(t)) console.log('PAGE:', t.slice(0, 500)); });
page.on('pageerror', (e) => console.log('PAGEERR:', e.message));
const log = (...a) => console.log(...a);
await page.goto(`http://localhost:${PORT}/${query}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__sim && window.__sim.ready(), { timeout: 600000 });
log('start gotowy');
if (process.env.MODE) await page.evaluate((m) => window.__sim.mode(m), process.env.MODE);
// stacje, przebieg w pętli klatek (przez koniec miesiąca), zatrzymanie
await page.evaluate((days) => new Promise((ok) => {
  const sim = window.__sim, el = document.getElementById('speed');
  sim.stations().importList([{ name: 'A', xkm: 60, ykm: 80 }, { name: 'B', xkm: 200, ykm: 150, zs: 1500 }]);
  el.value = 'max';
  const t0 = () => sim.months().cur.secs;
  const iv = setInterval(() => { if (document.getElementById('clockDate').textContent.includes(`day ${days}`)) { clearInterval(iv); ok(); } }, 200);
}), DAYS);
await page.evaluate(() => { window.__sim.stop(); return new Promise((r) => setTimeout(r, 1500)); });
if (process.env.PRESAVE) await page.evaluate(process.env.PRESAVE);   // np. suwak manipulacji atmosfery: zapis w trakcie zmiany
const t1 = Date.now();
const saved = await page.evaluate(async (out) => {
  const sim = window.__sim, t0 = performance.now();
  const { blob, name } = await sim.runBlob();
  const ms = performance.now() - t0;
  window.__blob = blob;
  const fp = await sim.fingerprint();
  const { meta } = await sim.openRun(blob);
  await sim.stashRun(blob);
  return { name, size: blob.size, ms, fp, chunks: meta.chunks.map((c) => `${c.name} ${(c.bytes / 1048576).toFixed(1)}→${(c.len / 1048576).toFixed(1)}`), url: sim.resumeUrl(meta, { hold: 1 }),
    months: sim.months().list.length, ana: sim.ana('m').filter((x) => !x.cur), st: sim.stations().history(0), st1: sim.stations().history(1) };
});
log(`zapis: ${saved.name}, ${(saved.size / 1048576).toFixed(1)} MB, ${(saved.ms / 1000).toFixed(1)} s; miesiące ${saved.months}; doby stacji ${saved.st.d.length}`);
log(saved.chunks.join(' | '));
log('url', saved.url);
if (process.env.OUT) {
  const b64 = await page.evaluate(async () => { const a = new Uint8Array(await window.__blob.arrayBuffer()); let s = ''; for (let i = 0; i < a.length; i += 32768) s += String.fromCharCode(...a.subarray(i, i + 32768)); return btoa(s); });
  fs.writeFileSync(process.env.OUT, Buffer.from(b64, 'base64'));
}
// ścieżka A
const A = await page.evaluate(async (n) => { const sim = window.__sim; await sim.run(n); return { fp: await sim.fingerprint(), T2: sim.sfcStats ? null : null }; }, STEPS);
// ścieżka B
await page.goto(`http://localhost:${PORT}${saved.url}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__sim && window.__sim.ready(), { timeout: 600000 });
const B0 = await page.evaluate(async () => {
  const sim = window.__sim;
  return { fp: await sim.fingerprint(), months: sim.months().list.length, ana: sim.ana('m').filter((x) => !x.cur), st: sim.stations().history(0), st1: sim.stations().history(1), url: location.search,
    err: document.getElementById('err').textContent };
});
log('wczytanie w', ((Date.now() - t1) / 1000).toFixed(0), 's od zapisu; adres po wczytaniu', B0.url, B0.err ? `BŁĄD: ${B0.err}` : '');
const cmp = (a, b, label) => {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])], bad = keys.filter((k) => a[k] !== b[k]);
  log(label, bad.length ? `RÓŻNE: ${bad.map((k) => `${k} ${a[k]} / ${b[k]}`).join(', ')}` : `identyczne (${keys.length} wartości)`);
  return bad.length;
};
// (pe.wk: wektor środka domeny – readCenter po wczytaniu zapisuje go w tym buforze; po N krokach bufor musi być identyczny)
let bad = cmp({ ...saved.fp, 'pe.wk': 0 }, { ...B0.fp, 'pe.wk': 0 }, 'tuż po wczytaniu:');
bad += JSON.stringify(saved.ana) === JSON.stringify(B0.ana) ? 0 : (log('analizy RÓŻNE', JSON.stringify(saved.ana).slice(0, 300), JSON.stringify(B0.ana).slice(0, 300)), 1);
const round = (x) => JSON.stringify(x, (k, v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v));
bad += round(saved.st) === round(B0.st) && round(saved.st1) === round(B0.st1) ? 0 : (log('historia stacji RÓŻNA'), 1);
log('miesiące', B0.months, 'doby stacji', B0.st.d.length, 'ostatnia', JSON.stringify(B0.st.d.at(-1)).slice(0, 160));
const B = await page.evaluate(async (n) => { const sim = window.__sim; await sim.run(n); return { fp: await sim.fingerprint() }; }, STEPS);
bad += cmp(A.fp, B.fp, `po ${STEPS} krokach:`);
// mapa okresu z zapisanych miesięcy po wczytaniu
log(bad ? `WYNIK: ${bad} różnic` : 'WYNIK: wszystko zgodne');
await browser.close();
