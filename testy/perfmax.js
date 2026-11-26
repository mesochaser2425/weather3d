// Pętla klatek trybu lekkiego (albo zwykłego) w MAX lub tempie z adresu (&spd=): tempo, czasy klatek (własna pętla rAF), a w wersjach
// z __sim.perfLog – kroki, budżet i koszty z pomiaru. Uruchomienie: PORT=… BLOCK_OM=1 node runm.mjs "?start=52,19,5&lite=1&dx=7500&nx=120&ny=120&spd=max" perfmax.js
const q = new URLSearchParams(location.search);
await sim.ready();
const st = () => sim.t().simHours * 3600;
while (!(st() > 0)) await new Promise((r) => setTimeout(r, 200));      // start (rozbieg, kopia korekty) skończony, symulacja idzie
const spds = (q.get('spd') || 'max').split(',');
sim.set('speed', spds[0]);
sim.set('fieldH', q.get('fld') || '20');
const win = async (sec, label) => {
  if (sim.perfLog) sim.perfLog(true);
  const a = st(), w0 = performance.now(), dts = [];
  let last = w0;
  await new Promise((res) => { const f = (now) => { dts.push(now - last); last = now; if (now - w0 < sec * 1000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  const el = (performance.now() - w0) / 1000, b = st();
  dts.sort((x, y) => x - y);
  const qq = (p) => dts[Math.floor(p * (dts.length - 1))].toFixed(0);
  let s = `${label}: tempo ${((b - a) / el).toFixed(0)}x | ${(dts.length / el).toFixed(1)} kl./s, klatka p50 ${qq(0.5)} p95 ${qq(0.95)} maks ${qq(1)} ms`;
  const L = sim.perfLog ? sim.perfLog(false) : null;
  if (L && L.length) {
    const avg = (f) => L.reduce((t, x) => t + f(x), 0) / L.length, last = L[L.length - 1];
    s += ` | kroki/kl. ${avg((x) => x.n).toFixed(2)} (cap ${avg((x) => x.cap).toFixed(1)}), klatek bez krokow ${L.filter((x) => !x.n).length}, lag ${L.filter((x) => x.lag).length}`
      + ` | GPU plan ${avg((x) => x.u1).toFixed(1)} + kopie ${avg((x) => x.u2 - x.u1).toFixed(1)} ms, CPU ${avg((x) => x.cpu).toFixed(1)} ms (maks ${Math.max(...L.map((x) => x.cpu)).toFixed(0)})`
      + ` | kroki 450 s/kl.: glowny ${avg((x) => x.main).toFixed(2)}, korekta ${avg((x) => x.cc).toFixed(2)}, prognoza ${avg((x) => x.fc).toFixed(2)}`
      + ` | koszt: krok domeny ${last.dom.toFixed(2)}, krok modelu ${last.pe.toFixed(2)}, termin ${last.term.toFixed(2)}, obraz ${last.rend.toFixed(2)}, krok lacznie ${last.cs.toFixed(2)} ms; nadrabia ${last.cb}, prognoza wstrzymana ${last.st}`;
  }
  log(s);
};
// kilka temp (&spd=20000,50000,max) – po 12 s każde, inaczej trzy okna jednego tempa
if (spds.length > 1) for (const s of spds) { sim.set('speed', s); await new Promise((r) => setTimeout(r, 1500)); await win(12, s); }
else { await win(10, '0-10 s'); await win(15, '10-25 s'); await win(15, '25-40 s'); }
