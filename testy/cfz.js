// Skąd chmury siatki w letnie popołudnie (14:00 doby __day, domyślnie 4): profil średni (T, Td, RH, udział oczek z chmurą)
// i kolumny – najwięcej wody (LWP) oraz mediana LWP: T, w, q_v, q_c na poziomach nad gruntem.
sim.stop();
sim.set('date', window.__date || '2027-07-01');
await sim.dem(window.__lat ?? 50.0, window.__lon ?? 19.95, 1.0, 0.8);
sim.stop(); await sim.roll(window.__sd || 1); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const day = window.__day || 4;
let r = b;
while (!(r.clock.hour >= 14 && r.clock.hour < 15 && r.simHours > 24 * (day - 1) + 6)) r = await sim.run(Math.max(1, Math.round(900 / dt)));
const es = (T) => 6.112 * Math.exp(17.67 * T / (T + 243.5));
log('profil (z, T, Td, RH, udział oczek z chmurą):');
log(sim.profile().filter((p) => p[0] < 7000).map((p) => `${p[0]}:${p[1].toFixed(1)}/${p[2].toFixed(1)}/${(100 * es(p[2]) / es(p[1])).toFixed(0)}%/${(100 * p[3]).toFixed(0)}`).join(' '));
const g = sim.sfcGrid('LWP'), L = g.v, nx = g.nx || Math.round(Math.sqrt(L.length));
const idx = [...L.keys()].sort((p, q) => L[p] - L[q]);
for (const [nm, q] of [['maks', idx[idx.length - 1]], ['p75', idx[Math.floor(0.75 * idx.length)]], ['mediana', idx[Math.floor(0.5 * idx.length)]]]) {
  const i = q % nx, j = Math.floor(q / nx), c = await sim.colq(i, j);
  log(`${nm} LWP ${(1000 * L[q]).toFixed(0)} g/m² (${i},${j}): ` + c.filter((x) => x[0] < 6000).map((x) => `${x[0]}:T${x[1]} w${x[2]} qv${x[3]} qc${x[4]} qi${x[5]}`).join(' | '));
}
const dr = await sim.drift(), qs = (T, z) => 622 * es(T) / (1013 * Math.exp(-z / 8400));
log('domena vs cel (z: T/T_cel, RH/RH_cel): ' + dr.lev.filter((l) => l.z < 6000).map((l) => `${l.z}:${l.T.toFixed(1)}/${l.Tt.toFixed(1)} ${(100 * l.q / qs(l.T, l.z)).toFixed(0)}/${(100 * l.qt / qs(l.Tt, l.z)).toFixed(0)}%`).join(' '));
log(`nx ${nx}, oczek ${L.length}, PBLH śr ${(sim.sfcGrid('PBLH').v.reduce((s, x) => s + x, 0) / L.length).toFixed(0)}`);
