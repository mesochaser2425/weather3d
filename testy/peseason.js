// model synoptyczny sam: średnie miesięczne T przy gruncie (średnia dobowa, poziom morza), podłoża, na 1.5 / 3 / 5.6 km, opad,
// zachmurzenie i strumienie z podłoża w pudełkach 2.5° nad Europą (35…72.5°N, −20…+50°E) i co 6 h stan nad Polską – porównanie
// z NCEP w Pythonie (peseason.py). Parametry: tp=data,ziarno,doby (np. 2026-12-01,1,240)
sim.stop();
window.__lc = false;
const P = (new URLSearchParams(location.search).get('tp') || '2026-12-01,1,240').split(',');
sim.set('date', P[0]); sim.set('hour', 6);
await sim.dem(52.0, 19.0, 0.65, 0.75);
await sim.roll(+P[1]);
const t0 = performance.now();
const r = await sim.peMonths(+P[2]);
const LA0 = 35, LO0 = -20, NA = 16, NB = 29;
const box = new Int32Array(r.NXP * r.NYP).fill(-1);
for (let j = 0; j < r.NYP; j++) for (let i = 0; i < r.NXP; i++) {
  const a = Math.round((r.lat[j] - LA0) / 2.5), lo = ((r.lon[i] + 540) % 360) - 180, b = Math.round((lo - LO0) / 2.5);
  if (a >= 0 && a < NA && b >= 0 && b < NB) box[j * r.NXP + i] = a * NB + b;
}
const cnt = new Float32Array(NA * NB);
for (const x of box) if (x >= 0) cnt[x]++;
const binned = (f, d = 2) => {
  const s = new Float64Array(NA * NB);
  for (let c = 0; c < f.length; c++) if (box[c] >= 0) s[box[c]] += f[c];
  return Array.from(s, (v, k) => (cnt[k] ? +(v / cnt[k]).toFixed(d) : null));
};
log(`czas ${((performance.now() - t0) / 1000).toFixed(0)} s`);
for (const x of r.months) log('MON ' + JSON.stringify({ seed: P[1], mon: x.mon, n: x.n, NA, NB, LA0, LO0,
  ...Object.fromEntries(Object.entries(x.mean).map(([k, v]) => [k, binned(v, k === 'pr' ? 4 : 2)])) }));
log('CTR ' + JSON.stringify(r.ctr));
