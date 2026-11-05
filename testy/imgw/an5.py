# Analiza 4_pelne_lata.csv (cała Polska, 7.5 km, 1 I 2026 – 7 I 2030) wobec danych dobowych IMGW-PIB 1991–2020.
# Użycie: python -I -X utf8 an5.py <csv> <ref_all.json> <norms_all.json> <wyjście json>
import calendar, collections, csv, datetime, json, math, statistics as SS, sys
CSV, REFD, NORM, OUT = sys.argv[1:5]
rows = [r for r in csv.DictReader(open(CSV, encoding='utf-8-sig'), delimiter=';') if r.get('Tmin_C') and r['station'][:1] != '#']
f = lambda x: float(x.replace(',', '.'))
D0 = datetime.date(2026, 1, 1)
date = lambda d: D0 + datetime.timedelta(days=d - 1)
RZ = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
laby = lambda d: f"{date(d).day} {RZ[date(d).month - 1]} {date(d).year}"
COL = dict(Tn='Tmin_C', Tx='Tmax_C', T='Tmean_C', Td='Td_mean_C', RH='RH_mean_%', P='precip_mm', Sn='snow_mm', W='wind_mean_m_s', G='gust_max_m_s', PSL='pressure_mean_hPa', CL='cloud_cover_mean_%', S='sunshine_h', SD='snow_depth_cm', Vis='visibility_min_km', Fog='fog_h', ET='evapotranspiration_mm', S1='soil_0_10cm_%vol', S2='soil_10_40cm_%vol', S3='soil_40_100cm_%vol')
S = collections.OrderedDict(); INFO = {}
for r in rows:
    s = r['station']; d = int(r['sim_day'])
    if date(d).year > 2029: continue
    if s not in S: S[s] = {}; INFO[s] = dict(x=f(r['x_km']), y=f(r['y_km']), h=int(r['height_m']))
    e = {k: f(r[c]) for k, c in COL.items()}; e['dir'] = r['prevailing_dir']
    S[s][d] = e
DAYS = sorted(next(iter(S.values())))
R = json.load(open(REFD, encoding='utf-8'))
NR = json.load(open(NORM, encoding='utf-8'))
# stacja modelu: (kod IMGW, wysokość stacji IMGW, odległość ~km)
PAIR = {'Gdańsk': ('GDA', 5), 'Władysławowo': ('354180135', 1), 'Ustka': ('354160115', 6), 'Koszalin': ('354160105', 32), 'Szczecin': ('353140205', 1), 'Słupsk': ('354170125', 81),
        'Grudziądz': ('353180250', 69), 'Elbląg': ('354190160', 189), 'Olsztyn': ('353200272', 133), 'Białystok': ('353230295', 148), 'Suwałki': ('354220195', 184), 'Biała Podlaska': ('352230399', 133),
        'Warszawa': ('352200375', 106), 'Siedlce': ('352220385', 146), 'Lublin': ('351220495', 238), 'Chełm': ('351230497', 177), 'Radom': ('351210488', 120), 'Kielce': ('350200570', 261),
        'Rzeszów': ('350220580', 200), 'Tarnów': ('350200575', 209), 'Łódź': ('351190465', 187), 'Bydgoszcz': ('353180250', 69), 'Toruń': ('353180250', 69), 'Poznań': ('352160330', 84),
        'Wrocław': ('351160424', 120), 'Bielsko-Biała': ('349190600', 396), 'Kraków': ('350190566', 237), 'Częstochowa': ('350190550', 293), 'Kalisz': ('351180435', 140), 'Leszno': ('351160418', 91),
        'Legnica': ('351160415', 122), 'Wałbrzych': ('350160520', 356), 'Jelenia Góra': ('350150500', 342), 'Zielona Góra': ('351150400', 192), 'Gorzów Wielkopolski': ('352150300', 64),
        'Świnoujście': ('353140200', 6), 'Kołobrzeg': ('354150100', 5), 'Bytów': ('354170125', 81), 'Kościerzyna': ('353170235', 172), 'Świdwin': ('353150210', 52), 'Miastko': ('353170235', 172),
        'Złocieniec': ('353160230', 72), 'Piła': ('353160230', 72), 'Konin': ('352180345', 116), 'Opole': ('350170530', 176), 'Katowice': ('350190560', 284), 'Nowy Sącz': ('349200660', 292),
        'Nowy Targ': ('249200320', 575), 'Zakopane': ('349190625', 855), 'Ciechanów': ('353200270', 147), 'Łomża': ('353230295', 148), 'Płock': ('352190360', 106), 'Sandomierz': ('350210585', 217),
        'Przemyśl': ('350220580', 200), 'Sanok': ('249220080', 300), 'Ustrzyki Dolne': ('349220690', 420)}
assert set(PAIR) == set(S), set(PAIR) ^ set(S)
REG = collections.OrderedDict([
    ('wybrzeże', ['Świnoujście', 'Kołobrzeg', 'Ustka', 'Władysławowo', 'Gdańsk']),
    ('północ', ['Szczecin', 'Koszalin', 'Słupsk', 'Świdwin', 'Złocieniec', 'Miastko', 'Bytów', 'Kościerzyna', 'Piła', 'Grudziądz', 'Elbląg', 'Olsztyn', 'Suwałki', 'Białystok', 'Łomża', 'Ciechanów']),
    ('zachód', ['Gorzów Wielkopolski', 'Zielona Góra', 'Poznań', 'Leszno', 'Legnica', 'Wrocław', 'Opole', 'Kalisz', 'Konin', 'Bydgoszcz', 'Toruń']),
    ('centrum i wschód', ['Płock', 'Warszawa', 'Łódź', 'Siedlce', 'Biała Podlaska', 'Lublin', 'Chełm', 'Radom', 'Kielce', 'Częstochowa', 'Sandomierz', 'Rzeszów', 'Tarnów', 'Kraków', 'Katowice']),
    ('podgórze i góry', ['Bielsko-Biała', 'Nowy Sącz', 'Nowy Targ', 'Zakopane', 'Sanok', 'Przemyśl', 'Ustrzyki Dolne', 'Jelenia Góra', 'Wałbrzych'])])
ALL = [s for g in REG.values() for s in g]
assert sorted(ALL) == sorted(S), set(ALL) ^ set(S)
LOW = [s for g, L in REG.items() if g != 'podgórze i góry' for s in L]
REGS = dict(REG); REGS['kraj'] = ALL
ADJ = {s: (0.0065 * (PAIR[s][1] - INFO[s]['h']) if abs(PAIR[s][1] - INFO[s]['h']) >= 30 else 0.0) for s in S}
def nm(s, v, m):
    a = NR[PAIR[s][0]]['m'].get(v)
    return a[m - 1] if a and a[m - 1] else None
def nmean(s, v, m):
    a = nm(s, v, m)
    return a['mean'] if a else None
fm = lambda v, d=1: '  –' if v is None else f'{v:.{d}f}'
def mean(v):
    v = [x for x in v if x is not None]
    return SS.mean(v) if v else None
# ---------- przegląd par ----------
print('PARY: stacja modelu → IMGW (dni T, dni P, dni S, dni RH/wiatr), poprawka T [K]')
for s in ALL:
    c = PAIR[s][0]; d = R[c]['days']
    print(f"  {s[:20]:20s} h{INFO[s]['h']:4d} → {R[c]['name'][:22]:22s} h{PAIR[s][1]:4d} adj {ADJ[s]:+.2f} | T {sum(1 for e in d.values() if e.get('tm') is not None):5d} P {sum(1 for e in d.values() if e.get('p') is not None):5d} S {sum(1 for e in d.values() if e.get('sun') is not None):5d} W {sum(1 for e in d.values() if e.get('ws') is not None):5d} CL {sum(1 for e in d.values() if e.get('cl') is not None):5d}")
Y = [2026, 2027, 2028, 2029]
YD = {y: [d for d in DAYS if date(d).year == y] for y in Y}
MD = {m: [d for d in DAYS if date(d).month == m] for m in range(1, 13)}
# ---------- wielkości w miesiącach kalendarzowych: model (śr. 4 lat) i norma ----------
MM = collections.defaultdict(dict)
KEY = ['T', 'Tx', 'Tn', 'RH', 'WS', 'CL', 'PSL', 'P', 'S', 'd25', 'd30', 'mroz', 'zmroz', 'trop', 'tn18', 'd1', 'd10', 'd20', 'd50', 'covd', 'fogd', 'SDX']
def model_month(s, m):
    L = [S[s][d] for d in MD[m]]
    v = lambda k: [e[k] for e in L]
    ny = 4
    return dict(T=mean(v('T')), Tx=mean(v('Tx')), Tn=mean(v('Tn')), RH=mean(v('RH')), WS=mean(v('W')), CL=mean(v('CL')), PSL=mean(v('PSL')), P=sum(v('P')) / ny, S=sum(v('S')) / ny, Sn=sum(v('Sn')) / ny, ET=sum(v('ET')) / ny, Td=mean(v('Td')),
                d25=sum(x >= 25 for x in v('Tx')) / ny, d30=sum(x >= 30 for x in v('Tx')) / ny, mroz=sum(x < 0 for x in v('Tx')) / ny, zmroz=sum(x < 0 for x in v('Tn')) / ny, trop=sum(x >= 20 for x in v('Tn')) / ny, tn18=sum(x >= 18 for x in v('Tn')) / ny,
                d1=sum(x >= 1 for x in v('P')) / ny, d10=sum(x >= 10 for x in v('P')) / ny, d20=sum(x >= 20 for x in v('P')) / ny, d50=sum(x >= 50 for x in v('P')) / ny, covd=sum(x >= 1 for x in v('SD')) / ny, fogd=sum(x >= 1 for x in v('Fog')) / ny)
MOD = {s: {m: model_month(s, m) for m in range(1, 13)} for s in S}
def nval(s, k, m):
    x = nmean(s, k, m)
    if x is None: return None
    if k in ('T', 'Tx', 'Tn'): return x + ADJ[s]
    if k == 'CL': return x * 12.5
    return x
# ---------- ROK: regiony ----------
print('\nROK (śr. 2026–2029 / norma 1991–2020) wg regionów')
AN = {}
for g, L in REGS.items():
    o = {}
    for k in ['T', 'Tx', 'Tn', 'RH', 'WS', 'CL']:
        o[k] = (mean(mean(MOD[s][m][k] for m in range(1, 13)) for s in L), mean(mean(nval(s, k, m) for m in range(1, 13)) if all(nval(s, k, m) is not None for m in range(1, 13)) else None for s in L))
    for k in ['P', 'S', 'd25', 'd30', 'mroz', 'zmroz', 'trop', 'tn18', 'd1', 'd10', 'd20', 'd50', 'covd', 'fogd']:
        pairs = [(sum(MOD[s][m][k] for m in range(1, 13)), sum(nval(s, k, m) for m in range(1, 13))) for s in L if all(nval(s, k, m) is not None for m in range(1, 13))]
        o[k] = (mean(a for a, _ in pairs), mean(b for _, b in pairs))
    o['ET'] = (mean(sum(MOD[s][m]['ET'] for m in range(1, 13)) for s in L), None)
    AN[g] = o
    print(f"{g:18s} n={len(L):2d} T {o['T'][0]:5.2f}/{o['T'][1]:5.2f} ({o['T'][0]-o['T'][1]:+.2f}) Tx {o['Tx'][0]-o['Tx'][1]:+.2f} Tn {o['Tn'][0]-o['Tn'][1]:+.2f} amp {o['Tx'][0]-o['Tn'][0]:.1f}/{o['Tx'][1]-o['Tn'][1]:.1f} | P {o['P'][0]:4.0f}/{o['P'][1]:4.0f} ({100*o['P'][0]/o['P'][1]:3.0f}%) | S {o['S'][0]:4.0f}/{o['S'][1]:4.0f} ({100*o['S'][0]/o['S'][1]:3.0f}%) | CL {o['CL'][0]:3.0f}/{o['CL'][1]:3.0f} | RH {o['RH'][0]:3.0f}/{o['RH'][1]:3.0f} | W {o['WS'][0]:.1f}/{o['WS'][1]:.1f} | ET {o['ET'][0]:.0f}")
    print(f"{'':18s} d25 {o['d25'][0]:4.1f}/{o['d25'][1]:4.1f} d30 {o['d30'][0]:4.1f}/{o['d30'][1]:4.1f} Tx<0 {o['mroz'][0]:4.1f}/{o['mroz'][1]:4.1f} Tn<0 {o['zmroz'][0]:5.1f}/{o['zmroz'][1]:5.1f} Tn≥20 {o['trop'][0]:4.1f}/{o['trop'][1]:4.2f} Tn≥18 {o['tn18'][0]:4.1f}/{o['tn18'][1]:4.1f} | P≥1 {o['d1'][0]:5.1f}/{o['d1'][1]:5.1f} ≥10 {o['d10'][0]:4.1f}/{o['d10'][1]:4.1f} ≥20 {o['d20'][0]:4.1f}/{o['d20'][1]:4.1f} ≥50 {o['d50'][0]:4.2f}/{o['d50'][1]:4.2f} | pokrywa≥1 {o['covd'][0]:4.1f}/{o['covd'][1]:4.1f} | mgła {o['fogd'][0]:4.1f}/{o['fogd'][1]:4.1f}")
# ---------- MIESIĄCE: kraj ----------
print('\nMIESIĄCE, kraj (56 stacji): dT dTx dTn amp/norm | P/norm % | S/norm % | CL/norm | RH/norm | W/norm | d30/norm | Tn≥20')
MON = {}
for m in range(1, 13):
    o = {}
    for k in ['T', 'Tx', 'Tn', 'RH', 'WS', 'CL', 'P', 'S', 'd25', 'd30', 'trop', 'd1', 'd10', 'covd']:
        Lk = [s for s in ALL if nval(s, k, m) is not None]
        o[k] = (mean(MOD[s][m][k] for s in Lk), mean(nval(s, k, m) for s in Lk))
    MON[m] = o
    print(f"{RZ[m-1]:4s} dT {o['T'][0]-o['T'][1]:+5.2f} dTx {o['Tx'][0]-o['Tx'][1]:+5.2f} dTn {o['Tn'][0]-o['Tn'][1]:+5.2f} amp {o['Tx'][0]-o['Tn'][0]:4.1f}/{o['Tx'][1]-o['Tn'][1]:4.1f} | P {o['P'][0]:4.0f}/{o['P'][1]:4.0f} {100*o['P'][0]/o['P'][1]:4.0f}% | S {o['S'][0]:4.0f}/{o['S'][1]:4.0f} {100*o['S'][0]/o['S'][1]:4.0f}% | CL {o['CL'][0]:3.0f}/{o['CL'][1]:3.0f} | RH {o['RH'][0]:3.0f}/{o['RH'][1]:3.0f} | W {o['WS'][0]:.1f}/{o['WS'][1]:.1f} | d25 {o['d25'][0]:4.1f}/{o['d25'][1]:4.1f} d30 {o['d30'][0]:4.1f}/{o['d30'][1]:4.1f} | Tn≥20 {o['trop'][0]:4.1f}/{o['trop'][1]:4.2f} | P≥1 {o['d1'][0]:4.1f}/{o['d1'][1]:4.1f} ≥10 {o['d10'][0]:3.1f}/{o['d10'][1]:3.1f} | pokr {o['covd'][0]:4.1f}/{o['covd'][1]:4.1f}")
# ---------- szeregi krajowe IMGW 1991–2020 (σ, zakres) i istotność miesięcy ----------
codes = sorted(set(PAIR[s][0] for s in ALL))
RM = collections.defaultdict(dict)   # kod: (y,m): {T,P}
for c in codes:
    by = collections.defaultdict(list)
    for k, e in R[c]['days'].items(): by[(int(k[:4]), int(k[5:7]))].append(e)
    for ym, L in by.items():
        nd = calendar.monthrange(*ym)[1]
        tv = [e['tm'] for e in L if e.get('tm') is not None]; pv = [e['p'] for e in L if e.get('p') is not None]
        if len(tv) >= nd - 3: RM[c].setdefault(ym, {})['T'] = SS.mean(tv)
        if pv and len(pv) >= nd - 3: RM[c].setdefault(ym, {})['P'] = sum(pv)
        sv = [e['sun'] for e in L if e.get('sun') is not None]
        if len(sv) >= nd - 3: RM[c].setdefault(ym, {})['S'] = sum(sv)
def natl(m, v):
    # krajowa średnia roczna dla miesiąca m: średnia z odchyleń stacji od ich średniej + średnia norm
    cl = {c: mean(RM[c][(y, m)][v] for y in range(1991, 2021) if v in RM[c].get((y, m), {})) for c in codes}
    cl = {c: x for c, x in cl.items() if x is not None}
    out = {}
    for y in range(1991, 2021):
        an = [RM[c][(y, m)][v] - cl[c] for c in cl if v in RM[c].get((y, m), {})]
        if len(an) >= 0.7 * len(cl): out[y] = mean(cl.values()) + SS.mean(an)
    return out
print('\nISTOTNOŚĆ: kraj, miesiąc: model 2026..2029 | norma σ zakres (IMGW, te same stacje) | (śr. model − norma)/(σ/√4)')
SIG = {}
for m in range(1, 13):
    tt = natl(m, 'T'); pp = natl(m, 'P')
    mt = [SS.mean(SS.mean(S[s][d]['T'] for d in MD[m] if date(d).year == y) for s in ALL) for y in Y]
    mp = [SS.mean(sum(S[s][d]['P'] for d in MD[m] if date(d).year == y) for s in ALL) for y in Y]
    nt = SS.mean(tt.values()); st = SS.pstdev(tt.values()); np_ = SS.mean(pp.values()); sp = SS.pstdev(pp.values())
    SIG[m] = dict(nT=nt, sT=st, mT=mt, nP=np_, sP=sp, mP=mp, maxP=max(pp.values()), minP=min(pp.values()), maxT=max(tt.values()), minT=min(tt.values()))
    print(f"{RZ[m-1]:4s} T {' '.join(f'{x:5.1f}' for x in mt)} | {nt:5.1f} σ{st:4.1f} [{min(tt.values()):5.1f},{max(tt.values()):5.1f}] t={(SS.mean(mt)-nt)/(st/2):+.1f} | P {' '.join(f'{x:4.0f}' for x in mp)} | {np_:4.0f} σ{sp:3.0f} [{min(pp.values()):3.0f},{max(pp.values()):3.0f}] t={(SS.mean(mp)-np_)/(sp/2):+.1f}")
# roczne
tya = {y: SS.mean(SS.mean(S[s][d]['T'] for d in YD[y]) for s in ALL) for y in Y}; pya = {y: SS.mean(sum(S[s][d]['P'] for d in YD[y]) for s in ALL) for y in Y}
rt = {}; rp = {}
for y in range(1991, 2021):
    a = []; b = []
    for m in range(1, 13):
        a.append(natl(m, 'T').get(y)); b.append(natl(m, 'P').get(y))
    if all(x is not None for x in a): rt[y] = SS.mean(a)
    if all(x is not None for x in b): rp[y] = sum(b)
print(f"ROK T model {[round(v, 2) for v in tya.values()]} | IMGW śr {SS.mean(rt.values()):.2f} σ {SS.pstdev(rt.values()):.2f} [{min(rt.values()):.2f},{max(rt.values()):.2f}]")
print(f"ROK P model {[round(v) for v in pya.values()]} | IMGW śr {SS.mean(rp.values()):.0f} σ {SS.pstdev(rp.values()):.0f} [{min(rp.values()):.0f},{max(rp.values()):.0f}]")
# ---------- stacje: bilans ----------
print('\nSTACJE: dT dTx dTn | P % | S % | CL−n | RH−n | W/n | d30/n | Tn≥20/n | P≥1/n | ≥10/n | ≥50/n | pokr/n | Pmax / rek | Txx / rek | Tnn / rek')
ST = {}
for g, L in REG.items():
    print(' --', g)
    for s in L:
        M = MOD[s]
        def ann(k, how):
            a = [M[m][k] for m in range(1, 13)]; b = [nval(s, k, m) for m in range(1, 13)]
            if any(x is None for x in b): return (sum(a) if how == 's' else SS.mean(a), None)
            return (sum(a), sum(b)) if how == 's' else (SS.mean(a), SS.mean(b))
        T, Tx, Tn, P, Sx, CLx, RHx, Wx = ann('T', 'm'), ann('Tx', 'm'), ann('Tn', 'm'), ann('P', 's'), ann('S', 's'), ann('CL', 'm'), ann('RH', 'm'), ann('WS', 'm')
        d30, tr, d1, d10, d50, cov = ann('d30', 's'), ann('trop', 's'), ann('d1', 's'), ann('d10', 's'), ann('d50', 's'), ann('covd', 's')
        A = list(S[s].values()); rec = NR[PAIR[s][0]]['rec']
        px, tx, tn = max(e['P'] for e in A), max(e['Tx'] for e in A), min(e['Tn'] for e in A)
        ST[s] = dict(reg=g, x=INFO[s]['x'], y=INFO[s]['y'], h=INFO[s]['h'], ref=R[PAIR[s][0]]['name'], T=T, Tx=Tx, Tn=Tn, P=P, S=Sx, CL=CLx, RH=RHx, W=Wx, d30=d30, trop=tr, d1=d1, d10=d10, d50=d50, cov=cov, px=px, txx=tx, tnn=tn)
        dif = lambda p, q=1: fm(p[0] - p[1], q) if p[1] is not None else '  –'
        pct = lambda p: f'{100 * p[0] / p[1]:3.0f}%' if p[1] else '  –'
        print(f"  {s[:15]:15s} {dif(T):>5} {dif(Tx):>5} {dif(Tn):>5} | {P[0]:5.0f}/{fm(P[1], 0):>4} {pct(P)} | {pct(Sx)} | {dif(CLx, 0):>3} | {dif(RHx, 0):>3} | {Wx[0]:.1f}/{fm(Wx[1])} | {d30[0]:4.1f}/{fm(d30[1])} | {tr[0]:4.1f}/{fm(tr[1], 2)} | {d1[0]:3.0f}/{fm(d1[1], 0)} | {d10[0]:4.1f}/{fm(d10[1])} | {d50[0]:4.2f}/{fm(d50[1], 2)} | {cov[0]:3.0f}/{fm(cov[1], 0)} | {px:4.0f}/{rec.get('Pxx', [None])[0]} | {tx:4.1f}/{rec.get('Txx', [None])[0]} | {tn:5.1f}/{rec.get('Tnn', [None])[0]}")
# ---------- gradient W–E opadu ----------
def regress(xs, ys):
    mx, my = SS.mean(xs), SS.mean(ys); sxx = sum((a - mx) ** 2 for a in xs)
    b = sum((a - mx) * (c - my) for a, c in zip(xs, ys)) / sxx
    r = b * math.sqrt(sxx) / math.sqrt(sum((c - my) ** 2 for c in ys))
    return b, my - b * mx, r
print('\nOPAD: % normy wg odległości od zachodniego brzegu widocznej domeny (bez gór), wszystkie miesiące i pory roku')
SEAS = collections.OrderedDict([('DJF', [12, 1, 2]), ('MAM', [3, 4, 5]), ('JJA', [6, 7, 8]), ('SON', [9, 10, 11]), ('ROK', list(range(1, 13)))])
LX = [s for s in LOW]
GR = {}
for sk, ms in SEAS.items():
    x = [INFO[s]['x'] for s in LX]; y = [INFO[s]['y'] for s in LX]; p = [100 * sum(MOD[s][m]['P'] for m in ms) / sum(nval(s, 'P', m) for m in ms) for s in LX]
    bx, ax, rx = regress(x, p); by, ay, ry = regress(y, p)
    bins = [(0, 150), (150, 300), (300, 450), (450, 600), (600, 900)]
    b = [mean(q for q, a in zip(p, x) if lo <= a < hi) for lo, hi in bins]
    GR[sk] = dict(bx=bx, rx=rx, by=by, ry=ry, bins=b)
    print(f"  {sk}: x-biny {' '.join(fm(v, 0) for v in b)} | nachylenie {bx*100:+.1f} pkt/100 km r={rx:+.2f} | y: {by*100:+.1f} pkt/100 km r={ry:+.2f}")
# ---------- opad wg kierunku wiatru: czy rośnie z odległością od brzegu napływu ----------
print('\nOPAD wg kierunku wiatru (kierunek przeważający stacji w danej dobie, większość stacji): średni opad doby [mm] w pasach W→E (x) i S→N (y)')
SECT = {'W': {'WSW', 'W', 'WNW', 'SW', 'NW'}, 'E': {'ENE', 'E', 'ESE', 'NE', 'SE'}, 'N': {'N', 'NNE', 'NNW'}, 'S': {'S', 'SSE', 'SSW'}}
day_sec = {}
for d in DAYS:
    c = collections.Counter()
    for s in LOW:
        for k, v in SECT.items():
            if S[s][d]['dir'] in v: c[k] += 1
    k, n = c.most_common(1)[0]
    day_sec[d] = k if n >= 0.6 * len(LOW) else '?'
print('  częstość dób:', {k: f'{100 * v / len(DAYS):.0f}%' for k, v in collections.Counter(day_sec.values()).items()})
xb = [(0, 150), (150, 300), (300, 450), (450, 600), (600, 900)]
yb = [(0, 200), (200, 350), (350, 500), (500, 600), (600, 900)]
for k in ['W', 'E', 'N', 'S']:
    dd = [d for d in DAYS if day_sec[d] == k]
    px = [mean(mean(S[s][d]['P'] for d in dd) for s in LOW if lo <= INFO[s]['x'] < hi) for lo, hi in xb]
    py = [mean(mean(S[s][d]['P'] for d in dd) for s in LOW if lo <= INFO[s]['y'] < hi) for lo, hi in yb]
    tot = mean(sum(S[s][d]['P'] for d in dd) for s in LOW) / 4
    print(f"  {k}: dób {len(dd):4d}, opad {tot:4.0f} mm/rok | x: {' '.join(f'{v:4.2f}' for v in px)} | y: {' '.join(f'{v:4.2f}' for v in py)}")
# ---------- opad: klasy dobowe, model / IMGW ----------
print('\nOPAD DOBOWY: dni na rok w klasach (śr. stacji nizin), model / IMGW; udział sumy')
CL_ = [(0.1, 1), (1, 5), (5, 10), (10, 20), (20, 50), (50, 1e9)]
PD = {}
for sk, ms in SEAS.items():
    a = [0.0] * 6; b = [0.0] * 6; sa = [0.0] * 6; sb = [0.0] * 6; n = 0
    for s in LOW:
        dm = [S[s][d]['P'] for d in DAYS if date(d).month in ms]
        c = PAIR[s][0]
        dr = [e['p'] for k, e in R[c]['days'].items() if int(k[5:7]) in ms and e.get('p') is not None]
        ny = len({k[:4] for k, e in R[c]['days'].items() if e.get('p') is not None}) or 1
        if len(dr) < 2000 * len(ms) / 12: continue
        yr = len(dr) / (365.25 * len(ms) / 12)
        for i, (lo, hi) in enumerate(CL_):
            a[i] += sum(lo <= x < hi for x in dm) / 4; b[i] += sum(lo <= x < hi for x in dr) / yr
            sa[i] += sum(x for x in dm if lo <= x < hi) / 4; sb[i] += sum(x for x in dr if lo <= x < hi) / yr
        n += 1
    PD[sk] = dict(m=[x / n for x in a], r=[x / n for x in b], sm=[x / n for x in sa], sr=[x / n for x in sb])
    print(f"  {sk} (n={n}) dni: " + ' '.join(f"{CL_[i][0]}+ {a[i]/n:5.1f}/{b[i]/n:5.1f}" for i in range(6)) + f" | sumy mm: " + ' '.join(f"{sa[i]/n:4.0f}/{sb[i]/n:4.0f}" for i in range(6)) + f" | razem {sum(sa)/n:4.0f}/{sum(sb)/n:4.0f}")
# ---------- rozkłady T ----------
def pct_(v, q):
    v = sorted(v); i = q / 100 * (len(v) - 1); a = int(i); b = min(a + 1, len(v) - 1)
    return v[a] + (v[b] - v[a]) * (i - a)
print('\nROZKŁADY dobowe (śr. kwantyli po stacjach nizin): model / IMGW; σ odchyleń T od klimatologii dnia; autokorelacja T (1 doba)')
base = datetime.date(2000, 1, 1)
def harm(s):
    # sezonowy cykl modelu: 3 harmoniczne (metoda najmniejszych kwadratów przez rzut – równomierne próbkowanie)
    dd = DAYS; n = len(dd); v = [S[s][d]['T'] for d in dd]; t = [2 * math.pi * (date(d) - datetime.date(date(d).year, 1, 1)).days / 365.25 for d in dd]
    a0 = SS.mean(v); cf = []
    for k in (1, 2, 3):
        cf.append((2 / n * sum(x * math.cos(k * p) for x, p in zip(v, t)), 2 / n * sum(x * math.sin(k * p) for x, p in zip(v, t))))
    return {d: x - (a0 + sum(c * math.cos((k + 1) * p) + q * math.sin((k + 1) * p) for k, (c, q) in enumerate(cf))) for d, x, p in zip(dd, v, t)}
AM = {s: harm(s) for s in LOW}
def real_series(c, key):
    return {k: e[key] for k, e in R[c]['days'].items() if e.get(key) is not None}
DIST = {}
for sk, ms in SEAS.items():
    rec = collections.defaultdict(list)
    for s in LOW:
        c = PAIR[s][0]; adj = ADJ[s]
        tx = [S[s][d]['Tx'] for d in DAYS if date(d).month in ms]; tn = [S[s][d]['Tn'] for d in DAYS if date(d).month in ms]; tm = [S[s][d]['T'] for d in DAYS if date(d).month in ms]
        rx = [e['tx'] + adj for k, e in R[c]['days'].items() if int(k[5:7]) in ms and e.get('tx') is not None]; rn = [e['tn'] + adj for k, e in R[c]['days'].items() if int(k[5:7]) in ms and e.get('tn') is not None]
        if len(rx) < 2000 * len(ms) / 12: continue
        for q in (1, 5, 50, 95, 99):
            rec[f'Tx{q}m'].append(pct_(tx, q)); rec[f'Tx{q}r'].append(pct_(rx, q)); rec[f'Tn{q}m'].append(pct_(tn, q)); rec[f'Tn{q}r'].append(pct_(rn, q))
        # σ odchyleń i autokorelacja
        am = [AM[s][d] for d in DAYS if date(d).month in ms]
        rec['sm'].append(SS.pstdev(am))
        pairs = [(AM[s][d], AM[s][d + 1]) for d in DAYS if d + 1 in AM[s] and date(d).month in ms]
        mx = SS.mean(a for a, _ in pairs); my = SS.mean(b for _, b in pairs)
        rec['acm'].append(sum((a - mx) * (b - my) for a, b in pairs) / math.sqrt(sum((a - mx) ** 2 for a, _ in pairs) * sum((b - my) ** 2 for _, b in pairs)))
        rec['dtm'].append(pct_([abs(a - b) for a, b in pairs], 95))
        cl = NR[c].get('clim')
        if cl:
            ra = {}
            for k, e in R[c]['days'].items():
                if e.get('tm') is None: continue
                j = (datetime.date(2000, int(k[5:7]), int(k[8:])) - base).days
                ra[k] = e['tm'] - cl[j]
            ks = [k for k in ra if int(k[5:7]) in ms]
            rec['sr'].append(SS.pstdev(ra[k] for k in ks))
            pr = []
            for k in ks:
                d2 = (datetime.date.fromisoformat(k) + datetime.timedelta(days=1)).isoformat()
                if d2 in ra: pr.append((ra[k], ra[d2]))
            mx = SS.mean(a for a, _ in pr); my = SS.mean(b for _, b in pr)
            rec['acr'].append(sum((a - mx) * (b - my) for a, b in pr) / math.sqrt(sum((a - mx) ** 2 for a, _ in pr) * sum((b - my) ** 2 for _, b in pr)))
            rec['dtr'].append(pct_([abs(a - b) for a, b in pr], 95))
    DIST[sk] = {k: SS.mean(v) for k, v in rec.items()}
    o = DIST[sk]
    print(f"  {sk}: Tx p1 {o['Tx1m']:5.1f}/{o['Tx1r']:5.1f} p5 {o['Tx5m']:5.1f}/{o['Tx5r']:5.1f} p50 {o['Tx50m']:5.1f}/{o['Tx50r']:5.1f} p95 {o['Tx95m']:5.1f}/{o['Tx95r']:5.1f} p99 {o['Tx99m']:5.1f}/{o['Tx99r']:5.1f}")
    print(f"       Tn p1 {o['Tn1m']:5.1f}/{o['Tn1r']:5.1f} p5 {o['Tn5m']:5.1f}/{o['Tn5r']:5.1f} p50 {o['Tn50m']:5.1f}/{o['Tn50r']:5.1f} p95 {o['Tn95m']:5.1f}/{o['Tn95r']:5.1f} p99 {o['Tn99m']:5.1f}/{o['Tn99r']:5.1f}")
    print(f"       σ T {o['sm']:4.2f}/{o['sr']:4.2f}, autokorelacja {o['acm']:.2f}/{o['acr']:.2f}, |ΔT| doba p95 {o['dtm']:.1f}/{o['dtr']:.1f}")
# ---------- dni gorące i noce ciepłe: w jakiej pogodzie ----------
print('\nDNI Tx ≥ 30 (niziny): pogoda tych dni: S, CL, RH, wiatr, kierunek; miesiąc')
HOT = [(s, d) for s in LOW for d in DAYS if S[s][d]['Tx'] >= 30]
print(f"  stacjo-dni {len(HOT)}, na stację rok {len(HOT) / len(LOW) / 4:.1f}; S {mean(S[s][d]['S'] for s, d in HOT):.1f} h, CL {mean(S[s][d]['CL'] for s, d in HOT):.0f}%, RH {mean(S[s][d]['RH'] for s, d in HOT):.0f}%, W {mean(S[s][d]['W'] for s, d in HOT):.1f}, Td {mean(S[s][d]['Td'] for s, d in HOT):.1f}, Tn {mean(S[s][d]['Tn'] for s, d in HOT):.1f}")
print('  kierunki:', [(k, f'{100 * v / len(HOT):.0f}%') for k, v in collections.Counter(S[s][d]['dir'] for s, d in HOT).most_common(8)])
print('  miesiące:', sorted(collections.Counter(date(d).month for s, d in HOT).items()), '| lata:', sorted(collections.Counter(date(d).year for s, d in HOT).items()))
# fale upałów: doby, w których ≥ 1/3 stacji nizin ma Tx ≥ 30
ep = []
for d in DAYS:
    n = sum(S[s][d]['Tx'] >= 30 for s in LOW)
    if n >= len(LOW) / 3: ep.append(d)
gr = []
for d in ep:
    if gr and d - gr[-1][-1] <= 1: gr[-1].append(d)
    else: gr.append([d])
print('  fale (≥ 1/3 stacji nizin Tx ≥ 30):', [(laby(g[0]), len(g), round(max(S[s][d]['Tx'] for s in LOW for d in g), 1)) for g in gr])
print('  IMGW: ile dób w roku ≥ 1/3 tych stacji Tx ≥ 30, śr. roczna / najgorszy rok; długość fal')
lc = sorted(set(PAIR[s][0] for s in LOW))
cnt = collections.Counter(); byy = collections.Counter(); seq = []
for y in range(1991, 2021):
    dt = datetime.date(y, 1, 1)
    while dt.year == y:
        k = dt.isoformat(); v = [R[c]['days'].get(k, {}).get('tx') for c in lc]; v = [x for x in v if x is not None]
        if len(v) > 10 and sum(x >= 30 for x in v) >= len(v) / 3:
            byy[y] += 1; seq.append(dt)
        dt += datetime.timedelta(days=1)
print('   ', round(sum(byy.values()) / 30, 1), 'dób/rok; maks', byy.most_common(3), '| model:', round(len(ep) / 4, 1), 'dób/rok')
gr2 = []
for d in seq:
    if gr2 and (d - gr2[-1][-1]).days <= 1: gr2[-1].append(d)
    else: gr2.append([d])
print('    najdłuższe fale IMGW:', sorted((len(g) for g in gr2), reverse=True)[:6], '| model:', sorted((len(g) for g in gr), reverse=True)[:6])
print('\nNOCE Tn ≥ 18 i ≥ 20: kierunek, wiatr, chmury (niziny bez Warszawy) oraz stacje')
WN = [(s, d) for s in LOW if s != 'Warszawa' for d in DAYS if S[s][d]['Tn'] >= 20]
print(f"  Tn≥20 stacjo-dni {len(WN)} ({len(WN) / (len(LOW) - 1) / 4:.1f}/rok na stację); W {mean(S[s][d]['W'] for s, d in WN):.1f}, CL {mean(S[s][d]['CL'] for s, d in WN):.0f}, RH {mean(S[s][d]['RH'] for s, d in WN):.0f}, Td {mean(S[s][d]['Td'] for s, d in WN):.1f}; kierunki {[(k, f'{100 * v / len(WN):.0f}%') for k, v in collections.Counter(S[s][d]['dir'] for s, d in WN).most_common(6)]}")
print('  lata:', sorted(collections.Counter(date(d).year for s, d in WN).items()), '| miesiące:', sorted(collections.Counter(date(d).month for s, d in WN).items()))
rows_ = sorted(((sum(S[s][d]['Tn'] >= 20 for d in DAYS) / 4, s) for s in ALL), reverse=True)
print('  najwięcej:', [(s, round(a, 1), fm(ST[s]['trop'][1], 2)) for a, s in rows_[:12]])
# ---------- pory roku: T wg regionów ----------
print('\nT wg regionów i pór roku: dT (dTx, dTn) | P% | S% | CL−n')
SR = {}
for g, L in REGS.items():
    line = []
    for sk, ms in list(SEAS.items())[:4]:
        dT = mean(mean(MOD[s][m]['T'] - nval(s, 'T', m) for m in ms) for s in L); dX = mean(mean(MOD[s][m]['Tx'] - nval(s, 'Tx', m) for m in ms) for s in L); dN = mean(mean(MOD[s][m]['Tn'] - nval(s, 'Tn', m) for m in ms) for s in L)
        P = 100 * sum(MOD[s][m]['P'] for s in L for m in ms) / sum(nval(s, 'P', m) for s in L for m in ms)
        Lk = [s for s in L if all(nval(s, 'S', m) is not None for m in ms)]
        Sp = 100 * sum(MOD[s][m]['S'] for s in Lk for m in ms) / sum(nval(s, 'S', m) for s in Lk for m in ms) if Lk else None
        Lc = [s for s in L if all(nval(s, 'CL', m) is not None for m in ms)]
        dC = mean(mean(MOD[s][m]['CL'] - nval(s, 'CL', m) for m in ms) for s in Lc)
        line.append(f"{sk} {dT:+.1f} ({dX:+.1f},{dN:+.1f}) P{P:3.0f} S{fm(Sp, 0)} C{dC:+.0f}")
        SR.setdefault(g, {})[sk] = dict(dT=dT, dX=dX, dN=dN, P=P, S=Sp, C=dC)
    print(f"  {g[:16]:16s} " + ' | '.join(line))
# ---------- śnieg ----------
print('\nŚNIEG: udział śniegu w opadzie XII–II, dni z pokrywą, maks. pokrywa (średnia z rocznych maksimów), wg regionów; norma dni')
for g, L in REGS.items():
    sn = sum(MOD[s][m]['Sn'] for s in L for m in (12, 1, 2)) / max(sum(MOD[s][m]['P'] for s in L for m in (12, 1, 2)), 1e-6)
    cov = mean(sum(MOD[s][m]['covd'] for m in range(1, 13)) for s in L); ncov = mean(sum(nval(s, 'covd', m) for m in range(1, 13)) for s in L if all(nval(s, 'covd', m) is not None for m in range(1, 13)))
    mx = mean(mean(max(S[s][d]['SD'] for d in YD[y]) for y in Y) for s in L)
    print(f"  {g[:16]:16s} śnieg {100 * sn:.0f}% opadu | pokrywa {cov:.0f}/{ncov:.0f} dni | śr. maks. roczne {mx:.0f} cm")
# maks. pokrywa roczna IMGW (Kraków, Warszawa, Poznań, Suwałki)
for s in ['Warszawa', 'Poznań', 'Kraków', 'Suwałki', 'Gdańsk', 'Zakopane']:
    c = PAIR[s][0]; by = collections.defaultdict(float)
    for k, e in R[c]['days'].items():
        if e.get('sd') is not None: by[k[:4]] = max(by[k[:4]], e['sd'])
    print(f"    {s}: model roczne maks {[int(max(S[s][d]['SD'] for d in YD[y])) for y in Y]} | IMGW śr. rocznych maks. {SS.mean(by.values()):.0f}, maks {max(by.values()):.0f}; dni {sum(MOD[s][m]['covd'] for m in range(1,13)):.0f}/{fm(sum(nval(s,'covd',m) for m in range(1,13)),0)}")
# ---------- ekstremalne zdarzenia ----------
print('\nNAJWIĘKSZE OPADY DOBOWE (wszystkie stacje):')
big = sorted(((S[s][d]['P'], s, d) for s in ALL for d in DAYS if S[s][d]['P'] >= 70), reverse=True)
for a, s, d in big[:25]:
    e = S[s][d]
    print(f"  {a:5.1f} {s[:16]:16s} {laby(d):14s} T {e['T']:5.1f} Tx {e['Tx']:4.1f} p {e['PSL']:6.1f} W {e['W']:.1f} {e['dir']:3s} | śr. kraj {SS.mean(S[q][d]['P'] for q in ALL):4.1f}, oczek ≥20: {sum(S[q][d]['P'] >= 20 for q in ALL)}")
dm = {d: SS.mean(S[s][d]['P'] for s in ALL) for d in DAYS}
print('  doby największego opadu krajowego:', [(laby(d), round(dm[d], 1), max(S[s][d]['P'] for s in ALL)) for d in sorted(dm, key=lambda d: -dm[d])[:12]])
rdm = collections.defaultdict(list)
for c in codes:
    for k, e in R[c]['days'].items():
        if e.get('p') is not None: rdm[k].append(e['p'])
rd = {k: SS.mean(v) for k, v in rdm.items() if len(v) >= 25}
print('  IMGW doby największego opadu krajowego:', [(k, round(rd[k], 1)) for k in sorted(rd, key=lambda k: -rd[k])[:8]])
for th in (10, 15, 20):
    print(f"  doby śr. krajowego opadu ≥ {th} mm: model {sum(v >= th for v in dm.values()) / 4:.1f}/rok, IMGW {sum(v >= th for v in rd.values()) / 30:.2f}/rok")
print('\nNAJGRĘTSZE i NAJZIMNIEJSZE:')
print('  Tx:', [(s[:10], S[s][d]['Tx'], laby(d)) for s, d in sorted(((s, d) for s in ALL for d in DAYS), key=lambda q: -S[q[0]][q[1]]['Tx'])[:6]])
print('  Tn:', [(s[:10], S[s][d]['Tn'], laby(d)) for s, d in sorted(((s, d) for s in ALL for d in DAYS), key=lambda q: S[q[0]][q[1]]['Tn'])[:6]])
print('  G:', [(s[:10], S[s][d]['G'], laby(d)) for s, d in sorted(((s, d) for s in ALL for d in DAYS), key=lambda q: -S[q[0]][q[1]]['G'])[:6]])
print('  doby z porywem ≥ 15 / ≥ 20 m/s, śr. stacji nizin na rok:', round(mean(sum(S[s][d]['G'] >= 15 for d in DAYS) / 4 for s in LOW), 1), round(mean(sum(S[s][d]['G'] >= 20 for d in DAYS) / 4 for s in LOW), 1))
# ---------- lipiec 2026 ----------
print('\nLIPIEC 2026 (205 mm średnio): przebieg dobowy')
jd = [d for d in DAYS if date(d).year == 2026 and date(d).month == 7]
print('  ', ' '.join(f"{date(d).day}:{SS.mean(S[s][d]['P'] for s in ALL):.0f}" for d in jd))
print('   p', ' '.join(f"{SS.mean(S[s][d]['PSL'] for s in ALL):.0f}" for d in jd[::3]), '| T', ' '.join(f"{SS.mean(S[s][d]['T'] for s in ALL):.0f}" for d in jd[::3]))
print('   stacje:', sorted(((round(sum(S[s][d]['P'] for d in jd)), s[:10]) for s in ALL), reverse=True)[:10], sorted(((round(sum(S[s][d]['P'] for d in jd)), s[:10]) for s in ALL))[:5])
# ---------- ciśnienie, kierunki ----------
print('\nCIŚNIENIE (Warszawa / Okęcie): pora roku, śr. σ min max; model / IMGW')
c = PAIR['Warszawa'][0]
for sk, ms in list(SEAS.items())[:4]:
    r_ = [e['psl'] for k, e in R[c]['days'].items() if int(k[5:7]) in ms and e.get('psl') is not None]
    m_ = [S['Warszawa'][d]['PSL'] for d in DAYS if date(d).month in ms]
    print(f"  {sk}: {SS.mean(m_):.1f}/{SS.mean(r_):.1f} σ {SS.pstdev(m_):.1f}/{SS.pstdev(r_):.1f} min {min(m_):.0f}/{min(r_):.0f} max {max(m_):.0f}/{max(r_):.0f}")
print('  kierunki niziny:', sorted(((k, round(100 * v / (len(LOW) * len(DAYS)))) for k, v in collections.Counter(S[s][d]['dir'] for s in LOW for d in DAYS).items()), key=lambda x: -x[1]))
# ---------- słońce a zachmurzenie ----------
print('\nSŁOŃCE: S na dobę wg klasy zachmurzenia, model; miesiące VI i XII; norma S; CL norma')
for m in (1, 4, 6, 7, 10, 12):
    v = [(S[s][d]['CL'], S[s][d]['S']) for s in LOW for d in MD[m]]
    b = [(0, 20), (20, 50), (50, 80), (80, 101)]
    print(f"  {RZ[m-1]}: " + ' '.join(f"CL {lo}–{hi}: {100 * sum(lo <= c_ < hi for c_, _ in v) / len(v):3.0f}% dób, S {fm(mean(s_ for c_, s_ in v if lo <= c_ < hi))} h" for lo, hi in b))
# rzeczywisty rozkład klas zachmurzenia z IMGW (oktanty → %)
for m in (1, 4, 6, 7, 10, 12):
    v = []
    for s in LOW:
        c = PAIR[s][0]
        v += [(e['cl'] * 12.5, e.get('sun')) for k, e in R[c]['days'].items() if int(k[5:7]) == m and e.get('cl') is not None]
    b = [(0, 20), (20, 50), (50, 80), (80, 101)]
    print(f"  IMGW {RZ[m-1]}: " + ' '.join(f"CL {lo}–{hi}: {100 * sum(lo <= c_ < hi for c_, _ in v) / len(v):3.0f}% dób, S {fm(mean(s_ for c_, s_ in v if lo <= c_ < hi and s_ is not None))} h" for lo, hi in b))
# ---------- gleba, bilans wody ----------
print('\nGLEBA i BILANS (niziny): wilgotność na koniec roku; P, ET, P−ET; minima lata')
for y in Y:
    dl = YD[y][-1]
    P_ = mean(sum(S[s][d]['P'] for d in YD[y]) for s in LOW); E_ = mean(sum(S[s][d]['ET'] for d in YD[y]) for s in LOW)
    smin = min(SS.mean(S[s][d]['S2'] for s in LOW) for d in YD[y])
    print(f"  {y}: P {P_:.0f} ET {E_:.0f} P−ET {P_ - E_:.0f} | koniec roku 0–10 {SS.mean(S[s][dl]['S1'] for s in LOW):.1f} 10–40 {SS.mean(S[s][dl]['S2'] for s in LOW):.1f} 40–100 {SS.mean(S[s][dl]['S3'] for s in LOW):.1f} | min 10–40 {smin:.1f}")
print('  ET miesięcy (śr. kraj):', [round(mean(MOD[s][m]['ET'] for s in ALL)) for m in range(1, 13)])
# ---------- porównanie z poprzednim przebiegiem ----------
json.dump(dict(AN=AN, MON=MON, SIG=SIG, ST=ST, GR=GR, PD=PD, DIST=DIST, SR=SR, tya=tya, pya=pya, rtsd=SS.pstdev(rt.values()), rpsd=SS.pstdev(rp.values())), open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
print('zapisano')
