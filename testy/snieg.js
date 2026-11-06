// Tarasy pokrywy śnieżnej w górach: A/B z ?phs=0 przy tej samej pogodzie. Różnice między sąsiednimi oczkami na granicach warstw kb wobec oczek o tym samym kb, przy tej samej różnicy wysokości.
// ?dx=5000&nx=64&ny=64&start=49.2,19.9,0&phs=0, BLOCK_OM=1, SHOT=plik.png (mapa grubości śniegu). ~1 min.
while (!sim.ready()) await new Promise((r) => setTimeout(r, 300));
sim.stop();
await sim.roll(3);
while (!sim.ready()) await new Promise((r) => setTimeout(r, 300));
sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
await sim.run(Math.round(8 * 86400 / dt));
const sw = sim.sfcGrid('SWE'), kb = sim.kbGrid(), h = sim.hgt(), nx = sw.nx, ny = sw.ny, v = sw.v, K = kb.v || kb, H = h.v || h;
let cr = 0, cs = 0, nr = 0, ns = 0, tot = 0, mx = 0;
for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
  const c = j * nx + i; tot += v[c]; mx = Math.max(mx, v[c]);
  for (const q of [c + 1, c + nx]) {
    if (Math.abs(H[c] - H[q]) > 150 || Math.min(H[c], H[q]) < 400) continue;      // tylko małe różnice wysokości w terenie wyżynnym
    const d = Math.abs(v[c] - v[q]);
    if (K[c] !== K[q]) { cr += d; nr++; } else { cs += d; ns++; }
  }
}
log(JSON.stringify({ phs: new URLSearchParams(location.search).get('phs') ?? '1', sredniaSWE: +(tot / ((nx - 1) * (ny - 1))).toFixed(1), maks: +mx.toFixed(0), 'roznica na granicy warstw [mm]': +(cr / Math.max(nr, 1)).toFixed(2), 'roznica w warstwie [mm]': +(cs / Math.max(ns, 1)).toFixed(2), par: [nr, ns] }));
sim.set('fieldH', 32);
await new Promise((r) => setTimeout(r, 300));
await sim.draw();
await new Promise((r) => setTimeout(r, 500));
