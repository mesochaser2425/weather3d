# Punkt rosy przy gruncie ~12 UTC: sondaże (poziom przy gruncie) wobec Td2 z kolumn modelu; wg binów T850 i ogółem. Też T2.
import sys, os, json, glob
sys.path.insert(0, sys.argv[2])
import numpy as np
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'capeigra.py'), encoding='utf-8').read().rsplit('main()', 1)[0]
a_ = sys.argv; sys.argv = ['x', '', '', a_[2]]; G = {}; exec(compile(src, 'capeigra', 'exec'), G); sys.argv = a_
out, igra = sys.argv[1], sys.argv[3]
def td_from_r(r, p):
    e = r * p / (0.622 + r); a = np.log(e / 610.78); return 237.3 * a / (17.27 - a)
ob = []
for z in sorted(glob.glob(os.path.join(igra, '*.zip'))): ob += [x['g'] for x in G['load_igra'](z, y0=2005)]
OB = G['compute'](ob)
tdo = td_from_r(OB['R'][:, 0], np.exp(OB['L'][:, 0])); to = OB['T'][:, 0] - 273.15
BINS, NAM = G['BINS'], G['NAM']
def rep(n, t, x, tt):
    p = lambda q: np.percentile(x, q)
    print(f'  {n:10s} n {len(x):4d}  Td sr {x.mean():5.1f}  p10 {p(10):5.1f} p50 {p(50):5.1f} p90 {p(90):5.1f} p99 {p(99):5.1f}  %>=18 {100*(x>=18).mean():4.1f} %>=20 {100*(x>=20).mean():4.1f}  | T sr {tt.mean():5.1f}')
print('SONDAZE (poziom przy gruncie)')
for b, nm in zip(BINS, NAM):
    m = (OB['t8'] >= b[0]) & (OB['t8'] < b[1]); rep(nm, None, tdo[m], to[m])
rep('razem', None, tdo, to)
for v in sys.argv[4:]:
    base, cols = G['load_model'](os.path.join(out, v))
    MD = G['compute']([G['prof_model'](base, a, 'thD', 'qD') for a in cols])
    td = np.array([a['td2'] for a in cols]); t = np.array([a['t2'] for a in cols])
    print(f'{v} (Td2, T2 z kolumn)')
    for b, nm in zip(BINS, NAM):
        m = (MD['t8'] >= b[0]) & (MD['t8'] < b[1])
        if m.sum() > 3: rep(nm, None, td[m], t[m])
    rep('razem', None, td, t)
