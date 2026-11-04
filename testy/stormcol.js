// burze 1 km: kolumna pod najsilniejszym opadem w 6. godzinie – T, w, q_v (RH), q_c, q_i, q_r, N_r, θ'; i otoczenie 15 km dalej
sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
await sim.run(Math.round((window.__h || 5.5) * 3600 / dt));
const g = sim.sfcGrid('PR'), nx = g.nx; let best = 0, bi = 0;
for (let q = 0; q < g.v.length; q++) if (g.v[q] > best) { best = g.v[q]; bi = q; }
const i = bi % nx, j = Math.floor(bi / nx);
const fmt = (c) => c.filter((r) => r[0] < 6000).map((r) => r.join(' ')).join('\n');
log(`opad ${best.toFixed(0)} mm/h w (${i}, ${j}); kolumna [z, T, w, qv, qc, qi, qr, θ', Nr]:\n` + fmt(await sim.colq(i, j)) + `\notoczenie (${i + 15}, ${j}):\n` + fmt(await sim.colq(Math.min(i + 15, nx - 1), j)));
