window.__peBias = async (m, dev, pe) => {
  const { NXP, NYP, NZP } = pe; const N2 = NXP * NYP, N3 = N2 * NZP;
  const rb = dev.createBuffer({ size: 4 * N3 * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const enc = dev.createCommandEncoder(); enc.copyBufferToBuffer(m.S[m.p], 0, rb, 0, 4 * N3 * 4); dev.queue.submit([enc.finish()]);
  await rb.mapAsync(GPUMapMode.READ); const s = new Float32Array(rb.getMappedRange()).slice(); rb.unmap(); rb.destroy();
  const o = m.vzOff, v = m.vzData, out = {};
  for (const j of [8, 24, 40, 48, 56, 72, 88]) {
    const lat = (m.lat + ((j + 0.5) * pe.DXP - pe.LYP / 2) / 111.2e3).toFixed(0);
    const row = [];
    for (const k of [0, 2, 3, 5, 7, 9]) {
      let d = 0; for (let i = 0; i < NXP; i++) d += s[2 * N3 + (k * NYP + j) * NXP + i] - v[o.TEQ + j * NZP + k];
      row.push(+(d / NXP * v[o.PI0 + k]).toFixed(1));
    }
    out[lat] = row.join(' ');
  }
  return out;
};
