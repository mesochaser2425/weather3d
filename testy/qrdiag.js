// profil 50°N (pas j 44–51): T vs profil klimatyczny, RH, grzanie radiacyjne [K/dobę] (WK_QR), lato, 30 dób
const pe = await import('/src/pe.js');
const ad = await navigator.gpu.requestAdapter();
const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize, maxBufferSize: ad.limits.maxBufferSize } });
const { NXP, NYP, NZP } = pe; const N2 = NXP * NYP, N3 = N2 * NZP;
const rd = async (buf, len) => { const rb = dev.createBuffer({ size: len * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }); const e = dev.createCommandEncoder(); e.copyBufferToBuffer(buf, 0, rb, 0, len * 4); dev.queue.submit([e.finish()]); await rb.mapAsync(GPUMapMode.READ); const a = new Float32Array(rb.getMappedRange()).slice(); rb.unmap(); rb.destroy(); return a; };
const doy = window.__doy1 || 196;
const m = await pe.PEModel.create(dev, { lat: 50, cont: 1.1, hum: 0.75, doy, seed: 2 });
await m.spinup(10);
const NW = NZP + 1;
const WK_QR = 6 * N2 + 4 * N3 + 48 * N2 + 32 + N2 + N2;
const acc = new Float64Array(NZP * 4); let ns = 0;
for (let d = 0; d < 30; d++) {
  for (let s = 0; s < 48; s++) {
    m.step();
    if (d >= 20 && s % 6 === 0) {
      const st = await rd(m.S[m.p], 4 * N3), wk = await rd(m.wk, WK_QR + N3);
      const o = m.vzOff, v = m.vzData;
      for (let k = 0; k < NZP; k++) for (let j = 44; j < 52; j++) for (let i = 0; i < NXP; i++) {
        const c = (k * NYP + j) * NXP + i, t = (v[o.TH0 + k] + st[2 * N3 + c]) * v[o.PI0 + k];
        acc[k * 4] += t - 273.15; acc[k * 4 + 1] += (v[o.TH0 + k] + v[o.TEQ + j * NZP + k]) * v[o.PI0 + k] - 273.15;
        acc[k * 4 + 2] += st[3 * N3 + c] / pe.qsat(t, v[o.P0 + k]); acc[k * 4 + 3] += wk[WK_QR + c] * v[o.PI0 + k] * 86400;
      }
      ns++;
    }
  }
}
const n = ns * 8 * NXP, o = m.vzOff, v = m.vzData;
const rows = []; for (let k = 0; k < NZP; k++) rows.push(`z ${Math.round(v[o.ZC + k])} T ${(acc[k * 4] / n).toFixed(1)} Tclim ${(acc[k * 4 + 1] / n).toFixed(1)} RH ${(100 * acc[k * 4 + 2] / n).toFixed(0)} QR ${(acc[k * 4 + 3] / n).toFixed(2)} K/d`);
log('\n' + rows.join('\n'));
