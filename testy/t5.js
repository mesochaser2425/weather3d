const pe = await import('/src/pe.js');
const ad = await navigator.gpu.requestAdapter();
const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize, maxBufferSize: ad.limits.maxBufferSize } });
for (const doy of (window.__doys || [15, 196])) {
  const acc = { pc: [], mins: [], pr: [], prc: [], wind: [], area990: [] };
  for (const seed of [1, 2, 3]) {
    const m = await pe.PEModel.create(dev, { lat: 50, cont: 1.1, hum: 0.75, doy, seed });
    await m.spinup(10);
    for (let s = 0; s < 40 * 48; s++) {
      m.step();
      if (s % 12 === 11) { const c = await m.readCenter(); acc.pc.push(c.psl); acc.wind.push(Math.hypot(c.u0, c.v0)); }
      if (s % 48 === 47) {
        const mp = await m.readMap();
        let mn = 9999, n990 = 0, cnt = 0, pr = 0, prc = 0;
        for (let j = 16; j < pe.NYP - 16; j++) for (let i = 0; i < pe.NXP; i++) { const c = j * pe.NXP + i; mn = Math.min(mn, mp.psl[c]); cnt++; if (mp.psl[c] < 990) n990++; pr += mp.pr[c]; prc += mp.prc[c]; }
        acc.mins.push(mn); acc.area990.push(n990 / cnt); acc.pr.push(24 * pr / cnt); acc.prc.push(prc / Math.max(pr, 1e-9));
      }
    }
    m.destroy();
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const sd = Math.sqrt(mean(acc.pc.map((v) => (v - mean(acc.pc)) ** 2)));
  const d24 = mean(acc.pc.slice(4).map((v, n) => Math.abs(v - acc.pc[n])));
  log('doy', doy, { pMean: +mean(acc.pc).toFixed(1), pSd: +sd.toFixed(1), dp24: +d24.toFixed(1), mapMinMean: +mean(acc.mins).toFixed(0), area990: +(100 * mean(acc.area990)).toFixed(1), prDayMap: +mean(acc.pr).toFixed(2), convFrac: +mean(acc.prc).toFixed(2), wind: +mean(acc.wind).toFixed(1) });
}
