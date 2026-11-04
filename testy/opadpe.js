// Opad dużej skali: suma opadu domeny i modelu synoptycznego (ten sam obszar) co __every h oraz średnia odchyłka domena − cel
// (ΔT, Δq, RH celu / domeny względem nasycenia woda → lód) na kilku wysokościach; na końcu sumy i stosunek domena / model.
// Parametry: __lat, __lon (domyślnie Poznań), __date (2026-12-01), __sd (2), __hours (480), __every (24), __from (pierwszy wpis),
// __zs (wysokości n.p.m. [m]). Szybko: "?dx=8000&nx=40&ny=40" (20 dób ~100 s).
sim.stop();
sim.set('date', window.__date || '2026-12-01');
await sim.place(window.__lat ?? 52.4, window.__lon ?? 16.9);
sim.stop(); await sim.roll(window.__sd || 2); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const B = sim.base(), ZC = sim.levels();
const qsw = (T, p) => { const es = 610.78 * Math.exp(17.27 * (T - 273.16) / (T - 35.86)); return 0.622 * es / (p - es); };
const qsi = (T, p) => { const es = 610.78 * Math.exp(21.875 * (T - 273.16) / (T - 7.66)); return 0.622 * es / (p - es); };
const qsm = (T, p) => qsi(T, p) + (qsw(T, p) - qsi(T, p)) * Math.min(1, Math.max(0, (T - 233.15) / 40));
const H = window.__hours || 480, E = window.__every || 24;
let dom = 0, pe = 0, dE = 0, pE = 0;
const mean = (v) => v.reduce((x, y) => x + y, 0) / v.length;
for (let h = 1; h <= H; h++) {
  await sim.run(Math.round(3600 / dt));
  const pd = mean(sim.sfcGrid('PR').v), pp = await sim.pePr();
  dom += pd; pe += pp; dE += pd; pE += pp;
  if (h % E !== 0) continue;
  if (h >= (window.__from || 0)) {
    const d = await sim.drift();
    let line = `${h} h: domena ${dE.toFixed(2)} / model ${pE.toFixed(2)} mm | ΔT Δq[g/kg] RHm cel/dom:`;
    for (const zt of (window.__zs || [500, 1000, 1500, 2500, 3500, 5000])) {
      const r = d.lev.find((x) => x.z >= zt), p = B.prs[ZC.findIndex((z) => Math.round(z) === r.z)];
      const rt = r.qt / 1000 / qsm(r.Tt + 273.15, p), rd = r.q / 1000 / qsm(r.T + 273.15, p);
      line += ` ${zt / 1000}km ${(r.T - r.Tt).toFixed(1)} ${(r.q - r.qt).toFixed(2)} ${(100 * rt).toFixed(0)}/${(100 * rd).toFixed(0)}`;
    }
    log(line);
  }
  dE = 0; pE = 0;
}
log(`RAZEM ${H} h: domena ${dom.toFixed(1)} mm, model ${pe.toFixed(1)} mm, stosunek ${(dom / Math.max(pe, 0.01)).toFixed(2)} | `
  + `korekta klimatu: ${JSON.stringify(sim.cc().nodes.map((n) => ({ fq: n.fq, fqa: n.fqa, fp: n.fp })))}`);
