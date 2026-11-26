// Słaby opad (0.05–1 mm/h): źródło (siatka / schemat: głęboka, podniesiona, płytka), czas trwania w oczku (migotanie), cienkie pasma; tp=data,ziarno,doby,lat,lon
sim.stop();
const P = (new URLSearchParams(location.search).get('tp') || '2026-06-01,104141,5,52.02,19.13').split(',');
sim.set('date', P[0]);
await sim.place(+P[3], +P[4]);
sim.stop(); await sim.roll(+P[1]); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600, n10 = Math.round(600 / dt);
let r = b;
const g0 = sim.sfcGrid('PR'), W = g0.nx, H = g0.ny, n = W * H;
const wS = [[Math.exp(-2 / 0.7), Math.exp(-1 / 0.7), Math.exp(-2 / 0.7)], [Math.exp(-1 / 0.7), 1, Math.exp(-1 / 0.7)], [Math.exp(-2 / 0.7), Math.exp(-1 / 0.7), Math.exp(-2 / 0.7)]];
const NAMES = ['siatka', 'głęboka', 'podniesiona', 'płytka'];
const cnt = { all: 0, light: 0, src: [0, 0, 0, 0], thin: [0, 0, 0, 0], mm: [0, 0, 0, 0] };
const run = new Int16Array(n), runSrc = new Int8Array(n);             // bieżąca długość ciągu słabego opadu w oczku i jego źródło
const dur = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];  // źródło × (10, 20–30, 40–60, > 60 min)
const endRun = (k) => { if (run[k] > 0) { const d = run[k]; dur[runSrc[k]][d <= 1 ? 0 : d <= 3 ? 1 : d <= 6 ? 2 : 3]++; run[k] = 0; } };
const samp = { 0: [], 1: [], 2: [], 3: [] };
let seed = 777; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let best = null;
const days = +P[2];
while (r.simHours < 24 * days) {
  r = await sim.run(n10);
  const hr = r.clock.hour;
  if (r.simHours < 30 || hr < 8 || hr > 22) { if (hr > 22 && hr < 22.3) for (let k = 0; k < n; k++) endRun(k); continue; }
  const TB = sim.sfcGrid('TB').v; const PR = sim.sfcGrid('PR').v, PS = sim.sfcGrid('PRCUS').v, PK = sim.sfcGrid('PRK').v, PC = sim.sfcGrid('PRCU').v;
  const isL = new Uint8Array(n), src = new Int8Array(n);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i; cnt.all++;
    if (!(PR[k] >= 0.05 && PR[k] < 1)) continue;
    if (TB[k] < -20) { cnt.cold = (cnt.cold || 0) + 1; continue; }
    let s = 0, ws = 0, kind = 0, kmx = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = Math.min(W - 1, Math.max(0, i + di)), jj = Math.min(H - 1, Math.max(0, j + dj)), kk = jj * W + ii, w = wS[dj + 1][di + 1];
      s += w * PS[kk]; ws += w;
      if (w * PS[kk] > kmx && PK[kk] > 0) { kmx = w * PS[kk]; kind = Math.round(PK[kk]); }
    }
    s /= ws;
    src[k] = s > 0.5 * PR[k] ? (kind || 1) : 0;
    isL[k] = 1;
  }
  let nThin = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (!isL[k]) { endRun(k); continue; }
    cnt.light++; cnt.src[src[k]]++; cnt.mm[src[k]] += PR[k] / 6;
    // cienkie: w żadnym z 4 kwadratów 2 × 2 zawierających oczko nie pada wszędzie (pasmo o szerokości 1 oczka)
    let thick = false;
    for (const [a1, b1] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      let all = true;
      for (let dj = 0; dj <= 1 && all; dj++) for (let di = 0; di <= 1; di++) {
        const ii = i + a1 + di, jj = j + b1 + dj;
        if (ii < 0 || jj < 0 || ii >= W || jj >= H || PR[jj * W + ii] < 0.05) { all = false; break; }
      }
      if (all) { thick = true; break; }
    }
    if (!thick) { cnt.thin[src[k]]++; nThin++; }
    if (run[k] === 0) runSrc[k] = src[k];
    run[k]++;
    if (samp[src[k]].length < 60 && rnd() < 0.002) samp[src[k]].push([i, j, PR[k], hr]);
  }
  // próbki kolumn (od razu, stan bieżący)
  for (const sKey of [0, 1, 2, 3]) for (const e of samp[sKey]) if (e.length === 4) {
    const col = await sim.colq(e[0], e[1]);
    let top = -1, base = -1, ttop = 0, tbase = 0, cwp = 0, iwp = 0, qcm = 0, wm = 0, rhs = 0;
    for (let k = 0; k < col.length; k++) {
      const c = col[k], qc = c[4], qi = c[5];
      if (qc + qi > 0.01) { if (base < 0) { base = c[0]; tbase = c[1]; } top = c[0]; ttop = c[1]; }
      const dz = k + 1 < col.length ? col[k + 1][0] - c[0] : 500, rho = 1.2 * Math.exp(-c[0] / 8400);
      cwp += qc * rho * dz; iwp += qi * rho * dz; qcm = Math.max(qcm, qc); if (c[0] < 4000) wm = Math.max(wm, c[2]);
    }
    const kk = e[1] * W + e[0];
    e.push({ base, top, tbase, ttop, cwp, iwp, qcm, wm, cape: sim.sfcGrid('CAPE').v[kk], mucape: sim.sfcGrid('MUCAPE').v[kk], cum: sim.sfcGrid('CUM').v[kk] / 2e7, lift: sim.sfcGrid('LIFT').v[kk], org: sim.sfcGrid('ORG').v[kk], prcu: PC[kk], cubs: sim.sfcGrid('CUBS').v[kk], cuts: sim.sfcGrid('CUTS').v[kk] });
  }
  if (!best || nThin > best.nThin) best = { nThin, hr, day: Math.floor(r.simHours / 24), map: Array.from({ length: H }, (_, jj) => Array.from({ length: W }, (_, i) => { const k = (H - 1 - jj) * W + i; return PR[k] < 0.05 ? ' ' : PR[k] >= 1 ? '#' : isL[k] ? '0123'[src[k]] : '.'; }).join('')) };
}
const pc = (x, y) => (100 * x / Math.max(y, 1)).toFixed(1);
{ const pa = sim.sfcStats('PACC'), cp = sim.sfcStats('CAPE'), t2 = sim.sfcStats('T2'), td = sim.sfcStats('TD2'); log(`SUMA opad śr. ${pa.mean.toFixed(2)} mm maks ${pa.max.toFixed(0)} | T2 ${t2.mean.toFixed(2)} TD2 ${td.mean.toFixed(2)} CAPE ${cp.mean.toFixed(0)} | doby z opadem 0.1–1 mm: patrz niżej`); }
log(`dt ${dt} s | słaby opad 0.05–1 mm/h przy ciepłym wierzchołku (TB > −20 °C) w ${pc(cnt.light, cnt.all)}% oczko·terminów (8–22 h); z zimnym wierzchołkiem ${pc(cnt.cold || 0, cnt.all)}%`);
NAMES.forEach((nm, s) => {
  const d = dur[s], dn = d.reduce((x, y) => x + y, 0);
  log(`  ${nm.padEnd(12)} udział ${pc(cnt.src[s], cnt.light)}%  opad ${(cnt.mm[s] / (W * H) / Math.max(1, days - 1.25)).toFixed(3)} mm/d  cienkie pasma ${pc(cnt.thin[s], cnt.src[s])}%  | czas trwania w oczku: 10 min ${pc(d[0], dn)}%, 20–30 ${pc(d[1], dn)}%, 40–60 ${pc(d[2], dn)}%, > 60 ${pc(d[3], dn)}% (n ${dn})`);
});
for (const s of [0, 1, 2, 3]) {
  const L = samp[s].filter((e) => e.length === 5).map((e) => e[4]); if (!L.length) continue;
  const m = (f) => (L.reduce((x, e) => x + e[f], 0) / L.length);
  const noCl = L.filter((e) => e.top < 0).length;
  log(`  próbka ${NAMES[s]} n ${L.length}: bez chmury na siatce ${noCl} | podstawa ${m('base').toFixed(0)} m (${m('tbase').toFixed(1)} C) wierzch ${m('top').toFixed(0)} m (${m('ttop').toFixed(1)} C) woda ${m('cwp').toFixed(0)} lód ${m('iwp').toFixed(0)} g/m2 qc maks ${m('qcm').toFixed(2)} g/kg w maks ${m('wm').toFixed(2)} m/s | CAPE ${m('cape').toFixed(0)} MUCAPE ${m('mucape').toFixed(0)} CUM ${m('cum').toFixed(2)} LIFT ${m('lift').toFixed(0)} ORG ${m('org').toFixed(1)} PRCU ${m('prcu').toFixed(2)} CUBS ${m('cubs').toFixed(0)} CUTS ${m('cuts').toFixed(0)}`);
  log('   ' + JSON.stringify(L.slice(0, 6).map((e) => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, +(+v).toFixed(2)])))));
}
if (best) { log(`mapa: doba ${best.day}, ${best.hr.toFixed(1)} h, cienkich ${best.nThin} (0 siatka, 1 głęboka, 2 podniesiona, 3 płytka, # ≥ 1 mm/h)`); for (const l of best.map) log('|' + l + '|'); }
