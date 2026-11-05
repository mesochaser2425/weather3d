// Strona tytułowa: wielkość mapy, miesiąc startu i zakres na mapie terenu. Symulacja (main.js) wczytywana dopiero po „Start” – adres ustawiany
// bez przeładowania strony, więc wszystko rusza od razu z wybranymi ustawieniami. Zapamiętane w przeglądarce (w3d-title).
import { tile, demColor, lonLatToTile, tileToLonLat } from './geo.js';
import { NICE_DX, RES_OPTS, planGrid } from './gridplan.js';
import { openRun, stashRun, resumeUrl } from './runfile.js';
import { MANIP_RAIN, MANIP_VAR, fmtT, fmtX, manipQuery } from './manip.js';
import { toD, fromD, unitD, fmDx, isImp, setImp, onUnits } from './units.js';

const $ = (id) => document.getElementById(id);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SIZES = [25, 50, 100, 250, 500, 1000, 2000];
const KM_DEG = 111.32;
const st = { lat: 50.06, lon: 19.94, lx: 500, ly: 500, res: 100, dx: 'auto', month: 5 };
try { Object.assign(st, JSON.parse(localStorage.getItem('w3d-title') || '{}')); } catch { /* bez pamięci przeglądarki – domyślne */ }
const savePref = () => { try { localStorage.setItem('w3d-title', JSON.stringify(st)); } catch { /* bez pamięci */ } };
const plan = () => planGrid(st.lx, st.ly, st.res, st.dx);

$('loadScr').classList.remove('on');
$('titleScr').classList.add('on');

// ---------- ustawienia ----------
for (const km of SIZES) {
  const b = document.createElement('button');
  b.className = 'chipb'; b.dataset.km = km;
  b.onclick = () => { st.lx = km; st.ly = km; fitView(); ui(); };
  $('ttSizes').appendChild(b);
}
for (const r of RES_OPTS) {
  const b = document.createElement('button');
  b.textContent = r; b.dataset.r = r;
  b.onclick = () => { st.res = r; ui(); };
  $('ttRes').appendChild(b);
}
$('ttDx').add(new Option('automatic (from the detail)', 'auto'));
for (const d of NICE_DX) $('ttDx').add(new Option('', d));
$('ttDx').onchange = () => { st.dx = $('ttDx').value; ui(); };
MONTHS.forEach((m, i) => {
  const b = document.createElement('button');
  b.textContent = m; b.dataset.m = i;
  b.onclick = () => { st.month = i; ui(); };
  $('ttMonths').appendChild(b);
});
for (const [id, k] of [['ttLx', 'lx'], ['ttLy', 'ly']]) {
  $(id).addEventListener('change', () => { const v = +$(id).value; st[k] = Math.min(5000, Math.max(5, v ? fromD(v, 'km') : st[k])); fitView(); ui(); });
}
// manipulacja atmosfery: nie zapamiętywana, każda sesja startuje od neutralnych nastaw (ustawione kiedyś +6 K zostawało potem niezauważone)
const manT = () => +$('ttTan').value, manR = () => MANIP_RAIN[+$('ttRain').value], manV = () => MANIP_VAR[+$('ttVar').value];
function manUi() {
  const lab = (id, t, on) => { $(id).textContent = t; $(id).style.color = on ? '#ff9a3c' : ''; };
  lab('ttTanV', fmtT(manT()), manT() !== 0); lab('ttRainV', fmtX(manR()), manR() !== 1); lab('ttVarV', fmtX(manV()), manV() !== 1);
}
for (const id of ['ttTan', 'ttRain', 'ttVar']) $(id).addEventListener('input', manUi);
manUi();
const fmtLL = (lat, lon) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
function ui() {
  const g = plan();
  $('ttLx').value = String(Math.round(toD(st.lx, 'km')));
  $('ttLy').value = String(Math.round(toD(st.ly, 'km')));
  const uKm = unitD('km');
  $('ttLxL').textContent = `Width (W–E) [${uKm}]`;
  $('ttLyL').textContent = `Height (S–N) [${uKm}]`;
  for (const b of $('ttSizes').children) b.textContent = `${Math.round(toD(+b.dataset.km, 'km'))} ${uKm}`;
  for (const o of $('ttDx').options) if (o.value !== 'auto') o.textContent = fmDx(+o.value);
  for (const b of $('ttUnits').children) b.classList.toggle('on', (b.dataset.u === 'imperial') === isImp());
  for (const b of $('ttSizes').children) b.classList.toggle('on', +b.dataset.km === Math.round(st.lx) && +b.dataset.km === Math.round(st.ly));
  for (const b of $('ttRes').children) b.classList.toggle('on', +b.dataset.r === st.res);
  for (const b of $('ttMonths').children) b.classList.toggle('on', +b.dataset.m === st.month);
  $('ttDx').value = String(st.dx);
  const sp = fmDx(g.dx), secs = 30 * g.cost;
  $('ttInfo').innerHTML = `Grid spacing <b>${sp}</b> · <b>${g.nx} × ${g.ny}</b> cells · map <b>${Math.round(toD(g.nx * g.dx / 1000, 'km'))} × ${Math.round(toD(g.ny * g.dx / 1000, 'km'))} ${uKm}</b><br>`
    + `${g.sc.name[0].toUpperCase()}${g.sc.name.slice(1)}: ${g.sc.use}<br>One day at max speed ≈ <b${secs > 45 ? ' style="color:var(--warn)"' : ''}>${secs < 100 ? secs.toFixed(0) : Math.round(secs / 10) * 10} s</b> (RTX 5060 Ti)`;
  $('ttPlace').textContent = fmtLL(st.lat, st.lon);
  savePref();
  drawReq();
}

// ---------- mapa terenu: kafelki Terrarium, zoom ciągły (cx, cy – środek widoku w układzie Mercatora 0…1) ----------
const cv = $('ttMap'), ctx = cv.getContext('2d');
const view = { cx: 0.5, cy: 0.33, zoom: 4 };
const Z_MIN = 1.2, Z_MAX = 12.5, TZ_MIN = 2, TZ_MAX = 12;
const tiles = new Map();        // z/x/y → płótno 256 × 256 albo 1 (pobierany)
let netFail = false;
const mod = (a, n) => ((a % n) + n) % n;
function tileCanvas(z, x, y, load = true) {
  const n = 2 ** z;
  x = mod(x, n);
  if (y < 0 || y >= n) return null;
  const k = `${z}/${x}/${y}`, e = tiles.get(k);
  if (e !== undefined) return e === 1 ? null : e;
  if (!load) return null;
  tiles.set(k, 1);
  tile(z, x, y).then((h) => {
    if (!h) { tiles.delete(k); if (!netFail) { netFail = true; $('ttNet').style.display = ''; } return; }
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const g = c.getContext('2d'), img = g.createImageData(256, 256), D = img.data, sh = 0.0015 * 2 ** ((z - 5) * 0.6);
    for (let py = 0; py < 256; py++) {
      for (let px = 0; px < 256; px++) {
        const hv = h[py * 256 + px];
        const gx = h[py * 256 + Math.min(255, px + 1)] - h[py * 256 + Math.max(0, px - 1)];
        const gy = h[Math.min(255, py + 1) * 256 + px] - h[Math.max(0, py - 1) * 256 + px];
        const col = demColor(hv, hv > 0 ? Math.min(1.25, Math.max(0.6, 1 + (gy - gx) * sh)) : 1), q = 4 * (py * 256 + px);
        D[q] = col[0]; D[q + 1] = col[1]; D[q + 2] = col[2]; D[q + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    tiles.set(k, c);
    drawReq();
  });
  return null;
}
let raf = 0;
function drawReq() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
const merc = (lat, lon) => lonLatToTile(lat, lon, 0);        // [0…1, 0…1]
const unmerc = (mx, my) => { const [lat, lon] = tileToLonLat(mx, my, 0); return [Math.max(-80, Math.min(80, lat)), ((lon + 540) % 360) - 180]; };
const scale = () => 256 * 2 ** view.zoom;
// położenie na płótnie [px CSS]; długość geograficzna zawijana do najbliższej kopii świata
function toPx(mx, my) {
  let d = mx - view.cx;
  d -= Math.round(d);
  return [cv.clientWidth / 2 + d * scale(), cv.clientHeight / 2 + (my - view.cy) * scale()];
}
const fromPx = (x, y) => [view.cx + (x - cv.clientWidth / 2) / scale(), view.cy + (y - cv.clientHeight / 2) / scale()];
// zakres mapy: faktyczne wymiary siatki po zaokrągleniu
function rect() {
  const g = plan(), lx = g.nx * g.dx / 1000, ly = g.ny * g.dx / 1000, dLat = ly / 2 / KM_DEG, dLon = lx / 2 / (KM_DEG * Math.cos(st.lat * Math.PI / 180));
  const [ax, ay] = merc(st.lat + dLat, st.lon - dLon), [bx, by] = merc(st.lat - dLat, st.lon + dLon);
  const [x0, y0] = toPx(ax, ay), [x1, y1] = toPx(bx, by);
  return { x0, y0, x1, y1, lx, ly, x1b: x0 + (bx - ax) * scale() };
}
function draw() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#000012';
  ctx.fillRect(0, 0, W, H);
  const tz = Math.min(TZ_MAX, Math.max(TZ_MIN, Math.round(view.zoom))), n = 2 ** tz, s = 256 * 2 ** (view.zoom - tz);
  const x0 = Math.floor(view.cx * n - W / 2 / s), x1 = Math.floor(view.cx * n + W / 2 / s);
  const y0 = Math.max(0, Math.floor(view.cy * n - H / 2 / s)), y1 = Math.min(n - 1, Math.floor(view.cy * n + H / 2 / s));
  ctx.imageSmoothingEnabled = true;
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const px = (tx - view.cx * n) * s + W / 2, py = (ty - view.cy * n) * s + H / 2, c = tileCanvas(tz, tx, ty);
      if (c) { ctx.drawImage(c, px, py, s + 0.6, s + 0.6); continue; }
      // zanim dojdzie kafelek: powiększony kafelek niższego poziomu
      for (let z = tz - 1; z >= TZ_MIN; z--) {
        const f = 2 ** (tz - z), pc = tileCanvas(z, Math.floor(tx / f), Math.floor(ty / f), z === TZ_MIN);
        if (!pc) continue;
        const a = 256 / f;
        ctx.drawImage(pc, mod(tx, f) * a, mod(ty, f) * a, a, a, px, py, s + 0.6, s + 0.6);
        break;
      }
    }
  }
  // zakres domeny: przyciemnione otoczenie, ramka, uchwyty w rogach, wymiary
  const r = rect(), xa = r.x0, xb = r.x1b, ya = r.y0, yb = r.y1;
  ctx.fillStyle = 'rgba(0,0,18,0.32)';
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(xa, ya, xb - xa, yb - ya); ctx.fill('evenodd');
  ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 4;
  ctx.strokeRect(xa, ya, xb - xa, yb - ya);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.strokeRect(xa, ya, xb - xa, yb - ya);
  ctx.fillStyle = '#d9d9d9'; ctx.strokeStyle = '#005d63'; ctx.lineWidth = 1.5;
  for (const [x, y] of [[xa, ya], [xb, ya], [xa, yb], [xb, yb]]) { ctx.fillRect(x - 5, y - 5, 10, 10); ctx.strokeRect(x - 5, y - 5, 10, 10); }
  const lab = `${Math.round(toD(r.lx, 'km'))} × ${Math.round(toD(r.ly, 'km'))} ${unitD('km')}`;
  ctx.font = "700 13px Jura, 'Segoe UI', sans-serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  const lx = (xa + xb) / 2, ly = Math.max(16, ya - 8), tw = ctx.measureText(lab).width;
  ctx.fillStyle = 'rgba(12,12,39,0.85)'; ctx.fillRect(lx - tw / 2 - 6, ly - 16, tw + 12, 18);
  ctx.fillStyle = '#fff'; ctx.fillText(lab, lx, ly);
}
// widok tak, by zakres zajmował ok. 40% mapy
function fitView() {
  const W = cv.clientWidth || 800, H = cv.clientHeight || 600, cl = Math.cos(st.lat * Math.PI / 180);
  const [mx, my] = merc(st.lat, st.lon);
  view.cx = mx; view.cy = my;
  const wFrac = st.lx / (40075 * cl), hFrac = st.ly / (40075 * cl);    // ułamek obwodu Mercatora
  const z = Math.log2(Math.min(0.42 * W / wFrac, 0.42 * H / hFrac) / 256);
  view.zoom = Math.min(Z_MAX, Math.max(Z_MIN, z));
}
function clampView() {
  view.cy = Math.min(1, Math.max(0, view.cy));
  view.cx = mod(view.cx, 1);
}
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const b = cv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top, [mx, my] = fromPx(x, y);
  view.zoom = Math.min(Z_MAX, Math.max(Z_MIN, view.zoom - e.deltaY * 0.0015));
  view.cx = mx - (x - cv.clientWidth / 2) / scale();
  view.cy = my - (y - cv.clientHeight / 2) / scale();
  clampView(); drawReq();
}, { passive: false });
let drag = null;
// co pod kursorem: róg zakresu, wnętrze, tło
function hit(x, y) {
  const r = rect(), xs = [r.x0, r.x1b], ys = [r.y0, r.y1];
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) if (Math.abs(x - xs[a]) <= 8 && Math.abs(y - ys[b]) <= 8) return { k: 'corner', a, b };
  return x > r.x0 && x < r.x1b && y > r.y0 && y < r.y1 ? { k: 'move' } : { k: 'pan' };
}
cv.addEventListener('pointerdown', (e) => {
  const b = cv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top, h = hit(x, y);
  drag = { ...h, sx: x, sy: y, cx: view.cx, cy: view.cy, moved: false, m0: merc(st.lat, st.lon) };
  if (h.k === 'corner') {
    // róg przeciwległy zostaje w miejscu
    const r = rect();
    drag.fix = fromPx(h.a ? r.x0 : r.x1b, h.b ? r.y0 : r.y1);
  }
  cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', (e) => {
  const b = cv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
  if (!drag) {
    const h = hit(x, y);
    cv.style.cursor = h.k === 'corner' ? (h.a === h.b ? 'nwse-resize' : 'nesw-resize') : h.k === 'move' ? 'move' : 'grab';
    return;
  }
  const dx = x - drag.sx, dy = y - drag.sy;
  if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
  if (!drag.moved) return;
  if (drag.k === 'pan') {
    view.cx = drag.cx - dx / scale(); view.cy = drag.cy - dy / scale();
    clampView(); cv.style.cursor = 'grabbing'; drawReq();
  } else if (drag.k === 'move') {
    [st.lat, st.lon] = unmerc(mod(drag.m0[0] + dx / scale(), 1), Math.min(1, Math.max(0, drag.m0[1] + dy / scale())));
    ui();
  } else {
    const [fx, fy] = drag.fix, [mx, my] = fromPx(x, y);
    const [la1, lo1] = unmerc(mod(fx, 1), fy), [la2, lo2] = unmerc(mod(mx, 1), my);
    let dl = lo2 - lo1;
    dl -= 360 * Math.round(dl / 360);
    st.lat = (la1 + la2) / 2;
    st.lon = ((lo1 + dl / 2 + 540) % 360) - 180;
    st.ly = Math.min(5000, Math.max(5, Math.abs(la2 - la1) * KM_DEG));
    st.lx = Math.min(5000, Math.max(5, Math.abs(dl) * KM_DEG * Math.cos(st.lat * Math.PI / 180)));
    ui();
  }
});
const up = (e) => {
  if (drag && !drag.moved && drag.k === 'pan') {
    // kliknięcie w tło: zakres w tym miejscu
    const b = cv.getBoundingClientRect(), [mx, my] = fromPx(e.clientX - b.left, e.clientY - b.top);
    [st.lat, st.lon] = unmerc(mod(mx, 1), Math.min(1, Math.max(0, my)));
    ui();
  }
  drag = null;
  cv.style.cursor = 'grab';
};
cv.addEventListener('pointerup', up);
cv.addEventListener('pointercancel', () => { drag = null; });
cv.addEventListener('dblclick', () => { fitView(); drawReq(); });
new ResizeObserver(drawReq).observe(cv);

// ---------- start: adres z wyborem bez przeładowania, potem wczytanie symulacji (main.js dokończy: klimat, teren, model) ----------
async function start(place) {
  const g = plan();
  savePref();
  const a = place ? `${st.lat.toFixed(3)},${st.lon.toFixed(3)},${st.month}` : `,,${st.month}`;
  history.replaceState(null, '', `${location.pathname}?dx=${g.dx}&nx=${g.nx}&ny=${g.ny}&start=${a}${manipQuery(manT(), manR(), manV())}`);
  $('titleScr').classList.remove('on');
  $('loadScr').classList.add('on');
  await import('./main.js');
}
$('ttStart').onclick = () => start(true);
$('ttFlat').onclick = () => start(false);
// zapisany przebieg: plik do pamięci przeglądarki, adres z siatką przebiegu (main.js wczyta go od razu, bez rozbiegu)
$('ttResume').onclick = () => $('ttRunFile').click();
$('ttRunFile').onchange = async () => {
  const file = $('ttRunFile').files[0];
  $('ttRunFile').value = '';
  if (!file) return;
  try {
    const { meta } = await openRun(file);
    $('ttRunInfo').textContent = `Loading the run saved at ${meta.date}…`;
    await stashRun(file);
    location.href = resumeUrl(meta);
  } catch (e) { $('ttRunInfo').textContent = `Could not load the file: ${e.message}`; }
};
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && $('titleScr').classList.contains('on') && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT') start(true); });

for (const b of $('ttUnits').children) b.onclick = () => setImp(b.dataset.u === 'imperial');
onUnits(() => { if ($('titleScr').classList.contains('on')) { manUi(); ui(); } });
ui();
fitView();
// czcionka dojdzie po pierwszym rysowaniu – podpis wymiarów
if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawReq);
drawReq();
