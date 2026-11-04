const pe = await import('/src/pe.js');
const ad = await navigator.gpu.requestAdapter();
const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize, maxBufferSize: ad.limits.maxBufferSize } });
const { NXP, NYP, NZP } = pe; const N2 = NXP * NYP, N3 = N2 * NZP;
const rd = async (buf, len) => { const rb = dev.createBuffer({ size: len * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }); const e = dev.createCommandEncoder(); e.copyBufferToBuffer(buf, 0, rb, 0, len * 4); dev.queue.submit([e.finish()]); await rb.mapAsync(GPUMapMode.READ); const a = new Float32Array(rb.getMappedRange()).slice(); rb.unmap(); rb.destroy(); return a; };
for (const seed of [1, 2, 3]) {
  const m = await pe.PEModel.create(dev, { lat: 50, cont: 1.1, hum: 0.75, doy: 15, seed });
  await m.spinup(10);
  let prev = await rd(m.S[m.p], 4 * N3), found = false;
  for (let s = 0; s < 40 * 48 && !found; s++) {
    m.step();
    if (s % 6 === 5) {
      const st = await rd(m.S[m.p], 4 * N3);
      let bad = -1; for (let q = 0; q < 4 * N3; q++) if (!Number.isFinite(st[q])) { bad = q; break; }
      if (bad >= 0) {
        const f = Math.floor(bad / N3), r = bad % N3, k = Math.floor(r / N2), j = Math.floor((r % N2) / NXP), i = r % NXP;
        // poprzedni stan wokół tego punktu: u, v, θ', q
        const near = [0, 1, 2, 3].map((ff) => prev[ff * N3 + r].toFixed(2));
        const col = []; for (let kk = 0; kk < NZP; kk++) col.push(prev[2 * N3 + kk * N2 + j * NXP + i].toFixed(1) + '/' + (1000 * prev[3 * N3 + kk * N2 + j * NXP + i]).toFixed(2));
        log('seed', seed, 'NaN at step', s, 'day', (s / 48).toFixed(2), 'field', ['u', 'v', 'th', 'q'][f], 'k', k, 'j', j, 'i', i, 'prev u,v,th,q', near.join(' '), '\n  prev column th/q:', col.join(' '));
        found = true;
      }
      prev = st;
    }
  }
  if (!found) log('seed', seed, 'OK 40 d');
  m.destroy();
}
