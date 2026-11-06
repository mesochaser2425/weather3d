import csv, collections, json, math, re, sys, statistics as SS, datetime
CSV, REF, AN5 = sys.argv[1:4]
f = lambda x: float(x.replace(',', '.'))
MON = ['January','February','March','April','May','June','July','August','September','October','November','December']
S = collections.defaultdict(dict); INFO = {}
for r in csv.DictReader(open(CSV, encoding='utf-8-sig'), delimiter=';'):
    if not r.get('Tmin_C') or r['station'][:1] == '#': continue
    s = r['station']; d = int(r['sim_day'])
    if s not in INFO: INFO[s] = dict(h=f(r['height_m']))
    S[s][d] = dict(m=MON.index(r['date'].split()[-1]) + 1, tx=f(r['Tmax_C']), t=f(r['Tmean_C']), rh=f(r['RH_mean_%']), p=f(r['precip_mm']), su=f(r['sunshine_h']))
ns = {}
exec(re.search(r"PAIR = \{.*?\n\s+'Przemyśl'.*?\}\n", open(AN5, encoding='utf-8').read(), re.S).group(0), ns); PAIR = ns['PAIR']
R = json.load(open(REF, encoding='utf-8'))
pairs = [s for s in S if s in PAIR and INFO[s]['h'] < 350 and PAIR[s][0] in R and s not in ('Ustka', 'Kołobrzeg')]
def tdew(t, rh):
    a = math.log(max(rh, 1) / 100) + 17.625 * t / (243.04 + t); return 243.04 * a / (17.625 - a)
JJA = (6, 7, 8)
A = collections.defaultdict(list); B = collections.defaultdict(list)
for s in pairs:
    days = sorted(S[s])
    for d in days[3:]:
        e = S[s][d]
        if e['m'] not in JJA: continue
        d2 = S[s][d - 2]['t'] if d - 2 in S[s] else None
        if d2 is None: continue
        ch = e['t'] - d2
        kind = 'ochłodzenie ≥ 4 K w 2 doby' if ch <= -4 else ('bez zmian ±2 K' if abs(ch) <= 2 else ('ocieplenie ≥ 4 K' if ch >= 4 else None))
        if kind: A[kind].append((tdew(e['t'], e['rh']), e['t'], e['tx'], e['su'], e['p']))
    ds = R[PAIR[s][0]]['days']
    for k, e in ds.items():
        if not ('1991' <= k[:4] <= '2020') or int(k[5:7]) not in JJA or e.get('rh') is None or e.get('tm') is None or e.get('tx') is None: continue
        y = datetime.date.fromisoformat(k) - datetime.timedelta(days=2)
        e2 = ds.get(y.isoformat())
        if not e2 or e2.get('tm') is None: continue
        ch = e['tm'] - e2['tm']
        kind = 'ochłodzenie ≥ 4 K w 2 doby' if ch <= -4 else ('bez zmian ±2 K' if abs(ch) <= 2 else ('ocieplenie ≥ 4 K' if ch >= 4 else None))
        if kind: B[kind].append((tdew(e['tm'], e['rh']), e['tm'], e['tx'], e.get('sun') or 0, e.get('p') or 0))
def q(v, p): v = sorted(v); return v[int(p * (len(v) - 1))]
print('JJA, stacje < 350 m: model / IMGW 1991–2020')
for k in ('ochłodzenie ≥ 4 K w 2 doby', 'bez zmian ±2 K', 'ocieplenie ≥ 4 K'):
    a, b = A[k], B[k]
    print(f'{k:28s} n {len(a):5d}/{len(b):6d} ({100 * len(a) / 18400:.0f}/{100 * len(b) / 134045:.0f}% dób) Td śr {SS.mean(x[0] for x in a):5.1f}/{SS.mean(x[0] for x in b):5.1f} p90 {q([x[0] for x in a], .9):5.1f}/{q([x[0] for x in b], .9):5.1f} | T {SS.mean(x[1] for x in a):5.1f}/{SS.mean(x[1] for x in b):5.1f} Tx {SS.mean(x[2] for x in a):5.1f}/{SS.mean(x[2] for x in b):5.1f} | słońce {SS.mean(x[3] for x in a):4.1f}/{SS.mean(x[3] for x in b):4.1f} | P {SS.mean(x[4] for x in a):4.1f}/{SS.mean(x[4] for x in b):4.1f}')
# ta sama temperatura: Td przy Tx w przedziałach
print('\nTd przy tym samym Tx (JJA): Tx | model | IMGW')
mo = [(tdew(e['t'], e['rh']), e['tx']) for s in pairs for e in S[s].values() if e['m'] in JJA]
ob = [(tdew(e['tm'], e['rh']), e['tx']) for s in pairs for k, e in R[PAIR[s][0]]['days'].items() if '1991' <= k[:4] <= '2020' and int(k[5:7]) in JJA and e.get('rh') is not None and e.get('tm') is not None and e.get('tx') is not None]
for lo in (16, 18, 20, 22, 24, 26, 28, 30, 32):
    a = [x[0] for x in mo if lo <= x[1] < lo + 2]; b = [x[0] for x in ob if lo <= x[1] < lo + 2]
    print(f'  {lo}–{lo + 2} °C: {SS.mean(a):5.1f} (p90 {q(a, .9):4.1f}, n {len(a)}) | {SS.mean(b):5.1f} (p90 {q(b, .9):4.1f}, n {len(b)})')
