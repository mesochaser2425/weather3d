// Seryjne komórki a duża skala: co 3 h średni opad domeny i modelu synoptycznego (ten sam obszar), maks. natężenie, udział mapy
// z opadem, CAPE; na końcu suma domeny / suma modelu synoptycznego, największe sumy i udział 5% najmokrzejszych oczek.
// Parametry: __lat, __lon (domyślnie 52.0, 19.3), __date (2026-07-10), __sd (2), __hours (36)
sim.stop();
sim.set('date', window.__date || '2026-07-10');
if (!window.__noplace) await sim.place(window.__lat ?? 52.0, window.__lon ?? 19.3);
sim.stop(); await sim.roll(window.__sd || 2); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const mean = (v) => { let s = 0; for (const x of v) s += x; return s / v.length; };
const H = window.__hours || 36;
let dom = 0, pe = 0, dom3 = 0, pe3 = 0;
for (let h = 1; h <= H; h++) {
  const r = await sim.run(Math.round(3600 / dt));
  const PR = sim.sfcGrid('PR').v, ppe = await sim.pePr();
  const pd = mean(PR);
  dom += pd; pe += ppe; dom3 += pd; pe3 += ppe;
  if (h % (window.__every || 3) === 0) {
    log(`${String(h).padStart(2)} h (${r.clock.hour.toFixed(0)}:00): opad 3 h domena ${dom3.toFixed(2)} mm, model synoptyczny ${pe3.toFixed(2)} mm | maks ${Math.max(...PR).toFixed(0)} mm/h, ` +
      `> 1 mm/h ${(100 * PR.filter((x) => x > 1).length / PR.length).toFixed(1)}% | CAPE śr ${mean(sim.sfcGrid('CAPE').v).toFixed(0)}`);
    dom3 = 0; pe3 = 0;
  }
}
const P = Array.from(sim.sfcGrid('PACC').v).sort((x, y) => y - x);
const tot = P.reduce((x, y) => x + y, 0), top = P.slice(0, Math.ceil(P.length * 0.05)).reduce((x, y) => x + y, 0);
log(`RAZEM ${H} h: domena ${dom.toFixed(1)} mm (z sumy oczek ${(tot / P.length).toFixed(1)}), model synoptyczny ${pe.toFixed(1)} mm, stosunek ${(dom / Math.max(pe, 0.01)).toFixed(2)} | ` +
  `maks ${P[0].toFixed(0)} mm, p99 ${P[Math.floor(0.01 * P.length)].toFixed(0)}, p90 ${P[Math.floor(0.1 * P.length)].toFixed(0)} | 5% oczek = ${(100 * top / Math.max(tot, 1e-9)).toFixed(0)}% opadu`);
