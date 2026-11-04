// Szukanie frontów w samym modelu synoptycznym: dla kilku losowań i dat co 3 h największy gradient T ~1.5 km w promieniu ~300 km
// od środka domeny [K/100 km]; wypisuje najsilniejsze epizody (godzina, gradient, położenie, T w środku i jej zmiana w 12 h).
// Parametry: window.__dates, __seeds, __days
sim.stop();
for (const date of (window.__dates || ['2026-10-20', '2027-04-10'])) {
  sim.set('date', date);
  for (const seed of (window.__seeds || [1, 2, 3, 4, 5, 6])) {
    await sim.roll(seed);
    const f = await sim.peFronts(window.__days || 6, 3, 4);
    const top = [...f].sort((a, b) => b.g - a.g).slice(0, 3);
    const d12 = (h) => { const n = f.findIndex((x) => x.h === h); return n >= 4 ? (f[n].t15 - f[n - 4].t15).toFixed(1) : '–'; };
    log(`${date} seed ${seed}: maks. gradient ${top.map((x) => `${x.g} K/100km (h=${x.h}, ${x.x}/${x.y} km, T ${x.t15}, zmiana 12 h ${d12(x.h)})`).join(' | ')}`);
  }
}
