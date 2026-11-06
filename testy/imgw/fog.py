import csv, collections, json, re, sys, statistics as SS, datetime
CSV, REF, AN5 = sys.argv[1:4]
f = lambda x: float(x.replace(',', '.'))
MON = ['January','February','March','April','May','June','July','August','September','October','November','December']
S = collections.defaultdict(dict); INFO = {}
for r in csv.DictReader(open(CSV, encoding='utf-8-sig'), delimiter=';'):
    if not r.get('Tmin_C') or r['station'][:1] == '#': continue
    s = r['station']; d = int(r['sim_day'])
    if s not in INFO: INFO[s] = dict(x=f(r['x_km']), y=f(r['y_km']), h=int(f(r['height_m'])))
    S[s][d] = dict(m=MON.index(r['date'].split()[-1]) + 1, tn=f(r['Tmin_C']), tx=f(r['Tmax_C']), fog=f(r['fog_h']), p=f(r['precip_mm']), ws=f(r['wind_mean_m_s']), cl=f(r['cloud_cover_mean_%']), sd=f(r['snow_depth_cm']))
ns = {}
exec(re.search(r"PAIR = \{.*?\n\s+'Przemyśl'.*?\}\n", open(AN5, encoding='utf-8').read(), re.S).group(0), ns); PAIR = ns['PAIR']
R = json.load(open(REF, encoding='utf-8'))
pairs = [s for s in S if s in PAIR and INFO[s]['h'] < 350 and PAIR[s][0] in R and s not in ('Ustka', 'Kołobrzeg')]
yrm = len(next(iter(S.values()))) / 365.25
print(f'par stacji (< 350 m): {len(pairs)}; model {yrm:.1f} lat; IMGW 1991–2020')
Rd = {}
for s in pairs:
    Rd[s] = {k: e for k, e in R[PAIR[s][0]]['days'].items() if '1991' <= k[:4] <= '2020'}
nyr = 30
print('\nDni z mgłą na rok (czas trwania mgły) – model / IMGW')
for th in (0.1, 1, 3, 6):
    m = SS.mean(sum(e['fog'] >= th for e in S[s].values()) / yrm for s in pairs)
    o = SS.mean(sum((e.get('fog') or 0) >= th for e in Rd[s].values()) / nyr for s in pairs)
    print(f'  ≥ {th:>3} h: {m:6.1f} / {o:6.1f}  (×{m / max(o, .01):.1f})')
print('Miesiące (≥ 1 h) model:', ' '.join(f"{SS.mean(sum(e['fog'] >= 1 and e['m'] == mm for e in S[s].values()) / yrm for s in pairs):4.1f}" for mm in range(1, 13)))
print('Miesiące (≥ 1 h) IMGW :', ' '.join(f"{SS.mean(sum((e.get('fog') or 0) >= 1 and int(k[5:7]) == mm for k, e in Rd[s].items()) / nyr for s in pairs):4.1f}" for mm in range(1, 13)))
def share(items):
    items = list(items); return 100 * sum(items) / max(len(items), 1)
mf = [e for s in pairs for e in S[s].values() if e['fog'] >= 1]
of = [e for s in pairs for e in Rd[s].values() if (e.get('fog') or 0) >= 1]
print(f"Doby z mgłą ≥ 1 h: z opadem ≥ 0.1 mm {share(e['p'] >= .1 for e in mf):.0f} / {share((e.get('p') or 0) >= .1 for e in of):.0f}%, wiatr ≥ 3 m/s {share(e['ws'] >= 3 for e in mf):.0f} / {share((e.get('ws') or 0) >= 3 for e in of):.0f}%, zachm. ≥ 80% {share(e['cl'] >= 80 for e in mf):.0f} / {share((e.get('cl') or 0) >= 6.4 for e in of):.0f}%")
# Tn wobec średniej stacji tej doby
days = sorted(next(iter(S.values())))
dm = {d: SS.mean(S[s][d]['tn'] for s in pairs) for d in days}
kd = sorted({k for s in pairs for k in Rd[s]})
om = {}
for k in kd:
    v = [Rd[s][k]['tn'] for s in pairs if k in Rd[s] and Rd[s][k].get('tn') is not None]
    if len(v) >= .7 * len(pairs): om[k] = SS.mean(v)
def dev(a):
    a = sorted(a); n = len(a); return f'śr {SS.mean(a):+.2f}, p05 {a[n // 20]:+.1f}, p01 {a[n // 100]:+.1f}'
print('\nTn − średnia Tn stacji tej doby:')
print('  model, mgła ≥ 3 h:', dev([S[s][d]['tn'] - dm[d] for s in pairs for d in days if S[s][d]['fog'] >= 3]))
print('  IMGW,  mgła ≥ 3 h:', dev([e['tn'] - om[k] for s in pairs for k, e in Rd[s].items() if k in om and e.get('tn') is not None and (e.get('fog') or 0) >= 3]))
print('  model, bez mgły  :', dev([S[s][d]['tn'] - dm[d] for s in pairs for d in days if S[s][d]['fog'] == 0]))
print('  IMGW,  bez mgły  :', dev([e['tn'] - om[k] for s in pairs for k, e in Rd[s].items() if k in om and e.get('tn') is not None and (e.get('fog') or 0) == 0]))
# bezwzględne minimum miesiąca
def recs(get):
    by = collections.defaultdict(lambda: collections.defaultdict(list))
    for s, d, ym, tn, fg in get: by[ym][s].append((tn, d, fg))
    cnt = collections.Counter(); margin = []; second = []; fogn = []; nm = 0
    for ym, st in by.items():
        if len(st) < .7 * len(pairs): continue
        mins = sorted((min(v)[0], s, min(v)[2]) for s, v in st.items() if len(v) >= 25)
        if len(mins) < 3: continue
        nm += 1; cnt[mins[0][1]] += 1
        margin.append(SS.median(x[0] for x in mins) - mins[0][0]); second.append(mins[1][0] - mins[0][0]); fogn.append(mins[0][2] >= 1)
    top = cnt.most_common(); t4 = sum(c for _, c in top[:4])
    print(f'  {nm} miesięcy, {len(cnt)} różnych stacji; 4 najczęstsze mają {100 * t4 / nm:.0f}%: {", ".join(f"{s} {c}" for s, c in top[:6])}')
    print(f'  zapas nad medianą stacji śr {SS.mean(margin):.1f} K (maks {max(margin):.1f}), nad drugą {SS.mean(second):.1f} K; noc rekordu z mgłą {100 * SS.mean(fogn):.0f}%')
D0 = datetime.date(2026, 1, 1)
print('\nAbsolutne Tmin miesiąca wśród stacji:')
print(' model (kolejne miesiące przebiegu):'); recs((s, d, (D0 + datetime.timedelta(days=d - 1)).strftime('%Y-%m'), S[s][d]['tn'], S[s][d]['fog']) for s in pairs for d in days)
print(' IMGW 1991–2020:'); recs((s, k, k[:7], e['tn'], e.get('fog') or 0) for s in pairs for k, e in Rd[s].items() if e.get('tn') is not None)
print(' IMGW, 4 ostatnie lata 2017–2020 (ten sam okres co model):'); recs((s, k, k[:7], e['tn'], e.get('fog') or 0) for s in pairs for k, e in Rd[s].items() if e.get('tn') is not None and k[:4] >= '2017')
# dobowy spadek Tn w mgle bez opadu: Tx − Tn
print('\nAmplituda Tx − Tn w dobach z mgłą ≥ 3 h, bez opadu, październik–marzec (model / IMGW):', end=' ')
print(f"{SS.mean(e['tx'] - e['tn'] for s in pairs for e in S[s].values() if e['fog'] >= 3 and e['p'] < .1 and e['m'] in (10, 11, 12, 1, 2, 3)):.1f} / {SS.mean(e['tx'] - e['tn'] for s in pairs for k, e in Rd[s].items() if (e.get('fog') or 0) >= 3 and (e.get('p') or 0) < .1 and e.get('tx') is not None and e.get('tn') is not None and int(k[5:7]) in (10, 11, 12, 1, 2, 3)):.1f} K")
