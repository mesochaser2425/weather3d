# Sprawdzenia końcowe: istotność zmienności ciśnienia, dni z rozległym opadem, normy 9 stacji południa. Użycie jak an5b.py
import collections, csv, datetime, json, math, re, statistics as SS, sys
CSV, REFD, NORM, STATE, AN5 = sys.argv[1:6]
f = lambda x: float(x.replace(',', '.'))
D0 = datetime.date(2026, 1, 1)
date = lambda d: D0 + datetime.timedelta(days=d - 1)
RZ = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
S = collections.OrderedDict(); INFO = {}
for r in csv.DictReader(open(CSV, encoding='utf-8-sig'), delimiter=';'):
    if not r.get('Tmin_C') or r['station'][:1] == '#': continue
    s = r['station']; d = int(r['sim_day'])
    if date(d).year > 2029: continue
    if s not in S: S[s] = {}; INFO[s] = dict(x=f(r['x_km']), y=f(r['y_km']), h=int(r['height_m']))
    S[s][d] = dict(PSL=f(r['pressure_mean_hPa']), P=f(r['precip_mm']), W=f(r['wind_mean_m_s']), T=f(r['Tmean_C']), Tn=f(r['Tmin_C']), Tx=f(r['Tmax_C']))
DAYS = sorted(next(iter(S.values())))
R = json.load(open(REFD, encoding='utf-8')); NR = json.load(open(NORM, encoding='utf-8'))
src = open(AN5, encoding='utf-8').read(); ns = {}
exec(re.search(r"PAIR = \{.*?\n\s+'Przemyśl'.*?\}\n", src, re.S).group(0), ns); PAIR = ns['PAIR']
ALL = list(S)
mean = lambda v: (lambda q: SS.mean(q) if q else None)([x for x in v if x is not None])
# ---------- zmienność ciśnienia: σ dobowa w każdym roku ----------
CH = ['Warszawa', 'Poznań', 'Kraków', 'Gdańsk', 'Suwałki']
print('σ dobowa ciśnienia w miesiącu: model 4 lata (śr. 5 stacji) | IMGW 30 lat: śr., σ między latami, min, maks | (śr. model − śr. IMGW)/(σ/√4)')
for m in range(1, 13):
    mv = [mean(SS.pstdev([S[s][d]['PSL'] for d in DAYS if date(d).year == y and date(d).month == m]) for s in CH) for y in (2026, 2027, 2028, 2029)]
    rv = []
    for y in range(1991, 2021):
        a = []
        for s in CH:
            v = [e['psl'] for k, e in R[PAIR[s][0]]['days'].items() if k[:7] == f'{y}-{m:02d}' and e.get('psl') is not None]
            if len(v) >= 25: a.append(SS.pstdev(v))
        if a: rv.append(SS.mean(a))
    print(f"  {RZ[m-1]:4s} {' '.join(f'{x:4.1f}' for x in mv)} śr {SS.mean(mv):4.1f} | {SS.mean(rv):4.1f} ±{SS.pstdev(rv):3.1f} [{min(rv):4.1f},{max(rv):4.1f}] | t={(SS.mean(mv) - SS.mean(rv)) / (SS.pstdev(rv) / 2):+.1f}")
# ---------- dni z rozległym opadem wg pór roku ----------
print('\nDOBY z rozległym opadem (śr. wszystkich stacji ≥ próg), wg pór roku: model / IMGW [dni na rok]; udział w sumie rocznej')
SEAS = collections.OrderedDict([('DJF', [12, 1, 2]), ('MAM', [3, 4, 5]), ('JJA', [6, 7, 8]), ('SON', [9, 10, 11])])
dm = {d: SS.mean(S[s][d]['P'] for s in ALL) for d in DAYS}
codes = sorted(set(PAIR[s][0] for s in ALL))
rdm = collections.defaultdict(list)
for c in codes:
    for k, e in R[c]['days'].items():
        if e.get('p') is not None: rdm[k].append(e['p'])
rd = {k: SS.mean(v) for k, v in rdm.items() if len(v) >= 25}
for th in (5, 10, 15):
    line = []
    for sk, ms in SEAS.items():
        a = sum(1 for d, v in dm.items() if v >= th and date(d).month in ms) / 4; b = sum(1 for k, v in rd.items() if v >= th and int(k[5:7]) in ms) / 30
        line.append(f"{sk} {a:4.1f}/{b:4.1f}")
    sa = sum(v for v in dm.values() if v >= th) / sum(dm.values()); sb = sum(v for v in rd.values() if v >= th) / sum(rd.values())
    print(f"  ≥{th:2d} mm: " + ' '.join(line) + f" | udział w sumie {100 * sa:.0f}%/{100 * sb:.0f}%")
print('  doby bez rozległego opadu: średnio ', round(mean(v for v in dm.values() if v < 5), 2), 'mm (model) /', round(mean(v for v in rd.values() if v < 5), 2), 'mm (IMGW); suma z takich dób na rok', round(sum(v for v in dm.values() if v < 5) / 4), '/', round(sum(v for v in rd.values() if v < 5) / 30))
# ---------- lipiec: najmokrzejsze w IMGW ----------
jy = collections.defaultdict(float)
for k, v in rd.items():
    if k[5:7] == '07': jy[k[:4]] += v
print('\nLIPCE IMGW (śr. stacji): największe', sorted(((round(v), y) for y, v in jy.items()), reverse=True)[:4], '| model 2026:', round(sum(dm[d] for d in DAYS if date(d).year == 2026 and date(d).month == 7)))
# ---------- normy 9 stacji południa, do porównania ze starym przebiegiem ----------
COMMON = ['Kraków', 'Katowice', 'Tarnów', 'Rzeszów', 'Bielsko-Biała', 'Nowy Sącz', 'Sanok', 'Nowy Targ', 'Zakopane']
def ann(s, v, how):
    a = NR[PAIR[s][0]]['m'].get(v)
    if not a or any(x is None for x in a): return None
    return sum(x['mean'] for x in a) if how == 's' else SS.mean(x['mean'] for x in a)
print('\nNORMY 9 stacji południa (średnia dostępnych): ', {k: round(mean(ann(s, v, h) for s in COMMON), 1) for k, v, h in (('T', 'T', 'm'), ('Tx', 'Tx', 'm'), ('Tn', 'Tn', 'm'), ('RH', 'RH', 'm'), ('W', 'WS', 'm'), ('S', 'S', 's'), ('P', 'P', 's'), ('d30', 'd30', 's'), ('Tn20', 'trop', 's'), ('Tn18', 'tn18', 's'), ('P1', 'd1', 's'), ('P50', 'd50', 's'))}, 'CL', round(12.5 * mean(ann(s, 'CL', 'm') for s in COMMON)))
# ---------- wiatr a różnica wysokości stacji i oczka ----------
st = json.load(open(STATE, encoding='utf-8')); NXV = st['grid']['nx'] + 2 * st['grid']['mg']; MG = st['grid']['mg']; hv = st['hv']; wm = st['wmask']
xs = []; ys = []
for s in ALL:
    i = MG + int((INFO[s]['x'] - 7.6) // 7.5); j = MG + int((INFO[s]['y'] - 8.5) // 7.5)
    if not (0 <= i < NXV and 0 <= j < NXV) or wm[j * NXV + i] > 0: continue
    if INFO[s]['h'] > 400: continue
    xs.append(INFO[s]['h'] - hv[j * NXV + i]); ys.append(SS.mean(e['W'] for e in S[s].values()))
mx, my = SS.mean(xs), SS.mean(ys); sxx = sum((a - mx) ** 2 for a in xs); b = sum((a - mx) * (c - my) for a, c in zip(xs, ys)) / sxx
print(f"\nWIATR a (wysokość stacji − teren oczka): {100 * b:+.2f} m/s na 100 m, r={b * math.sqrt(sxx) / math.sqrt(sum((c - my) ** 2 for c in ys)):+.2f}, n={len(xs)}")
