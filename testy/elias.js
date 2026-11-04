sim.stop();
sim.set('date', window.__date || '2026-01-15');
await sim.dem(window.__lat || 60.0, window.__lon || -140.5, 0.8, 0.9);
sim.stop();
await sim.roll(window.__sd || 1); sim.stop();
await sim.run(3);
const h = sim.hgt();
const wat = sim.sfcGrid('W').v.map((w) => w >= 0.999);   // woda: W = 1 (gleba nasycona tylko na wodzie)
let nW = wat.filter((x) => x).length;
log('woda', (100 * nW / h.length).toFixed(0), '%, maks. wysokość', Math.max(...h).toFixed(0));
let parent = 0;
for (let q = 1; q <= (window.__n || 16); q++) {
  const r = await sim.run(window.__steps || 360);
  const sy = await sim.syn(); parent += sy.pr * (r.simHours ? 3 : 3);
  const pr = sim.sfcGrid('PR').v, pc = sim.sfcGrid('PRCUS').v, acc = sim.sfcGrid('PACC').v;
  let sw = 0, sl = 0, cw = 0, aw = 0, al = 0, mx = 0;
  for (let k = 0; k < pr.length; k++) { mx = Math.max(mx, pr[k]); if (wat[k]) { sw += pr[k]; cw += pc[k]; aw += acc[k]; } else { sl += pr[k]; al += acc[k]; } }
  const nl = pr.length - nW;
  const H = sim.sfcGrid('H').v, LE = sim.sfcGrid('LE').v, TS = sim.sfcGrid('TS').v, T1 = sim.sfcGrid('T1').v; let hh = 0, ll = 0, tw = 0, ta = 0; for (let k = 0; k < pr.length; k++) if (wat[k]) { hh += H[k]; ll += LE[k]; tw += TS[k]; ta += T1[k]; }
  log(`H ${(hh / nW).toFixed(0)} LE ${(ll / nW).toFixed(0)} Twody ${(tw / nW - 273.15).toFixed(1)} T1 ${(ta / nW).toFixed(1)}`);
  log(`${r.clock.hour.toFixed(0)}h PR woda ${(sw / nW).toFixed(2)} (param ${(cw / nW).toFixed(2)}) ląd ${(sl / nl).toFixed(2)} maks ${mx.toFixed(1)} mm/h | suma woda ${(aw / nW).toFixed(1)} ląd ${(al / nl).toFixed(1)} | duża skala ${sy.pr.toFixed(2)} mm/h T2 ${sim.sfcStats('T2').mean.toFixed(1)}`);
}
