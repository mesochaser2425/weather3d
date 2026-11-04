// model synoptyczny sam: dobowe ciśnienie i średni wiatr / T uśrednione do pudełek 2.5° × 2.5° (środki jak siatka NCEP:
// 25…77.5°N, −80…+60°E) – porównanie toru niżów z NCEP w Pythonie (petrack.py). Parametry: tp=data,ziarno,doby
sim.stop();
window.__lc = false;
const P = (new URLSearchParams(location.search).get('tp') || '2026-01-01,1,30').split(',');
sim.set('date', P[0]); sim.set('hour', 6);
await sim.dem(52.0, 19.0, 0.65, 0.75);
await sim.roll(+P[1]);
const r = await sim.peMap(+P[2]);
const LA0 = 25, LO0 = -80, NA = 22, NB = 57;
const box = new Int32Array(r.NXP * r.NYP).fill(-1);
for (let j = 0; j < r.NYP; j++) for (let i = 0; i < r.NXP; i++) {
  const a = Math.round((r.lat[j] - LA0) / 2.5), lo = ((r.lon[i] + 540) % 360) - 180, b = Math.round((lo - LO0) / 2.5);
  if (a >= 0 && a < NA && b >= 0 && b < NB) box[j * r.NXP + i] = a * NB + b;
}
const cnt = new Float32Array(NA * NB);
for (const x of box) if (x >= 0) cnt[x]++;
const binned = (f, d = 1) => {
  const s = new Float64Array(NA * NB);
  for (let c = 0; c < f.length; c++) if (box[c] >= 0) s[box[c]] += f[c];
  return Array.from(s, (v, k) => (cnt[k] ? +(v / cnt[k]).toFixed(d) : null));
};
const out = { seed: P[1], date: P[0], doy: r.doy, NA, NB, LA0, LO0, days: r.daily.map((d) => binned(d)),
  psl: binned(r.mean.psl), u15: binned(r.mean.u15, 2), u5: binned(r.mean.u5, 2), t15: binned(r.mean.t15, 2) };
log('JSON ' + JSON.stringify(out));
