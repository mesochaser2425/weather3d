// pod burzą: temperatura gruntu (TS), T2, strumienie H i LE pod opadem > 10 mm/h vs okolica bez opadu
sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
await sim.run(Math.round(6 * 3600 / dt));
const g = sim.sfcGrid('PR'), PR = g.v, TS = sim.sfcGrid('TS').v, T2 = sim.sfcGrid('T2').v, H = sim.sfcGrid('H').v, LE = sim.sfcGrid('LE').v;
let r = [0, 0, 0, 0, 0], d = [0, 0, 0, 0, 0];
for (let q = 0; q < PR.length; q++) {
  const t = PR[q] > 10 ? r : PR[q] < 0.01 ? d : null; if (!t) continue;
  t[0] += TS[q]; t[1] += T2[q]; t[2] += H[q]; t[3] += LE[q]; t[4]++;
}
const f = (t) => `TS ${(t[0] / t[4] - (t[0] > 200 * t[4] ? 273.15 : 0)).toFixed(1)}, T2 ${(t[1] / t[4]).toFixed(1)}, H ${(t[2] / t[4]).toFixed(0)}, LE ${(t[3] / t[4]).toFixed(0)} W/m² (${t[4]} oczek)`;
log(`pod ulewą > 10 mm/h: ${f(r)}\nbez opadu: ${f(d)}`);
