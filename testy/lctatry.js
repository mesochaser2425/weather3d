// scenariusz Tatry z pokryciem z WorldCover: kilka godzin bez błędów, statystyka T2 nad lasem i polem
for (let i = 0; i < 60 && !window.__lcStats; i++) await new Promise((r) => setTimeout(r, 500));
sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600;
await sim.run(Math.round(6 * 3600 / dt));
const T2 = sim.sfcGrid('T2').v; let s = 0, bad = 0; for (const v of T2) { if (!isFinite(v)) bad++; else s += v; }
log(`pokrycie ${JSON.stringify(window.__lcStats)}; po 6 h T2 śr. ${(s / T2.length).toFixed(1)} °C, NaN ${bad}`);
