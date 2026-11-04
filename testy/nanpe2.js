const pe = await import('/src/pe.js');
const ad = await navigator.gpu.requestAdapter();
const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize, maxBufferSize: ad.limits.maxBufferSize } });
const { NXP, NYP, NZP } = pe; const N2 = NXP * NYP, N3 = N2 * NZP, NW = NZP + 1;
const rd = async (buf, len) => { const rb = dev.createBuffer({ size: len * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }); const e = dev.createCommandEncoder(); e.copyBufferToBuffer(buf, 0, rb, 0, len * 4); dev.queue.submit([e.finish()]); await rb.mapAsync(GPUMapMode.READ); const a = new Float32Array(rb.getMappedRange()).slice(); rb.unmap(); rb.destroy(); return a; };
const WK_TL = 6 * N2 + 4 * N3 + 48 * N2 + 32 + N2;
const names = [['PR', 5 * N2, N2], ['PRC', WK_TL - N2, N2], ['TL', WK_TL, N2], ['QR', WK_TL + N2, N3], ['RD', WK_TL + N2 + N3, 8 * N2], ['KP', WK_TL + N2 + N3 + 8 * N2, NW * N2], ['TM', WK_TL + N2 + N3 + 8 * N2 + NW * N2, N2]];
const seed = window.__seed || 1, S0 = window.__s0 || 1320;
const m = await pe.PEModel.create(dev, { lat: 50, cont: 1.1, hum: 0.75, doy: 15, seed });
await m.spinup(10);
for (let s = 0; s < S0; s++) m.step();
for (let s = S0; s < S0 + 30; s++) {
  m.step();
  const st = await rd(m.S[m.p], 4 * N3), wk = await rd(m.wk, m.wkLen);
  const bad = [];
  for (let f = 0; f < 4; f++) { let n = 0, first = -1; for (let q = 0; q < N3; q++) if (!Number.isFinite(st[f * N3 + q])) { n++; if (first < 0) first = q; } if (n) bad.push(`${'uvtq'[f]}:${n}@k${Math.floor(first / N2)} j${Math.floor((first % N2) / NXP)} i${first % NXP}`); }
  for (const [nm, o, len] of names) { let n = 0, first = -1; for (let q = 0; q < len; q++) if (!Number.isFinite(wk[o + q])) { n++; if (first < 0) first = q; } if (n) bad.push(`${nm}:${n}@${first % N2 >= 0 ? `j${Math.floor((first % N2) / NXP)} i${first % NXP} lvl${Math.floor(first / N2)}` : ''}`); }
  if (bad.length) {
    log('step', s, bad.join(' | '));
    if (bad.length && s > S0) break;
  }
}
