// klimat modelu PE z promieniowaniem: średnie strefowe vs klimat, bilans promieniowania
const pe = await import('/src/pe.js');
const cl = await import('/src/climate.js');
const ad = await navigator.gpu.requestAdapter();
const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize, maxBufferSize: ad.limits.maxBufferSize } });
const days = window.__days || 30;
for (const doy of (window.__doys || [15, 196])) {
  const m = await pe.PEModel.create(dev, { lat: 50, cont: 1.1, hum: 0.75, doy, seed: 2 });
  await m.spinup(10);
  const acc = {};
  let n = 0;
  for (let d = 0; d < days; d++) {
    for (let s = 0; s < 48; s++) m.step();
    if (d >= days - 10) {
      const mp = await m.readMap(); n++;
      for (const j of [8, 24, 40, 48, 56, 72, 88]) {
        const r = acc[j] ??= { ts: 0, tl: 0, t15: 0, t5: 0, olr: 0, asr: 0, cl: 0, pr: 0, nl: 0, sw: 0, lw: 0, sh: 0, lh: 0 };
        for (let i = 0; i < pe.NXP; i++) {
          const c = j * pe.NXP + i;
          r.ts += mp.ts[c] / pe.NXP; r.t15 += mp.t15[c] / pe.NXP; r.t5 += mp.t5[c] / pe.NXP; r.olr += mp.olr[c] / pe.NXP; r.asr += mp.asr[c] / pe.NXP; r.cl += mp.cloud[c] / pe.NXP; r.pr += 24 * mp.pr[c] / pe.NXP;
          if (m.sea[c] < 0.5) { r.tl += mp.tsfc[c]; r.nl++; r.sw += mp.swSfc[c]; r.lw += mp.lwNet[c]; r.sh += mp.sh[c]; r.lh += mp.lh[c]; }
        }
      }
    }
  }
  const out = [];
  for (const [j, r] of Object.entries(acc)) {
    const la = m.lat + ((+j + 0.5) * pe.DXP - pe.LYP / 2) / 111.2e3;
    const doyE = doy + days - 5;
    out.push(`${la.toFixed(0)}°: T2 ${(r.ts / n).toFixed(1)} (clim ${cl.climate(la, doyE, 1.1).tDay.toFixed(1)}) Tland ${(r.tl / Math.max(r.nl, 1)).toFixed(1)} T850 ${(r.t15 / n).toFixed(1)} T500 ${(r.t5 / n).toFixed(1)} OLR ${(r.olr / n).toFixed(0)} ASR ${(r.asr / n).toFixed(0)} cl ${(r.cl / n).toFixed(2)} pr ${(r.pr / n).toFixed(1)} | ląd: SW ${(r.sw / r.nl).toFixed(0)} LWnet ${(r.lw / r.nl).toFixed(0)} SH ${(r.sh / r.nl).toFixed(0)} LH ${(r.lh / r.nl).toFixed(0)}`);
  }
  log('doy', doy, '+', days, 'd\n  ' + out.join('\n  '));
  m.destroy();
}
