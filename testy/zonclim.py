# Generator tablicy src/zonclim.js: klimatologia średnich strefowych temperatury powietrza i wiatru zachodniego z reanalizy
# NCEP/NCAR R1 (średnie miesięczne 1991–2020, siatka 2.5°, 17 poziomów ciśnienia). Dla każdego miesiąca, szerokości i wysokości
# n.p.m. – średnia po długościach wartości przeliczonych z poziomów ciśnienia na wysokość (liniowo w z między poziomami;
# poniżej 1000 hPa temperatura z gradientu 1000–925 hPa, wiatr z 1000 hPa), tylko z punktów nad gruntem (ląd: wysokość terenu
# reanalizy, morze: 0 m); gdy nad gruntem nie ma żadnego punktu (Antarktyda nisko) – średnia z wartości ekstrapolowanych.
#
# Pliki (https://downloads.psl.noaa.gov/Datasets/): ncep.reanalysis.derived/pressure/air.mon.ltm.1991-2020.nc,
# ncep.reanalysis.derived/pressure/uwnd.mon.ltm.1991-2020.nc, ncep.reanalysis.derived/pressure/hgt.mon.ltm.1991-2020.nc,
# ncep.reanalysis/surface/hgt.sfc.nc, ncep.reanalysis/surface/land.nc
#
# Z trzecim argumentem także src/zonwave.js: długie fale (liczby falowe 1…6 wzdłuż koła szerokości) T, u i v – współczynniki
# Fouriera a_m, b_m (f = Σ a_m·cos mλ + b_m·sin mλ, λ – długość geograficzna na wschód) na wysokościach ZWV_Z, ze wszystkich
# długości (pod gruntem – wartości ekstrapolowane reanalizy); dodatkowo plik vwnd.mon.ltm.1991-2020.nc.
# Wymaga h5py (Python ≤ 3.13): python -I testy/zonclim.py <katalog z plikami> src/zonclim.js [src/zonwave.js]
import sys, base64
import numpy as np
import h5py

src, out = sys.argv[1], sys.argv[2]
ZS = [0, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000,
      13000, 14000, 16000]
rd = lambda name, var: h5py.File(f'{src}/{name}', 'r')[var][:].astype(np.float64)
T = rd('air.mon.ltm.1991-2020.nc', 'air')      # (12, 17, 73, 144) °C
U = rd('uwnd.mon.ltm.1991-2020.nc', 'uwnd')    # (12, 17, 73, 144) m/s
Z = rd('hgt.mon.ltm.1991-2020.nc', 'hgt')      # (12, 17, 73, 144) m
lat = h5py.File(f'{src}/air.mon.ltm.1991-2020.nc', 'r')['lat'][:]
hs = rd('hgt.sfc.nc', 'hgt')[0]
land = rd('land.nc', 'land')[0]
sfc = np.where(land > 0.5, hs, 0.0)
assert lat[0] == 90 and lat[-1] == -90 and len(lat) == 73
NM, NL, NY, NX = T.shape
res = np.zeros((NM, NY, len(ZS)))
resu = np.zeros((NM, NY, len(ZS)))
for m in range(NM):
    Zm, Tm, Um = Z[m], T[m], U[m]
    for z_i, z in enumerate(ZS):
        # poziom k z Z[k] ≤ z < Z[k+1] w każdym punkcie; z < Z[0] → k = 0 (ekstrapolacja)
        k = np.clip((Zm <= z).sum(axis=0) - 1, 0, NL - 2)
        jj, ii = np.indices(k.shape)
        z0, z1 = Zm[k, jj, ii], Zm[k + 1, jj, ii]
        w = (z - z0) / (z1 - z0)
        tz = Tm[k, jj, ii] + (Tm[k + 1, jj, ii] - Tm[k, jj, ii]) * w
        uz = Um[k, jj, ii] + (Um[k + 1, jj, ii] - Um[k, jj, ii]) * np.clip(w, 0, 1)
        ok = z >= sfc
        for j in range(NY):
            sel = ok[j] if ok[j].any() else np.ones(NX, bool)
            res[m, j, z_i] = tz[j, sel].mean()
            resu[m, j, z_i] = uz[j, sel].mean()
q = np.round(res * 10).astype('<i2')                                  # 0.1 °C
qu = np.clip(np.round(resu * 2), -127, 127).astype('i1')              # 0.5 m/s
b64 = base64.b64encode(q.tobytes()).decode()
b64u = base64.b64encode(qu.tobytes()).decode()
HEAD = """// Klimatologia średnich strefowych temperatury powietrza i wiatru zachodniego – reanaliza NCEP/NCAR R1, średnie miesięczne
// 1991–2020 (siatka 2.5°): T [°C] i u [m/s] na wysokościach ZCL_Z n.p.m., średnia po długościach z punktów nad gruntem (bez
// nich – wartości ekstrapolowane reanalizy). Tablice [miesiąc I–XII][szerokość 90 … −90°N co 2.5°][wysokość]: T w 0.1 °C
// (Int16, base64), u w 0.5 m/s (Int8, base64). Generator: testy/zonclim.py. Cel średniej strefowej modelu synoptycznego
// (pe.js) – zamiast komórki Hadleya i kulistości Ziemi, których kanał 16–80°N nie ma.
"""
CODE = """let tab = null, tabU = null;
function bytes(b) {
  const s = atob(b), u = new Uint8Array(s.length);
  for (let n = 0; n < s.length; n++) u[n] = s.charCodeAt(n);
  return u.buffer;
}
// środki miesięcy [dzień roku]
const MID = [15.5, 45, 74.5, 105, 135.5, 166, 196.5, 227.5, 258, 288.5, 319, 349.5];
// wartość średniej strefowej na szerokości lat [°], wysokości z [m n.p.m.] w dniu roku doy – liniowo w szerokości, wysokości
// i czasie (t – tablica, sc – skala)
function interp(t, sc, lat, z, doy) {
  const d = ((doy % 365) + 365) % 365;
  let m1 = MID.findIndex((x) => x > d);
  if (m1 < 0) m1 = 0;
  const m0 = (m1 + 11) % 12;
  const d0 = MID[m0] > d ? MID[m0] - 365 : MID[m0], d1 = MID[m1] < d ? MID[m1] + 365 : MID[m1];
  const wm = (d - d0) / (d1 - d0);
  const y = Math.min(NY - 1.001, Math.max(0, (90 - lat) / 2.5)), j0 = Math.floor(y), wy = y - j0;
  let k0 = 0;
  while (k0 < NZ - 2 && ZCL_Z[k0 + 1] <= z) k0++;
  const wz = Math.min(1, Math.max(0, (z - ZCL_Z[k0]) / (ZCL_Z[k0 + 1] - ZCL_Z[k0])));
  const at = (m, j, k) => t[(m * NY + j) * NZ + k] * sc;
  const atz = (m, j) => at(m, j, k0) + wz * (at(m, j, k0 + 1) - at(m, j, k0));
  const aty = (m) => atz(m, j0) + wy * (atz(m, j0 + 1) - atz(m, j0));
  return aty(m0) + wm * (aty(m1) - aty(m0));
}
// T [°C] i wiatr zachodni u [m/s] średniej strefowej
export function zonClimT(lat, z, doy) { return interp(tab || (tab = new Int16Array(bytes(B64))), 0.1, lat, z, doy); }
export function zonClimU(lat, z, doy) { return interp(tabU || (tabU = new Int8Array(bytes(B64U))), 0.5, lat, z, doy); }
"""
with open(out, 'w', encoding='utf-8', newline='\n') as f:
    f.write(HEAD)
    f.write(f'export const ZCL_Z = [{", ".join(str(z) for z in ZS)}];\n')
    f.write(f'const NY = 73, NZ = {len(ZS)};\n')
    f.write(f"const B64 = '{b64}';\n")
    f.write(f"const B64U = '{b64u}';\n")
    f.write(CODE)
# kontrola: styczeń i lipiec – T i u na 1.5 i 6 km
for m, nm in ((0, 'I'), (6, 'VII')):
    jx = lambda la: int((90 - la) / 2.5)
    print(nm, 'T 1.5/6 km:', ' | '.join(f'{la}°N {res[m, jx(la), 5]:+.1f}/{res[m, jx(la), 12]:+.1f}' for la in (80, 70, 60, 50, 40, 30, 20)))
    print(nm, 'u 1.5/6 km:', ' | '.join(f'{la}°N {resu[m, jx(la), 5]:+.1f}/{resu[m, jx(la), 12]:+.1f}' for la in (80, 70, 60, 50, 40, 30, 20)))
print('zapisano', out, len(b64) + len(b64u), 'znaków base64')

# --- długie fale (zonwave.js) ---
if len(sys.argv) > 3:
    out2 = sys.argv[3]
    V = rd('vwnd.mon.ltm.1991-2020.nc', 'vwnd')
    lon = h5py.File(f'{src}/air.mon.ltm.1991-2020.nc', 'r')['lon'][:].astype(np.float64)
    ZWV = [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7000, 8500, 10000, 12000, 14500]
    NMW = 6
    lam = np.deg2rad(lon)
    cm = np.cos(np.outer(np.arange(1, NMW + 1), lam))      # (NMW, NX)
    sm = np.sin(np.outer(np.arange(1, NMW + 1), lam))
    wav = np.zeros((NM, NY, len(ZWV), 3, 2 * NMW))
    for m in range(NM):
        Zm, Tm, Um, Vm = Z[m], T[m], U[m], V[m]
        for z_i, z in enumerate(ZWV):
            k = np.clip((Zm <= z).sum(axis=0) - 1, 0, NL - 2)
            jj, ii = np.indices(k.shape)
            z0, z1 = Zm[k, jj, ii], Zm[k + 1, jj, ii]
            w = (z - z0) / (z1 - z0)
            fs = (Tm[k, jj, ii] + (Tm[k + 1, jj, ii] - Tm[k, jj, ii]) * w,
                  Um[k, jj, ii] + (Um[k + 1, jj, ii] - Um[k, jj, ii]) * np.clip(w, 0, 1),
                  Vm[k, jj, ii] + (Vm[k + 1, jj, ii] - Vm[k, jj, ii]) * np.clip(w, 0, 1))
            for vi, f in enumerate(fs):
                wav[m, :, z_i, vi, 0::2] = 2.0 / NX * f @ cm.T
                wav[m, :, z_i, vi, 1::2] = 2.0 / NX * f @ sm.T
    qw = np.clip(np.round(wav * 4), -127, 127).astype('i1')               # 0.25 K / 0.25 m/s
    print('fale: największy współczynnik', np.abs(wav).max().round(1), '| obcięte', int((np.abs(np.round(wav * 4)) > 127).sum()))
    HEAD2 = """// Klimatologia długich fal (stacjonarnych) temperatury powietrza i wiatru – reanaliza NCEP/NCAR R1, średnie miesięczne
// 1991–2020 (siatka 2.5°): współczynniki Fouriera wzdłuż koła szerokości dla liczb falowych 1…NMW – f(λ) = Σ a_m·cos mλ +
// b_m·sin mλ (λ – długość geograficzna na wschód) – T [K], u, v [m/s] na wysokościach ZWV_Z n.p.m. (pod gruntem wartości
// ekstrapolowane reanalizy). Tablica [miesiąc][szerokość 90 … −90°N co 2.5°][wysokość][T, u, v][a1, b1, … a6, b6] w 0.25 K
// albo 0.25 m/s (Int8, base64). Generator: testy/zonclim.py. Cel regulatora długich fal modelu synoptycznego (pe.js) – niż
// islandzki, wyż azorski, położenie prądu strumieniowego nad Atlantykiem: fale, które na Ziemi wymuszają góry i kontrast
// ląd–morze, a których kanał z górami w połowie wysokości nie odtwarza.
"""
    CODE2 = """let tab = null;
function bytes(b) {
  const s = atob(b), u = new Uint8Array(s.length);
  for (let n = 0; n < s.length; n++) u[n] = s.charCodeAt(n);
  return u.buffer;
}
const MID = [15.5, 45, 74.5, 105, 135.5, 166, 196.5, 227.5, 258, 288.5, 319, 349.5];
// współczynniki [a1, b1, … a_NMW, b_NMW] zmiennej vr (0 – T [K], 1 – u, 2 – v [m/s]) na szerokości lat [°], wysokości
// z [m n.p.m.] w dniu roku doy – liniowo w szerokości, wysokości i czasie; wynik do out (Float32Array 2·NMW)
export function zonWave(lat, z, doy, vr, out) {
  const t = tab || (tab = new Int8Array(bytes(B64)));
  const d = ((doy % 365) + 365) % 365;
  let m1 = MID.findIndex((x) => x > d);
  if (m1 < 0) m1 = 0;
  const m0 = (m1 + 11) % 12;
  const d0 = MID[m0] > d ? MID[m0] - 365 : MID[m0], d1 = MID[m1] < d ? MID[m1] + 365 : MID[m1];
  const wm = (d - d0) / (d1 - d0);
  const y = Math.min(NY - 1.001, Math.max(0, (90 - lat) / 2.5)), j0 = Math.floor(y), wy = y - j0;
  let k0 = 0;
  while (k0 < NZ - 2 && ZWV_Z[k0 + 1] <= z) k0++;
  const wz = Math.min(1, Math.max(0, (z - ZWV_Z[k0]) / (ZWV_Z[k0 + 1] - ZWV_Z[k0])));
  const L = 2 * NMW;
  const at = (m, j, k, n) => t[(((m * NY + j) * NZ + k) * 3 + vr) * L + n];
  for (let n = 0; n < L; n++) {
    const az = (m, j) => at(m, j, k0, n) + wz * (at(m, j, k0 + 1, n) - at(m, j, k0, n));
    const ay = (m) => az(m, j0) + wy * (az(m, j0 + 1) - az(m, j0));
    out[n] = 0.25 * (ay(m0) + wm * (ay(m1) - ay(m0)));
  }
  return out;
}
"""
    with open(out2, 'w', encoding='utf-8', newline='\n') as f:
        f.write(HEAD2)
        f.write(f'export const ZWV_Z = [{", ".join(str(z) for z in ZWV)}];\n')
        f.write(f'export const NMW = {NMW};\n')
        f.write(f'const NY = 73, NZ = {len(ZWV)};\n')
        f.write(f"const B64 = '{base64.b64encode(qw.tobytes()).decode()}';\n")
        f.write(CODE2)
    # kontrola: styczeń, 50°N, 5 km – amplituda fal 1…6 wiatru u i T
    j50, k5 = int((90 - 50) / 2.5), ZWV.index(5000)
    amp = lambda vi: np.hypot(wav[0, j50, k5, vi, 0::2], wav[0, j50, k5, vi, 1::2]).round(1)
    print('I 50°N 5 km: amplitudy fal 1…6 – T', amp(0), '| u', amp(1), '| v', amp(2))
    print('zapisano', out2)
