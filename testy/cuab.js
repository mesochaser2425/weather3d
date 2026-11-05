// A/B: ten sam stan pogody, wzór cumulusów z przesunięciami jak po pełnym okresie pokolenia w MAX (Te z parametru), satelita
sim.stop();
const Q = new URLSearchParams(location.search), seed = +(Q.get('sd') || 1), T = +(Q.get('t') || 33), Te = +(Q.get('te') || 20000), ph = +(Q.get('ph') || 0.45);
await sim.roll(seed); sim.stop();
await sim.run(T * 60);
sim.set('fieldH', '29');
sim.go(); await new Promise((r) => setTimeout(r, 1500)); sim.stop();   // kafle wiatru (cuWind) z bieżących pól
const c = sim.cu();
let dmax = 0;
for (let t = 0; t < c.nx * c.ny; t++) dmax = Math.max(dmax, Math.hypot(c.U[2 * t] - c.U2[2 * t], c.U[2 * t + 1] - c.U2[2 * t + 1]));
log('kafle', c.nx, c.ny, 'gmax', (c.gmax * 1e5).toFixed(2), 'max |U-U2|', dmax.toFixed(1), 'm/s', 'D-D2 po Te', (dmax * Te / 1000).toFixed(0), 'km');
for (let t = 0; t < c.nx * c.ny; t++) for (let g = 0; g < 2; g++) {
  c.D[4 * t + 2 * g] = c.U[2 * t] * Te * 0.9; c.D[4 * t + 2 * g + 1] = c.U[2 * t + 1] * Te * 0.9;
  c.D2[4 * t + 2 * g] = c.U2[2 * t] * Te * 0.9; c.D2[4 * t + 2 * g + 1] = c.U2[2 * t + 1] * Te * 0.9;
}
await sim.draw(); await new Promise((r) => setTimeout(r, 500));
await window.shot('sat');
