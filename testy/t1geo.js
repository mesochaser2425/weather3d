// środek kanału z prawdziwym rozkładem lądu i morza (mapa świata) – Kraków; średnie po 30 dobach
const g = await import('/src/grid.js');
const pe = await import('/src/pe.js');
const geoM = await import('/src/geo.js');
const w = await geoM.worldDem();
const geo = { lon: 19.94, elev: (la, lo) => geoM.worldElev(w, la, lo) };
const ad = await navigator.gpu.requestAdapter();
const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize, maxBufferSize: ad.limits.maxBufferSize } });
for (const doy of (window.__doys || [15, 105, 196, 288])) {
  const res = [];
  for (const seed of [1, 2]) {
    const m = await pe.PEModel.create(dev, { lat: 50.06, cont: 1.0, hum: 0.75, doy, seed, geo });
    await m.spinup(10);
    let n = 0, td = 0, t850 = 0, t500 = 0, pr = 0, tdp = 0, cape = 0;
    for (let s = 0; s < 30 * 48; s++) {
      m.step();
      if (s % 12 === 11) { const c = await m.readCenter(); const snd = g.makeSounding(c.air); const ix = g.soundingIndices(snd);
        td += c.tDay; t850 += snd.T(1500) - 273.15; t500 += snd.T(5600) - 273.15; pr += c.pr * 24; tdp += ix.tdSfc; cape += ix.cape; n++; }
    }
    m.destroy();
    res.push(`s${seed}: Tśr ${(td / n).toFixed(1)} Td ${(tdp / n).toFixed(1)} T850 ${(t850 / n).toFixed(1)} T500 ${(t500 / n).toFixed(1)} opad ${(pr / n).toFixed(1)} mm/d CAPE ${(cape / n).toFixed(0)}`);
  }
  log(`doy ${doy}+10…40: ` + res.join(' | '));
}
