// Bilans opadu dobami: opad domeny (średnia, maksimum oczka, część ≥ 50 mm), opad modelu synoptycznego nad domeną, mnożnik opadu, wilgotność celu i domeny na poziomach, MUCAPE.
// Parametry: tp=data,ziarno,doby,szer,dł. "?dx=5000&nx=64&ny=64&tp=2027-07-01,2,12,50,20", BLOCK_OM=1.
sim.stop();
const P = (new URLSearchParams(location.search).get('tp') || '2027-07-01,2,12,50,20').split(',');
sim.set('date', P[0]);
await sim.place(+P[3], +P[4]);
sim.stop(); await sim.roll(+P[1]); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600, nH = Math.round(3600 / dt);
const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
const B = sim.base(), ZC = sim.levels();
const qsw = (T, p) => { const es = 610.78 * Math.exp(17.27 * (T - 273.16) / (T - 35.86)); return 0.622 * es / (p - es); };
const qsi = (T, p) => { const es = 610.78 * Math.exp(21.875 * (T - 273.16) / (T - 7.66)); return 0.622 * es / (p - es); };
const qsm = (T, p) => qsi(T, p) + (qsw(T, p) - qsi(T, p)) * Math.min(1, Math.max(0, (T - 233.15) / 40));
const n = sim.sfcGrid('PR').v.length;
let day = new Float32Array(n), pe = 0;
for (let h = 1; h <= +P[2] * 24; h++) {
  await sim.run(nH);
  const pr = sim.sfcGrid('PR').v;
  for (let k = 0; k < n; k++) day[k] += pr[k];
  pe += await sim.pePr();
  if (h % 24 !== 0) continue;
  const d = await sim.drift(), c = sim.cc().nodes[0], mu = sim.sfcGrid('MUCAPE').v, n50 = day.filter((x) => x >= 50).length;
  let line = `d${h / 24}: domena ${mean(Array.from(day)).toFixed(1)} maks ${Math.max(...day).toFixed(0)} n≥50 ${n50} | model ${pe.toFixed(1)} | fp ${c.fp} | MUCAPE ${mean(Array.from(mu)).toFixed(0)}/${Math.max(...mu).toFixed(0)} | RH cel/dom ΔT:`;
  for (const zt of [1500, 3000, 5000]) {
    const r = d.lev.find((x) => x.z >= zt), p = B.prs[ZC.findIndex((z) => Math.round(z) === r.z)];
    line += ` ${zt / 1000}km ${(100 * r.qt / 1000 / qsm(r.Tt + 273.15, p)).toFixed(0)}/${(100 * r.q / 1000 / qsm(r.T + 273.15, p)).toFixed(0)} ${(r.T - r.Tt).toFixed(1)}`;
  }
  log(line);
  day = new Float32Array(n); pe = 0;
}
