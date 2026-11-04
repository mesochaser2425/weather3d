// śledzenie kolumny przed NaN: maks. |u|, |θ'| i ich położenie co krok (1 krok = 30 min)
const pe = await import('/src/pe.js');
const ad = await navigator.gpu.requestAdapter();
const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize, maxBufferSize: ad.limits.maxBufferSize } });
const { NXP, NYP, NZP } = pe; const N2 = NXP * NYP, N3 = N2 * NZP;
const rd = async (buf, len) => { const rb = dev.createBuffer({ size: len * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }); const e = dev.createCommandEncoder(); e.copyBufferToBuffer(buf, 0, rb, 0, len * 4); dev.queue.submit([e.finish()]); await rb.mapAsync(GPUMapMode.READ); const a = new Float32Array(rb.getMappedRange()).slice(); rb.unmap(); rb.destroy(); return a; };
const m = await pe.PEModel.create(dev, { lat: 50, cont: 1.1, hum: 0.75, doy: window.__doy0 || 15, seed: window.__seed || 2 });
await m.spinup(10);
const S0 = window.__s0 || 2330;
for (let s = 0; s < S0; s++) m.step();
const loc = (q) => `k${Math.floor(q / N2)} j${Math.floor((q % N2) / NXP)} i${q % NXP}`;
for (let s = S0; s < S0 + 30; s++) {
  m.step();
  const st = await rd(m.S[m.p], 4 * N3);
  const mx = [0, 1, 2, 3].map((f) => { let b = 0, bq = 0; for (let q = 0; q < N3; q++) { const x = Math.abs(st[f * N3 + q]); if (!(x <= b)) { b = x; bq = q; } } return `${'uvtq'[f]} ${f === 3 ? (1000 * b).toFixed(1) : b.toFixed(1)}@${loc(bq)}`; });
  log('s' + s, mx.join(' | '));
  if (mx.some((x) => x.includes('NaN'))) break;
}
