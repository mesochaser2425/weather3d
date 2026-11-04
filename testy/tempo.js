// tempo trybu MAX i czasy klatek: domena 500 × 500 km, mapa T 2 m; okna pomiaru po starcie (kopie modelu doganiają w tle)
sim.stop();
sim.set('date', '2026-06-01'); sim.set('hour', 6);
await sim.dem(50.5, 19.0, 0.65, 0.75);
await sim.roll(1);
sim.set('speed', 'max');
sim.set('fieldH', new URLSearchParams(location.search).get('fld') || '20');
sim.go();
const meas = async (sec) => {
  const t0 = performance.now(), a = (await sim.syn()).tA, dts = [];
  let last = t0;
  await new Promise((res) => { const f = (now) => { dts.push(now - last); last = now; if (now - t0 < sec * 1000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  const b = (await sim.syn()).tA, el = (performance.now() - t0) / 1000;
  dts.sort((x, y) => x - y);
  const q = (p) => dts[Math.floor(p * (dts.length - 1))].toFixed(0);
  return `tempo ${((b - a) / el).toFixed(0)}× | ${(dts.length / el).toFixed(1)} kl./s | klatka p50 ${q(0.5)} p95 ${q(0.95)} maks ${q(1)} ms`;
};
log('0–15 s: ', await meas(15));
log('15–35 s:', await meas(20));
log('35–60 s:', await meas(25));
