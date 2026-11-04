// miejscowości (GeoNames) na mapie: liczby w klasach (z DOM), nazwy dużych
sim.stop();
await sim.dem(window.__lat || 49.25, window.__lon || 20.0, 1.0, 0.9);
sim.stop();
for (let n = 0; n < 40 && !document.querySelector('.city'); n++) await new Promise((r) => setTimeout(r, 250));
const q = (k) => [...document.querySelectorAll(`.city.c${k} span`)].map((e) => e.firstChild.textContent);
log(`duże ${q(2).length}: ${q(2).join(', ')}`);
log(`średnie ${q(1).length}: ${q(1).slice(0, 15).join(', ')} | małe ${q(0).length}`);
