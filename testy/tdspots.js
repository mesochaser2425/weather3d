// Plamy punktu rosy (lato, 15:00): odchyłka Td 2 m od średniej 5×5 a opad, chmury schematu (CUL) i pokrycie terenu
sim.stop();
sim.set('date', window.__date || '2027-07-10');
await sim.dem(49.93, 19.91, 1.0, 0.8);
sim.stop(); await sim.roll(window.__sd || 4); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
let r = a; while (!(r.simHours >= 20 && r.clock.hour >= 15 && r.clock.hour < 16)) r = await sim.run(Math.round(1800 / dt));
const nx = 88, ny = 88, g = (n) => sim.sfcGrid(n).v;
const TD = g('TD2'), PR = g('PR'), CU = g('CUL'), CS = g('CULS'), HF = g('H'), T2 = g('T2');
const cls = { rain: [], cul: [], none: [], all: [] };
let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0, n = 0;
for (let j = 2; j < ny - 2; j++) for (let i = 2; i < nx - 2; i++) {
  let m = 0; for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) m += TD[(j + dj) * nx + i + di];
  const c = j * nx + i, d = TD[c] - m / 25;
  cls.all.push(Math.abs(d));
  if (PR[c] > 0.5) cls.rain.push(d); else if (CU[c] > 1) cls.cul.push(d); else cls.none.push(d);
  sx += d; sy += CU[c]; sxy += d * CU[c]; sxx += d * d; syy += CU[c] * CU[c]; n++;
}
const mean = (v) => v.reduce((s, x) => s + x, 0) / Math.max(v.length, 1);
const corr = (sxy / n - sx / n * sy / n) / Math.sqrt((sxx / n - (sx / n) ** 2) * (syy / n - (sy / n) ** 2));
log(`|ΔTd| śr. ${mean(cls.all).toFixed(2)} K | ΔTd: pod opadem > 0.5 mm/h ${mean(cls.rain).toFixed(2)} K (${cls.rain.length}), z CUL > 1 bez opadu ${mean(cls.cul).toFixed(2)} K (${cls.cul.length}), reszta ${mean(cls.none).toFixed(2)} K (${cls.none.length}) | korelacja ΔTd–CUL ${corr.toFixed(2)}`);
