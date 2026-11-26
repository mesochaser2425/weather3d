import sys, json, collections, statistics as st
R = collections.defaultdict(list)
for f in sys.argv[1:]:
    mass = {}
    for l in open(f, encoding='utf-8', errors='replace'):
        if ' DAY ' in l[:20]:
            a = json.loads(l.split('DAY ', 1)[1]); mass[a['d']] = a['mass']; 
            if a['d'] >= 3: R[(a['mass'], '13')].append(a['map'])
        elif ' M15 ' in l[:20]:
            a = json.loads(l.split('M15 ', 1)[1])
            if a['d'] >= 3: R[(mass[a['d']], '15')].append(a['map'])
print('masa  godz  dob | sr(mean) p50 p90 p99 max (srednie dobowych statystyk mapy) | maks max | %oczek>=1000 >=2000 >=3000')
for k in sorted(R):
    v = R[k]; n = len(v)
    m = lambda x: sum(d[x] for d in v) / n
    print(f"{k[0]:5s} {k[1]}  {n:3d} | {m('mean'):5.0f} {m('p50'):5.0f} {m('p90'):5.0f} {m('p99'):5.0f} {m('max'):5.0f} | {max(d['max'] for d in v):5.0f} | {m('f1k'):5.1f} {m('f2k'):5.1f} {m('f3k'):5.2f}")
