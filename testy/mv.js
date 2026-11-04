// ruch pola chmur (LWP) i prądów (W1) w 30 min: korelacja przy przesunięciu z wiatrem 10 m (kierunek z UA/VA)
const nx = window.__nx, ny = window.__ny, DXk = window.__dxk;
const H = sim.hgt();
const corr = (A, B, sx, sy) => { let ma = 0, mb = 0; const idx = []; const m = 12;
  for (let j = m; j < ny - m; j++) for (let i = m; i < nx - m; i++) { if (H[j * nx + i] > 800) continue; const jj = j + sy, ii = i + sx; if (jj < 0 || ii < 0 || jj >= ny || ii >= nx) continue; idx.push([j * nx + i, jj * nx + ii]); }
  for (const [p, q] of idx) { ma += A[p]; mb += B[q]; } ma /= idx.length; mb /= idx.length;
  let c = 0, va = 0, vb = 0; for (const [p, q] of idx) { c += (A[p] - ma) * (B[q] - mb); va += (A[p] - ma) ** 2; vb += (B[q] - mb) ** 2; } return c / Math.sqrt(va * vb + 1e-30); };
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
const U = sim.sfcGrid('UA').v, V = sim.sfcGrid('VA').v; let um = 0, vm = 0; for (let q = 0; q < U.length; q++) { um += U[q]; vm += V[q]; } um /= U.length; vm /= V.length;
const sp = Math.hypot(um, vm), ex = um / sp, ey = vm / sp;
const L0 = sim.sfcGrid('LWP').v.slice(), W0 = sim.sfcGrid('W1').v.slice();
await sim.run(Math.round(1800 / dt));
const L1 = sim.sfcGrid('LWP').v, W1 = sim.sfcGrid('W1').v;
const rl = [], rw = []; const exp = sp * 1800 / 1000 / DXk;
for (const f of [0, 0.25, 0.5, 0.75, 1, 1.5]) { const s = f * exp; const sx = Math.round(s * ex), sy = Math.round(s * ey); rl.push(`${(s * DXk).toFixed(0)}km:${corr(L0, L1, sx, sy).toFixed(2)}`); rw.push(`${corr(W0, W1, sx, sy).toFixed(2)}`); }
log(`wiatr 10 m ${sp.toFixed(1)} m/s (oczekiwane przesunięcie ~${(exp * DXk).toFixed(0)}+ km) | LWP: ${rl.join(' ')} | W1: ${rw.join(' ')}`);
