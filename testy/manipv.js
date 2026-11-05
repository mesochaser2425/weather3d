// Manipulacja atmosfery, zmienność pogody: statystyki samego modelu synoptycznego (ciśnienie i T nad domeną, niże na mapie). Adres z &vrf=, np. ?dx=8000&nx=40&ny=40&start=52,19,0&vrf=1.5
while (!sim.ready()) await new Promise((r) => setTimeout(r, 300));
sim.stop();
await sim.roll(+(window.SEED || 3));
while (!sim.ready()) await new Promise((r) => setTimeout(r, 300));
sim.stop();
const s = await sim.peStats(40), m = sim.manip(), ts = s.tDaySeries, tm = ts.reduce((a, b) => a + b, 0) / ts.length;
log(JSON.stringify({ V: m.V.to, forcV: m.forcV, pMean: s.pMean, pSd: s.pSd, pMin: s.pMin, pMax: s.pMax, dp24: s.dp24, mapMinMean: s.mapMinMean, mapMin: s.mapMin, area990: s.area990, area1000: s.area1000, tMean: s.tDayMean, tSd: +Math.sqrt(ts.reduce((a, b) => a + (b - tm) ** 2, 0) / ts.length).toFixed(1), tMin: Math.min(...ts), tMax: Math.max(...ts), prDay: s.prDay }));
