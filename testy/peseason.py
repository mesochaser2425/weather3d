# Porównanie średnich miesięcznych samego modelu synoptycznego (peseason.js) z NCEP R1 1991–2020 w regionach Europy.
# Użycie: python -I -X utf8 peseason.py <ncep_dl> plik.out [plik2.out …]
import sys, json
import numpy as np
import h5py

dl, outs = sys.argv[1], sys.argv[2:]
MN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']

def rd(f, v, unpack=True):
    h = h5py.File(f, 'r'); x = h[v]
    a = x[:].astype(np.float64)
    if unpack:
        a = a * x.attrs.get('scale_factor', 1.0) + x.attrs.get('add_offset', 0.0)
    return a, h

T, hT = rd(f'{dl}/air.mon.ltm.1991-2020.nc', 'air')
Z, _ = rd(f'{dl}/hgt.mon.ltm.1991-2020.nc', 'hgt')
lev = hT['level'][:]
hs = h5py.File(f'{dl}/hgt.sfc.nc', 'r')['hgt'][0].astype(float)
land = h5py.File(f'{dl}/land.nc', 'r')['land'][0]
sfc = np.where(land > 0.5, hs, 0.0)
S995, _ = rd(f'{dl}/air.sig995.mon.ltm.1991-2020.nc', 'air')
PR, hP = rd(f'{dl}/prate.sfc.mon.ltm.1991-2020.nc', 'prate')
glat, glon = hP['lat'][:], hP['lon'][:]
T2, h2 = rd(f'{dl}/air.2m.mon.ltm.1991-2020.nc', 'air')
if np.nanmean(T2) > 100: T2 = T2 - 273.15
if np.nanmean(S995) > 100: S995 = S995 - 273.15
if np.nanmean(T) > 100: T = T - 273.15

def at_z(F, Zm, z):
    k = np.clip((Zm <= z).sum(axis=0) - 1, 0, Zm.shape[0] - 2)
    jj, ii = np.indices(k.shape)
    z0, z1 = Zm[k, jj, ii], Zm[k + 1, jj, ii]
    return F[k, jj, ii] + (F[k + 1, jj, ii] - F[k, jj, ii]) * (z - z0) / (z1 - z0)

runs = {}
ctr = []
for f in outs:
    for line in open(f, encoding='utf-8', errors='replace'):
        k = line.find('MON ')
        if k >= 0:
            o = json.loads(line[k + 4:]); runs.setdefault(o['mon'], []).append(o)
        k = line.find('CTR ')
        if k >= 0: ctr.append(json.loads(line[k + 4:]))
o0 = next(iter(runs.values()))[0]
NA, NB, LA0, LO0 = o0['NA'], o0['NB'], o0['LA0'], o0['LO0']
lats = LA0 + 2.5 * np.arange(NA); lons = LO0 + 2.5 * np.arange(NB)
JJ = np.round((90 - lats) / 2.5).astype(int); II = np.round(((lons + 360) % 360) / 2.5).astype(int)
sel = lambda a: a[..., JJ, :][..., II]
# siatka Gaussa (prate, air.2m): najbliższy punkt
GJ = np.array([np.argmin(np.abs(glat - la)) for la in lats]); GI = np.array([np.argmin(np.abs(((glon - (lo % 360)) + 180) % 360 - 180)) for lo in lons])
gsel = lambda a: a[..., GJ, :][..., GI]

REG = [('Polska', 50, 55, 15, 25), ('Niemcy', 50, 55, 5, 12.5), ('Francja', 45, 50, -2.5, 5), ('Hiszpania', 37.5, 42.5, -7.5, 0),
       ('Bałkany', 40, 45, 17.5, 27.5), ('Ukraina', 47.5, 52.5, 27.5, 37.5), ('Rosja europ.', 52.5, 60, 37.5, 50),
       ('Skandynawia', 60, 67.5, 10, 25), ('Morze Śródz.', 35, 40, 0, 20), ('Atlantyk', 45, 55, -20, -10)]
def reg(arr, la1, la2, lo1, lo2):
    m = np.outer((lats >= la1) & (lats <= la2), (lons >= lo1) & (lons <= lo2))
    return np.nanmean(np.where(m, arr, np.nan))

def mean_runs(rs, key):
    return np.nanmean(np.array([[np.nan if x is None else x for x in r[key]] for r in rs], float), axis=0).reshape(NA, NB)

print('Regiony: model − NCEP 1991–2020 (T [K]; ts – średnia dobowa przy gruncie sprowadzona do poziomu morza wobec NCEP sig995 '
      'sprowadzonego 6.5 K/km; opad model / NCEP [mm/d])')
for mo in sorted(runs, key=lambda m: (m < 12, m)):
    rs = runs[mo]; m = mo - 1
    ts, t15, t3, t5 = (mean_runs(rs, k) for k in ('ts', 't15', 't3', 't5'))
    pr = mean_runs(rs, 'pr') * 24
    sh, lh, cl, sw, tsf = (mean_runs(rs, k) for k in ('sh', 'lh', 'cloud', 'swSfc', 'tsfc'))
    ex = {k: (mean_runs(rs, k) if k in rs[0] else np.full((NA, NB), np.nan)) for k in ('prc', 'soil', 'cape', 'bmAct', 'bmBlk')}
    nS = sel(S995[m] + 0.0065 * sfc)
    n15, n3, n5 = (sel(at_z(T[m], Z[m], z)) for z in (1500, 3000, 5600))
    nP = gsel(PR[m]) * 86400
    print(f'\n== {MN[mo]} (n = {rs[0]["n"]} odczytów × {len(rs)}) ==  region: ts M/N (Δ) | 1.5 km Δ | 3 km Δ | 5.6 km Δ | opad M/N | SH LH zachm. | konw.% gleba CAPE BMpada% BMblok%')
    for nm, a, b, c, d in REG:
        r = lambda x: reg(x, a, b, c, d)
        print(f'  {nm:13s} {r(ts):6.1f} {r(nS):6.1f} ({r(ts) - r(nS):+5.1f}) | {r(t15) - r(n15):+5.1f} | {r(t3) - r(n3):+5.1f} | '
              f'{r(t5) - r(n5):+5.1f} | {r(pr):4.1f} {r(nP):4.1f} | {r(sh):4.0f} {r(lh):4.0f} {r(cl):4.2f} | '
              f'{100 * r(ex["prc"]) * 24 / max(r(pr), 1e-6):4.0f} {r(ex["soil"]):4.2f} {r(ex["cape"]):5.0f} {100 * r(ex["bmAct"]):5.1f} {100 * r(ex["bmBlk"]):5.1f}')

# Polska co 6 h: przepływ i T
if ctr:
    print('\nPolska (środek domeny, co 6 h): miesiąc | ts | t15 | v15 śr. | % z północy (v < −2 m/s) | % z południa (v > 2) | u15 śr. | opad mm/d | gleba')
    for c in ctr:
        by = {}
        for x in c: by.setdefault(x['mon'], []).append(x)
        for mo in sorted(by, key=lambda m: (m < 12, m)):
            xs = by[mo]; g = lambda k: np.array([x[k] for x in xs if k in x], float)
            v = g('v15')
            print(f'  {MN[mo]:5s} {g("ts").mean():6.1f} {g("t15").mean():6.1f} {v.mean():+5.1f} {100 * (v < -2).mean():5.0f} {100 * (v > 2).mean():5.0f} '
                  f'{g("u15").mean():+5.1f} {24 * g("pr").mean():5.2f} {g("soil").mean() if len(g("soil")) else float("nan"):5.2f}')
