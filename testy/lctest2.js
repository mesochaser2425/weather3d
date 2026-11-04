window.__lcDebug = [];
sim.stop();
await sim.dem(50.06, 19.94, 1.0, 0.75);
log(JSON.stringify(window.__lcStats) + '\n' + window.__lcDebug.map((d) => `${d.name} W=${d.W} poziomów ${d.n}: ${JSON.stringify(d.hs)}`).join('\n'));
