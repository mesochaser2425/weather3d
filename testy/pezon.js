// model synoptyczny (prawdziwa mapa, Kraków), lipiec: T przy gruncie wg szerokości (ląd / morze) vs normy klimatu (tNorm), T850
const pe = await import('/src/pe.js');
const geoM = await import('/src/geo.js');
const w = await geoM.worldDem();
const geo = { lon: 19.94, elev: (la, lo) => geoM.worldElev(w, la, lo) };
const ad = await navigator.gpu.requestAdapter();
const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize, maxBufferSize: ad.limits.maxBufferSize } });
const { NXP, NYP } = pe;
const doy = window.__doy || 196;
const acc = Array.from({ length: NYP }, () => [0, 0, 0, 0, 0, 0]);
let tn = null;
for (const seed of (window.__seedsR || [1, 2])) {
  const m = await pe.PEModel.create(dev, { lat: 50.06, cont: 1.0, hum: 0.75, doy, seed, geo });
  await m.spinup(10);
  tn = m.tNorm;
  for (let s = 0; s < 20 * 48; s++) {
    m.step();
    if (s % 12 === 11) {
      const mp = await m.readMap();
      for (let j = 0; j < NYP; j++) for (let i = 0; i < NXP; i++) {
        const c = j * NXP + i, land = geo.elev(50.06 + ((j + 0.5) * 75e3 - NYP * 75e3 / 2) / 111.2e3, 19.94 + ((i + 0.5) * 75e3 - NXP * 75e3 / 2) / (111.2e3 * Math.cos(50 * Math.PI / 180))) > 0;
        const a = acc[j]; if (land) { a[0] += mp.ts[c]; a[1]++; } else { a[2] += mp.ts[c]; a[3]++; } a[4] += mp.t15[c]; a[5]++;
      }
    }
  }
  m.destroy();
}
const rows = [];
for (let j = 4; j < NYP - 4; j += 6) {
  const la = 50.06 + ((j + 0.5) * 75e3 - NYP * 75e3 / 2) / 111.2e3, a = acc[j];
  rows.push(`${la.toFixed(0)}°: ląd ${a[1] ? (a[0] / a[1]).toFixed(1) : '–'} morze ${a[3] ? (a[2] / a[3]).toFixed(1) : '–'} | norma ${(tn[j] - 273.15).toFixed(1)} | T~1.5km ${(a[4] / a[5]).toFixed(1)}`);
}
log('\n' + rows.join('\n'));
