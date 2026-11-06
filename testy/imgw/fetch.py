import csv, collections, sys
rows = [r for r in csv.DictReader(open(sys.argv[1], encoding='utf-8-sig'), delimiter=';') if r.get('date') and not r['station'].startswith('#')]
def fl(v):
    try: return float(v.replace(',', '.'))
    except: return None
MON = {'January':0,'February':1,'March':2,'April':3,'May':4,'June':5,'July':6,'August':7,'September':8,'October':9,'November':10,'December':11}
SE = {11:'DJF',0:'DJF',1:'DJF',2:'MAM',3:'MAM',4:'MAM',5:'JJA',6:'JJA',7:'JJA',8:'SON',9:'SON',10:'SON'}
sec = {'W':'W','SW':'W','NW':'W','WSW':'W','WNW':'W','E':'E','SE':'E','NE':'E','ENE':'E','ESE':'E','N':'N','NNW':'N','NNE':'N','S':'S','SSW':'S','SSE':'S'}
excl = {'Ustka','Kołobrzeg'}
day = collections.defaultdict(list)
for r in rows:
    h = fl(r['height_m'])
    if h is None or h > 350 or r['station'] in excl: continue
    day[r['sim_day']].append(r)
lab = {}
for d, R in day.items():
    c = collections.Counter(sec.get(r['prevailing_dir'], '?') for r in R)
    s, n = c.most_common(1)[0]
    if n >= .7 * len(R): lab[d] = s
print('dni z jednym sektorem ≥70% stacji:', collections.Counter(lab.values()), 'z', len(day))
xs = sorted({fl(r['x_km']) for R in day.values() for r in R}); ys = sorted({fl(r['y_km']) for R in day.values() for r in R})
print('x', xs[0], xs[-1], 'y', ys[0], ys[-1])
def part(r, ax):
    v = fl(r['x_km']) if ax == 'x' else fl(r['y_km'])
    return 0 if v < 220 else (1 if v < 440 else 2)
out = {}
tab = collections.defaultdict(list)
for d, s in lab.items():
    for r in day[d]:
        m = MON[r['date'].split()[-1]]
        ax = 'x' if s in 'WE' else 'y'
        tab[(SE[m], s, part(r, ax))].append(r)
def stats(R):
    n = len(R); P = [fl(r['precip_mm']) or 0 for r in R]; wet = [p for p in P if p >= 1]
    m = lambda k: sum(fl(r[k]) or 0 for r in R) / n
    return dict(n=n, P=sum(P)/n, d01=100*sum(p>=.1 for p in P)/n, d1=100*len(wet)/n, d10=100*sum(p>=10 for p in P)/n, CL=m('cloud_cover_mean_%'), S=m('sunshine_h'), RH=m('RH_mean_%'), Td=m('Td_mean_C'), Tx=m('Tmax_C'), Tn=m('Tmin_C'))
print('Sektor: strefy geograficzne (x: zach 0-220, środ 220-440, wsch 440+; y: płd/środ/płn). Stacje < 350 m')
for s in ('JJA','MAM','SON','DJF'):
    print('\n'+s)
    for d in ('W','E','S','N'):
        for z in (0,1,2):
            R = tab.get((s,d,z))
            if not R: continue
            t = stats(R)
            name = {'W':'zach sr wsch','E':'zach sr wsch','S':'pld sr pln','N':'pld sr pln'}[d].split()[z]
            print(f"  wiatr {d} {name:5s} n{t['n']:5d} P {t['P']:4.2f} d≥0.1 {t['d01']:3.0f} d≥1 {t['d1']:3.0f} d≥10 {t['d10']:4.1f} | CL {t['CL']:3.0f} S {t['S']:4.1f} RH {t['RH']:3.0f} Td {t['Td']:5.1f} Tx {t['Tx']:5.1f} Tn {t['Tn']:5.1f}")
    # dekompozycja: położenie, kierunek, droga (W,E) – zachód/wschód
    a = {(d,z): stats(tab[(s,d,z)])['P'] for d in 'WE' for z in (0,2) if tab.get((s,d,z))}
    c = {(d,z): stats(tab[(s,d,z)])['CL'] for d in 'WE' for z in (0,2) if tab.get((s,d,z))}
    if len(a) == 4:
        print(f"  P: położenie wsch−zach {((a['W',2]-a['W',0])+(a['E',2]-a['E',0]))/2:+.2f}  droga (daleko−blisko) {((a['W',2]-a['W',0])-(a['E',2]-a['E',0]))/2:+.2f} mm/d;  CL: położenie {((c['W',2]-c['W',0])+(c['E',2]-c['E',0]))/2:+.1f}  droga {((c['W',2]-c['W',0])-(c['E',2]-c['E',0]))/2:+.1f}")
