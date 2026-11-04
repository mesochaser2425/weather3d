// Diagnostyka frontów: jak ostry jest front w domenie w porównaniu z dużą skalą (model synoptyczny)?
// Co 30 min trzy wiersze W–E (¼, ½, ¾ wysokości mapy): największy gradient T na ~100 m i ~1.5 km [K/10 km] w domenie
// i w polu docelowym, największe w na ~1.5 km (domena) i ruch pionowy dużej skali, opad. Na końcu profile przez 3 najsilniejsze
// fronty i najszybsze spadki T 2 m w środku mapy. Parametry: window.__date, __seed, __days, __dt
sim.stop();
sim.set('date', window.__date || '2026-10-20');
await sim.roll(window.__seed || 3);
await sim.run(1);
const zc = sim.levels();
const kOf = (z) => zc.reduce((b, x, k) => (Math.abs(x - z) < Math.abs(zc[b] - z) ? k : b), 0);
const k1 = kOf(100), k15 = kOf(1500);
const dt = window.__dt || 45, days = window.__days || 6, nPer = Math.round(1800 / dt);
const g0 = sim.sfcGrid('T2'), NXD = g0.nx, NYD = g0.ny, dx = g0.dx;
const rows = [Math.floor(NYD / 4), Math.floor(NYD / 2), Math.floor(3 * NYD / 4)];
// największy gradient (różnica centralna przez 2 oczka) [K/10 km] i jego położenie
const grad = (T) => { let m = 0, im = 0; for (let i = 1; i < T.length - 1; i++) { const g = Math.abs(T[i + 1] - T[i - 1]) / (2 * dx) * 1e4; if (g > m) { m = g; im = i; } } return [m, im]; };
// szerokość strefy spadku 10–90% w oknie ±W oczek wokół i0 [km]
const width = (T, i0, W) => {
  const a = Math.max(0, i0 - W), b = Math.min(T.length - 1, i0 + W), s = T.slice(a, b + 1);
  const hi = Math.max(...s), lo = Math.min(...s), d = hi - lo;
  if (d < 1) return null;
  const i10 = s.findIndex((x) => x <= hi - 0.1 * d), i90 = s.findIndex((x) => x <= hi - 0.9 * d);
  const up = s.indexOf(hi) > s.indexOf(lo);   // spadek w stronę wschodu czy zachodu
  const j10 = up ? s.findIndex((x) => x >= lo + 0.1 * d) : i10, j90 = up ? s.findIndex((x) => x >= lo + 0.9 * d) : i90;
  return { dT: d, w: Math.abs(j90 - j10) * dx / 1000 };
};
log(`siatka ${NXD}×${NYD}, oczko ${dx} m, poziomy: k1=${k1} (${zc[k1].toFixed(0)} m), k15=${k15} (${zc[k15].toFixed(0)} m)`);
log('czas[h]  grad T100 dom/cel  grad T1.5 dom/cel [K/10km] | w1.5 maks [m/s] | w duża skala [cm/s] | opad maks [mm/h] | T2 środek | front maks/min');
const rec = [], tc = [];
for (let s = 0; s < days * 48; s++) {
  await sim.run(nPer);
  const h = (s + 1) / 2, pr = sim.sfcGrid('PR').v, t2 = sim.sfcGrid('T2').v, fr = sim.sfcGrid('FRT').v;
  tc.push(t2[Math.floor(NYD / 2) * NXD + Math.floor(NXD / 2)]);
  const r = { h, rows: [] };
  for (const j of rows) {
    const a = await sim.rowk(j, k1), b = await sim.rowk(j, k15);
    const [gd1] = grad(a.T), [gt1] = grad(a.Tt), [gd15] = grad(b.T), [gt15, it15] = grad(b.Tt);
    const prRow = pr.slice(j * NXD, (j + 1) * NXD);
    const frRow = fr.slice(j * NXD, (j + 1) * NXD);
    r.rows.push({ j, gd1, gt1, gd15, gt15, it15, wmax: Math.max(...b.w), wls: Math.max(...b.wls) * 100, pmax: Math.max(...prRow), frx: Math.max(...frRow), frn: Math.min(...frRow), a, b, prRow, frRow });
  }
  rec.push(r);
  if (s % 6 === 5) {
    const m = (k) => Math.max(...r.rows.map((x) => x[k]));
    log(`${h.toFixed(0).padStart(5)}   ${m('gd1').toFixed(2)}/${m('gt1').toFixed(2)}   ${m('gd15').toFixed(2)}/${m('gt15').toFixed(2)} | ${m('wmax').toFixed(2)} | ${m('wls').toFixed(1)} | ${m('pmax').toFixed(1)} | ${tc[tc.length - 1].toFixed(1)} | ${m('frx').toFixed(2)}/${Math.min(...r.rows.map((x) => x.frn)).toFixed(2)}`);
  }
}
// najszybsze spadki T 2 m w środku mapy (1 h i 3 h)
let d1 = 0, d3 = 0, t1h = 0, t3h = 0;
for (let n = 2; n < tc.length; n++) { if (tc[n - 2] - tc[n] > d1) { d1 = tc[n - 2] - tc[n]; t1h = n / 2; } }
for (let n = 6; n < tc.length; n++) { if (tc[n - 6] - tc[n] > d3) { d3 = tc[n - 6] - tc[n]; t3h = n / 2; } }
log(`największy spadek T2 w środku: ${d1.toFixed(1)} K/1 h (h=${t1h}), ${d3.toFixed(1)} K/3 h (h=${t3h})`);
// 3 najsilniejsze fronty (gradient dużej skali na 1.5 km), odstęp ≥ 6 h
const all = rec.flatMap((r) => r.rows.map((x) => ({ h: r.h, ...x }))).sort((p, q) => q.gt15 - p.gt15);
const pick = [];
for (const x of all) { if (pick.length < 3 && pick.every((p) => Math.abs(p.h - x.h) >= 6)) pick.push(x); }
for (const p of pick) {
  const wd = width(p.b.T, p.it15, 20), wt = width(p.b.Tt, p.it15, 20), wd1 = width(p.a.T, p.it15, 20), wt1 = width(p.a.Tt, p.it15, 20);
  log(`\nFRONT h=${p.h} wiersz ${p.j}: grad 1.5 km dom/cel ${p.gd15.toFixed(2)}/${p.gt15.toFixed(2)} K/10km, ~100 m ${p.gd1.toFixed(2)}/${p.gt1.toFixed(2)}`);
  log(`  szerokość spadku 10–90% (±100 km): 1.5 km dom ${wd ? `${wd.w} km (ΔT ${wd.dT.toFixed(1)})` : '–'}, cel ${wt ? `${wt.w} km (ΔT ${wt.dT.toFixed(1)})` : '–'}; 100 m dom ${wd1 ? `${wd1.w} km` : '–'}, cel ${wt1 ? `${wt1.w} km` : '–'}`);
  log('  x[km]  T100 dom/cel  T1.5 dom/cel  w1.5[cm/s]  wDS[cm/s]  u100  v100  opad  front');
  for (let i = Math.max(0, p.it15 - 20); i <= Math.min(NXD - 1, p.it15 + 20); i += 2) {
    log(`  ${((i + 0.5) * dx / 1000).toFixed(0).padStart(4)}   ${p.a.T[i].toFixed(1)}/${p.a.Tt[i].toFixed(1)}   ${p.b.T[i].toFixed(1)}/${p.b.Tt[i].toFixed(1)}   ${(100 * p.b.w[i]).toFixed(0).padStart(4)}   ${(100 * p.b.wls[i]).toFixed(1).padStart(5)}   ${p.a.u[i].toFixed(1)} ${p.a.v[i].toFixed(1)}  ${p.prRow[i].toFixed(1)}  ${p.frRow[i].toFixed(2)}`);
  }
}
