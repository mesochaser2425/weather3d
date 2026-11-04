// Wykres profilu pionowego (średnia z domeny albo sonda w punkcie): T i Td, sondaż startowy (przerywane),
// cząstka, wiatr (chorągiewki), zachmurzenie; meteogram sondy.

export function drawProfile(canvas, d) {
  // d: { z: [], T: [], Td: [], T0: [], Td0: [], cloud: [] (0..1), top: m }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = W / dpr, h = H / dpr;
  g.clearRect(0, 0, w, h);
  const L = 34, R = 46, T = 8, B = 22;                  // marginesy; po prawej pasek zachmurzenia
  const pw = w - L - R, ph = h - T - B;

  const idx = d.z.map((z, k) => k).filter((k) => d.z[k] <= d.top);
  if (!idx.length) return;
  const arrs = [d.T, d.Td, d.T0, d.Td0, d.parcel].filter(Boolean);
  let lo = Infinity, hi = -Infinity;
  for (const k of idx) {
    for (const a of arrs) { const v = a[k]; if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
  }
  if (d.xmin !== undefined) lo = Math.max(lo, d.xmin);
  const step = hi - lo > 40 ? 10 : 5;
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const X = (v) => L + (v - lo) / (hi - lo) * pw;
  const Y = (z) => T + ph * (1 - z / d.top);

  g.font = '10px system-ui, sans-serif';
  g.fillStyle = '#8b94a3';
  g.strokeStyle = '#2c313b';
  g.lineWidth = 1;
  // siatka: temperatura
  for (let v = lo; v <= hi + 1e-6; v += step) {
    g.beginPath(); g.moveTo(X(v), T); g.lineTo(X(v), T + ph); g.stroke();
    g.textAlign = 'center'; g.fillText(`${v}`, X(v), h - 8);
  }
  // siatka: wysokość
  const zs = d.top > 8000 ? 2000 : 1000;
  for (let z = 0; z <= d.top + 1; z += zs) {
    g.beginPath(); g.moveTo(L, Y(z)); g.lineTo(L + pw, Y(z)); g.stroke();
    g.textAlign = 'right'; g.fillText(`${z / 1000}`, L - 4, Y(z) + 3);
  }
  g.textAlign = 'left';
  g.fillText('km', 4, T + 8);
  g.textAlign = 'center';
  g.fillText('°C', L + pw / 2, h - 0);

  // zachmurzenie (pasek po prawej)
  const cx0 = L + pw + 8, cw = R - 12;
  if (!d.cloud) d.cloud = d.z.map(() => 0);
  g.strokeStyle = '#2c313b';
  g.strokeRect(cx0, T, cw, ph);
  g.fillStyle = 'rgba(235,240,248,0.85)';
  for (let n = 0; n < idx.length; n++) {
    const k = idx[n];
    const z0 = n > 0 ? 0.5 * (d.z[idx[n - 1]] + d.z[k]) : 0;
    const z1 = n < idx.length - 1 ? 0.5 * (d.z[k] + d.z[idx[n + 1]]) : d.top;
    const f = Math.min(1, d.cloud[k]);
    if (f > 0.001) g.fillRect(cx0, Y(z1), cw * Math.max(f, 0.04), Y(z0) - Y(z1));
  }
  g.fillStyle = '#8b94a3';
  g.textAlign = 'center';
  g.fillText('clouds', cx0 + cw / 2, h - 8);

  const line = (arr, color, dash, width) => {
    g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash);
    g.beginPath();
    let first = true;
    for (const k of idx) {
      if (!isFinite(arr[k])) continue;
      const x = X(arr[k]), y = Y(d.z[k]);
      if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y);
    }
    g.stroke();
    g.setLineDash([]);
  };
  g.save();
  g.beginPath(); g.rect(L, T, pw, ph); g.clip();            // linie tylko w obszarze wykresu
  if (d.T0) line(d.T0, 'rgba(255,120,110,0.55)', [4, 4], 1.2);
  if (d.Td0) line(d.Td0, 'rgba(110,210,130,0.55)', [4, 4], 1.2);
  if (d.parcel) line(d.parcel, 'rgba(230,230,240,0.75)', [2, 3], 1.4);
  line(d.Td, '#5fd17a', [], 2);
  line(d.T, '#ff6b5e', [], 2);
  g.restore();

  // grunt pod sondą
  if (d.ground > 0) {
    g.fillStyle = 'rgba(120,95,70,0.55)';
    g.fillRect(L, Y(Math.min(d.ground, d.top)), pw, T + ph - Y(Math.min(d.ground, d.top)));
  }
  // wiatr: chorągiewki co ~1 km (węzły: pół kreski 5, kreska 10, trójkąt 50), przy prawej krawędzi
  if (d.wind) {
    let nextZ = -1;
    g.strokeStyle = '#c9d1dc'; g.fillStyle = '#c9d1dc'; g.lineWidth = 1.2;
    const dzb = d.top > 8000 ? 1000 : 500;
    for (const k of idx) {
      if (!d.wind[k] || d.z[k] < nextZ) continue;
      nextZ = (Math.floor(d.z[k] / dzb) + 1) * dzb;
      barb(g, L + pw - 16, Y(d.z[k]), d.wind[k][0], d.wind[k][1]);
    }
  }

  if (d.hodo && d.hodo.pts.length > 2) hodograph(g, L + pw - 150, T + 22, 112, d.hodo);

  // legenda
  g.font = '10px system-ui, sans-serif';
  g.textAlign = 'left';
  g.fillStyle = '#ff6b5e'; g.fillText('T', L + 6, T + 12);
  g.fillStyle = '#5fd17a'; g.fillText('Td', L + 18, T + 12);
  g.fillStyle = '#8b94a3'; g.fillText(d.parcel ? `··· ${d.parcelLabel || 'afternoon parcel'}` : '- - start', L + 36, T + 12);
}

// Hodograf (wstawka): koniec wektora wiatru na kolejnych wysokościach; 0–1 km fioletowo, 1–3 czerwono,
// 3–6 zielono, 6–9 żółto; pierścienie co 10 m/s; ✕ – ruch prawej superkomórki (Bunkers)
function hodograph(g, x0, y0, size, h) {
  const pts = h.pts;
  let vmax = 10;
  for (const p of pts) vmax = Math.max(vmax, Math.abs(p[0]), Math.abs(p[1]));
  vmax = Math.ceil(vmax / 10) * 10;
  const cx = x0 + size / 2, cy = y0 + size / 2, s = size / 2 / vmax;
  g.save();
  g.fillStyle = 'rgba(14,17,23,0.88)'; g.strokeStyle = '#3a4150'; g.lineWidth = 1;
  g.fillRect(x0, y0, size, size); g.strokeRect(x0, y0, size, size);
  g.beginPath(); g.rect(x0, y0, size, size); g.clip();
  g.strokeStyle = '#2c3340';
  for (let r = 10; r <= vmax; r += 10) { g.beginPath(); g.arc(cx, cy, r * s, 0, 2 * Math.PI); g.stroke(); }
  g.beginPath(); g.moveTo(x0, cy); g.lineTo(x0 + size, cy); g.moveTo(cx, y0); g.lineTo(cx, y0 + size); g.stroke();
  const col = (z) => (z < 1000 ? '#e05cff' : z < 3000 ? '#ff5a4e' : z < 6000 ? '#5fd17a' : '#e8d35a');
  g.lineWidth = 2;
  for (let n = 1; n < pts.length; n++) {
    g.strokeStyle = col(pts[n][2]);
    g.beginPath(); g.moveTo(cx + pts[n - 1][0] * s, cy - pts[n - 1][1] * s); g.lineTo(cx + pts[n][0] * s, cy - pts[n][1] * s); g.stroke();
  }
  if (h.storm) {
    const sx = cx + h.storm[0] * s, sy = cy - h.storm[1] * s;
    g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(sx - 4, sy - 4); g.lineTo(sx + 4, sy + 4); g.moveTo(sx + 4, sy - 4); g.lineTo(sx - 4, sy + 4); g.stroke();
  }
  g.restore();
  g.font = '9px system-ui, sans-serif'; g.fillStyle = '#8b94a3'; g.textAlign = 'left';
  g.fillText(`hodograph · ${vmax} m/s`, x0 + 4, y0 + size + 10);
}

// chorągiewka wiatru w (x, y): trzon w stronę, skąd wieje (u, v w m/s → węzły)
function barb(g, x, y, u, v) {
  const kt = Math.hypot(u, v) * 1.944;
  if (kt < 2.5) { g.beginPath(); g.arc(x, y, 3, 0, 2 * Math.PI); g.stroke(); return; }
  const a = Math.atan2(-v, -u);                 // kierunek „skąd”
  const len = 22, dx = Math.cos(a), dy = -Math.sin(a), px = -dy, py = dx;
  const ex = x + dx * len, ey = y + dy * len;
  g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke();
  let n = Math.round(kt / 5), pos = 0;
  const step = 4;
  while (n >= 10) {                              // trójkąt 50 kt
    const bx = ex - dx * pos, by = ey - dy * pos;
    g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + px * 9 - dx * 2, by + py * 9 - dy * 2); g.lineTo(bx - dx * step, by - dy * step); g.fill();
    pos += step + 1; n -= 10;
  }
  while (n >= 2) {
    const bx = ex - dx * pos, by = ey - dy * pos;
    g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + px * 9 + dx * 3, by + py * 9 + dy * 3); g.stroke();
    pos += step; n -= 2;
  }
  if (n === 1) {
    if (pos === 0) pos = step;
    const bx = ex - dx * pos, by = ey - dy * pos;
    g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + px * 5 + dx * 1.5, by + py * 5 + dy * 1.5); g.stroke();
  }
}

// Meteogram: pasek zachmurzenia, T 2 m i Td (°C), opad (słupki, mm/h) i ciśnienie (hPa), wiatr (m/s)
export function drawMeteogram(canvas, hist) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
  if (!W || !H) return;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = W / dpr, h = H / dpr;
  g.clearRect(0, 0, w, h);
  g.font = '10px system-ui, sans-serif';
  if (hist.length < 2) { g.fillStyle = '#8b94a3'; g.textAlign = 'center'; g.fillText('the meteogram records every 10 min of simulation time…', w / 2, h / 2); return; }
  const L = 34, R = 40, T = 6, B = 16;
  const pw = w - L - R;
  const hc = 10, h1 = (h - T - B - hc - 8) * 0.6, h2 = (h - T - B - hc - 8) * 0.4;
  const yc = T, y1 = T + hc + 4, y2 = y1 + h1 + 4;
  const t0 = hist[0].t, t1 = Math.max(hist[hist.length - 1].t, t0 + 3 * 3600);
  const X = (t) => L + (t - t0) / (t1 - t0) * pw;
  // osie czasu: północ (pełna linia) i co 6 h
  g.strokeStyle = '#2c313b'; g.lineWidth = 1; g.fillStyle = '#8b94a3'; g.textAlign = 'center';
  const hr0 = hist[0].hour, tStart = t0 - hr0 * 3600;
  for (let t = tStart; t <= t1; t += 6 * 3600) {
    if (t < t0) continue;
    const mid = Math.abs(((t - tStart) / 3600) % 24) < 0.01;
    g.strokeStyle = mid ? '#4a5262' : '#262b35';
    g.beginPath(); g.moveTo(X(t), y1); g.lineTo(X(t), y2 + h2); g.stroke();
    const hh = Math.round(((t - tStart) / 3600) % 24);
    g.fillText(mid ? '0:00' : `${hh}`, X(t), h - 4);
  }
  // zachmurzenie
  for (let n = 1; n < hist.length; n++) {
    const c = hist[n].cov, gr = Math.round(40 + 190 * c);
    g.fillStyle = c < 0.05 ? '#2a4a7a' : `rgb(${gr},${gr},${Math.min(255, gr + 10)})`;
    g.fillRect(X(hist[n - 1].t), yc, X(hist[n].t) - X(hist[n - 1].t) + 0.5, hc);
  }
  // T i Td
  let lo = Infinity, hi = -Infinity;
  for (const p of hist) { lo = Math.min(lo, p.Td2, p.T2); hi = Math.max(hi, p.T2); }
  lo = Math.floor(lo / 2) * 2 - 1; hi = Math.ceil(hi / 2) * 2 + 1;
  const Y1 = (v) => y1 + h1 * (1 - (v - lo) / (hi - lo));
  const st = hi - lo > 24 ? 10 : 5;
  g.textAlign = 'right'; g.fillStyle = '#8b94a3';
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) {
    g.strokeStyle = v === 0 ? '#5b8bd6' : '#232833';
    g.beginPath(); g.moveTo(L, Y1(v)); g.lineTo(L + pw, Y1(v)); g.stroke();
    g.fillText(`${v}°`, L - 4, Y1(v) + 3);
  }
  const line = (key, Y, color, width) => {
    g.strokeStyle = color; g.lineWidth = width; g.beginPath();
    hist.forEach((p, n) => { const x = X(p.t), y = Y(p[key]); if (n) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
  };
  line('Td2', Y1, '#5fd17a', 1.6);
  line('T2', Y1, '#ff6b5e', 2);
  // opad (słupki) i ciśnienie
  const pmax = Math.max(2, ...hist.map((p) => p.PR));
  const Y2 = (v) => y2 + h2 * (1 - v / pmax);
  for (let n = 1; n < hist.length; n++) {
    const p = hist[n];
    if (p.PR < 0.05) continue;
    g.fillStyle = p.sn > 0.5 * p.PR ? '#d9e6ff' : '#3d8bff';
    g.fillRect(X(hist[n - 1].t), Y2(p.PR), Math.max(1, X(p.t) - X(hist[n - 1].t) - 0.5), y2 + h2 - Y2(p.PR));
  }
  g.strokeStyle = '#2c313b'; g.strokeRect(L, y2, pw, h2);
  g.fillStyle = '#6fa8ff'; g.textAlign = 'right'; g.fillText(`${pmax.toFixed(pmax < 10 ? 1 : 0)}`, L - 4, y2 + 8); g.fillText('mm/h', L - 4, y2 + 18);
  let plo = Infinity, phi = -Infinity;
  for (const p of hist) { plo = Math.min(plo, p.PSL); phi = Math.max(phi, p.PSL); }
  if (phi - plo < 4) { const m = (phi + plo) / 2; plo = m - 2; phi = m + 2; }
  const Yp = (v) => y2 + 2 + (h2 - 4) * (1 - (v - plo) / (phi - plo));
  line('PSL', Yp, '#c58cff', 1.4);
  g.fillStyle = '#c58cff'; g.textAlign = 'left';
  g.fillText(`${phi.toFixed(0)}`, L + pw + 4, y2 + 8); g.fillText(`${plo.toFixed(0)} hPa`, L + pw + 4, y2 + h2);
  // wiatr (m/s) w prawej osi górnego panelu
  const wmax = Math.max(5, ...hist.map((p) => p.gust || p.ws));
  const Yw = (v) => y1 + h1 * (1 - v / wmax);
  g.setLineDash([3, 3]); line('ws', Yw, '#d8c26a', 1.2); g.setLineDash([]);
  if (hist[0].gust !== undefined) {
    g.fillStyle = 'rgba(216,194,106,0.7)';
    for (const p of hist) g.fillRect(X(p.t) - 1, Yw(p.gust) - 1, 2, 2);
  }
  g.fillStyle = '#d8c26a'; g.fillText(`${wmax.toFixed(0)} m/s`, L + pw + 4, y1 + 8);
  // legenda
  g.textAlign = 'left';
  const lg = [['T 2 m', '#ff6b5e'], ['Td', '#5fd17a'], ['wind 10 m (· gusts)', '#d8c26a'], ['p', '#c58cff'], ['precip.', '#3d8bff']];
  let lx = L + 4;
  for (const [t, c] of lg) { g.fillStyle = c; g.fillText(t, lx, y1 + 10); lx += g.measureText(t).width + 10; }
}
