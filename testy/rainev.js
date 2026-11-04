// Największe zdarzenia opadowe w domenie: co godzinę pole opadu; dla każdej doby oczko z największą sumą, udział konwekcji schematu; dla największego zdarzenia przebieg godzinowy w tym oczku,
// położenie maksimum opadu w promieniu ~40 km (czy rdzeń stoi w miejscu), wiatr przy gruncie i CAPE, wysokość terenu. Parametry: tp=data,ziarno,doby,szer,dł. "?dx=5000&nx=64&ny=64&tp=…", BLOCK_OM=1.
sim.stop();
const P = (new URLSearchParams(location.search).get('tp') || '2027-06-01,1,20,50,20').split(',');
sim.set('date', P[0]);
await sim.place(+P[3], +P[4]);
sim.stop(); await sim.roll(+P[1]); sim.stop();
const a = await sim.run(1), b = await sim.run(1), dt = (b.simHours - a.simHours) * 3600, nH = Math.round(3600 / dt);
const H = sim.hgt(), g0 = sim.sfcGrid('PR'), nx = g0.nx, ny = g0.ny, dx = g0.dx / 1000, N = nx * ny;
const R = 2 + Math.round(40 / dx);
const hist = [];  // godzinowo: PR (mm/h), PRCU, CAPE, UA, VA wybranych pól
const days = +P[2], t0 = performance.now();
let day = new Float32Array(N), dayC = new Float32Array(N), events = [], buf = [];
for (let h = 0; h < days * 24; h++) {
  await sim.run(nH);
  const pr = sim.sfcGrid('PR').v, pc = sim.sfcGrid('PRCUS').v, ca = sim.sfcGrid('CAPE').v, ua = sim.sfcGrid('UA').v, va = sim.sfcGrid('VA').v;
  for (let k = 0; k < N; k++) { day[k] += pr[k]; dayC[k] += Math.min(pc[k], pr[k]); }
  buf.push({ h, pr: Float32Array.from(pr), pc: Float32Array.from(pc), ca: Float32Array.from(ca), ua: Float32Array.from(ua), va: Float32Array.from(va) });
  if (buf.length > 48) buf.shift();
  if ((h + 1) % 24 === 0) {
    let kx = 0; for (let k = 0; k < N; k++) if (day[k] > day[kx]) kx = k;
    let area = 0; for (let k = 0; k < N; k++) if (day[k] >= 50) area++;
    const e = { d: Math.floor(h / 24) + 1, mm: +day[kx].toFixed(1), conv: +(100 * dayC[kx] / Math.max(day[kx], 0.01)).toFixed(0), i: kx % nx, j: Math.floor(kx / nx), hgt: Math.round(H[kx]), n50: area };
    events.push(e);
    if (!window.__top || e.mm > window.__top.e.mm) {
      // przebieg godzinowy: opad w oczku, konwekcja schematu, położenie maksimum w promieniu R, wiatr i CAPE w oczku
      const hrs = buf.slice(-24).map((B) => {
        let best = -1, bi = 0, bj = 0;
        for (let jj = Math.max(0, e.j - R); jj < Math.min(ny, e.j + R + 1); jj++) for (let ii = Math.max(0, e.i - R); ii < Math.min(nx, e.i + R + 1); ii++) { const v = B.pr[jj * nx + ii]; if (v > best) { best = v; bi = ii; bj = jj; } }
        const c = e.j * nx + e.i;
        return `${(B.h % 24)}h: ${B.pr[c].toFixed(1)} (schem. ${B.pc[c].toFixed(1)}) maks ${best.toFixed(1)} @${bi - e.i},${bj - e.j} V ${Math.hypot(B.ua[c], B.va[c]).toFixed(1)} CAPE ${B.ca[c].toFixed(0)}`;
      });
      window.__top = { e, hrs };
    }
    day = new Float32Array(N); dayC = new Float32Array(N);
  }
}
log(`czas ${((performance.now() - t0) / 1000).toFixed(0)} s; oczko ${dx} km`);
log('doby: ' + events.map((e) => `${e.d}:${e.mm}(${e.conv}%,${e.i},${e.j},h${e.hgt},n50=${e.n50})`).join(' '));
const T = window.__top;
log('NAJWIĘKSZE: ' + JSON.stringify(T.e));
for (const s of T.hrs) log(s);
const hs = []; for (let k = 0; k < N; k += 1) hs.push(H[k]);
const fr = (th) => (100 * events.filter((e) => e.mm >= th).length / events.length).toFixed(0);
log(`doby z maksimum ≥ 50 / 100 / 150 mm: ${fr(50)} / ${fr(100)} / ${fr(150)}%`);
