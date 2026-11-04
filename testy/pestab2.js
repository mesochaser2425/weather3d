const pe = await import('/src/pe.js');
const geoM = await import('/src/geo.js');
const w = await geoM.worldDem();
const geo = { lon: 19.94, elev: (la, lo) => geoM.worldElev(w, la, lo) };
const ad = await navigator.gpu.requestAdapter();
const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize, maxBufferSize: ad.limits.maxBufferSize } });
const m = await pe.PEModel.create(dev, { lat: 50.06, cont: 1.0, hum: 0.75, doy: 196, seed: 2, geo });
await m.spinup(10);
const ser = [];
for (let d = 0; d < 60; d++) { for (let s = 0; s < 192; s++) m.step(); const c = await m.readCenter(); ser.push(c.tDay.toFixed(0)); }
log(ser.join(' '));
