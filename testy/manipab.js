// Manipulacja atmosfery, A/B przy tej samej pogodzie: pole docelowe T po zmianie suwaka w trakcie przebiegu. ?dx=8000&nx=40&ny=40&start=52,19,6&ab=4 (bez ab – odniesienie). Kick-in 1 doba.
while (!sim.ready()) await new Promise((r) => setTimeout(r, 300));
sim.stop();
await sim.roll(5);
while (!sim.ready()) await new Promise((r) => setTimeout(r, 300));
sim.stop();
const ab = +(new URLSearchParams(location.search).get('ab') || 0);
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600, n = (h) => Math.round(h * 3600 / dt);
const mean = (v) => v.reduce((x, y) => x + y, 0) / v.length;
const row = async () => { const r = await sim.rowk(20, 12); return { Tt: +mean(r.Tt).toFixed(2), T: +mean(r.T).toFixed(2) }; };
await sim.run(n(24) - 2);
const t0 = await row();
if (ab) { document.getElementById('manipRamp').value = '1'; const e = document.getElementById('tanom'); e.value = ab; e.dispatchEvent(new Event('input', { bubbles: true })); }
await sim.run(n(12));
const t1 = await row();
await sim.run(n(24));
const t2 = await row();
log(JSON.stringify({ ab, start: t0, 'po 12 h': t1, 'po 36 h': t2 }));
