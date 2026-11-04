const g = await import('/src/grid.js');
const pe = await import('/src/pe.js');
const ad = await navigator.gpu.requestAdapter();
const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize, maxBufferSize: ad.limits.maxBufferSize } });
const DOY = window.__doy || 196, DAYS = window.__days || 30;
for (const seed of (window.__seeds || [1, 2, 3])) {
  const m = await pe.PEModel.create(dev, { lat: 50, cont: 1.1, hum: 0.75, doy: DOY, seed });
  await m.spinup(10);
  const rows = [];
  for (let s = 0; s < DAYS * 48; s++) {
    m.step();
    if (s % 12 === 11) {
      const c = await m.readCenter();
      const snd = g.makeSounding(c.air);
      const ix = g.soundingIndices(snd);
      rows.push({ l2: c.air.lapse2, t: c.air.tsfc, td: ix.tdSfc, lapse: c.air.lapse, dinv: c.air.dinv, rhl: c.air.rhLow, rhh: c.air.rhHigh, cape: ix.cape, cin: ix.cin, t500: snd.T(5600) - 273.15, t850: snd.T(1500) - 273.15, tday: c.tDay, pr: c.pr, psl: c.psl, w: c.w });
    }
  }
  m.destroy();
  const avg = (k) => rows.reduce((a, r) => a + (r[k] ?? 0), 0) / rows.length;
  const pct = (k, p) => { const v = rows.map((r) => r[k] ?? 0).sort((a, b) => a - b); return v[Math.floor(p * (v.length - 1))]; };
  log('seed', seed, 'mean', Object.fromEntries(['t', 'td', 'lapse', 'l2', 'dinv', 'rhl', 'rhh', 'cape', 't500', 't850', 'tday', 'pr'].map((k) => [k, +avg(k).toFixed(1)])));
  log('  cape p50/p90/max', pct('cape', 0.5).toFixed(0), pct('cape', 0.9).toFixed(0), pct('cape', 1).toFixed(0), ' frac>500', (rows.filter((r) => r.cape > 500).length / rows.length).toFixed(2), ' td p10/p50/p90', pct('td', 0.1).toFixed(1), pct('td', 0.5).toFixed(1), pct('td', 0.9).toFixed(1), ' lapse p10/p90', pct('lapse', 0.1).toFixed(1), pct('lapse', 0.9).toFixed(1), ' t500 p10/p90', pct('t500', 0.1).toFixed(1), pct('t500', 0.9).toFixed(1));
  log('  daily', rows.filter((_, n) => n % 4 === 2).map((r) => `${r.t.toFixed(0)}/${r.td.toFixed(0)}/${r.t500.toFixed(0)}:${r.cape.toFixed(0)}`).join(' '));
}
