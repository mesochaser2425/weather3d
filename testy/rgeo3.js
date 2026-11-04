// odporna statystyka: 4 losowania × 30 dób, prawdziwa mapa (Kraków), region ±4 oczka (~600 km), próbki co 3 h
const pe = await import('/src/pe.js');
const geoM = await import('/src/geo.js');
const w = await geoM.worldDem();
const geo = { lon: 19.94, elev: (la, lo) => geoM.worldElev(w, la, lo) };
const ad = await navigator.gpu.requestAdapter();
const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize, maxBufferSize: ad.limits.maxBufferSize } });
const { NXP, NYP } = pe;
const out = [];
for (const doy of (window.__doys || [15, 105, 196, 288])) {
  let pr = 0, prc = 0, ts = 0, cl = 0, n = 0, tdS = 0, nd = 0, asr = 0, olr = 0, sh = 0, lh = 0, sw = 0, lw = 0, t85 = 0;
  for (const seed of (window.__seedsR || [1, 2, 3, 4])) {
    const m = await pe.PEModel.create(dev, { lat: 50.06, cont: 1.0, hum: 0.75, doy, seed, geo });
    await m.spinup(10);
    for (let s = 0; s < 30 * 48; s++) {
      m.step();
      if (s % 6 === 5) {
        const mp = await m.readMap();
        for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) { const c = (NYP / 2 + dj) * NXP + NXP / 2 + di; pr += mp.pr[c] * 24; prc += mp.prc[c] * 24; ts += mp.ts[c]; cl += mp.cloud[c]; asr += mp.asr[c]; olr += mp.olr[c]; sh += mp.sh[c]; lh += mp.lh[c]; sw += mp.swSfc[c]; lw += mp.lwNet[c]; t85 += mp.t15[c]; n++; }
      }
      if (s % 48 === 47) { const c = await m.readCenter(); tdS += c.tDay; nd++; }
    }
    m.destroy();
  }
  out.push(`doy ${doy}: opad ${(pr / n).toFixed(2)} mm/d (konw. ${(prc / n).toFixed(2)}), T2 regionu ${(ts / n).toFixed(1)}, Tśr środka ${(tdS / nd).toFixed(1)}, chmury ${(cl / n).toFixed(2)} | ASR ${(asr / n).toFixed(0)} OLR ${(olr / n).toFixed(0)} SWsfc ${(sw / n).toFixed(0)} LWnet ${(lw / n).toFixed(0)} SH ${(sh / n).toFixed(0)} LH ${(lh / n).toFixed(0)} T850 ${(t85 / n).toFixed(1)}`);
}
log('\n' + out.join('\n'));
