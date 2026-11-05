// Przelotny opad w napływie polarnym nad Zatoką Gdańską: stała masa, wiatr NW 12 m/s, woda +4 °C, 4 km; tg – T przy gruncie; opad schematu i część śnieżna
sim.stop();
const Q = new URLSearchParams(location.search), tg = +(Q.get('tg') || 1), lp = +(Q.get('lp') || 7), rl = +(Q.get('rl') || 85), rh = +(Q.get('rh') || 75);
sim.set('date', '2027-01-15'); sim.set('hour', 6);
await sim.dem(54.4, 19.0, 0.7, 0.75);
sim.stop();
for (const [k, v] of [['tsfc', tg], ['lapse', lp], ['rhLow', rl], ['rhHigh', rh], ['ztrop', 9], ['zinv', 3], ['dinv', 0], ['tnight', 2], ['wind', 12], ['wdir', 315], ['water', 4]]) sim.set(k, v);
await sim.mode('const'); sim.stop();
for (const [k, v] of [['tsfc', tg], ['lapse', lp], ['rhLow', rl], ['rhHigh', rh], ['ztrop', 9], ['zinv', 3], ['dinv', 0], ['wind', 12], ['wdir', 315], ['water', 4]]) sim.set(k, v);
document.getElementById('applyAir').click();
await new Promise((r) => setTimeout(r, 2500)); sim.stop();
await sim.run(1);
const G = (n) => sim.sfcGrid(n).v;
const lc = sim.landGrid(), mean = (v, f) => { let s = 0, n = 0; for (let k = 0; k < v.length; k++) if (f(k)) { s += v[k]; n++; } return n ? s / n : 0; };
for (let h = 2; h <= 10; h += 2) {
  await sim.run(h === 2 ? 119 : 120);
  const pr = G('PR'), ps = G('PSN'), pc = G('PRCUS'), sh = G('SHACT'), n = pr.length;
  let a = 0; for (let k = 0; k < n; k++) if (pr[k] >= 0.1) a++;
  log(`+${h} h T2 ${sim.sfcStats('T2').mean.toFixed(1)} | opad>=0.1 ${(100 * a / n).toFixed(0)}% maks ${Math.max(...pr).toFixed(2)} mm/h śr ${(pr.reduce((x, y) => x + y, 0) / n).toFixed(3)} | schemat śr ${(pc.reduce((x, y) => x + y, 0) / n).toFixed(3)} | śnieg ${(100 * ps.reduce((x, y) => x + y, 0) / Math.max(pr.reduce((x, y) => x + y, 0), 1e-6)).toFixed(0)}% | Cu płytkie ${(100 * sh.filter((x) => x > 0).length / n).toFixed(0)}% | RH2m ${(() => { const t = sim.sfcStats('T2').mean, d = sim.sfcStats('TD2').mean; return (100 * Math.exp(17.27 * d / (d + 237.3) - 17.27 * t / (t + 237.3))).toFixed(0); })()}%`);
}
log('PACC śr', sim.sfcStats('PACC').mean.toFixed(2), 'maks', sim.sfcStats('PACC').max.toFixed(1));
