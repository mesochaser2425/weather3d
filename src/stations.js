// Stacje meteorologiczne: dowolnie wiele punktów pomiarowych na mapie (nazwa, położenie w km widocznej mapy).
// Historia w trzech rozdzielczościach (im dalej w czas, tym zgrubniej – jak w archiwach stacji):
//   • co 10 min – ostatnie 3 doby,
//   • godzinowa (średnie, sumy, ekstrema) – ostatnie 120 dób,
//   • dobowa (Tmin, Tmax, Tśr, opad, śnieg, wiatr, porywy, ciśnienie, zachmurzenie, usłonecznienie, pokrywa
//     śnieżna, mgła) – cały przebieg symulacji (do badań długoterminowych).
// Tabela bieżących odczytów, meteogram wybranego zakresu, eksport CSV każdego poziomu. Lista stacji pamiętana
// w przeglądarce i w zapisanym scenariuszu; historia liczy się od startu symulacji (restart ją czyści).
// Wysokość stacji (zs) z prawdziwego terenu (gęstszy DEM, jak wysokość pod kursorem); model liczy na średniej z oczka.
// Stacja wyżej niż grunt modelu (szczyt) mierzy powietrze modelu na swojej wysokości, niżej (dno doliny) – temperaturę
// i punkt rosy przeliczone gradientem 6.5 K/km; przycisk „Szczyt” stawia stację w najwyższym punkcie w pobliżu kliknięcia.

import { toD, unitD, nD, fm, fT, fmH, fmVis, isImp, onUnits } from './units.js';
import { drawMeteogram, newView, viewRange, viewStep, attachView, MET_L, MET_R } from './profile.js';

const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const dirName = (u, v) => DIRS[Math.round(((Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360) / 22.5) % 16];
const rhOf = (t, td) => { const es = (x) => 6.112 * Math.exp(17.67 * x / (x + 243.5)); return Math.min(100, 100 * es(td) / es(t)); };
const H10_MAX = 432, H1_MAX = 24 * 120, D_MAX = 36500;

// sumator okresu (godzina, doba): średnie, sumy i ekstrema z próbek co 10 min
function newAgg(key, t) {
  return { key, t0: t, n: 0, T: 0, Td: 0, RH: 0, ws: 0, ua: 0, va: 0, psl: 0, cov: 0, tmin: Infinity, tmax: -Infinity,
    gust: 0, pr: 0, sn: 0, vis: Infinity, fog: 0, sunh: 0, swe: 0, snd: 0, tmaxS: -Infinity, tminS: Infinity, dt: 0, et: 0, sm1: 0, sm2: 0, sm3: 0 };
}
function addAgg(a, h, dP, dS, dtH) {
  a.n++; a.T += h.T2; a.Td += h.Td2; a.RH += rhOf(h.T2, h.Td2); a.ws += h.ws; a.ua += h.ua; a.va += h.va; a.psl += h.PSL; a.cov += h.cov;
  a.tmin = Math.min(a.tmin, h.T2); a.tmax = Math.max(a.tmax, h.T2); a.gust = Math.max(a.gust, h.gust);
  a.pr += dP; a.sn += dS; a.vis = Math.min(a.vis, h.vis); a.fog += h.vis < 1 ? dtH : 0; a.dt += dtH;
  // TMAX/TMIN modelu liczone od północy: wystarczy ostatni odczyt doby (maksimum po próbkach przenosiło ekstremum
  // poprzedniej doby, gdy pierwsza próbka nowej doby pochodziła sprzed zerowania)
  a.sunh = h.sunh; a.swe = h.swe; a.snd = h.snd; a.tmaxS = h.tmaxS; a.tminS = h.tminS;
  a.et += h.et * dtH; a.sm1 = h.sm1; a.sm2 = h.sm2; a.sm3 = h.sm3;
}

// ctx: { $, S, NX, NXY, MG, NXD, NYD, DX, DY, sfc(), time(), clock(t), toast(msg), mapInner, probe(), absHour(t), dateStr(t),
//        realH(xkm, ykm) – wysokość prawdziwego terenu, peak(xkm, ykm, rkm) – najwyższy punkt w promieniu, modelH(col) – grunt
//        modelu w oczku, air(s) – powietrze modelu na wysokości stacji { T, Td, ua, va } (kopia pól jak sfc) albo null }
export function createStations(ctx) {
  const { $, S, NX, NXY, MG, NXD, NYD, DX, DY } = ctx;
  const LX = NXD * DX / 1000, LY = NYD * DY / 1000;
  let list = [];
  let sel = -1;
  let addMode = false;      // false | 'point' | 'peak'
  let lastTable = 0;
  let cities = [];          // miejscowości z OpenStreetMap: { name, xkm, ykm, pop, cls 0/1/2 }

  const colOf = (st) => {
    const i = Math.min(NXD - 1, Math.max(0, Math.floor(st.xkm * 1000 / DX)));
    const j = Math.min(NYD - 1, Math.max(0, Math.floor(st.ykm * 1000 / DY)));
    return (j + MG) * NX + i + MG;
  };
  const val = (col, n) => ctx.sfc()[S[n] * NXY + col];
  const fresh = (s) => Object.assign(s, { h10: [], h1: [], d: [], ah: null, ad: null, lastPacc: null, lastT: null });

  function save() {
    try { localStorage.setItem('w3d-stations', JSON.stringify(exportList())); } catch (e) { /* bez pamięci przeglądarki */ }
  }
  const exportList = () => list.map((s) => ({ name: s.name, xkm: +s.xkm.toFixed(2), ykm: +s.ykm.toFixed(2), ...(s.zs != null ? { zs: Math.round(s.zs) } : {}) }));
  function importList(arr) {
    list = (arr || []).filter((s) => s.xkm >= 0 && s.xkm <= LX && s.ykm >= 0 && s.ykm <= LY)
      .map((s) => fresh({ name: String(s.name || 'Station').slice(0, 40), xkm: +s.xkm, ykm: +s.ykm, zs: Number.isFinite(+s.zs) && s.zs !== null ? +s.zs : null }));
    sel = list.length ? 0 : -1;
    markers(); table(true); drawSel();
  }

  function add(xkm, ykm, name, zs) {
    const z = zs ?? ctx.realH(xkm, ykm);
    const nm = (name || $('stName').value || '').trim() || `Station ${list.length + 1}`;
    list.push(fresh({ name: nm.slice(0, 40), xkm, ykm, zs: z }));
    sel = list.length - 1;
    $('stName').value = '';
    save(); markers(); table(true); drawSel();
    const zm = ctx.modelH(colOf(list[sel]));
    ctx.toast(`Station “${nm}” added (${nD(xkm, 'km', 1)}, ${nD(ykm, 'km', 1)} ${unitD('km')}, ${fmH(z)} a.s.l.; model ground ${fmH(zm)}) – measures every 10 min of simulation time`);
  }
  const setMode = (m) => {
    addMode = m;
    $('stAdd').classList.toggle('on', m === 'point');
    $('stPeak').classList.toggle('on', m === 'peak');
  };
  // kliknięcie na mapie w trybie dodawania (x, y – położenie w oczkach siatki obliczeniowej, ułamkowe); „Szczyt” – najwyższy
  // punkt prawdziwego terenu w promieniu max(0.4 oczka, 1.5 km) od kliknięcia (przy 5 km dawniej cały promień oczka – koło
  // Kasprowego łapała się Świnica)
  async function addAt(x, y) {
    const m = addMode;
    setMode(false);
    const xkm = (x - MG) * DX / 1000, ykm = (y - MG) * DY / 1000;
    if (m === 'peak') {
      const nm = ($('stName').value || '').trim();
      const p = await ctx.peak(xkm, ykm, Math.max(0.4 * DX, 1500) / 1000);
      add(p.xkm, p.ykm, nm || `Summit ${fmH(p.z)}`, p.z);
    } else add(xkm, ykm);
  }
  function remove(n) {
    list.splice(n, 1);
    if (sel >= list.length) sel = list.length - 1;
    save(); markers(); table(true); drawSel();
  }

  // znaczniki na mapie (warstwa nad płótnem mapy, położenie w %): miejscowości i stacje; w widoku 3D ukryte.
  // Miejscowości od największych, klasy wielkości liczone dla widocznego fragmentu (po przybliżeniu mniejsze miasta dostają
  // większą kropkę i podpis, dochodzą wsie); kropka pomijana, gdy < 7 px od już postawionej (wróci po przybliżeniu); podpis stały
  // tylko dla dużych i tylko, gdy nie nachodzi na inny podpis – pozostałe: nazwa po najechaniu; klik w kropkę – stacja
  let visible = true;
  const meas = document.createElement('canvas').getContext('2d');
  function markers() {
    const box = ctx.mapInner;
    box.querySelectorAll('.stmark, .city').forEach((e) => e.remove());
    if (!visible) return;
    const W = box.clientWidth || 1, H = box.clientHeight || 1;
    const pos = (x, y) => (ctx.mapPos ? ctx.mapPos(x / LX, y / LY) : [x / LX * 100, (1 - y / LY) * 100]);
    const labs = [];
    meas.font = '600 11px system-ui, sans-serif';
    const st = [];
    list.forEach((s, n) => {
      const [l, t] = pos(s.xkm, s.ykm);
      if (l < 0 || l > 100 || t < 0 || t > 100) return;          // poza oknem zoomu
      const px = l / 100 * W, py = t / 100 * H;
      labs.push([px + 7, py - 9, px + 15 + meas.measureText(s.name).width, py + 7]);
      st.push([s, n, l, t]);
    });
    if (cities.length && (!ctx.citiesOn || ctx.citiesOn())) {
      const Lv = Math.max(LX, LY) / (ctx.zoom ? ctx.zoom() : 1);
      const pBig = 25000 * (Lv / 100) ** 0.9, pMed = pBig / 6, pSmall = pBig / 40;
      const dots = [];
      meas.font = '700 12px system-ui, sans-serif';
      for (const c of cities) {
        if (c.pop < pSmall || dots.length >= 250) break;
        const [l, t] = pos(c.xkm, c.ykm);
        if (l < 0 || l > 100 || t < 0 || t > 100) continue;
        const px = l / 100 * W, py = t / 100 * H;
        if (dots.some(([x, y]) => (x - px) ** 2 + (y - py) ** 2 < 49)) continue;
        dots.push([px, py]);
        const cls = c.pop >= pBig ? 2 : c.pop >= pMed ? 1 : 0;
        let lab = false;
        if (cls === 2) {
          const b = [px + 5, py - 10, px + 9 + meas.measureText(c.name).width, py + 7];
          if (b[2] <= W && b[1] >= 0 && !labs.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1])) { labs.push(b); lab = true; }
        }
        const m = document.createElement('div');
        m.className = `city c${cls}${lab ? ' lab' : ''}`;
        m.style.left = `${l}%`;
        m.style.top = `${t}%`;
        const pop = c.pop >= 1000 ? `${Math.round(c.pop / 1000)}k` : `${c.pop}`;
        m.innerHTML = `<i></i><span>${c.name.replace(/</g, '&lt;')}<em> · ~${pop} inhabitants · click: station</em></span>`;
        m.querySelector('i').addEventListener('click', (ev) => { ev.stopPropagation(); add(c.xkm, c.ykm, c.name); });
        box.appendChild(m);
      }
    }
    for (const [s, n, l, t] of st) {
      const m = document.createElement('div');
      m.className = 'stmark' + (n === sel ? ' sel' : '');
      m.style.left = `${l}%`;
      m.style.top = `${t}%`;
      m.innerHTML = `<i></i><span>${s.name.replace(/</g, '&lt;')}</span>`;
      box.appendChild(m);
    }
  }

  // zamknięcie godziny / doby: wpis do historii zgrubnej
  function closeHour(s, a) {
    if (!a || !a.n) return;
    const n = a.n;
    s.h1.push({ t: a.t0 + 1800, hour: ctx.clock(a.t0 + 1800).hour, T2: a.T / n, Td2: a.Td / n, RH: a.RH / n, PR: a.pr, sn: a.sn,
      PSL: a.psl / n, cov: a.cov / n, ws: a.ws / n, ua: a.ua / n, va: a.va / n, gust: a.gust, tmin: a.tmin, tmax: a.tmax, vis: a.vis });
    if (s.h1.length > H1_MAX) s.h1.shift();
  }
  function closeDay(s, a) {
    if (!a || !a.n) return;
    const n = a.n;
    // ekstrema dobowe z pól TMAX/TMIN modelu (każdy krok) – dokładniejsze niż próbki co 10 min
    const tmax = Number.isFinite(a.tmaxS) ? Math.max(a.tmax, a.tmaxS) : a.tmax;
    const tmin = Number.isFinite(a.tminS) ? Math.min(a.tmin, a.tminS) : a.tmin;
    // data z chwili tuż po północy (t0 po zaokrągleniu bywa ułamek sekundy przed nią → poprzedni dzień, powtórzone daty)
    s.d.push({ day: a.key, date: ctx.dateStr(a.t0 + 60), full: a.dt > 23.5, Tmin: tmin, Tmax: tmax, Tmean: a.T / n, Td: a.Td / n, RH: a.RH / n,
      pr: a.pr, sn: a.sn, ws: a.ws / n, dir: dirName(a.ua, a.va), gust: a.gust, PSL: a.psl / n, cov: a.cov / n, sunh: a.sunh,
      snow: 100 * a.snd, vis: a.vis, fog: a.fog, et: a.et, sm1: a.sm1, sm2: a.sm2, sm3: a.sm3 });
    if (s.d.length > D_MAX) s.d.shift();
  }

  // odczyt stacji z pól przy gruncie oczka, przeliczony na prawdziwą wysokość stacji (zs): stacja wyżej niż grunt modelu –
  // powietrze modelu na jej wysokości (szczyt w swobodnej atmosferze: mniejsza amplituda dobowa, silniejszy wiatr; ekstrema
  // dobowe z próbek, nie z pól TMAX/TMIN gruntu); niżej – za dnia T i Td + 6.5 K/km, w nocnej warstwie stałej chłodniej (powietrza modelu tam nie ma); opad, śnieg na
  // gruncie, ciśnienie, chmury z oczka. corr – przeliczona (rodzaj opadu wtedy z temperatury stacji)
  function reading(s, t) {
    const c = colOf(s), v = (n) => val(c, n);
    const h = { t, hour: ctx.clock(t).hour, T2: v('T2'), Td2: v('TD2'), PR: v('PR'), PSL: v('PSL'), cov: v('COVER'),
      ws: v('U10'), gust: v('GUST'), sn: v('PSN'), ua: v('UA'), va: v('VA'), vis: v('VIS'), swe: v('SWE'), snd: v('SND'), pacc: v('PACC'),
      sunh: v('SUNH'), tmaxS: v('TMAX'), tminS: v('TMIN'),
      // parowanie terenowe [mm/h] z ciepła utajonego; wilgotność objętościowa warstw gleby [%] (θs = 45%)
      et: v('LE') / 2.5e6 * 3600, sm1: 45 * v('SM1'), sm2: 45 * v('SM2'), sm3: 45 * v('SM3'), corr: false };
    if (s.zs == null) return h;
    const dz = s.zs - ctx.modelH(c);
    if (dz > 25) {
      const a = ctx.air(s);
      if (!a) return h;
      const ws = Math.hypot(a.ua, a.va);
      return Object.assign(h, { T2: a.T, Td2: Math.min(a.Td, a.T), ws, ua: a.ua, va: a.va, gust: ws + Math.max(0, h.gust - h.ws), tmaxS: NaN, tminS: NaN, corr: true });
    }
    if (dz < -25) {
      // kotlina poniżej średniego gruntu oczka: w dzień w dół cieplej, nocą przy inwersji (T 1. warstwy − T 2 m) w dół chłodniej – zastoisko zimnego powietrza, ~1 K/100 m. Wcześniej +6.5 K/km
      // także do Tmin: najcieplejsze noce właśnie w kotlinach (przebieg 797 dób: Nowy Sącz, Lesko, Sucha Tmin +3…+4 K). Tmin z próbek, bo gradient zmienia się w ciągu doby
      const st = Math.min(1, Math.max(0, (v('T1') - v('T2')) / 1.5));
      const d = -dz * (0.0065 - 0.0165 * st), t2 = h.T2 + d;
      return Object.assign(h, { T2: t2, Td2: Math.min(h.Td2 + d, t2), tmaxS: h.tmaxS - 0.0065 * dz, tminS: NaN, corr: true });
    }
    return h;
  }
  // stacje wyżej niż grunt modelu – o powietrze na ich wysokości prosi main.js przy kopii pól (encodeDiag)
  const airReq = () => list.filter((s) => s.zs != null && s.zs - ctx.modelH(colOf(s)) > 25).map((s) => ({ s, col: colOf(s), zs: s.zs }));

  // pomiar co 10 min czasu symulacji; restart symulacji czyści historię
  function record() {
    if (!ctx.sfc()) return;
    const t = ctx.time();
    for (const s of list) {
      if (s.lastT !== null && t < s.lastT) fresh(s);
      else if (s.lastT !== null && t - s.lastT < 600) continue;
      const h = reading(s, t);
      const dtH = s.lastT === null ? 1 / 6 : (t - s.lastT) / 3600;
      const dP = s.lastPacc === null ? 0 : Math.max(0, h.pacc - s.lastPacc);
      // rodzaj opadu: z modelu (przy gruncie oczka) albo – stacja na innej wysokości – z jej temperatury (śnieg < −1…+1 °C)
      const dS = h.corr ? dP * Math.min(1, Math.max(0, (1 - h.T2) / 2)) : h.PR > 0.01 ? dP * Math.min(1, h.sn / h.PR) : 0;
      s.lastPacc = h.pacc; s.lastT = t;
      s.h10.push(h);
      if (s.h10.length > H10_MAX) s.h10.shift();
      const ah = ctx.absHour(t), hk = Math.floor(ah + 1e-6), dk = Math.floor(ah / 24 + 1e-6);
      if (!s.ah || s.ah.key !== hk) { closeHour(s, s.ah); s.ah = newAgg(hk, t - (ah - hk) * 3600); }
      if (!s.ad || s.ad.key !== dk) { closeDay(s, s.ad); s.ad = newAgg(dk, t - (ah - 24 * dk) * 3600); }
      addAgg(s.ah, h, dP, dS, dtH);
      addAgg(s.ad, h, dP, dS, dtH);
    }
  }

  // tabela bieżących odczytów (co ~1 s czasu rzeczywistego)
  function table(force) {
    const now = performance.now();
    if (!force && now - lastTable < 1000) return;
    lastTable = now;
    const tb = $('stTable');
    if (!list.length) {
      tb.innerHTML = '<tr><td class="empty">No stations. Click “Add station”, then a place on the map.</td></tr>';
      return;
    }
    const sf = ctx.sfc();
    const rows = list.map((s, n) => {
      if (!sf) return `<tr><td>${s.name}</td></tr>`;
      const c = colOf(s), v = (k) => val(c, k);
      const r = reading(s, 0), t2 = r.T2, td = r.Td2, ws = r.ws;
      const day = s.ad ? s.ad.pr : 0;
      const pr = v('PR'), sn = (r.corr ? t2 < 0 : v('PSN') > 0.5 * pr) && pr > 0.05;
      const zm = ctx.modelH(c), zt = s.zs == null ? '' : ` · ${fmH(s.zs)}${Math.abs(s.zs - zm) > 25 ? ` (model ${fmH(zm)})` : ''}`;
      return `<tr data-n="${n}" class="${n === sel ? 'sel' : ''}">
        <td><b>${s.name.replace(/</g, '&lt;')}</b><small>${nD(s.xkm, 'km', 1)}, ${nD(s.ykm, 'km', 1)} ${unitD('km')}${zt}</small></td>
        <td><b>${nD(t2, '°C', 1)}</b><small>Td ${nD(td, '°C', 1)} · ${rhOf(t2, td).toFixed(0)}%</small></td>
        <td><b>${ws < 0.5 ? 'calm' : `${dirName(r.ua, r.va)} ${nD(ws, 'm/s')}`}</b><small>gusts ${fm(r.gust, 'm/s')}</small></td>
        <td><b>${pr < 0.05 ? '–' : `${nD(pr, 'mm/h', 1)}${sn ? ' ❄' : ''}`}</b><small>today ${fm(day, 'mm', 1)}</small></td>
        <td><b>${nD(v('PSL'), 'hPa')}</b><small>${unitD('hPa')}</small></td>
        <td><b>${Math.round(100 * v('COVER'))}%</b><small>${v('VIS') < 1 ? 'fog' : fmVis(v('VIS'))}</small></td>
        <td><button class="stdel" data-del="${n}" title="Remove the station">×</button></td></tr>`;
    });
    tb.innerHTML = `<tr class="hd"><th>station</th><th>T ${unitD('°C')}</th><th>wind ${unitD('m/s')}</th><th>rain ${unitD('mm/h')}</th><th>press.</th><th>clouds</th><th></th></tr>` + rows.join('');
  }

  // wykres dobowy (cały okres): słupki Tmin–Tmax z linią Tśr, opad dobowy, śnieg
  function drawDaily(canvas, dAll, view) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
    if (!W || !H) return;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = W / dpr, h = H / dpr;
    g.clearRect(0, 0, w, h);
    g.font = '10px system-ui, sans-serif';
    if (dAll.length < 1) { g.fillStyle = '#8b94a3'; g.textAlign = 'center'; g.fillText('the daily history starts after the first full day…', w / 2, h / 2); return; }
    const L = MET_L, R = MET_R, T = 8, B = 16, h1 = (h - T - B - 6) * 0.62, h2 = (h - T - B - 6) * 0.38, y1 = T, y2 = T + h1 + 6;
    // okno w dobach: słupek doby `day` zajmuje [day, day + 1]; skale i podsumowanie z tego, co widać
    const [a, b] = viewRange(view, dAll[0].day, dAll[dAll.length - 1].day + 1);
    const d = dAll.filter((r) => r.day + 1 > a + 1e-6 && r.day < b - 1e-6);
    if (!d.length) return;
    const pw = w - L - R, bw = pw / (b - a), XD = (day) => L + (day - a) * bw;
    let lo = Infinity, hi = -Infinity, pmax = 1;
    for (const r of d) { lo = Math.min(lo, toD(r.Tmin, '°C')); hi = Math.max(hi, toD(r.Tmax, '°C')); pmax = Math.max(pmax, r.pr); }
    lo = Math.floor(lo / 5) * 5; hi = Math.ceil(hi / 5) * 5 + (hi - lo < 5 ? 5 : 0);
    const Y = (v) => y1 + h1 * (1 - (v - lo) / (hi - lo));
    g.strokeStyle = '#262b35'; g.fillStyle = '#8b94a3'; g.textAlign = 'right';
    for (let v = lo; v <= hi; v += (hi - lo > (isImp() ? 54 : 30) ? (isImp() ? 20 : 10) : (isImp() ? 10 : 5))) { g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(L + pw, Y(v)); g.stroke(); g.fillText(`${v}°`, L - 4, Y(v) + 3); }
    const y0d = toD(0, '°C');   // linia zera °C (32 °F)
    if (lo < y0d && hi > y0d) { g.strokeStyle = '#7da7ff55'; g.beginPath(); g.moveTo(L, Y(y0d)); g.lineTo(L + pw, Y(y0d)); g.stroke(); }
    g.save(); g.beginPath(); g.rect(L, 0, pw, h - B); g.clip();   // słupki kończą się na brzegu okna
    for (const r of d) {
      const x = XD(r.day);
      g.fillStyle = r.full ? '#e06a4c' : '#e06a4c77';
      g.fillRect(x + bw * 0.15, Y(toD(r.Tmax, '°C')), Math.max(1, bw * 0.7), Math.max(1, Y(toD(r.Tmin, '°C')) - Y(toD(r.Tmax, '°C'))));
      const ph = h2 * Math.min(1, r.pr / pmax);
      g.fillStyle = r.sn > 0.5 * r.pr && r.pr > 0 ? '#c9b6ff' : '#4d9bff';
      g.fillRect(x + bw * 0.15, y2 + h2 - ph, Math.max(1, bw * 0.7), ph);
    }
    g.strokeStyle = '#ffd34d'; g.lineWidth = 1.2; g.beginPath();
    d.forEach((r, n) => { const x = XD(r.day + 0.5), y = Y(toD(r.Tmean, '°C')); if (n) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke(); g.lineWidth = 1;
    g.restore();
    g.fillStyle = '#6fa8ff'; g.textAlign = 'right'; g.fillText(nD(pmax, 'mm/d', pmax < 10 ? 1 : 0), L - 4, y2 + 8); g.fillText(unitD('mm/d'), L - 4, y2 + 18);
    // podpisy dób: najwyżej ~5, przypięte do numeru doby – nie skaczą przy przesuwaniu; przy długim oknie miesiąc i rok przebiegu
    g.fillStyle = '#8b94a3'; g.textAlign = 'center';
    const step = Math.max(1, Math.ceil((b - a) / 5));
    for (const r of d) {
      if (r.day % step) continue;
      const w3 = r.date.split(' '), x = XD(r.day + 0.5);
      if (x < L || x > L + pw) continue;
      g.fillText(b - a > 300 ? `${w3[1].slice(0, 3)} y${Math.floor(r.day / 365.25) + 1}` : `${w3[0]} ${w3[1].slice(0, 3)}`, x, h - 4);   // data w historii jest bez roku: y – rok przebiegu
    }
    g.textAlign = 'left'; g.fillStyle = '#c9d1dc';
    const tot = d.reduce((a, r) => a + r.pr, 0), tm = d.reduce((a, r) => a + r.Tmean, 0) / d.length;
    g.fillText(`${d.length} days · Tmean ${fT(tm)} · precip. ${fm(tot, 'mm')}`, L + 4, y1 + 10);
  }

  function drawSel() {
    const s = list[sel];
    const rng = $('stRange').value;
    const lab = { d3: '3 days every 10 min', d120: 'up to 120 days – hourly means', all: 'whole period – daily' }[rng];
    $('stMetTitle').innerHTML = `${s ? `Meteogram: ${s.name.replace(/</g, '&lt;')}` : 'Meteogram'} <span class="sub">${lab}</span>`;
    if (rng === 'all') drawDaily($('cmetSt'), s ? s.d : [], views.all);
    else drawMeteogram($('cmetSt'), s ? (rng === 'd3' ? s.h10 : s.h1) : [], views[rng], ctx.dateStr ? (t) => { const w3 = ctx.dateStr(t).split(' '); return `${w3[0]} ${w3[1].slice(0, 3)}`; } : null);
  }
  // przybliżanie: osobny widok na każdy zakres (najkrótsze okno: 1 h przy zapisie co 10 min, 6 h przy godzinowym, 3 doby przy dobowym)
  onUnits(() => { table(true); drawSel(); });
  const views = { d3: newView(3600), d120: newView(6 * 3600), all: newView(3) };
  attachView($('cmetSt'), () => views[$('stRange').value], drawSel, MET_L, MET_R);
  $('stZp').onclick = () => { viewStep(views[$('stRange').value], 1 / 1.5); drawSel(); };
  $('stZm').onclick = () => { viewStep(views[$('stRange').value], 1.5); drawSel(); };

  // eksport CSV (separator „;”, przecinek dziesiętny – otwiera się wprost w polskim Excelu)
  function csv() {
    if (!list.length) { ctx.toast('No stations to save'); return; }
    const kind = $('stCsvKind').value;
    const f = (x, dd = 1) => (Number.isFinite(x) ? x.toFixed(dd).replace('.', ',') : '');
    const nm = (s) => s.name.replace(/;/g, ',');
    const lines = [];
    const zf = (s) => (s.zs == null ? '' : Math.round(s.zs));
    if (kind === 'day') {
      lines.push('station;x_km;y_km;height_m;sim_day;date;full_day;Tmin_C;Tmax_C;Tmean_C;Td_mean_C;RH_mean_%;precip_mm;snow_mm;wind_mean_m_s;prevailing_dir;gust_max_m_s;pressure_mean_hPa;cloud_cover_mean_%;sunshine_h;snow_depth_cm;visibility_min_km;fog_h;evapotranspiration_mm;soil_0_10cm_%vol;soil_10_40cm_%vol;soil_40_100cm_%vol');
      for (const s of list) for (const r of s.d) {
        lines.push([nm(s), f(s.xkm), f(s.ykm), zf(s), r.day + 1, r.date, r.full ? 1 : 0, f(r.Tmin), f(r.Tmax), f(r.Tmean), f(r.Td), f(r.RH, 0), f(r.pr), f(r.sn), f(r.ws),
          r.dir, f(r.gust), f(r.PSL), f(100 * r.cov, 0), f(r.sunh), f(r.snow, 0), f(r.vis), f(r.fog), f(r.et, 2), f(r.sm1), f(r.sm2), f(r.sm3)].join(';'));
      }
    } else {
      const hourly = kind === 'hour';
      lines.push(`station;x_km;y_km;height_m;sim_time_h;hour;T2_C;Td_C;RH_%;wind_m_s;dir;gust_m_s;${hourly ? 'precip_mm_per_hour;snow_mm_per_hour;Tmin_C;Tmax_C' : 'precip_mm_h;snow_mm_h;total_since_start_mm'};pressure_hPa;cloud_cover_%;visibility_km`);
      for (const s of list) for (const h of (hourly ? s.h1 : s.h10)) {
        lines.push([nm(s), f(s.xkm), f(s.ykm), zf(s), f(h.t / 3600, 2), f(h.hour, 2), f(h.T2), f(h.Td2), f(rhOf(h.T2, h.Td2), 0), f(h.ws), dirName(h.ua, h.va), f(h.gust),
          ...(hourly ? [f(h.PR, 2), f(h.sn, 2), f(h.tmin), f(h.tmax)] : [f(h.PR, 2), f(h.sn, 2), f(h.pacc, 1)]), f(h.PSL), f(100 * h.cov, 0), f(h.vis)].join(';'));
      }
    }
    if (lines.length < 2) { ctx.toast('No data at this resolution yet'); return; }
    // ostatni wiersz: siatka, ziarno pogody i źródło norm korekty klimatu – bez tego raportu z przebiegu nie da się jednoznacznie opisać
    if (ctx.csvMeta) lines.push('# ' + ctx.csvMeta());
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `weather3d_stations_${{ day: 'daily', hour: 'hourly', min10: '10min' }[kind]}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    ctx.toast(`Saved ${lines.length - 1 - (ctx.csvMeta ? 1 : 0)} rows (CSV)`);
  }

  // --- przyciski i tabela ---
  $('stAdd').onclick = () => {
    setMode(addMode === 'point' ? false : 'point');
    if (addMode) ctx.toast('Click the place of the new station on the map');
  };
  $('stPeak').onclick = () => {
    setMode(addMode === 'peak' ? false : 'peak');
    if (addMode) ctx.toast('Click the map near a summit – the station goes to the highest terrain point nearby');
  };
  $('stAddProbe').onclick = () => {
    const p = ctx.probe();
    if (!p) { ctx.toast('First click the map to place the probe'); return; }
    add((p.i - MG + 0.5) * DX / 1000, (p.j - MG + 0.5) * DY / 1000);
  };
  $('stCsv').onclick = csv;
  $('stRange').onchange = drawSel;
  $('stClear').onclick = () => { if (list.length && confirm('Remove all stations?')) { list = []; sel = -1; save(); markers(); table(true); drawSel(); } };
  $('stTable').addEventListener('click', (e) => {
    const d = e.target.closest('[data-del]');
    if (d) { remove(+d.dataset.del); return; }
    const r = e.target.closest('tr[data-n]');
    if (r) { sel = +r.dataset.n; markers(); table(true); drawSel(); }
  });

  // start: stacje zapamiętane w przeglądarce
  try { importList(JSON.parse(localStorage.getItem('w3d-stations') || '[]')); } catch (e) { importList([]); }

  return {
    get addMode() { return addMode; },
    addAt,
    airReq,
    markers,                 // ponowne rozmieszczenie znaczników (zoom mapy)
    setCities: (arr) => { cities = arr || []; markers(); },
    exportList,
    importList: (arr) => { importList(arr); save(); },
    viewOf: (rng) => ({ ...views[rng] }),   // widok przybliżenia meteogramu (testy)
    // pełny zapis przebiegu: historia (hist) i liczniki w toku (live) – osobno, bo historię można zaokrąglić
    exportFull: () => ({ sel,
      hist: list.map((s) => ({ h10: s.h10, h1: s.h1, d: s.d })),
      live: list.map((s) => ({ name: s.name, xkm: s.xkm, ykm: s.ykm, zs: s.zs, ah: s.ah, ad: s.ad, lastPacc: s.lastPacc, lastT: s.lastT })) }),
    importFull({ sel: n, hist, live }) {
      list = live.map((s, i) => ({ ...s, ...hist[i] }));
      sel = list.length ? Math.max(0, Math.min(n ?? 0, list.length - 1)) : -1;
      save(); markers(); table(true); drawSel();
    },
    // co ~0.25 s (pętla interfejsu): zapis pomiarów; gdy panel stacji widoczny – tabela i meteogram
    tick(visible) {
      record();
      if (visible) { table(false); drawSel(); }
    },
    setVisible(on) { visible = on; markers(); },
    days: (n) => (list[n] ? list[n].d : null),      // historia dobowa stacji n (testy)
    // historia do testów (dobowa i godzinowa wybranej / pierwszej stacji)
    history(n = 0) { const s = list[n]; return s ? { h10: s.h10.length, h1: s.h1.length, d: s.d } : null; },
  };
}
