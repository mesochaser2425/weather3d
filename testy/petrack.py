# Porównanie toru niżów: model synoptyczny (zrzuty petrack.js) wobec NCEP R1 (dobowe ciśnienie 2015–2020, średnie miesięczne
# 1991–2020 wiatru). Pudełka 2.5° (środki 25…77.5°N, −80…+60°E). Użycie: python -I testy/petrack.py <katalog NCEP> <miesiąc 1-12> plik.out… (zrzuty: MAXLOG=100000000 node runm.mjs … petrack.js > plik.out;
# pliki NCEP: slp.20XX.nc z ncep.reanalysis.dailyavgs/surface oraz pliki z testy/zonclim.py)
import sys, glob, json, datetime
import numpy as np
import h5py
sys.stdout.reconfigure(encoding="utf-8")

dl, month, outs = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
LA0, LO0, NA, NB = 25.0, -80.0, 22, 57
lats = LA0 + 2.5 * np.arange(NA)
lons = LO0 + 2.5 * np.arange(NB)
JJ = np.round((90 - lats) / 2.5).astype(int)
II = np.round(((lons + 360) % 360) / 2.5).astype(int)

def sel(a):  # (…, 73, 144) → (…, NA, NB)
    return a[..., JJ, :][..., II]

# --- NCEP: dobowe ciśnienie w wybranym miesiącu, osobno dla każdego roku ---
ncep_years = []
for f in sorted(glob.glob(f'{dl}/slp.20*.nc')):
    h = h5py.File(f, 'r')
    v = h['slp']
    a = v[:].astype(np.float64)
    sc = v.attrs.get('scale_factor', 1.0); of = v.attrs.get('add_offset', 0.0)
    a = a * sc + of
    if np.nanmean(a) > 5000: a = a / 100.0              # Pa → hPa
    t = h['time'][:]
    d0 = datetime.datetime(1800, 1, 1)
    mo = np.array([(d0 + datetime.timedelta(hours=float(x))).month for x in t])
    ncep_years.append(sel(a[mo == month]))

# --- model ---
runs = []
mod = {'psl': [], 'u15': [], 'u5': [], 't15': []}
for f in outs:
    for line in open(f, encoding='utf-8', errors='replace'):
        k = line.find('JSON ')
        if k < 0: continue
        o = json.loads(line[k + 5:])
        d = np.array([[np.nan if x is None else x for x in day] for day in o['days']], float).reshape(-1, NA, NB)
        runs.append(d)
        for key in mod: mod[key].append(np.array([np.nan if x is None else x for x in o[key]], float).reshape(NA, NB))
mod = {k: np.nanmean(np.array(v), axis=0) for k, v in mod.items()}

def stats(series):
    """series: lista (dni, NA, NB) – średnia, odchylenie std. wewnątrz okresu (wariancja uśredniona), częstość ośrodków niżowych,
    lista ciśnień w ośrodkach (z położeniem)"""
    mean = np.nanmean(np.concatenate(series), axis=0)
    var = np.nanmean(np.array([np.nanvar(s, axis=0) for s in series]), axis=0)
    cyc = np.zeros((NA, NB)); nd = 0; cent = []
    for s in series:
        for p in s:
            nd += 1
            for a in range(1, NA - 1):
                for b in range(1, NB - 1):
                    v = p[a, b]
                    if not np.isfinite(v) or v >= 1010: continue
                    nb = p[a - 1:a + 2, b - 1:b + 2]
                    if np.any(nb < v - 1e-6) : continue
                    ring = (nb.sum() - v) / 8
                    if ring - v < 1.0: continue                       # płytkie zagłębienie – pomijane
                    cyc[a, b] += 1; cent.append((lats[a], lons[b], v))
    return mean, np.sqrt(var), cyc / nd, cent

mN, sdN, cN, ceN = stats(ncep_years)
mM, sdM, cM, ceM = stats(runs)

# wiatr NCEP na 1.5 i 5.6 km ze średnich miesięcznych 1991–2020 (poziomy ciśnienia → wysokość; punkty pod gruntem pominięte)
U = h5py.File(f'{dl}/uwnd.mon.ltm.1991-2020.nc', 'r')['uwnd'][:].astype(float)[month - 1]
Z = h5py.File(f'{dl}/hgt.mon.ltm.1991-2020.nc', 'r')['hgt'][:].astype(float)[month - 1]
T = h5py.File(f'{dl}/air.mon.ltm.1991-2020.nc', 'r')['air'][:].astype(float)[month - 1]
hs = h5py.File(f'{dl}/hgt.sfc.nc', 'r')['hgt'][0].astype(float)
land = h5py.File(f'{dl}/land.nc', 'r')['land'][0]
sfc = np.where(land > 0.5, hs, 0.0)
def at_z(F, z):
    k = np.clip((Z <= z).sum(axis=0) - 1, 0, Z.shape[0] - 2)
    jj, ii = np.indices(k.shape)
    z0, z1 = Z[k, jj, ii], Z[k + 1, jj, ii]
    f = F[k, jj, ii] + (F[k + 1, jj, ii] - F[k, jj, ii]) * (z - z0) / (z1 - z0)
    return np.where(z >= sfc, f, np.nan)
uN15, uN5, tN15 = sel(at_z(U, 1500)), sel(at_z(U, 5600)), sel(at_z(T, 1500))

def band(arr, lo1, lo2):
    m = (lons >= lo1) & (lons <= lo2)
    return np.nanmean(arr[:, m], axis=1)

sectors = [('Atlantyk 50–10°W', -50, -10), ('Europa 10°W–40°E', -10, 40)]
for name, lo1, lo2 in sectors:
    print(f'\n=== {name}, miesiąc {month}: model ({len(runs)} przebiegi × {runs[0].shape[0]} dób) | NCEP 2015–2020 ===')
    print(' lat |  ciśnienie M / N | odch. std. M / N | ośrodki niżowe %dni M / N | u 1.5 km M / N | u 5.6 km M / N | T 1.5 M − N')
    a1, b1, c1, d1 = band(mM, lo1, lo2), band(mN, lo1, lo2), band(sdM, lo1, lo2), band(sdN, lo1, lo2)
    e1, f1 = band(cM, lo1, lo2) * 100, band(cN, lo1, lo2) * 100
    g1, h1, i1, j1 = band(mod['u15'], lo1, lo2), band(uN15, lo1, lo2), band(mod['u5'], lo1, lo2), band(uN5, lo1, lo2)
    k1 = band(mod['t15'], lo1, lo2) - band(tN15, lo1, lo2)
    for a in range(1, NA - 1):
        print(f'{lats[a]:5.1f} | {a1[a]:7.1f} {b1[a]:7.1f} | {c1[a]:5.1f} {d1[a]:5.1f} | {e1[a]:5.1f} {f1[a]:5.1f} | {g1[a]:5.1f} {h1[a]:5.1f} | {i1[a]:5.1f} {j1[a]:5.1f} | {k1[a]:+5.1f}')
    # ośrodki niżowe w sektorze 40–70°N: ciśnienie w centrum
    for nm, ce in (('model', ceM), ('NCEP', ceN)):
        v = np.array([c[2] for c in ce if lo1 <= c[1] <= lo2 and 40 <= c[0] <= 70])
        la = np.array([c[0] for c in ce if lo1 <= c[1] <= lo2 and 40 <= c[0] <= 70])
        if len(v):
            print(f'  {nm}: ośrodki 40–70°N: {len(v)} ({len(v) / (len(runs) if nm == "model" else len(ncep_years)):.1f} na miesiąc·przebieg), '
                  f'ciśnienie mediana {np.median(v):.0f}, p10 {np.percentile(v, 10):.0f} hPa, szerokość mediana {np.median(la):.1f}°N, '
                  f'< 52.5°N {100 * np.mean(la < 52.5):.0f}%')

# ośrodki działania
def ext(arr, la1, la2, lo1, lo2, f):
    m = np.outer((lats >= la1) & (lats <= la2), (lons >= lo1) & (lons <= lo2))
    x = np.where(m, arr, np.nan)
    k = f(x)
    a, b = np.unravel_index(k, x.shape)
    return f'{x[a, b]:.1f} hPa @ {lats[a]:.1f}°N {lons[b]:+.1f}°E'
print('\nNiż islandzki (min 50–75°N, 60°W–10°E): model', ext(mM, 50, 75, -60, 10, np.nanargmin), '| NCEP', ext(mN, 50, 75, -60, 10, np.nanargmin))
print('Wyż azorski (max 25–50°N, 60–0°W):      model', ext(mM, 25, 50, -60, 0, np.nanargmax), '| NCEP', ext(mN, 25, 50, -60, 0, np.nanargmax))
print('Wyż syberyjski/euroazjatycki (max 40–65°N, 30–60°E): model', ext(mM, 40, 65, 30, 60, np.nanargmax), '| NCEP', ext(mN, 40, 65, 30, 60, np.nanargmax))
# Polska: 52.5°N 20°E
a, b = int(round((52.5 - LA0) / 2.5)), int(round((20 - LO0) / 2.5))
print(f'Polska (52.5°N 20°E): ciśnienie M {mM[a, b]:.1f} / N {mN[a, b]:.1f}, odch. std. M {sdM[a, b]:.1f} / N {sdN[a, b]:.1f}, '
      f'u 1.5 km M {mod["u15"][a, b]:.1f} / N {uN15[a, b]:.1f}')
# gradient ciśnienia nad Europą środkową: różnica 45°N − 60°N (wiatr zachodni geostroficzny)
for nm, arr in (('model', mM), ('NCEP', mN)):
    g = band(arr, 0, 30)
    print(f'  {nm}: ciśnienie 0–30°E: 40°N {g[6]:.1f}, 45°N {g[8]:.1f}, 50°N {g[10]:.1f}, 55°N {g[12]:.1f}, 60°N {g[14]:.1f}, 65°N {g[16]:.1f}')
