// Fronty A/B (uruchamiać z ?fr=0 i bez): co 30 min T 2 m i opad na całej mapie, co 3 h statystyka wykrytych frontów.
// Wynik: rozkład największego spadku T 2 m w ciągu 1 h w oczkach (p50/p90/p99/maks), godziny z opadem ≥ 1 mm/h w pasie ±25 km
// od osi frontu, profil w poprzek osi w chwili najsilniejszego frontu (T 2 m, T ~100 m domena/duża skala, w ~1.5 km, opad).
// Parametry: window.__date, __seed, __days, __dt
sim.stop();
sim.set('date', window.__date || '2027-05-15');
await sim.roll(window.__seed || 4);
await sim.run(1);
const zc = sim.levels(), kOf = (z) => zc.reduce((b, x, k) => (Math.abs(x - z) < Math.abs(zc[b] - z) ? k : b), 0);
const k1 = kOf(100), k15 = kOf(1500);
const dt = window.__dt || 45, nPer = Math.round(1800 / dt), days = window.__days || 3;
const g0 = sim.sfcGrid('T2'), NXD = g0.nx, NYD = g0.ny, dx = g0.dx, M = NXD * NYD;
const hist = [];
let best = null;
for (let s = 0; s < days * 48; s++) {
  await sim.run(nPer);
  const t2 = Float32Array.from(sim.sfcGrid('T2').v), pr = Float32Array.from(sim.sfcGrid('PR').v), fr = Float32Array.from(sim.sfcGrid('FRT').v);
  hist.push({ t2, pr, fr });
  // najsilniejszy front (maks. FRT) – wiersz i położenie osi
  let fm = 0, km = 0;
  fr.forEach((v, k) => { if (v > fm) { fm = v; km = k; } });
  if (!best || fm > best.fm) {
    const j = Math.floor(km / NXD), a = await sim.rowk(j, k1), b = await sim.rowk(j, k15);
    best = { fm, h: (s + 1) / 2, j, i: km % NXD, a, b, t2: t2.slice(j * NXD, (j + 1) * NXD), pr: pr.slice(j * NXD, (j + 1) * NXD), fr: fr.slice(j * NXD, (j + 1) * NXD) };
  }
}
// największy spadek T 2 m w ciągu 1 h w każdym oczku – względem średniej zmiany na mapie (bez wieczornego wychładzania)
const drop = new Float32Array(M);
for (let n = 2; n < hist.length; n++) {
  let mean = 0;
  for (let k = 0; k < M; k++) mean += (hist[n].t2[k] - hist[n - 2].t2[k]) / M;
  for (let k = 0; k < M; k++) drop[k] = Math.max(drop[k], -(hist[n].t2[k] - hist[n - 2].t2[k] - mean));
}
const pc = (a, p) => { const s = Float32Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
log(`spadek T2 w 1 h względem średniej [K]: p50 ${pc(drop, 0.5).toFixed(1)}, p90 ${pc(drop, 0.9).toFixed(1)}, p99 ${pc(drop, 0.99).toFixed(1)}, maks ${Math.max(...drop).toFixed(1)}; oczek ≥ 3 K/h: ${drop.filter((x) => x >= 3).length}, ≥ 5 K/h: ${drop.filter((x) => x >= 5).length}`);
// opad przy osi frontu (|FRT| > 0.3) i z dala od niej
let pf = 0, nf = 0, po = 0, no = 0;
for (const r of hist) for (let k = 0; k < M; k++) { if (Math.abs(r.fr[k]) > 0.3) { pf += r.pr[k]; nf++; } else { po += r.pr[k]; no++; } }
log(`opad średni przy osi frontu ${(pf / Math.max(nf, 1)).toFixed(2)} mm/h (${nf} oczko·półgodzin), z dala ${(po / Math.max(no, 1)).toFixed(2)} mm/h; suma opadu średnio ${(hist.reduce((a, r) => a + r.pr.reduce((x, y) => x + y, 0) / M, 0) / 2).toFixed(1)} mm`);
if (best) {
  log(`najsilniejszy front: FRT ${best.fm.toFixed(2)} (h=${best.h}, wiersz ${best.j}, x ${((best.i + 0.5) * dx / 1000).toFixed(0)} km)`);
  log('  x[km]   T2   T100 dom/cel   w1.5[cm/s]  opad  FRT');
  for (let i = Math.max(0, best.i - 16); i <= Math.min(NXD - 1, best.i + 16); i++) {
    log(`  ${((i + 0.5) * dx / 1000).toFixed(0).padStart(4)}  ${best.t2[i].toFixed(1).padStart(5)}  ${best.a.T[i].toFixed(1)}/${best.a.Tt[i].toFixed(1)}   ${(100 * best.b.w[i]).toFixed(0).padStart(4)}   ${best.pr[i].toFixed(1).padStart(4)}  ${best.fr[i].toFixed(2)}`);
  }
}
