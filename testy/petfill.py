# Wypelnianie nizow w glab ladu: pas 45-62.5N, wg dlugosci: (a) odch. std. dobowego cisnienia, (b) glebokosc osrodkow wzgledem sredniej miesiaca w tym miejscu,
# (c) srednia zmiana cisnienia w osrodku na dobe przy sledzeniu (najblizszy osrodek nastepnej doby <= 12.5 st.). python fill.py <katalog NCEP> <M> plik.out...
import sys, glob, json, datetime, numpy as np, h5py
dl, M, outs = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
LA0, LO0, NA, NB = 25.0, -80.0, 22, 57
lats = LA0 + 2.5 * np.arange(NA); lons = LO0 + 2.5 * np.arange(NB)
JJ = np.round((90 - lats) / 2.5).astype(int); II = np.round(((lons + 360) % 360) / 2.5).astype(int)
SEC = [(-40, -20, 'Atl. −40…−20'), (-20, 0, 'Atl. −20…0'), (0, 15, '0…15E'), (15, 30, '15…30E'), (30, 50, '30…50E')]
def centers(d):
    r = []
    for a in range(2, NA - 2):
        if not (42.5 <= lats[a] <= 65): continue
        for b in range(2, NB - 2):
            w = d[a-2:a+3, b-2:b+3]
            if np.isnan(d[a, b]) or d[a, b] > np.nanmin(w): continue
            r.append((a, b, d[a, b]))
    return r
def stats(months):   # lista tablic (dni, NA, NB)
    sd = {s[2]: [] for s in SEC}; dep = {s[2]: [] for s in SEC}; dpdt = {s[2]: [] for s in SEC}
    band = (lats >= 45) & (lats <= 62.5)
    for D in months:
        mean = np.nanmean(D, axis=0); s = np.nanstd(D, axis=0)
        for lo, hi, n in SEC:
            mk = np.outer(band, (lons >= lo) & (lons < hi)); sd[n].append(np.nanmean(s[mk]))
        prev = None
        for d in D:
            c = [x for x in centers(d) if x[2] - mean[x[0], x[1]] < -8]      # osrodki >= 8 hPa ponizej sredniej miejsca
            for a, b, p in c:
                for lo, hi, n in SEC:
                    if lo <= lons[b] < hi: dep[n].append(p - mean[a, b])
            if prev is not None:
                for a0, b0, p0 in prev:
                    best = None
                    for a, b, p in c:
                        dd = np.hypot((a - a0) * 2.5, (b - b0) * 2.5 * np.cos(np.radians(lats[a0])))
                        if b >= b0 - 2 and dd <= 12.5 and (best is None or dd < best[0]): best = (dd, p)
                    for lo, hi, n in SEC:
                        if lo <= lons[b0] < hi: dpdt[n].append((best[1] - p0) if best else np.nan)
            prev = c
    return sd, dep, dpdt
def show(tag, months):
    sd, dep, dpdt = stats(months); nd = sum(len(D) for D in months)
    print(f'{tag} ({nd} dób)')
    for lo, hi, n in SEC:
        t = np.array(dpdt[n], float); ok = ~np.isnan(t)
        print(f'   {n:14s} σ {np.mean(sd[n]):5.1f} hPa | ośrodków/30 d {len(dep[n]) / nd * 30:5.1f}  głębokość śr. {np.mean(dep[n]) if dep[n] else 0:6.1f}  | zmiana w ośrodku na dobę {np.nanmean(t) if ok.any() else 0:+5.1f} hPa (śledzonych {ok.sum()}, zanikło {100 * (1 - ok.mean()) if len(t) else 0:3.0f}%)')
nc = []
for f in sorted(glob.glob(dl + '/slp.20*.nc')):
    h = h5py.File(f, 'r'); v = h['slp']; a = v[:].astype(float) * v.attrs.get('scale_factor', 1.0) + v.attrs.get('add_offset', 0.0)
    if np.nanmean(a) > 5000: a /= 100
    t = h['time'][:]; d0 = datetime.datetime(1800, 1, 1)
    mo = np.array([(d0 + datetime.timedelta(hours=float(x))).month for x in t])
    nc.append(a[mo == M][:, JJ][:, :, II])
show('NCEP', nc)
mod = []
for f in outs:
    o = next(json.loads(l[l.find('JSON ') + 5:]) for l in open(f, encoding='utf-8', errors='replace') if 'JSON ' in l)
    mod.append(np.array([[np.nan if x is None else x for x in d] for d in o['days']]).reshape(-1, NA, NB))
show('model', mod)
