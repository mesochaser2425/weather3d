// stabilność modelu synoptycznego: 60 dób (lato i zima), sprawdzenie NaN i zakresu ciśnienia/temperatury w środku
const pe = await import('/src/pe.js');
const geoM = await import('/src/geo.js');
const w = await geoM.worldDem();
const geo = { lon: 19.94, elev: (la, lo) => geoM.worldElev(w, la, lo) };
const ad = await navigator.gpu.requestAdapter();
const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize, maxBufferSize: ad.limits.maxBufferSize } });
const out = [];
for (const doy of [15, 196]) {
  const m = await pe.PEModel.create(dev, { lat: 50.06, cont: 1.0, hum: 0.75, doy, seed: 2, geo });
  await m.spinup(10);
  let bad = false, pmin = 1e9, pmax = -1e9, tmin = 1e9, tmax = -1e9;
  for (let d = 0; d < 60; d++) {
    for (let s = 0; s < 192; s++) m.step();
    const c = await m.readCenter();
    if (!isFinite(c.psl) || !isFinite(c.tDay)) { bad = true; out.push(`doy ${doy}: NaN w dobie ${d}`); break; }
    pmin = Math.min(pmin, c.psl); pmax = Math.max(pmax, c.psl); tmin = Math.min(tmin, c.tDay); tmax = Math.max(tmax, c.tDay);
  }
  if (!bad) out.push(`doy ${doy}: OK, p ${pmin.toFixed(0)}–${pmax.toFixed(0)} hPa, T dobowa ${tmin.toFixed(1)}–${tmax.toFixed(1)}`);
  m.destroy();
}
log(out.join(' | '));
