import csv, collections, sys
rows = [r for r in csv.DictReader(open(sys.argv[1], encoding='utf-8-sig'), delimiter=';') if r.get('date') and not r['station'].startswith('#')]
def fl(v):
    try: return float(v.replace(',', '.'))
    except: return None
MON = ['January','February','March','April','May','June','July','August','September','October','November','December']
excl = {'Ustka', 'Kołobrzeg'}
by = collections.defaultdict(list)
days = []
for r in rows:
    h = fl(r['height_m'])
    if h is None or h > 350 or r['station'] in excl: continue
    d = int(fl(r['sim_day']))
    by[d].append(r)
days = sorted(by)
mean = lambda d, k: sum(fl(r[k]) or 0 for r in by[d]) / len(by[d])
ORD = {}
for d in days:
    ORD[d] = dict(m=MON.index(by[d][0]['date'].split()[-1]), P=mean(d, 'precip_mm'), ET=mean(d, 'evapotranspiration_mm'),
                  s1=mean(d, 'soil_0_10cm_%vol'), s2=mean(d, 'soil_10_40cm_%vol'), s3=mean(d, 'soil_40_100cm_%vol'),
                  SD=mean(d, 'snow_depth_cm'), T=mean(d, 'Tmean_C'), Tx=mean(d, 'Tmax_C'), S=mean(d, 'sunshine_h'))
for d in days:
    o = ORD[d]; o['W'] = o['s1'] * 1 + o['s2'] * 3 + o['s3'] * 6   # mm w górnym metrze
# cztery pełne lata od pierwszego stycznia
acc = collections.defaultdict(lambda: collections.defaultdict(float)); cnt = collections.Counter()
prev = None
for d in days:
    o = ORD[d]; m = o['m']
    for k in ('P', 'ET'): acc[m][k] += o[k]
    for k in ('s1', 's2', 's3', 'W', 'T', 'Tx', 'S'): acc[m]['_' + k] += o[k]
    if prev is not None: acc[m]['dW'] += o['W'] - ORD[prev]['W']
    cnt[m] += 1; prev = d
yrs = len(days) / 365.25
print(f'{len(days)} dób ≈ {yrs:.2f} lat; stacje < 350 m')
print('mies |  P  mm |  ET mm | dW mm | P-ET-dW | gleba 0-10 10-40 40-100 %obj | woda 1 m | T  Tx | słońce h/d')
tot = collections.Counter()
for m in range(12):
    a = acc[m]; n = cnt[m]; f = 1 / yrs
    res = (a['P'] - a['ET'] - a['dW']) * f
    print(f"{m+1:4d} | {a['P']*f:6.1f} | {a['ET']*f:6.1f} | {a['dW']*f:+5.1f} | {res:6.1f}  | {a['_s1']/n:5.1f} {a['_s2']/n:5.1f} {a['_s3']/n:5.1f} | {a['_W']/n:5.0f} | {a['_T']/n:5.1f} {a['_Tx']/n:5.1f} | {a['_S']/n:4.1f}")
    tot['P'] += a['P'] * f; tot['ET'] += a['ET'] * f; tot['res'] += res
print(f"rok: P {tot['P']:.0f} ET {tot['ET']:.0f} odpływ+drenaż {tot['res']:.0f} mm")
