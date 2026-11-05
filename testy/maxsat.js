// Tryb MAX (pętla klatek, jak u użytkownika): satelita i natężenie opadu w wybranych godzinach, stan wzoru cumulusów
sim.stop();
const Q = new URLSearchParams(location.search), seed = +(Q.get('sd') || 1), times = (Q.get('ts') || '12,15,36,39').split(',').map(Number);
await sim.roll(seed); sim.stop();
sim.set('speed', 'max'); sim.set('fieldH', '29');
const r0 = await sim.run(1);
sim.go();
const clock = () => document.getElementById('clockDate').textContent + ' ' + document.getElementById('clockTime').textContent;
const cuInfo = () => {
  const c = sim.cu(), nx = c.nx, ny = c.ny; let mx = 0, gd = 0; const D = c.D, D2 = c.D2;
  for (let t = 0; t < nx * ny; t++) for (const g of [0, 2]) mx = Math.max(mx, Math.hypot(D[4 * t + g] - D2[4 * t + g], D[4 * t + g + 1] - D2[4 * t + g + 1]));
  return { Te: Math.round(c.Te), gmax: +(c.gmax * 1e5).toFixed(2), rate: Math.round(c.rate), tiles: nx + 'x' + ny, maxDD2km: Math.round(mx / 1000), ph: +c.ph.toFixed(2) };
};
let k = 0;
const t0 = performance.now();
let simh0 = r0.simHours;
const lastH = times[times.length - 1];
while (k < times.length && performance.now() - t0 < 240000) {
  await new Promise((r) => setTimeout(r, 200));
  const syn = await sim.syn();
  const hNow = (syn.tA !== undefined ? syn.tA : 0) / 3600;
  if (k === 0 && !globalThis.__h0) { globalThis.__h0 = hNow; }
  if (hNow - globalThis.__h0 >= times[k]) {
    sim.stop();
    await new Promise((r) => setTimeout(r, 1500));   // odczyt pól z pętli klatek musi się skończyć przed draw()
    log(clock(), JSON.stringify(cuInfo()), 'PR>=0.1:', (100 * sim.sfcGrid('PR').v.filter((x) => x >= 0.1).length / sim.sfcGrid('PR').v.length).toFixed(0) + '%');
    await sim.draw(); await new Promise((r) => setTimeout(r, 300));
    await window.shot('sat_' + times[k]);
    sim.set('fieldH', '22'); await sim.draw(); await new Promise((r) => setTimeout(r, 300));
    await window.shot('pr_' + times[k]);
    sim.set('fieldH', '29');
    k++;
    sim.go();
  }
}
