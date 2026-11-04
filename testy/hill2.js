// stała część prądów (średnia W1 z 1 h, co 2 min) – wymuszona przez teren; reszta (termiki) uśrednia się przy wietrze 8 m/s
sim.stop(); await sim.mode('const'); sim.stop();
sim.set('shape', window.__shape || 'hill'); sim.stop(); sim.set('hills', window.__hh ?? 150); sim.stop(); sim.set('landuse', 'uniform'); sim.stop();
sim.set('wind', 8); sim.stop(); sim.set('wdir', 270); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600; let r0 = await sim.run(1);
while (!(r0.clock.hour >= 12 && r0.clock.hour < 13)) r0 = await sim.run(Math.round(1200 / dt));
const nx = 100, M = new Float32Array(nx * nx), S2 = new Float32Array(nx * nx); let n = 0;
for (let t = 0; t < 30; t++) { await sim.run(Math.round(120 / dt)); const W = sim.sfcGrid('W1').v; for (let q = 0; q < W.length; q++) { M[q] += W[q]; S2[q] += W[q] * W[q]; } n++; }
let sm = 0, st = 0; for (let q = 0; q < M.length; q++) { M[q] /= n; sm += M[q] * M[q]; st += S2[q] / n; }
const K = sim.kbGrid();
log(`${window.__shape || 'hill'} ${window.__hh ?? 150} m: odch. std średniej 1 h W1 (część stała) ${Math.sqrt(sm / M.length).toFixed(3)} m/s, całkowita ${Math.sqrt(st / M.length).toFixed(3)} m/s`);
const row = []; for (let i = 20; i < 80; i += 1) { let s = 0; for (let j = 47; j < 53; j++) s += M[j * nx + i]; row.push((100 * s / 6).toFixed(0)); }
log('średnia W1 [cm/s] wzdłuż x 20–80 km:', row.join(' '));
log('kb  wzdłuż x 20–80 km:', Array.from({ length: 60 }, (_, q) => K[50 * nx + 20 + q]).join(' '));
