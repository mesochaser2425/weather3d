// Klimat domeny na świecie wobec norm: domena 500 × 500 km, oczko 5 km, każde miejsce w czterech porach roku (od 1 I, 1 IV, 1 VII, 1 X, 15 dób, pierwsze 2 doby – rozbieg), ~4 h na 12 miejsc.
// Błąd lub zawieszenie jednego przebiegu nie zatrzymuje reszty; gotowe przebiegi pomijane. Analiza: globclim.py. 15 dób to szum pogody ±2–3 K: oceniać wzory w wielu miejscach, nie jeden miesiąc.
// Gleba startuje z klimatologii, więc zmian bilansu wody w glebie (lato po zimie) ten test nie sprawdza – potrzebny przebieg od zimy.
// Serwer: zamrożona kopia (vite build + vite preview), zapytania do Open-Meteo odrzucane (klimat i korekta z klimatologii wbudowanej).
// Użycie: PORT=5240 OUT=folder [DAYS=15 SPIN=2 Q=&cul=0] node globclim.mjs [nazwa_miesiąc …]   np. warszawa_6; bez nazw – wszystkie.
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import os from 'os';
import path from 'path';
const SITES = [
  ['houston', 30.0, -95.5], ['warszawa', 52.2, 20.0], ['madryt', 40.4, -3.7], ['pekin', 39.9, 116.4], ['delhi', 28.6, 77.2], ['rijad', 24.7, 46.7],
  ['niamey', 13.5, 2.1], ['manaus', -3.1, -60.0], ['johannesburg', -26.2, 28.0], ['buenosaires', -34.6, -60.0], ['jakuck', 62.0, 129.7], ['seattle', 47.6, -121.0],
];
const MONTHS = [0, 3, 6, 9];
const OUT = process.env.OUT || 'glob', DAYS = +(process.env.DAYS || 15), SPIN = +(process.env.SPIN || 2), Q = process.env.Q || '', PORT = process.env.PORT || 5240;
fs.mkdirSync(OUT, { recursive: true });
const want = process.argv.slice(2);
const log = (...a) => { const s = `${new Date().toISOString().slice(5, 16)} ${a.join(' ')}`; console.log(s); fs.appendFileSync(path.join(OUT, 'log.txt'), s + '\n'); };

// W stronie: co 3 h średnie po widocznej domenie, co dobę opad w oczkach i ekstrema temperatury
const collector = `async (DAYS, SPIN) => {
  const sim = window.__sim;
  sim.stop();
  let NAMES = ['T2','TD2','TS','U10','GUST','PSL','H','LE','SW','LWP','PBLH','WS','SWE','SND','W','SM1','SM2','SM3','CLL','CLM','CLH','COVER','COVC','COVS','PRCUS','SUNH','GRN','ICE'];
  const a0 = await sim.run(1), a1 = await sim.run(1), dt = (a1.simHours - a0.simHours) * 3600, n3 = Math.round(10800 / dt), t00 = a1.simHours;
  const drop = NAMES.filter((nm) => !sim.sfcStats(nm) || !Number.isFinite(sim.sfcStats(nm).mean)); NAMES = NAMES.filter((nm) => !drop.includes(nm));
  const hasX = !drop.includes('X') && sim.sfcStats('TMAX') && Number.isFinite(sim.sfcStats('TMAX').mean);
  const M = { n: 0, m: {}, cape: 0, cape15: 0, n15: 0, c1: 0, c2: 0, c35: 0, c45: 0, cmx: 0, fog: 0, fog6: 0, n6: 0, nd: 0, pr: 0, d01: 0, d1: 0, d10: 0, d30: 0, d50: 0, prx: 0, prof: null, np: 0, tmx: -999, tmn: 999, tx: 0, tn: 0, nx: 0, txa: -999, tna: 999, dropped: drop, dt };
  let pacc0 = null, it = 0; const t0 = performance.now();
  for (;;) {
    const r = await sim.run(n3);
    const h = r.simHours - t00, hod = r.clock.hour;
    it++;
    const T2 = sim.sfcGrid('T2').v, nc = T2.length;
    if (!Number.isFinite(T2[0]) || Math.abs(sim.sfcStats('T2').mean) > 80) { M.nan = true; break; }
    if (it % 8 === 0) {
      const Pa = sim.sfcGrid('PACC').v;
      if (pacc0 && h > SPIN * 24) {
        let s = 0, d01 = 0, d1 = 0, d10 = 0, d30 = 0, d50 = 0, mx = 0;
        for (let k = 0; k < nc; k++) { const v = Pa[k] - pacc0[k]; s += v; if (v >= .1) d01++; if (v >= 1) d1++; if (v >= 10) d10++; if (v >= 30) d30++; if (v >= 50) d50++; if (v > mx) mx = v; }
        M.nd++; M.pr += s / nc; M.d01 += d01 / nc; M.d1 += d1 / nc; M.d10 += d10 / nc; M.d30 += d30 / nc; M.d50 += d50 / nc; if (mx > M.prx) M.prx = mx;
      }
      pacc0 = Pa.slice();
    }
    if (h > SPIN * 24) {
      for (const nm of NAMES) M.m[nm] = (M.m[nm] || 0) + sim.sfcStats(nm).mean;
      M.n++;
      const CA = sim.sfcGrid('CAPE').v;
      let cm = 0, c1 = 0, c2 = 0, c35 = 0, c45 = 0, cx = 0; for (let k = 0; k < nc; k++) { const v = CA[k]; cm += v; if (v >= 1000) c1++; if (v >= 2000) c2++; if (v >= 3500) c35++; if (v >= 4500) c45++; if (v > cx) cx = v; }
      M.cape += cm / nc; if (cx > M.cmx) M.cmx = cx;
      if (hod > 14 && hod < 16) { M.cape15 += cm / nc; M.n15++; M.c1 += c1 / nc; M.c2 += c2 / nc; M.c35 += c35 / nc; M.c45 += c45 / nc; }
      const VI = sim.sfcGrid('VIS').v; let fg = 0; for (let k = 0; k < nc; k++) if (VI[k] < 1) fg++;
      M.fog += fg / nc; if (hod > 5 && hod < 7) { M.fog6 += fg / nc; M.n6++; }
      for (let k = 0; k < nc; k++) { if (T2[k] > M.tmx) M.tmx = T2[k]; if (T2[k] < M.tmn) M.tmn = T2[k]; }
      if (hasX && hod > 20 && hod < 22) { const x = sim.sfcStats('TMAX'), n = sim.sfcStats('TMIN'); M.tx += x.mean; M.tn += n.mean; M.nx++; if (x.max > M.txa) M.txa = x.max; if (n.min < M.tna) M.tna = n.min; }
      const pf = sim.profile();
      if (pf) { if (!M.prof) M.prof = pf.map(() => [0, 0, 0, 0]); pf.forEach((p, k) => { M.prof[k][0] = p[0]; M.prof[k][1] += p[1]; M.prof[k][2] += p[2]; M.prof[k][3] += p[3]; }); M.np++; }
    }
    if (h >= DAYS * 24) break;
  }
  const hg = sim.hgt(); let s = 0; for (const v of hg) s += v;
  const g = sim.landGrid(), c = [0, 0, 0, 0]; for (const v of g) c[v] = (c[v] || 0) + 1;
  M.hgt = s / hg.length; M.land = c.map((x) => x / g.length); M.sec = (performance.now() - t0) / 1000; M.done = true;
  return JSON.stringify(M);
}`;

for (const [name, lat, lon] of SITES) for (const mon of MONTHS) {
  const tag = `${name}_${mon}`;
  if (want.length && !want.includes(tag)) continue;
  const file = path.join(OUT, tag + '.json');
  if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).done) { log(tag, 'już jest'); continue; }
  const t0 = Date.now();
  let browser, wd = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new', executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--disable-gpu-sandbox', '--ignore-gpu-blocklist', '--window-size=1400,900', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
      protocolTimeout: 0, userDataDir: path.join(os.tmpdir(), 'w3d-prof-glob'),
    });
    // zawieszony przebieg (utracone urządzenie GPU, sieć): po 25 min następny
    wd = setTimeout(() => { log(tag, 'ZAWIESZONE, następny'); try { browser.process().kill('SIGKILL'); } catch {} }, 1500e3);
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', (r) => { if (/open-meteo/.test(r.url())) r.abort(); else r.continue(); });
    page.on('pageerror', (e) => log(tag, 'PAGEERR', e.message.slice(0, 200)));
    page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/net::ERR|Failed to load/.test(t)) log(tag, 'console', t.slice(0, 200)); });
    await page.goto(`http://localhost:${PORT}/?dx=5000&nx=100&ny=100&start=${lat},${lon},${mon}${Q}`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__sim && window.__sim.ready() && window.__sim.sfcStats, { timeout: 600000, polling: 1000 });
    const ts = (Date.now() - t0) / 1000;
    const res = await page.evaluate(`(${collector})(${DAYS}, ${SPIN})`);
    fs.writeFileSync(file, res);
    const o = JSON.parse(res);
    log(tag, `start ${ts.toFixed(0)} s, razem ${((Date.now() - t0) / 1000).toFixed(0)} s;`, o.nan ? 'NaN' : `T2 ${(o.m.T2 / o.n).toFixed(1)} Tx ${o.nx ? (o.tx / o.nx).toFixed(1) : '-'} P ${(o.pr / Math.max(o.nd, 1)).toFixed(1)} mm/d CAPE maks ${o.cmx.toFixed(0)} pole ${o.dropped.join(',') || 'wszystkie'}`);
  } catch (e) { log(tag, 'BŁĄD', String(e.message || e).slice(0, 300)); }
  if (wd) clearTimeout(wd);
  try { if (browser) await browser.close(); } catch {}
}
log('wszystko');
