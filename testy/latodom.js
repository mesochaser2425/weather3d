// lato w domenie z modelem synoptycznym (Polska środkowa, teren z DEM): co dobę średnia T 2 m domeny i T przy gruncie modelu
// synoptycznego nad środkiem, na końcu średnie miesięczne domeny (T, T maks., T min., opad) i korekta klimatu – sprawdzenie upału
// i suszy. Parametry: tp=data,ziarno,doby (np. 2026-06-01,1,45); porównanie: ?smt=0&bms=0 (dawna gleba i konwekcja modelu)
sim.stop();
const P = (new URLSearchParams(location.search).get('tp') || '2026-06-01,1,45').split(',');
sim.set('date', P[0]); sim.set('hour', 6);
await sim.dem(52.0, 19.0, 0.65, 0.75);
await sim.roll(+P[1]); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600, spd = Math.round(86400 / dt);
const t0 = performance.now(), rows = [];
for (let d = 0; d < +P[2]; d++) {
  await sim.run(spd);
  const T2 = sim.sfcGrid('T2').v, sy = await sim.syn();
  rows.push(`${d + 1}:${(T2.reduce((s, x) => s + x, 0) / T2.length).toFixed(1)}/${sy.tDay.toFixed(1)}`);
}
log(`czas ${((performance.now() - t0) / 1000).toFixed(0)} s; doba: T 2 m domeny (chwila 6:00) / T dobowa modelu synoptycznego`);
log(rows.join(' '));
for (const p of sim.ana('m')) log(`${p.label}${p.cur ? '*' : ''}: T ${p.t?.toFixed(1)} Tmax ${p.tx?.toFixed(1)} Tmin ${p.tn?.toFixed(1)} opad ${p.p?.toFixed(1)} mm`);
const cc = sim.cc();
log('korekta klimatu:', cc.on, cc.nodes.map((n) => `${n.corr.join('/')} fq ${n.fq} fp ${n.fp}`).join(' | '));
