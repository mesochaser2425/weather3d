// częstość mas powietrza nad Krakowem (prawdziwa mapa), 4 losowania × 30 dób, co 6 h
const pe = await import('/src/pe.js');
const geoM = await import('/src/geo.js');
const w = await geoM.worldDem();
const geo = { lon: 19.94, elev: (la, lo) => geoM.worldElev(w, la, lo) };
const ad = await navigator.gpu.requestAdapter();
const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize, maxBufferSize: ad.limits.maxBufferSize } });
for (const doy of (window.__doys || [196])) {
  const cnt = {}; let n = 0; const ta = [], dy = [];
  for (const seed of [1, 2, 3, 4]) {
    const m = await pe.PEModel.create(dev, { lat: 50.06, cont: 1.0, hum: 0.75, doy, seed, geo });
    await m.spinup(10);
    for (let s = 0; s < 30 * 48; s++) {
      m.step();
      if (s % 12 === 11) { const c = await m.readCenter(); const k = pe.classifyCenter(c).key; cnt[k] = (cnt[k] || 0) + 1; n++; ta.push(c.tAnom); dy.push(c.dY / 1000); }
    }
    m.destroy();
  }
  const q = (a, p) => { const v = [...a].sort((x, y) => x - y); return v[Math.floor(p * (v.length - 1))].toFixed(1); };
  log(`doy ${doy}: ` + Object.entries(cnt).map(([k, v]) => `${k} ${(100 * v / n).toFixed(0)}%`).join(' ') + ` | tAnom p10/p50/p90 ${q(ta, 0.1)}/${q(ta, 0.5)}/${q(ta, 0.9)} | dY [km] p10/p50/p90 ${q(dy, 0.1)}/${q(dy, 0.5)}/${q(dy, 0.9)}`);
}
