const pe = await import('/src/pe.js');
const ad = await navigator.gpu.requestAdapter();
const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize, maxBufferSize: ad.limits.maxBufferSize } });
const { NXP, NYP, NZP } = pe; const N2 = NXP * NYP, N3 = N2 * NZP;
const rd = async (buf, len) => { const rb = dev.createBuffer({ size: len * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }); const e = dev.createCommandEncoder(); e.copyBufferToBuffer(buf, 0, rb, 0, len * 4); dev.queue.submit([e.finish()]); await rb.mapAsync(GPUMapMode.READ); const a = new Float32Array(rb.getMappedRange()).slice(); rb.unmap(); rb.destroy(); return a; };
for (const doy of [15, 196]) {
  const m = await pe.PEModel.create(dev, { lat: 50, cont: 1.1, hum: 0.75, doy, seed: 2 });
  await m.spinup(10);
  const out = [];
  for (let d = 0; d <= 60; d += 20) {
    if (d) for (let s = 0; s < 20 * 48; s++) m.step();
    const st = await rd(m.S[m.p], 4 * N3), o = m.vzOff, v = m.vzData;
    const row = [];
    for (const j of [0, 12, 48, 84, 95]) {
      const la = (m.lat + ((j + 0.5) * pe.DXP - pe.LYP / 2) / 111.2e3).toFixed(0);
      const t = []; for (const k of [8, 9, 10, 11]) { let a = 0; for (let i = 0; i < NXP; i++) a += (v[o.TH0 + k] + st[2 * N3 + (k * NYP + j) * NXP + i]) * v[o.PI0 + k] - 273.15; t.push((a / NXP).toFixed(0)); }
      row.push(`${la}°: ${t.join('/')}`);
    }
    out.push(`d${d} T[°C] z=9.1/11.3/14.3/(top) km: ` + row.join('  '));
  }
  log(`doy ${doy}\n  ` + out.join('\n  '));
  m.destroy();
}
