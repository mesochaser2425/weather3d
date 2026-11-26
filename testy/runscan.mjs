// A/B fizyki na zapisie .w3drun bez okna: dobowy opad domeny, schematu i modelu synoptycznego, oczka ≥ 30 / 50 / 100 mm, najbardziej zalane oczka, słaby opad, CAPE (CLAUDE.md, sekcja 2).
// Użycie: node runscan.mjs <katalog gałęzi z node_modules> <plik> <port serwera aplikacji> <doby> <etykieta> ["dodatkowe parametry adresu"]
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';

const [WT, FILE, PORT, HOURS, LABEL, EXTRA = ''] = process.argv.slice(2);
const require = createRequire(WT + '/package.json');
const puppeteer = require('puppeteer-core');

const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/octet-stream', 'Content-Length': fs.statSync(FILE).size });
  fs.createReadStream(FILE).pipe(r);
});
await new Promise((ok) => srv.listen(5251, '127.0.0.1', ok));

// adres jak resumeUrl w src/runfile.js
const fd = fs.openSync(FILE, 'r');
const h = Buffer.alloc(12); fs.readSync(fd, h, 0, 12, 0);
const hl = h.readUInt32LE(8), hb = Buffer.alloc(hl); fs.readSync(fd, hb, 0, hl, 12); fs.closeSync(fd);
const meta = JSON.parse(hb.toString('utf8'));
const qs = new URLSearchParams(meta.search || '');
for (const k of ['start', 'scen', 'title', 'lx', 'ly', 'res', 'n', 'resume', 'hold']) qs.delete(k);
const g = meta.grid;
for (const [k, v] of Object.entries({ dx: g.dx, nx: g.nx, ny: g.ny, mg: g.mg, nz: g.nz, dt: g.dt, hold: 1 })) qs.set(k, v);
for (const [k, v] of new URLSearchParams(EXTRA)) qs.set(k, v);
qs.set('resume', '1');

const browser = await puppeteer.launch({
  headless: 'new', executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--disable-gpu-sandbox', '--ignore-gpu-blocklist', '--window-size=1200,800'],
  protocolTimeout: 0, userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'w3d-probe-')),
});
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (r) => { if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(r.url()) || r.url().startsWith('data:') || r.url().startsWith('blob:')) r.continue(); else r.abort(); });
  page.on('pageerror', (e) => console.log('PAGEERR:', e.message.slice(0, 400)));
  page.on('console', (m) => { const t = m.text(); if (t.startsWith('DZIEN ')) { console.log(t); return; } if (/error/i.test(t) && !/ERR_FAILED|Failed to load resource|net::/.test(t)) console.log('PAGE:', t.slice(0, 400)); });
  await page.goto(`http://localhost:${PORT}/logo.svg`);
  await page.evaluate(async () => {
    const blob = await (await fetch('http://127.0.0.1:5251/run')).blob();
    await new Promise((ok, no) => {
      const r = indexedDB.open('w3d-run', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('run');
      r.onerror = () => no(r.error);
      r.onsuccess = () => { const d = r.result, t = d.transaction('run', 'readwrite'); t.objectStore('run').put(blob, 'pending'); t.oncomplete = () => { d.close(); ok(); }; t.onerror = () => no(t.error); };
    });
  });
  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/?${qs}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sim && window.__sim.ready(), { timeout: 240000, polling: 500 });
  console.log(`wczytane w ${((Date.now() - t0) / 1000).toFixed(0)} s, ${LABEL}, adres ?${qs}`);
  const res = await page.evaluate(async (D) => {
    const sim = window.__sim;
    const err = document.getElementById('err')?.textContent || '';
    await sim.run(1);
    if (!sim.sfcGrid('PACC')) return { err: err || 'brak pol' };
    const nx = sim.sfcGrid('PACC').nx, ny = sim.sfcGrid('PACC').ny, n = nx * ny;
    const grid = (f) => sim.sfcGrid(f).v;
    const out = [];
    let P0 = Float64Array.from(grid('PACC'));
    for (let d = 1; d <= D; d++) {
      const sch = new Float64Array(n), mu = new Float64Array(n), lf = new Float64Array(n), w1 = new Float64Array(n);
      let pe = 0, f01 = 0, f1 = 0, capem = 0;
      for (let s = 0; s < 144; s++) {
        await sim.run(10);
        const c = grid('PRCUS'), m = grid('MUCAPE'), l = grid('LIFT'), w = grid('W1'), pr = grid('PR'), cp = grid('CAPE');
        for (let k = 0; k < n; k++) { if (pr[k] >= 1) f1++; else if (pr[k] >= 0.1) f01++; capem += cp[k]; }
        for (let k = 0; k < n; k++) { sch[k] += Math.max(c[k], 0) / 6; mu[k] += m[k] / 144; lf[k] += l[k] / 144; w1[k] += w[k] / 144; }
        if (s % 6 === 5) pe += await sim.pePr();
      }
      const P1 = grid('PACC'), tot = new Float64Array(n);
      let mean = 0, smean = 0, n30 = 0, n50 = 0, n100 = 0;
      for (let k = 0; k < n; k++) { tot[k] = P1[k] - P0[k]; mean += tot[k] / n; smean += sch[k] / n; if (tot[k] >= 30) n30++; if (tot[k] >= 50) n50++; if (tot[k] >= 100) n100++; }
      const order = [...tot.keys()].sort((a, b) => tot[b] - tot[a]);
      const top = order.slice(0, 30);
      const av = (v) => top.reduce((s, k) => s + v[k], 0) / top.length;
      out.push({ d, domena: +mean.toFixed(2), schemat: +smean.toFixed(2), model: +pe.toFixed(2), n30, n50, n100, maks: +tot[order[0]].toFixed(1), at: [order[0] % nx, Math.floor(order[0] / nx)], top30_mm: +av(tot).toFixed(1), top30_schemat: +av(sch).toFixed(1), top30_MUCAPE: +av(mu).toFixed(0), top30_LIFT: +av(lf).toFixed(0), top30_w1: +(100 * av(w1)).toFixed(1), slaby_proc: +(100 * f01 / (144 * n)).toFixed(1), silny_proc: +(100 * f1 / (144 * n)).toFixed(1), CAPE: +(capem / (144 * n)).toFixed(0) });
      console.log('DZIEN ' + JSON.stringify(out[out.length - 1]));
      P0 = Float64Array.from(P1);
    }
    return { err, out };
  }, +HOURS);
  fs.writeFileSync(path.join(process.cwd(), `scan_${LABEL}.json`), JSON.stringify(res));
  console.log('KONIEC', res.err || '', (res.out || []).length);
} finally {
  await browser.close();
  srv.close();
}
