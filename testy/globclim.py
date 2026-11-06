# Analiza serii globclim.mjs: model (doby 3–15 miesiąca) wobec klimatologii tego miesiąca w pudełku 500 × 500 km.
# Odniesienie: T – GHCN_CAMS (ląd), opad – GPCC (ląd) / GPCP (morze), reszta – reanaliza NCEP/NCAR R1 1991–2020 (Tx, Tn, wilgotność 2 m, wiatr 10 m, zachmurzenie, ciśnienie, promieniowanie, strumienie, T i RH na poziomach).
# NCEP to model, nie pomiar: zachmurzenie, wiatr, Tx, Tn i strumienie traktować jako wskazówkę. 15 dób to szum pogody ±2–3 K. Python ≤ 3.13 z h5py i numpy, pliki danych poza folderem skryptu; uruchamiać z -I.
# Użycie: python -I -X utf8 globclim.py <folder wyników> <folder1 z .nc> [<folder2> …]
import json, math, os, sys
import h5py, numpy as np
OUT, DIRS = sys.argv[1], sys.argv[2:]
SITES = {'houston': (30.0, -95.5), 'warszawa': (52.2, 20.0), 'madryt': (40.4, -3.7), 'pekin': (39.9, 116.4), 'delhi': (28.6, 77.2), 'rijad': (24.7, 46.7), 'niamey': (13.5, 2.1), 'manaus': (-3.1, -60.0), 'johannesburg': (-26.2, 28.0), 'buenosaires': (-34.6, -60.0), 'jakuck': (62.0, 129.7), 'seattle': (47.6, -121.0)}
MONTHS = [0, 3, 6, 9]; RZ = {0: 'I', 3: 'IV', 6: 'VII', 9: 'X'}
DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
def find(n):
    for d in DIRS:
        p = os.path.join(d, n)
        if os.path.exists(p): return p
    raise SystemExit('brak pliku ' + n)
def load(fn, var):
    p = find(fn)
    if open(p, 'rb').read(3) == b'CDF':      # starszy format NetCDF (GHCN_CAMS)
        from scipy.io import netcdf_file
        with netcdf_file(p, 'r', mmap=False) as f:
            v = f.variables[var]; a = np.array(v.data, dtype='f8')
            for m in ('missing_value', '_FillValue'):
                if hasattr(v, m): a[a == np.ravel(getattr(v, m))[0]] = np.nan
            a[np.abs(a) > 1e20] = np.nan
            if hasattr(v, 'scale_factor'): a = a * float(np.ravel(v.scale_factor)[0])
            if hasattr(v, 'add_offset'): a = a + float(np.ravel(v.add_offset)[0])
            return a, np.array(f.variables['lat'].data, dtype='f8'), np.array(f.variables['lon'].data, dtype='f8'), None
    with h5py.File(p, 'r') as f:
        v = f[var]; a = v[()].astype('f8')
        for m in ('missing_value', '_FillValue'):
            if m in v.attrs: a[a == np.ravel(v.attrs[m])[0]] = np.nan
        a[np.abs(a) > 1e20] = np.nan
        if 'scale_factor' in v.attrs: a = a * float(np.ravel(v.attrs['scale_factor'])[0])
        if 'add_offset' in v.attrs: a = a + float(np.ravel(v.attrs['add_offset'])[0])
        return a, f['lat'][()], f['lon'][()], (f['level'][()] if 'level' in f else None)
def box(a, lat, lon, la, lo):
    dla = max(250 / 111.2, abs(lat[1] - lat[0]) * .6); dlo = max(250 / (111.2 * max(math.cos(math.radians(la)), .15)), abs(lon[1] - lon[0]) * .6)
    ila = np.abs(lat - la) <= dla; ilo = np.abs((lon - lo + 180) % 360 - 180) <= dlo
    w = np.cos(np.radians(lat[ila]))[:, None] * np.ones(ilo.sum())
    sub = a[..., ila, :][..., ilo]; ok = np.isfinite(sub)
    return np.where(ok.sum((-1, -2)) > 0, np.nansum(sub * w, (-1, -2)) / np.maximum((ok * w).sum((-1, -2)), 1e-9), np.nan)
C2K = lambda x: x - 273.15 if np.nanmean(x) > 100 else x
F = {'T': ('ghcn_air_ltm.nc', 'air', C2K), 'P_land': ('gpcc_ltm_1x1.nc', 'precip', None), 'P_sea': ('gpcp_ltm.nc', 'precip', None), 'Tx': ('tmax.2m.mon.ltm.1991-2020.nc', 'tmax', C2K), 'Tn': ('tmin.2m.mon.ltm.1991-2020.nc', 'tmin', C2K),
     'T2n': ('air.2m.mon.ltm.1991-2020.nc', 'air', C2K), 'q2': ('shum.2m.mon.ltm.1991-2020.nc', 'shum', None), 'wind': ('wspd.10m.mon.ltm.1991-2020.nc', 'wspd', None), 'CL': ('tcdc.eatm.mon.ltm.1991-2020.nc', 'tcdc', None),
     'SW': ('dswrf.sfc.mon.ltm.1991-2020.nc', 'dswrf', None), 'LE': ('lhtfl.sfc.mon.ltm.1991-2020.nc', 'lhtfl', None), 'H': ('shtfl.sfc.mon.ltm.1991-2020.nc', 'shtfl', None), 'SLP': ('slp.mon.ltm.1991-2020.nc', 'slp', None)}
D = {k: load(fn, v) for k, (fn, v, _) in F.items()}
air = load('air.mon.ltm.1991-2020.nc', 'air'); hgt = load('hgt.mon.ltm.1991-2020.nc', 'hgt'); rh = load('rhum.mon.ltm.1991-2020.nc', 'rhum')
def rv(k, la, lo):
    a, lat, lon, _ = D[k]; f = F[k][2]
    return box(f(a) if f else a, lat, lon, la, lo)
def lev_t(la, lo, z):
    T = box(C2K(air[0]), air[1], air[2], la, lo); Z = box(hgt[0], hgt[1], hgt[2], la, lo)
    return np.array([np.interp(z, Z[m], T[m]) for m in range(12)])
def es(t): return 6.112 * np.exp(17.67 * t / (t + 243.5))
def td_of_q(q, p=1000.0):
    q = q / 1000.0                   # plik NCEP podaje g/kg
    e = q * p / (0.622 + q); x = np.log(np.maximum(e, 1e-3) / 6.112); return 243.5 * x / (17.67 - x)
KEYS = ['T', 'Tx', 'Tn', 'Td', 'P', 'CL', 'wiatr', 'SLP', 'SW', 'LE', 'H', 'T1.5', 'T3', 'T5.6', 'RH850', 'RH700']
TAB = {}
for name, (la, lo) in SITES.items():
    ref = {k: rv(k, la, lo) for k in F}
    T_r = np.where(np.isfinite(ref['T']), ref['T'], ref['T2n'])
    # GPCC: mm w miesiącu, GPCP: mm/d (atrybut units plików); słońce w tabeli to średnia licznika od północy z próbek co 3 h – nie porównywać z normą
    P_r = np.where(np.isfinite(ref['P_land']), ref['P_land'] / np.array(DIM), ref['P_sea'])
    for mon in MONTHS:
        fn = os.path.join(OUT, f'{name}_{mon}.json')
        if not os.path.exists(fn): continue
        o = json.load(open(fn, encoding='utf-8'))
        if o.get('nan'): TAB[name, mon] = {'nan': True}; continue
        g = (lambda fld, cnt: lambda k: fld[k] / cnt if k in fld else float('nan'))(o['m'], o['n'])
        p = np.array(o['prof']); pm = p[:, 1] / o['np']; pd_ = p[:, 2] / o['np']; pz = p[:, 0]
        cov = g('COVER'); cov = cov * 100 if cov <= 1.5 else cov
        slp = ref['SLP'][mon]; slp = slp / 100 if slp > 5000 else slp
        L = {'T': (g('T2'), T_r[mon]), 'Td': (g('TD2'), td_of_q(ref['q2'][mon])), 'P': (o['pr'] / max(o['nd'], 1), P_r[mon]), 'CL': (cov, ref['CL'][mon]), 'wiatr': (g('U10'), ref['wind'][mon]), 'SLP': (g('PSL'), slp), 'SW': (g('SW'), ref['SW'][mon]), 'LE': (g('LE'), ref['LE'][mon]), 'H': (g('H'), ref['H'][mon])}
        if o.get('nx'): L['Tx'] = (o['tx'] / o['nx'], ref['Tx'][mon]); L['Tn'] = (o['tn'] / o['nx'], ref['Tn'][mon])
        for z, k in ((1500, 'T1.5'), (3000, 'T3'), (5600, 'T5.6')): L[k] = (float(np.interp(z, pz, pm)), lev_t(la, lo, z)[mon])
        for pp, k in ((850, 'RH850'), (700, 'RH700')):
            i = list(hgt[3]).index(pp); z = box(hgt[0][:, i], hgt[1], hgt[2], la, lo)[mon]; j = list(rh[3]).index(pp); r0 = box(rh[0][:, j], rh[1], rh[2], la, lo)[mon]
            L[k] = (float(100 * es(np.interp(z, pz, pd_)) / es(np.interp(z, pz, pm))), r0)
        TAB[name, mon] = {'L': L, 'o': o, 'g': g, 'cov': cov}
print('=== Każde miejsce: model / norma (w polach T, Tx, Tn, Td [°C], P [mm/d], zachmurzenie [%]) ===')
for name in SITES:
    ms = [m for m in MONTHS if (name, m) in TAB]
    if not ms: continue
    print(f'\n{name}: teren {next((TAB[name, m]["o"]["hgt"] for m in ms if "o" in TAB[name, m]), 0):.0f} m, ląd/woda {next(([round(x, 2) for x in TAB[name, m]["o"]["land"]] for m in ms if "o" in TAB[name, m]), "")}')
    print('  mies |' + ''.join(f'{k:>12s}' for k in KEYS[:6]) + ' |  CAPE15 maks ≥2000% | ≥1mm ≥10 ≥50 maks | mgła6h% | Tmaxa Tmina | słońce h/d W')
    for m in ms:
        e = TAB[name, m]
        if 'nan' in e: print(f'  {RZ[m]:>4s} | NaN'); continue
        o = e['o']; L = e['L']
        s = f'  {RZ[m]:>4s} |'
        for k in KEYS[:6]:
            s += (f'{L[k][0]:6.1f}/{L[k][1]:5.1f}' if k in L else ' ' * 12)
        nd = max(o['nd'], 1); n15 = max(o['n15'], 1)
        s += f' | {o["cape15"] / n15:5.0f} {o["cmx"]:5.0f} {100 * o["c2"] / n15:5.1f}'
        s += f' | {100 * o["d1"] / nd:3.0f}% {100 * o["d10"] / nd:4.1f}% {100 * o["d50"] / nd:4.2f}% {o["prx"]:4.0f} | {100 * o["fog6"] / max(o["n6"], 1):4.0f}'
        s += f' | {o["txa"]:5.1f} {o["tna"]:6.1f} | {e["g"]("SUNH"):4.1f} {e["g"]("W"):.2f}'
        print(s)
    good = [m for m in ms if 'L' in TAB[name, m]]
    if len(good) == 4:
        a = np.array([TAB[name, m]['L']['T'][0] for m in good]); b = np.array([TAB[name, m]['L']['T'][1] for m in good])
        print(f'  T: śr. błąd {np.mean(a - b):+.1f} K, amplituda {a.max() - a.min():.1f} przy {b.max() - b.min():.1f} K, najcieplej {RZ[good[int(a.argmax())]]} (norma {RZ[good[int(b.argmax())]]})')
        pa = np.array([TAB[name, m]['L']['P'][0] for m in good]); pb = np.array([TAB[name, m]['L']['P'][1] for m in good])
        print(f'  P: {100 * pa.sum() / max(pb.sum(), .01):.0f}% normy, najmokrzej {RZ[good[int(pa.argmax())]]} (norma {RZ[good[int(pb.argmax())]]})')
print('\n=== Wszystkie parametry: średni błąd model − norma ===')
print('          ' + ''.join(f'{k:>7s}' for k in KEYS))
for m in MONTHS + [None]:
    s = f'{RZ[m] if m is not None else "razem":>9s} '
    for k in KEYS:
        v = [(e['L'][k][0] - e['L'][k][1]) if k != 'P' else (e['L'][k][0] - e['L'][k][1]) for (n, mm), e in TAB.items() if (m is None or mm == m) and 'L' in e and k in e['L'] and np.isfinite(e['L'][k][1])]
        s += f'{np.mean(v):7.1f}' if v else ' ' * 7
    print(s)
print('\nŚredni błąd bezwzględny (wszystkie miesiące):')
print('          ' + ''.join(f'{k:>7s}' for k in KEYS))
s = '          '
for k in KEYS:
    v = [abs(e['L'][k][0] - e['L'][k][1]) for e in TAB.values() if 'L' in e and k in e['L'] and np.isfinite(e['L'][k][1])]
    s += f'{np.mean(v):7.1f}' if v else ' ' * 7
print(s)
print('\nBłąd T [K] wg miejsca i miesiąca / opad jako % normy:')
for name in SITES:
    t = [TAB.get((name, m)) for m in MONTHS]
    if not any(t): continue
    print(f'  {name:13s} ' + ' '.join(f'{(e["L"]["T"][0] - e["L"]["T"][1]):+5.1f}' if e and 'L' in e else '  NaN' for e in t) + '  |  ' + ' '.join(f'{100 * e["L"]["P"][0] / max(e["L"]["P"][1], .05):5.0f}' if e and 'L' in e else '  NaN' for e in t))
