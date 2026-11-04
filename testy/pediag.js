// pomocnicze: odczyt stanu modelu PE i średnie strefowe na pasie szerokości
window.__peDiag = async (m, dev, pe) => {
  const { NXP, NYP, NZP } = pe; const N2 = NXP * NYP, N3 = N2 * NZP;
  const rb = dev.createBuffer({ size: 4 * N3 * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const enc = dev.createCommandEncoder(); enc.copyBufferToBuffer(m.S[m.p], 0, rb, 0, 4 * N3 * 4); dev.queue.submit([enc.finish()]);
  await rb.mapAsync(GPUMapMode.READ); const s = new Float32Array(rb.getMappedRange()).slice(); rb.unmap(); rb.destroy();
  const o = m.vzOff, v = m.vzData;
  const prof = [];
  for (let k = 0; k < NZP; k++) {
    let T = 0, Teq = 0, rh = 0, n = 0;
    for (let j = NYP / 2 - 4; j < NYP / 2 + 4; j++) for (let i = 0; i < NXP; i++) {
      const c = (k * NYP + j) * NXP + i;
      const t = (v[o.TH0 + k] + s[2 * N3 + c]) * v[o.PI0 + k];
      T += t; Teq += (v[o.TH0 + k] + v[o.TEQ + j * NZP + k]) * v[o.PI0 + k];
      rh += s[3 * N3 + c] / pe.qsat(t, v[o.P0 + k]); n++;
    }
    prof.push([Math.round(v[o.ZC + k]), +(T / n - 273.15).toFixed(1), +(Teq / n - 273.15).toFixed(1), +(100 * rh / n).toFixed(0)]);
  }
  return prof;
};
