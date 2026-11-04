// Turbulencja napływu: odchylenie standardowe w czasie prądu pionowego na stałym poziomie (~__z m n.p.m.) w pasach co 1/10 szerokości
// od zachodu na wschód (przy wietrze z zachodu – od brzegu napływu w głąb), próbki co 2 min przez __min min, kilka wierszy.
// Gładki (laminarny) napływ: std ≈ 0 przy brzegu i przez kawał domeny. Parametry: __skip (h), __z (2600), __min (30)
sim.stop();
for (let n = 0; n < 600 && !(await sim.syn()).cls; n++) await new Promise((r) => setTimeout(r, 500));
sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
if (window.__skip) await sim.run(Math.round(window.__skip * 3600 / dt));
const zc = sim.levels(), k = zc.findIndex((z) => z > (window.__z || 2600));
const ny = sim.sfcGrid('T2').ny, rows = [0.2, 0.4, 0.6, 0.8].map((f) => Math.floor(f * ny));
const n = Math.round((window.__min || 30) / 2);
const S = new Map(), S2 = new Map();
let nxv = 0;
for (let s = 0; s < n; s++) {
  await sim.run(Math.max(1, Math.round(120 / dt)));
  for (const j of rows) {
    const r = await sim.rowk(j, k);
    nxv = r.w.length;
    if (!S.has(j)) { S.set(j, new Float64Array(nxv)); S2.set(j, new Float64Array(nxv)); }
    r.w.forEach((w, i) => { S.get(j)[i] += w; S2.get(j)[i] += w * w; });
  }
}
const bands = new Array(10).fill(0), cnt = new Array(10).fill(0);
for (const j of rows) for (let i = 0; i < nxv; i++) {
  const m = S.get(j)[i] / n, v = S2.get(j)[i] / n - m * m, b2 = Math.min(9, Math.floor(10 * i / nxv));
  bands[b2] += Math.sqrt(Math.max(v, 0)); cnt[b2]++;
}
const r = await sim.rowk(rows[1], k);
const um = r.u.reduce((x, y) => x + y, 0) / r.u.length;
log(`poziom ${zc[k].toFixed(0)} m n.p.m., wiatr u śr. ${um.toFixed(1)} m/s | std w w czasie wg pasów W→E [m/s]: ${bands.map((x, i) => (x / cnt[i]).toFixed(2)).join(' ')}`);
