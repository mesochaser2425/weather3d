const pe = await import('/src/pe.js');
const ad = await navigator.gpu.requestAdapter();
const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize, maxBufferSize: ad.limits.maxBufferSize } });
const { NXP, NYP, NZP } = pe; const N2 = NXP * NYP, N3 = N2 * NZP;
const rd = async (buf, len) => { const rb = dev.createBuffer({ size: len * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }); const e = dev.createCommandEncoder(); e.copyBufferToBuffer(buf, 0, rb, 0, len * 4); dev.queue.submit([e.finish()]); await rb.mapAsync(GPUMapMode.READ); const a = new Float32Array(rb.getMappedRange()).slice(); rb.unmap(); rb.destroy(); return a; };
const WK_TL = 6 * N2 + 4 * N3 + 48 * N2 + 32 + N2, WK_TM = WK_TL + N2 + N3 + 8 * N2 + (NZP + 1) * N2, WK_RD = WK_TL + N2 + N3;
const m = await pe.PEModel.create(dev, { lat: 50, cont: 1.1, hum: 0.75, doy: 15, seed: 1 });
await m.spinup(10);
for (let s = 0; s < 1310; s++) m.step();
const v = m.vzData, o = m.vzOff;
for (let s = 1310; s < 1330; s++) {
  m.step();
  const w = await rd(m.wk, m.wkLen), st = await rd(m.S[m.p], 4 * N3);
  let mx = -1e9, mi = 1e9, cmx = 0;
  for (let c = 0; c < N2; c++) { const t = w[WK_TL + c]; if (t > mx) { mx = t; cmx = c; } mi = Math.min(mi, t); }
  const c = 120;
  log(`s${s} TL[120] ${w[WK_TL + c].toFixed(1)} TM ${w[WK_TM + c].toFixed(1)} sea ${v[o.SEA + c]} TS ${v[o.TS + c].toFixed(1)} u0 ${st[c].toFixed(1)} v0 ${st[N3 + c].toFixed(1)} SH ${w[WK_RD + 6 * N2 + c].toFixed(0)} LH ${w[WK_RD + 7 * N2 + c].toFixed(0)} | TL max ${mx.toFixed(1)} @j${Math.floor(cmx / NXP)} i${cmx % NXP} min ${mi.toFixed(1)}`);
}
