// profil zachmurzenia (jak w pe_rad) i wody chmurowej w regionie Krakowa, lato, prawdziwa mapa
const pe = await import('/src/pe.js');
const geoM = await import('/src/geo.js');
const w = await geoM.worldDem();
const geo = { lon: 19.94, elev: (la, lo) => geoM.worldElev(w, la, lo) };
const ad = await navigator.gpu.requestAdapter();
const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize, maxBufferSize: ad.limits.maxBufferSize } });
const { NXP, NYP, NZP } = pe; const N2 = NXP * NYP, N3 = N2 * NZP;
const rd = async (buf, len) => { const rb = dev.createBuffer({ size: len * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }); const e = dev.createCommandEncoder(); e.copyBufferToBuffer(buf, 0, rb, 0, len * 4); dev.queue.submit([e.finish()]); await rb.mapAsync(GPUMapMode.READ); const a = new Float32Array(rb.getMappedRange()).slice(); rb.unmap(); rb.destroy(); return a; };
const acc = Array.from({ length: NZP }, () => [0, 0, 0, 0, 0]);
for (const seed of [1, 2]) {
  const m = await pe.PEModel.create(dev, { lat: 50.06, cont: 1.0, hum: 0.75, doy: window.__doy1 || 196, seed, geo });
  await m.spinup(10);
  for (let d = 0; d < 20; d++) {
    for (let s = 0; s < 48; s++) m.step();
    const st = await rd(m.S[m.p], 5 * N3), o = m.vzOff, v = m.vzData;
    for (let k = 0; k < NZP; k++) for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) {
      const c = (k * NYP + NYP / 2 + dj) * NXP + NXP / 2 + di;
      const t = (v[o.TH0 + k] + st[2 * N3 + c]) * v[o.PI0 + k], rh = st[3 * N3 + c] / ((tt) => { const ew = 610.78 * Math.exp(17.27 * (tt - 273.16) / (tt - 35.86)), ei = 611.2 * Math.exp(21.875 * (tt - 273.16) / (tt - 7.66)), w = Math.min(1, Math.max(0, (tt - 233.15) / 40)), es = ei + w * (ew - ei); return 0.622 * es / (v[o.P0 + k] - es); })(t), qc = st[4 * N3 + c];
      const cfr = t < 195 ? 0 : Math.min(1 - Math.sqrt(Math.min(1, Math.max(0, (1 - rh) / 0.1))), 0.85 + 0.15 * Math.min(1, qc / 2e-4));
      acc[k][0] += cfr; acc[k][1] += qc * 1000; acc[k][2] += rh; acc[k][3] += t - 273.15; acc[k][4]++;
    }
  }
  m.destroy();
}
const o = []; for (let k = 0; k < NZP; k++) { const a = acc[k]; o.push(`k${k} T ${(a[3] / a[4]).toFixed(1)} RH ${(100 * a[2] / a[4]).toFixed(0)} cf ${(a[0] / a[4]).toFixed(2)} qc ${(a[1] / a[4]).toFixed(3)} g/kg`); }
log('\n' + o.join('\n'));
