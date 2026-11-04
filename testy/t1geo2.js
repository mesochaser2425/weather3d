// opad w okolicy środka kanału (prawdziwa mapa, Kraków): wielkoskalowy vs konwekcyjny, zachmurzenie, ewaporacja lądu
const pe = await import('/src/pe.js');
const geoM = await import('/src/geo.js');
const w = await geoM.worldDem();
const geo = { lon: 19.94, elev: (la, lo) => geoM.worldElev(w, la, lo) };
const ad = await navigator.gpu.requestAdapter();
const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize, maxBufferSize: ad.limits.maxBufferSize } });
const { NXP, NYP } = pe;
for (const doy of (window.__doys || [196])) {
  for (const seed of [1, 2]) {
    const m = await pe.PEModel.create(dev, { lat: 50.06, cont: 1.0, hum: 0.75, doy, seed, geo });
    await m.spinup(10);
    let pr = 0, prc = 0, cl = 0, lh = 0, sh = 0, n = 0, sea = 0;
    const i0 = NXP / 2, j0 = NYP / 2;
    for (let d = 0; d < 20; d++) {
      for (let s = 0; s < 48; s++) m.step();
      const mp = await m.readMap();
      for (let dj = -2; dj <= 2; dj++) for (let di = -3; di <= 3; di++) { const c = (j0 + dj) * NXP + i0 + di; pr += mp.pr[c] * 24; prc += mp.prc[c] * 24; cl += mp.cloud[c]; lh += mp.lh[c]; sh += mp.sh[c]; sea += m.sea[c]; n++; }
    }
    log(`doy ${doy} s${seed} (okolica ~500 km, morze ${(100 * sea / n).toFixed(0)}%): opad ${(pr / n).toFixed(1)} mm/d, w tym konwekcyjny ${(prc / n).toFixed(1)}, chmury ${(cl / n).toFixed(2)}, LH ${(lh / n).toFixed(0)} SH ${(sh / n).toFixed(0)} W/m²`);
    m.destroy();
  }
}
