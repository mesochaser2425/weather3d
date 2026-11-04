// klik w miasto → stacja; klasy na dużej mapie
sim.stop();
await sim.dem(window.__lat || 52.0, window.__lon || 19.3, 1.0, 0.9);
sim.stop();
for (let n = 0; n < 40 && !document.querySelector('.city'); n++) await new Promise((r) => setTimeout(r, 250));
const q = (k) => [...document.querySelectorAll(`.city.c${k} span`)].map((e) => e.firstChild.textContent);
log(`duże ${q(2).length}: ${q(2).join(', ')}`);
log(`średnie ${q(1).length}: ${q(1).slice(0, 20).join(', ')} | małe ${q(0).length}`);
const n0 = sim.stations().exportList().length;
document.querySelector('.city.c2 i').dispatchEvent(new MouseEvent('click', { bubbles: true }));
const L = sim.stations().exportList();
log(`stacje: ${n0} → ${L.length}, ostatnia: ${JSON.stringify(L[L.length - 1])}`);
