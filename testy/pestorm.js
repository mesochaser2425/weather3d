// niże modelu synoptycznego zimą (60 dób, 2 losowania): ciśnienie w środku, najgłębsze niże na mapie, zmienność
sim.stop(); sim.set('date', '2026-12-01');
await sim.dem(49.25, 20.0, 1.0, 0.9);
for (const sd of [1, 2]) { sim.stop(); await sim.roll(sd); sim.stop(); const s = await sim.peStats(60);
  log(`seed ${sd}: p śr. ${s.pMean} sd ${s.pSd} min ${s.pMin} | dp24 ${s.dp24} | najgłębszy niż śr. ${s.mapMinMean} min ${s.mapMin} | obszar <990 ${s.area990}% <1000 ${s.area1000}% | T dobowa ${s.tDayMean} | opad ${s.prDay} mm/d`); }
