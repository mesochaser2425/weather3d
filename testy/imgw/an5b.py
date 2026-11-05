# Dodatkowe diagnozy do 4_pelne_lata.csv. Użycie: python -I -X utf8 an5b.py <csv> <ref_all.json> <norms_all.json> <cala polska.json> <an5.py>
import collections, csv, datetime, json, math, re, statistics as SS, sys
CSV, REFD, NORM, STATE, AN5 = sys.argv[1:6]
f = lambda x: float(x.replace(',', '.'))
D0 = datetime.date(2026, 1, 1)
date = lambda d: D0 + datetime.timedelta(days=d - 1)
RZ = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
COL = dict(Tn='Tmin_C', Tx='Tmax_C', T='Tmean_C', Td='Td_mean_C', RH='RH_mean_%', P='precip_mm', Sn='snow_mm', W='wind_mean_m_s', G='gust_max_m_s', PSL='pressure_mean_hPa', CL='cloud_cover_mean_%', S='sunshine_h', SD='snow_depth_cm', Vis='visibility_min_km', Fog='fog_h', ET='evapotranspiration_mm', S2='soil_10_40cm_%vol')
S = collections.OrderedDict(); INFO = {}
for r in csv.DictReader(open(CSV, encoding='utf-8-sig'), delimiter=';'):
    if not r.get('Tmin_C') or r['station'][:1] == '#': continue
    s = r['station']; d = int(r['sim_day'])
    if date(d).year > 2029: continue
    if s not in S: S[s] = {}; INFO[s] = dict(x=f(r['x_km']), y=f(r['y_km']), h=int(r['height_m']))
    e = {k: f(r[c]) for k, c in COL.items()}; e['dir'] = r['prevailing_dir']
    S[s][d] = e
DAYS = sorted(next(iter(S.values())))
R = json.load(open(REFD, encoding='utf-8')); NR = json.load(open(NORM, encoding='utf-8'))
# te same pary i regiony co w an5.py
src = open(AN5, encoding='utf-8').read()
ns = {}
exec(re.search(r"PAIR = \{.*?\n\s+'Przemyśl'.*?\}\n", src, re.S).group(0), ns)
PAIR = ns['PAIR']
exec('import collections\n' + re.search(r"REG = collections\.OrderedDict\(\[.*?\]\)\n", src, re.S).group(0), ns)
REG = ns['REG']
ALL = [s for g in REG.values() for s in g]; LOW = [s for g, L in REG.items() if g != 'podgórze i góry' for s in L]
ADJ = {s: (0.0065 * (PAIR[s][1] - INFO[s]['h']) if abs(PAIR[s][1] - INFO[s]['h']) >= 30 else 0.0) for s in S}
mean = lambda v: (lambda q: SS.mean(q) if q else None)([x for x in v if x is not None])
def nm(s, v, m):
    a = NR[PAIR[s][0]]['m'].get(v)
    return a[m - 1]['mean'] if a and a[m - 1] else None
def regress(xs, ys):
    mx, my = SS.mean(xs), SS.mean(ys); sxx = sum((a - mx) ** 2 for a in xs)
    b = sum((a - mx) * (c - my) for a, c in zip(xs, ys)) / sxx
    return b, b * math.sqrt(sxx) / math.sqrt(sum((c - my) ** 2 for c in ys))
SEAS = collections.OrderedDict([('DJF', [12, 1, 2]), ('MAM', [3, 4, 5]), ('JJA', [6, 7, 8]), ('SON', [9, 10, 11]), ('ROK', list(range(1, 13)))])
# ---------- mgła ----------
print('MGŁA: dni z ≥ 1 h widzialności < 1 km (model) / dni z mgłą ≥ 1 h (IMGW), niziny; część dób z opadem i z RH; widzialność')
for m in range(1, 13):
    L = [S[s][d] for s in LOW for d in DAYS if date(d).month == m]
    fg = [e for e in L if e['Fog'] >= 1]
    n = mean(nm(s, 'fogd', m) for s in LOW)
    print(f"  {RZ[m-1]:4s} {len(fg) / len(LOW) / 4:5.1f}/{n:4.1f} dni | średnio {mean(e['Fog'] for e in fg) or 0:4.1f} h | z opadem ≥ 0.1: {100 * sum(e['P'] >= 0.1 for e in fg) / max(len(fg), 1):3.0f}% | ≥ 1 mm: {100 * sum(e['P'] >= 1 for e in fg) / max(len(fg), 1):3.0f}% | RH {mean(e['RH'] for e in fg) or 0:3.0f} | CL {mean(e['CL'] for e in fg) or 0:3.0f} | W {mean(e['W'] for e in fg) or 0:.1f}")
fg = [(s, e) for s in LOW for e in S[s].values() if e['Fog'] >= 1]
print('  bez opadu ≥ 1 mm i ≥ 3 h:', round(sum(1 for s, e in fg if e['P'] < 1 and e['Fog'] >= 3) / len(LOW) / 4, 1), 'dni/rok; ≥ 6 h:', round(sum(1 for s, e in fg if e['Fog'] >= 6) / len(LOW) / 4, 1))
print('  wg stacji (dni/rok, norma):', [(s[:8], round(sum(e['Fog'] >= 1 for e in S[s].values()) / 4), round(sum(nm(s, 'fogd', m) or 0 for m in range(1, 13)))) for s in ['Poznań', 'Warszawa', 'Kraków', 'Wrocław', 'Suwałki', 'Gdańsk', 'Rzeszów', 'Zakopane']])
# ---------- mrozy ----------
print('\nMROZY: noce Tn ≤ −10 / ≤ −15 / ≤ −20 na rok, model / IMGW; dni Tx ≤ −5; serie Tx < 0')
reg_ = {k: v for k, v in REG.items()}; reg_['kraj'] = ALL
for g, L in reg_.items():
    o = collections.defaultdict(list)
    for s in L:
        c = PAIR[s][0]; adj = ADJ[s]
        dd = R[c]['days']; nd = sum(1 for e in dd.values() if e.get('tn') is not None)
        if nd < 5000: continue
        yr = nd / 365.25
        for th in (-10, -15, -20):
            o[f'm{th}'].append(sum(e['Tn'] <= th for e in S[s].values()) / 4); o[f'r{th}'].append(sum(1 for e in dd.values() if e.get('tn') is not None and e['tn'] + adj <= th) / yr)
        o['mx5'].append(sum(e['Tx'] <= -5 for e in S[s].values()) / 4); o['rx5'].append(sum(1 for e in dd.values() if e.get('tx') is not None and e['tx'] + adj <= -5) / yr)
    print(f"  {g[:16]:16s} Tn≤−10 {mean(o['m-10']):5.1f}/{mean(o['r-10']):5.1f} ≤−15 {mean(o['m-15']):4.1f}/{mean(o['r-15']):4.1f} ≤−20 {mean(o['m-20']):4.2f}/{mean(o['r-20']):4.2f} | Tx≤−5 {mean(o['mx5']):4.1f}/{mean(o['rx5']):4.1f}")
# ---------- ciśnienie w miesiącach ----------
print('\nCIŚNIENIE w miesiącach: model − IMGW (śr. 5 stacji: Warszawa, Poznań, Kraków, Gdańsk, Suwałki) i σ dobowa model / IMGW')
CH = ['Warszawa', 'Poznań', 'Kraków', 'Gdańsk', 'Suwałki']
for m in range(1, 13):
    a = mean(mean(S[s][d]['PSL'] for d in DAYS if date(d).month == m) for s in CH)
    sa = mean(SS.pstdev([S[s][d]['PSL'] for d in DAYS if date(d).month == m]) for s in CH)
    b = []; sb = []
    for s in CH:
        v = [e['psl'] for k, e in R[PAIR[s][0]]['days'].items() if int(k[5:7]) == m and e.get('psl') is not None]
        b.append(SS.mean(v)); sb.append(SS.pstdev(v))
    print(f"  {RZ[m-1]:4s} {a:7.1f} / {SS.mean(b):7.1f} ({a - SS.mean(b):+5.1f}) σ {sa:4.1f}/{SS.mean(sb):4.1f}")
# ---------- zachmurzenie, słońce, opad, T wzdłuż osi W–E ----------
print('\nWZDŁUŻ OSI W–E (niziny, x od zachodniego brzegu widocznej domeny; nachylenie na 100 km, r): CL−norma, S%, P%, dT')
bins = [(0, 150), (150, 300), (300, 450), (450, 600), (600, 800)]
for sk, ms in SEAS.items():
    X = []; C = []; Sp = []; P = []; T = []
    for s in LOW:
        cl = [nm(s, 'CL', m) for m in ms]; su = [nm(s, 'S', m) for m in ms]
        dd = [S[s][d] for d in DAYS if date(d).month in ms]
        X.append(INFO[s]['x'])
        C.append(SS.mean(e['CL'] for e in dd) - SS.mean(x * 12.5 for x in cl) if all(x is not None for x in cl) else None)
        Sp.append(100 * sum(e['S'] for e in dd) / 4 / sum(su) if all(x is not None for x in su) else None)
        P.append(100 * sum(e['P'] for e in dd) / 4 / sum(nm(s, 'P', m) for m in ms))
        T.append(SS.mean(e['T'] for e in dd) - (SS.mean(nm(s, 'T', m) for m in ms) + ADJ[s]))
    out = []
    for nmx, V in (('CL', C), ('S%', Sp), ('P%', P), ('dT', T)):
        q = [(a, b) for a, b in zip(X, V) if b is not None]
        b_, r_ = regress([a for a, _ in q], [b for _, b in q])
        bv = [mean(b for a, b in q if lo <= a < hi) for lo, hi in bins]
        out.append(f"{nmx} " + ' '.join(f'{v:5.1f}' for v in bv) + f" ({100 * b_:+.1f}, r{r_:+.2f})")
    print(f"  {sk}: " + ' | '.join(out))
# ---------- wg kierunku wiatru: zachmurzenie, słońce wzdłuż osi ----------
print('\nWG KIERUNKU NAPŁYWU: zachmurzenie i opad wzdłuż osi (odległość od brzegu napływu rośnie w kierunku wiatru)')
SECT = {'W': {'WSW', 'W', 'WNW', 'SW', 'NW'}, 'E': {'ENE', 'E', 'ESE', 'NE', 'SE'}, 'N': {'N', 'NNE', 'NNW'}, 'S': {'S', 'SSE', 'SSW'}}
sec = {}
for d in DAYS:
    c = collections.Counter()
    for s in LOW:
        for k, v in SECT.items():
            if S[s][d]['dir'] in v: c[k] += 1
    k, n = c.most_common(1)[0]
    sec[d] = k if n >= 0.6 * len(LOW) else '?'
xb = [(0, 150), (150, 300), (300, 450), (450, 600), (600, 800)]
yb = [(0, 150), (150, 300), (300, 450), (450, 550), (550, 800)]
for sk, ms in list(SEAS.items())[:4]:
    for k in ['W', 'E', 'N', 'S']:
        dd = [d for d in DAYS if sec[d] == k and date(d).month in ms]
        if len(dd) < 20: continue
        bb, ax = (xb, 'x') if k in 'WE' else (yb, 'y')
        pc = lambda key: ' '.join(f"{mean(mean(S[s][d][key] for d in dd) for s in LOW if lo <= INFO[s][ax] < hi):5.1f}" for lo, hi in bb)
        print(f"  {sk} {k} ({100 * len(dd) / sum(1 for d in DAYS if date(d).month in ms):2.0f}% dób) {ax}: P {pc('P')} | CL {pc('CL')} | RH {pc('RH')} | T {pc('T')}")
# ---------- wiatr wg pokrycia ----------
st = json.load(open(STATE, encoding='utf-8'))
NXV = st['grid']['nx'] + 2 * st['grid']['mg']; MG = st['grid']['mg']; lm = st['lmask']; hv = st['hv']; wm = st['wmask']
K = [1, 4, 6, 4, 1]
print('\nWIATR a pokrycie (stan „cala polska”, 7.5 km; klasa oczka i udział lasu 5×5, tylko stacje w tamtej domenie)')
rows = []
for s in ALL:
    xo = INFO[s]['x'] - 7.6; yo = INFO[s]['y'] - 8.5
    i = MG + int(xo // 7.5); j = MG + int(yo // 7.5)
    if not (2 <= i < NXV - 2 and 2 <= j < NXV - 2): continue
    wf = wu = ww = ws = 0.0
    for dj in range(-2, 3):
        for di in range(-2, 3):
            q = K[di + 2] * K[dj + 2]; c = (j + dj) * NXV + i + di; ws += q
            if wm[c] > 0: ww += q
            elif lm[c] == 1: wf += q
            elif lm[c] == 2: wu += q
    W = SS.mean(e['W'] for e in S[s].values()); G = SS.mean(e['G'] for e in S[s].values()); n = mean(nm(s, 'WS', m) for m in range(1, 13)) if all(nm(s, 'WS', m) is not None for m in range(1, 13)) else None
    rows.append(dict(s=s, cls=lm[j * NXV + i], wat=wm[j * NXV + i], hc=hv[j * NXV + i], h=INFO[s]['h'], forest=wf / ws, urb=wu / ws, water=ww / ws, W=W, n=n))
for r in sorted(rows, key=lambda r: -r['W']): print(f"  {r['s'][:16]:16s} W {r['W']:.1f}/{r['n'] if r['n'] is None else round(r['n'], 1)} | klasa {r['cls']} woda {r['wat']} | las {100 * r['forest']:3.0f}% zab. {100 * r['urb']:3.0f}% woda {100 * r['water']:3.0f}% | teren oczka {r['hc']:.0f} (stacja {r['h']})")
q = [r for r in rows if r['h'] < 400]
for k, lab in (('forest', 'las'), ('urb', 'zabudowa'), ('water', 'woda')):
    b_, r_ = regress([r[k] for r in q], [r['W'] for r in q]); print(f"  W a udział {lab} (5×5): {b_:+.2f} m/s na 100%, r={r_:+.2f}")
cc = collections.defaultdict(list)
for r in q:
    if r['wat'] <= 0: cc[r['cls']].append(r['W'])
print('  średni W wg klasy oczka:', {k: (round(SS.mean(v), 2), len(v)) for k, v in sorted(cc.items())})
# ---------- wariancja miesięcy ----------
print('\nZMIENNOŚĆ między latami: σ odchyleń miesięcznych T (śr. kraj) i CV opadu, model (4 lata) / IMGW (te same stacje)')
codes = sorted(set(PAIR[s][0] for s in ALL))
RM = collections.defaultdict(dict)
for c in codes:
    by = collections.defaultdict(list)
    for k, e in R[c]['days'].items(): by[(int(k[:4]), int(k[5:7]))].append(e)
    for ym, L in by.items():
        tv = [e['tm'] for e in L if e.get('tm') is not None]; pv = [e['p'] for e in L if e.get('p') is not None]
        if len(tv) >= 27: RM[c].setdefault(ym, {})['T'] = SS.mean(tv)
        if len(pv) >= 27: RM[c].setdefault(ym, {})['P'] = sum(pv)
def natl(m, v):
    cl = {c: mean(RM[c][(y, m)][v] for y in range(1991, 2021) if v in RM[c].get((y, m), {})) for c in codes}
    cl = {c: x for c, x in cl.items() if x is not None}
    return [SS.mean(an) + mean(cl.values()) for y in range(1991, 2021) for an in [[RM[c][(y, m)][v] - cl[c] for c in cl if v in RM[c].get((y, m), {})]] if len(an) >= 0.7 * len(cl)]
sm = []; sr = []; cm = []; cr = []
for m in range(1, 13):
    mt = [SS.mean(SS.mean(S[s][d]['T'] for d in DAYS if date(d).year == y and date(d).month == m) for s in ALL) for y in (2026, 2027, 2028, 2029)]
    mp = [SS.mean(sum(S[s][d]['P'] for d in DAYS if date(d).year == y and date(d).month == m) for s in ALL) for y in (2026, 2027, 2028, 2029)]
    sm.append(SS.stdev(mt)); sr.append(SS.stdev(natl(m, 'T'))); cm.append(SS.stdev(mp) / SS.mean(mp)); r_ = natl(m, 'P'); cr.append(SS.stdev(r_) / SS.mean(r_))
print('  σ T miesięcy:', [f"{RZ[i]} {sm[i]:.1f}/{sr[i]:.1f}" for i in range(12)])
print(f"  średnio σ T {math.sqrt(mean(x * x for x in sm)):.2f}/{math.sqrt(mean(x * x for x in sr)):.2f} | CV opadu {mean(cm):.2f}/{mean(cr):.2f}")
# ---------- sucha gleba i upał ----------
print('\nLATO: wilgotność 10–40 cm, opad i T wg miesiąca i roku (niziny)')
for y in (2026, 2027, 2028, 2029):
    line = []
    for m in (4, 5, 6, 7, 8, 9):
        dd = [d for d in DAYS if date(d).year == y and date(d).month == m]
        line.append(f"{RZ[m-1]} θ {mean(mean(S[s][d]['S2'] for d in dd) for s in LOW):4.1f} P {mean(sum(S[s][d]['P'] for d in dd) for s in LOW):3.0f} ET {mean(sum(S[s][d]['ET'] for d in dd) for s in LOW):3.0f} T {mean(mean(S[s][d]['T'] for d in dd) for s in LOW):4.1f}")
    print(f"  {y}: " + ' | '.join(line))
# zależność Tx od wilgotności gleby przy pogodzie bezchmurnej (lipiec)
print('\nJJA, doby bezchmurne (CL < 30%) wg wilgotności 10–40 cm: Tx, RH, ET, Bowen (nie liczony), Td')
for lo, hi in ((10, 17), (17, 20), (20, 24), (24, 28), (28, 45)):
    L = [e for s in LOW for d, e in S[s].items() if date(d).month in (6, 7, 8) and e['CL'] < 30 and lo <= e['S2'] < hi]
    if L: print(f"  θ {lo}–{hi}%: {len(L):5d} dób, Tx {mean(e['Tx'] for e in L):4.1f}, Tn {mean(e['Tn'] for e in L):4.1f}, RH {mean(e['RH'] for e in L):3.0f}, ET {mean(e['ET'] for e in L):.2f} mm/d, Td {mean(e['Td'] for e in L):4.1f}")
print('  udział stacjo-dób JJA wg θ:', {f'{lo}-{hi}': round(100 * sum(1 for s in LOW for d, e in S[s].items() if date(d).month in (6, 7, 8) and lo <= e['S2'] < hi) / (len(LOW) * sum(1 for d in DAYS if date(d).month in (6, 7, 8)))) for lo, hi in ((10, 17), (17, 20), (20, 24), (24, 28), (28, 45))})
# ---------- ciepłe noce a kierunek ----------
print('\nJJA: częstość kierunku a noce Tn ≥ 18 (niziny): udział dób, udział ciepłych nocy, śr. Tn, Tx, Td')
SEC2 = {'SE–SW': {'SE', 'SSE', 'S', 'SSW', 'SW'}, 'W–NW': {'WSW', 'W', 'WNW', 'NW'}, 'N–NE': {'NNW', 'N', 'NNE', 'NE'}, 'E': {'ENE', 'E', 'ESE'}}
A = [e for s in LOW if s != 'Warszawa' for d, e in S[s].items() if date(d).month in (6, 7, 8)]
W_ = [e for e in A if e['Tn'] >= 18]
for k, v in SEC2.items():
    q = [e for e in A if e['dir'] in v]; q2 = [e for e in W_ if e['dir'] in v]
    print(f"  {k:6s} dób {100 * len(q) / len(A):3.0f}% | ciepłych nocy {100 * len(q2) / len(W_):3.0f}% | Tn {mean(e['Tn'] for e in q):4.1f} Tx {mean(e['Tx'] for e in q):4.1f} Td {mean(e['Td'] for e in q):4.1f} W {mean(e['W'] for e in q):.1f} CL {mean(e['CL'] for e in q):3.0f} P {mean(e['P'] for e in q):.1f}")
