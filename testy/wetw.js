// opad i parowanie modelu PE wg szerokości, osobno ląd i morze (średnia z dób 20–30 po rozbiegu)
const pe = await import('/src/pe.js');
const ad = await navigator.gpu.requestAdapter();
const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize, maxBufferSize: ad.limits.maxBufferSize } });
const { NXP, NYP } = pe;
const doy = window.__doy1 || 15;
for (const seed of (window.__seeds || [1, 2])) {
  const m = await pe.PEModel.create(dev, { lat: 50, cont: 1.1, hum: 0.75, doy, seed });
  await m.spinup(10);
  const acc = {}; let n = 0, cprS = 0, cn = 0;
  for (let d = 0; d < 30; d++) {
    for (let s = 0; s < 48; s++) { m.step(); if (d >= 10 && s % 12 === 11) { const c = await m.readCenter(); cprS += c.pr; cn++; } }
    if (d >= 10) {
      const mp = await m.readMap(), sea = m.sea;
      for (let j = 0; j < NYP; j++) {
        const la = Math.round((m.lat + ((j + 0.5) * pe.DXP - pe.LYP / 2) / 111.2e3) / 5) * 5;
        for (let i = 0; i < NXP; i++) {
          const c = j * NXP + i, k = `${la}${sea[c] ? 's' : 'l'}`;
          acc[k] = acc[k] || [0, 0, 0, 0, 0, 0]; acc[k][0] += mp.pr[c] * 24; acc[k][1] += mp.lh[c] / 2.5e6 * 86400; acc[k][4] = (acc[k][4] || 0) + mp.sh[c]; acc[k][5] = (acc[k][5] || 0) + mp.tsfc[c]; acc[k][2]++; acc[k][3] += mp.cloud[c];
        }
      }
      n++;
    }
  }
  const rows = [];
  for (const la of [30, 40, 45, 50, 55, 60, 70]) {
    const l = acc[`${la}l`], s = acc[`${la}s`];
    const f = (a) => a ? `P ${(a[0] / a[2]).toFixed(1)} E ${(a[1] / a[2]).toFixed(1)} cl ${(a[3] / a[2]).toFixed(2)} SH ${(a[4] / a[2]).toFixed(0)} Ts ${(a[5] / a[2]).toFixed(1)}` : '-';
    rows.push(`${la}°: ląd ${f(l)} | morze ${f(s)}`);
  }
  log(`doy ${doy} seed ${seed} środek kanału: opad ${(cprS / cn * 24).toFixed(2)} mm/d [mm/d]\n  ` + rows.join('\n  '));
  m.destroy();
}
