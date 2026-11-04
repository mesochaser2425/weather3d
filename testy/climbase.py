# Generator src/climbase.js: wbudowana klimatologia miejsca, średnie miesięczne, cały glob. Dzięki niej start symulacji nie czeka na Open-Meteo: parametry klimatu
# (kontynentalizm, wilgotność, Köppen) i odniesienie korekty klimatu są od razu, także bez internetu; normy ERA5 (0.25°) przy gruncie dochodzą w tle.
#
# Dlaczego te źródła (sprawdzone na stacjach IMGW-PIB i radiosondażach IGRA 1991–2020, Polska płd.):
# - T przy gruncie: GHCN_CAMS (stacje, 0.5°) na lądzie; NCEP sig995 ma zły przebieg w roku (grudzień–styczeń −2 K, lato +0.7 K), NCEP 2 m jeszcze gorszy (zima −3.6 K);
# - opad: GPCC (deszczomierze, 1°, lata 1981–2010 – tylko taka średnia jest dostępna) na lądzie, GPCP na morzu; NCEP ma jesienią 55%, latem 120% normy, GPCP zimą 160% (poprawka na niedochwyt);
# - T na 850 / 700 / 500 hPa: NCEP (wobec IGRA −0.3…−0.5 K), sprowadzone do stałych wysokości 1.5 / 3 / 5.6 km z wysokości poziomów NCEP (Z500 od ~5480 m w styczniu do ~5750 m w lipcu);
# - punkt rosy: NCEP sig995 (wilgotność bezwzględna; RH i T razem, zima zgodna z ERA5), RH na 850 / 700 hPa: NCEP.
#
# Pola: oczko 2.5° (szerokość 90 … −90, długość 0 … 357.5): T [°C], punkt rosy [°C], opad [mm/d], wysokość terenu [m]; oczko 5°: T na 1.5 / 3 / 5.6 km [°C], RH na 850 / 700 hPa (0…1).
# Oczko 2.5° na lądzie: średnia oczek 0.5° (T sprowadzona do poziomu morza 6.5 K/km razem z wysokością z kafli Terrarium z = 4); udział lądu < 50% – przejście do NCEP / GPCP.
# Kodowanie bajtami: T, Td = (x + 70)·2; opad = √x·40; wysokość = x/25; T na poziomach = (x + 90)·2; RH = x·250. Base64.
#
# Pliki (https://downloads.psl.noaa.gov/Datasets/): ghcncams/Derived/air.mon.ltm.1991-2020.nc (zapisany jako ghcn_air_ltm.nc), gpcc/full_v2020/precip.mon.ltm.1x1.v2020.1981-2010.nc (gpcc_ltm_1x1_8110.nc),
# gpcp/precip.mon.ltm.1991-2020.nc (gpcp_ltm.nc),
# ncep.reanalysis.derived/surface/air.sig995.mon.ltm.1991-2020.nc, …/surface/rhum.sig995.mon.ltm.1991-2020.nc, ncep.reanalysis.derived/pressure/air.mon.ltm.1991-2020.nc,
# …/pressure/rhum.mon.ltm.1991-2020.nc, …/pressure/hgt.mon.ltm.1991-2020.nc, ncep.reanalysis/surface/hgt.sfc.nc; wysokość terenu: elev05.npy (360 × 720, średnia kafli Terrarium).
# Użycie (Python ≤ 3.13 z h5py i scipy): python -I -X utf8 climbase.py <folder1> <folder2> <folder3> <elev05.npy> <wyjście climbase.js>
import sys, base64, os
import numpy as np
import h5py
from scipy.io import netcdf_file

dirs, felev, out = sys.argv[1:4], sys.argv[4], sys.argv[5]
def find(name):
    for d in dirs:
        p = os.path.join(d, name)
        if os.path.exists(p): return p
    raise SystemExit('brak ' + name)
def load(name, var):
    p = find(name)
    if open(p, 'rb').read(3) == b'CDF':   # NetCDF3 (GHCN_CAMS)
        h = netcdf_file(p, 'r', mmap=False); v = h.variables[var]
        a = v.data.astype(np.float64); mv = getattr(v, 'missing_value', None)
        if mv is not None: a[a == float(np.ravel(mv)[0])] = np.nan
        a = a * getattr(v, 'scale_factor', 1.0) + getattr(v, 'add_offset', 0.0)
        return a, {k: h.variables[k].data.astype(float) for k in ('lat', 'lon', 'level') if k in h.variables}
    h = h5py.File(p, 'r'); v = h[var]
    a = v[:].astype(np.float64)
    mv = v.attrs.get('missing_value', None)
    if mv is not None: a[a == float(np.ravel(mv)[0])] = np.nan
    a = a * v.attrs.get('scale_factor', 1.0) + v.attrs.get('add_offset', 0.0)
    return a, {k: h[k][:].astype(float) for k in ('lat', 'lon', 'level') if k in h}
kel = lambda a: a - 273.15 if np.nanmean(a) > 100 else a

T95, _ = load('air.sig995.mon.ltm.1991-2020.nc', 'air'); T95 = kel(T95)
RH95, _ = load('rhum.sig995.mon.ltm.1991-2020.nc', 'rhum')
Zn, _ = load('hgt.sfc.nc', 'hgt'); Zn = Zn.reshape((73, 144))
A, ca = load('air.mon.ltm.1991-2020.nc', 'air'); A = kel(A)
R, cr = load('rhum.mon.ltm.1991-2020.nc', 'rhum')
H, ch = load('hgt.mon.ltm.1991-2020.nc', 'hgt')
G, cg = load('ghcn_air_ltm.nc', 'air')
G = kel(G); G[np.abs(G) > 90] = np.nan
PG, cpg = load('gpcc_ltm_1x1_8110.nc', 'precip')
PG[PG < 0] = np.nan
PS, cps = load('gpcp_ltm.nc', 'precip')
E05 = np.load(felev)
print('GHCN', G.shape, np.nanmin(G), np.nanmax(G), '| GPCC', PG.shape, np.nanmin(PG), np.nanmax(PG), '| GPCP', PS.shape, np.nanmin(PS), np.nanmax(PS), '| E05', E05.shape, np.nanmax(E05))
assert G.shape == (12, 360, 720) and E05.shape == (360, 720)

lats = 90 - 2.5 * np.arange(73); lons = 2.5 * np.arange(144)
MD = np.array([31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31.0])
G05lat, G05lon = cg['lat'], cg['lon']
if G05lat[0] < G05lat[-1]: G = G[:, ::-1, :]; G05lat = G05lat[::-1]
plat, plon = cpg['lat'], cpg['lon']
if plat[0] < plat[-1]: PG = PG[:, ::-1, :]; plat = plat[::-1]
PG = PG / MD[:, None, None]                                    # mm/miesiąc → mm/d
# GPCP (2.5°, środki oczek 88.75, …; 1.25, …) → punkty siatki NCEP, średnia czterech sąsiednich oczek
pslat, pslon = cps['lat'], cps['lon']
if pslat[0] < pslat[-1]: PS = PS[:, ::-1, :]; pslat = pslat[::-1]
PS2 = np.zeros((12, 73, 144))
for j, la in enumerate(lats):
    jn = np.where(np.abs(pslat - la) <= 1.26)[0]
    for i, lo in enumerate(lons):
        d = np.abs(((pslon - lo) + 180) % 360 - 180); inn = np.where(d <= 1.26)[0]
        PS2[:, j, i] = np.nanmean(PS[:, jn[:, None], inn[None, :]], axis=(1, 2))
SL = T95 + 0.0065 * Zn[None, ...]                               # T sig995 na poziomie morza
T_sl = SL.copy(); P = PS2.copy(); elev = np.zeros((73, 144)); land = np.zeros((73, 144))
for j, la in enumerate(lats):
    jj = np.where(np.abs(G05lat - la) <= 1.25)[0]
    jp = np.where(np.abs(plat - la) <= 1.25)[0]
    for i, lo in enumerate(lons):
        d = np.abs(((G05lon - lo) + 180) % 360 - 180); ii = np.where(d <= 1.25)[0]
        cos = np.cos(np.radians(G05lat[jj]))[:, None]
        g = G[0, jj[:, None], ii[None, :]]                      # oczka 0.5° z danymi = ląd
        ok = ~np.isnan(g)
        fl = (cos * ok).sum() / max((cos * np.ones_like(g)).sum(), 1e-9)
        land[j, i] = fl
        w = min(1.0, fl / 0.5)
        if fl > 0:
            e = np.nan_to_num(E05[jj[:, None], ii[None, :]])
            eL = (cos * ok * e).sum() / (cos * ok).sum()
            sl = np.array([np.nansum((cos * ok) * (G[m, jj[:, None], ii[None, :]] + 0.0065 * e)) / (cos * ok).sum() for m in range(12)])
            T_sl[:, j, i] = w * sl + (1 - w) * SL[:, j, i]
            elev[j, i] = w * eL
        dp = np.abs(((plon - lo) + 180) % 360 - 180); ip = np.where(dp <= 1.25)[0]
        if len(jp) and len(ip):
            cp = np.cos(np.radians(plat[jp]))[:, None]
            gp = PG[:, jp[:, None], ip[None, :]]
            okp = ~np.isnan(gp[0])
            if okp.any():
                flp = (cp * okp).sum() / (cp * np.ones_like(gp[0])).sum()
                wp = min(1.0, flp / 0.5)
                pl = (cp[None, ...] * np.nan_to_num(gp)).sum(axis=(1, 2)) / (cp * okp).sum()
                P[:, j, i] = wp * pl + (1 - wp) * PS2[:, j, i]
T = np.clip(T_sl - 0.0065 * elev[None, ...], -69.5, 57)
print('oczek lądowych:', int((land > 0.5).sum()), '| T nowa − sig995 (ta sama wysokość), ląd > 50%: śr', np.nanmean((T_sl - SL)[:, land > 0.5]), 'p1', np.nanpercentile((T_sl - SL)[:, land > 0.5], 1), 'p99', np.nanpercentile((T_sl - SL)[:, land > 0.5], 99))

a = np.log(np.clip(RH95, 1, 100) / 100.0) + 17.67 * T95 / (T95 + 243.5)
Td = 243.5 * a / (17.67 - a)

# T na stałych wysokościach: z poziomów ciśnienia, między nimi (i powyżej / poniżej) gradient z sąsiednich poziomów
k = lambda levels, p: int(np.argmin(np.abs(levels - p)))
LV = (1000, 925, 850, 700, 600, 500, 400)
TL = np.stack([A[:, k(ca['level'], p)] for p in LV])            # (7, 12, 73, 144)
ZL = np.stack([H[:, k(ch['level'], p)] for p in LV])
ZT = (1500.0, 3000.0, 5600.0)
TZ = np.zeros((3, 12, 73, 144))
for q, z in enumerate(ZT):
    up = np.argmax(ZL >= z, axis=0)                              # pierwszy poziom powyżej z
    up = np.clip(up, 1, len(LV) - 1)
    idx = np.indices(up.shape)
    z1, z0 = ZL[up, idx[0], idx[1], idx[2]], ZL[up - 1, idx[0], idx[1], idx[2]]
    t1, t0 = TL[up, idx[0], idx[1], idx[2]], TL[up - 1, idx[0], idx[1], idx[2]]
    TZ[q] = t0 + (t1 - t0) * (z - z0) / np.maximum(z1 - z0, 1)
print('T(1.5 km) − T850 w 50N 20E:', np.round(TZ[0, :, 16, 8] - TL[2, :, 16, 8], 2))
print('T(5.6 km) − T500 w 50N 20E:', np.round(TZ[2, :, 16, 8] - TL[5, :, 16, 8], 2))
rh = np.stack([R[:, k(cr['level'], p)] / 100.0 for p in (850, 700)])  # (2, 12, 73, 144)

byte = lambda x: np.clip(np.round(x), 0, 255).astype(np.uint8)
F = np.concatenate([byte((T + 70) * 2), byte((Td + 70) * 2), byte(np.sqrt(np.maximum(P, 0)) * 40)])       # (36, 73, 144)
E = byte(elev / 25)
C = np.concatenate([byte((TZ[:, :, ::2, ::2] + 90) * 2).reshape(36, 37, 72), byte(rh[:, :, ::2, ::2] * 250).reshape(24, 37, 72)])  # (60, 37, 72)
b64 = lambda x: base64.b64encode(x.tobytes()).decode()

js = """// Wbudowana klimatologia miejsca (wygenerowane: testy/climbase.py), średnie miesięczne, cały glob. Przy gruncie: T – GHCN_CAMS 1991–2020 (Fan i van den Dool 2008),
// opad – GPCC 1981–2010 (Schneider i in. 2011) i GPCP 1991–2020 na morzu, punkt rosy – NCEP/NCAR R1 1991–2020, wysokość terenu (oczko 2.5°). Swobodna atmosfera: T na 1.5 / 3 / 5.6 km,
// RH na 850 / 700 hPa – NCEP/NCAR R1 1991–2020 (oczko 5°). Dane: NOAA PSL, Boulder, https://psl.noaa.gov. Od razu i bez internetu; normy ERA5 przy gruncie dochodzą w tle (main.js ccLoad).
const B64F = '%s';
const B64E = '%s';
const B64C = '%s';
const dec = (s) => (typeof atob === 'function' ? Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) : new Uint8Array(Buffer.from(s, 'base64')));
let F = null, E = null, C = null;
// (lat, lon) → wagi dwuliniowe na siatce o oczku d [°]
function cell(lat, lon, d, nj, ni) {
  const fj = Math.min(nj - 1, Math.max(0, (90 - lat) / d)), j0 = Math.min(nj - 2, Math.floor(fj)), aj = fj - j0;
  const fi = (((lon %% 360) + 360) %% 360) / d, i0 = Math.floor(fi) %% ni, i1 = (i0 + 1) %% ni, ai = fi - Math.floor(fi);
  return (g) => (1 - aj) * ((1 - ai) * g(j0, i0) + ai * g(j0, i1)) + aj * ((1 - ai) * g(j0 + 1, i0) + ai * g(j0 + 1, i1));
}
// { norm: { elev, T[12], Td[12], P[12] [mm/d] }, free: { T: [1.5, 3, 5.6 km][12] [°C], rh: [850, 700][12] } }
export function baseClim(lat, lon) {
  if (!F) { F = dec(B64F); E = dec(B64E); C = dec(B64C); }
  const a = cell(lat, lon, 2.5, 73, 144), b = cell(lat, lon, 5, 37, 72);
  const f = (n) => a((j, i) => F[(n * 73 + j) * 144 + i]), c = (n) => b((j, i) => C[(n * 37 + j) * 72 + i]);
  const months = (g) => Array.from({ length: 12 }, (_, m) => g(m));
  const elev = a((j, i) => E[j * 144 + i]) * 25;
  const r2 = (x) => Math.round(100 * x) / 100;
  return {
    norm: { elev: Math.round(elev), T: months((m) => r2(f(m) / 2 - 70)), Td: months((m) => r2(f(12 + m) / 2 - 70)), P: months((m) => r2((f(24 + m) / 40) ** 2)) },
    free: { T: [0, 1, 2].map((q) => months((m) => r2(c(12 * q + m) / 2 - 90))), rh: [0, 1].map((q) => months((m) => r2(c(36 + 12 * q + m) / 250))) },
  };
}
// tylko T [°C], opad [mm/d] i wysokość – model synoptyczny pyta o każde oczko kanału (~33 tys.)
export function baseLand(lat, lon) {
  if (!F) { F = dec(B64F); E = dec(B64E); C = dec(B64C); }
  const a = cell(lat, lon, 2.5, 73, 144), T = new Float32Array(12), P = new Float32Array(12);
  for (let m = 0; m < 12; m++) {
    T[m] = a((j, i) => F[(m * 73 + j) * 144 + i]) / 2 - 70;
    P[m] = (a((j, i) => F[((24 + m) * 73 + j) * 144 + i]) / 40) ** 2;
  }
  return { elev: a((j, i) => E[j * 144 + i]) * 25, T, P };
}
""" % (b64(F), b64(E), b64(C))
open(out, 'w', encoding='utf-8', newline='\n').write(js)
print('zapisano', out, len(js), 'B')
