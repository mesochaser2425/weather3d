// Kolory drzew: satelita jesienią i typy lasu wg wysokości. ?dx=8000&nx=40&ny=40&start=49.3,20,9, BLOCK_OM=1, SHOT=plik.png. ~1 min.
while (!sim.ready()) await new Promise((r) => setTimeout(r, 300));
sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600, days = +(new URLSearchParams(location.search).get('dn') || 18);
await sim.run(Math.round(days * 86400 / dt));
sim.set('fieldH', 29);
const g = sim.sfcGrid('GRN'), H = sim.hgt(), L = sim.landGrid(), mean = (v) => v.reduce((x, y) => x + y, 0) / Math.max(v.length, 1);
log(JSON.stringify({ doby: days, 'zielen lasu': +mean(g.v.filter((_, i) => L[i] === 1)).toFixed(2), 'zegar': document.getElementById('clockDate').textContent }));
await sim.draw();
await new Promise((r) => setTimeout(r, 500));
