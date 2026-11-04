// Kalibracja wykrywania frontów: co 3 h rozkład (percentyle w widocznej domenie) gradientu dużej skali na ~1 km [K/100 km],
// skupienia gradientu (fness), kontrastu w poprzek strefy [K], wagi frontu i rodzaju tam, gdzie waga > 0.3
sim.stop();
sim.set('date', window.__date || '2027-05-15');
await sim.roll(window.__seed || 4);
await sim.run(1);
const dt = window.__dt || 45, steps = Math.round(3 * 3600 / dt);
const pc = (a, p) => { const s = Float32Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
log('h | gmax p50/p90/maks | fness p50/p90 | dT p50/p90/maks | w p90/maks, oczek w>0.3 | rodzaj (w>0.3) min/śr/maks | L km (w>0.3) min/śr');
for (let s = 0; s <= (window.__days || 3) * 8; s++) {
  if (s) await sim.run(steps);
  const g = await sim.frontGeo();
  const sel = []; g.w.forEach((w, k) => { if (w > 0.3) sel.push(k); });
  const ty = sel.map((k) => g.typ[k]), L = sel.map((k) => g.L[k] / 1000);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  log(`${String(s * 3).padStart(3)} | ${pc(g.gmax, 0.5).toFixed(2)}/${pc(g.gmax, 0.9).toFixed(2)}/${Math.max(...g.gmax).toFixed(2)} | ${pc(g.fness, 0.5).toFixed(2)}/${pc(g.fness, 0.9).toFixed(2)} | ${pc(g.dT, 0.5).toFixed(1)}/${pc(g.dT, 0.9).toFixed(1)}/${Math.max(...g.dT).toFixed(1)} | ${pc(g.w, 0.9).toFixed(2)}/${Math.max(...g.w).toFixed(2)}, ${sel.length} | ${ty.length ? `${Math.min(...ty).toFixed(2)}/${mean(ty).toFixed(2)}/${Math.max(...ty).toFixed(2)}` : '–'} | ${L.length ? `${Math.min(...L).toFixed(0)}/${mean(L).toFixed(0)}` : '–'}`);
}
