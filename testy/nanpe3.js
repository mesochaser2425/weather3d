const pe = await import('/src/pe.js');
const ad = await navigator.gpu.requestAdapter();
const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize, maxBufferSize: ad.limits.maxBufferSize } });
const { NXP, NYP, NZP } = pe; const N2 = NXP * NYP, N3 = N2 * NZP;
const rd = async (buf, len) => { const rb = dev.createBuffer({ size: len * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }); const e = dev.createCommandEncoder(); e.copyBufferToBuffer(buf, 0, rb, 0, len * 4); dev.queue.submit([e.finish()]); await rb.mapAsync(GPUMapMode.READ); const a = new Float32Array(rb.getMappedRange()).slice(); rb.unmap(); rb.destroy(); return a; };
const nanAt = (a) => { let n = 0, f = -1; for (let q = 0; q < a.length; q++) if (!Number.isFinite(a[q])) { n++; if (f < 0) f = q; } return [n, f]; };
const seed = window.__seed || 1, S0 = window.__s0 || 1328;
const m = await pe.PEModel.create(dev, { lat: 50, cont: 1.1, hum: 0.75, doy: 15, seed });
await m.spinup(10);
for (let s = 0; s < S0; s++) m.step();
const USLOT = 256;
const P = m.sh.pipes;
const run1 = (name, total, slot) => {
  const g = m.bgs[m.p];
  const enc = dev.createCommandEncoder(); const pass = enc.beginComputePass();
  pass.setPipeline(P[name]); pass.setBindGroup(0, g[slot], [slot * USLOT]); pass.dispatchWorkgroups(Math.ceil(total / 64)); pass.end(); dev.queue.submit([enc.finish()]);
};
const seq = [['pe_rad', N2, 0]];
for (let st = 0; st < 3; st++) for (const [n, t] of [['pe_diag', N2], ['pe_stage', N3], ['pe_div', N2], ['pe_dft', N2], ['pe_tri', NXP], ['pe_idft', N2], ['pe_proj', N3]]) seq.push([n, t, st]);
seq.push(['pe_column', N2, 2], ['pe_lap', 4 * N3, 2], ['pe_hyper', 4 * N3, 2]);
let done = false;
for (let term = 0; term < 3 && !done; term++) {
  const dNow = m.doyAt(m.time);
  if (Math.floor(dNow) !== m.forcDay) { m.doy = dNow; m.buildForcing(); }
  m.writeUniforms();
  for (let sub = 0; sub < 4 && !done; sub++) {
    for (const [n, t, sl] of seq) {
      run1(n, t, sl);
      const a = await rd(m.S[0], 4 * N3), b = await rd(m.S[1], 4 * N3), w = await rd(m.wk, m.wkLen), d = await rd(m.dg, N3);
      const r = [['S0', nanAt(a)], ['S1', nanAt(b)], ['wk', nanAt(w)], ['dg', nanAt(d)]].filter((x) => x[1][0] > 0);
      if (r.length) {
        log('term', term, 'sub', sub, 'kernel', n, 'stage', sl, r.map(([nm, [cnt, f]]) => `${nm}: ${cnt} first ${f} (k${Math.floor((f % N3) / N2)} j${Math.floor((f % N2) / NXP)} i${f % NXP} fld${Math.floor(f / N3)})`).join(' | '));
        done = true; break;
      }
    }
    m.p = 1 - m.p;
  }
  m.time += 1800;
}
if (!done) log('no NaN in 3 terms');
