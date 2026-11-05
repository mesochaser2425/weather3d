# Te same stacje w poprzednim przebiegu (codzienne_test.csv, 797 dób od 1 XI 2026, sprzed zmian nocy i lata) i w nowym (4_pelne_lata.csv).
# Użycie: python -I -X utf8 cmp_prev.py <stary csv> <nowy csv>
import collections, csv, datetime, statistics as SS, sys
COMMON = ['Kraków', 'Katowice', 'Tarnów', 'Rzeszów', 'Bielsko-Biała', 'Nowy Sącz', 'Sanok', 'Nowy Targ', 'Zakopane']
f = lambda x: float(x.replace(',', '.'))
def load(fn, d0):
    S = collections.defaultdict(dict)
    for r in csv.DictReader(open(fn, encoding='utf-8-sig'), delimiter=';'):
        if not r.get('Tmin_C') or r['station'] not in COMMON: continue
        d = int(r['sim_day']); dt = d0 + datetime.timedelta(days=d - 1)
        S[r['station']][dt] = dict(T=f(r['Tmean_C']), Tx=f(r['Tmax_C']), Tn=f(r['Tmin_C']), P=f(r['precip_mm']), RH=f(r['RH_mean_%']), W=f(r['wind_mean_m_s']), CL=f(r['cloud_cover_mean_%']), S=f(r['sunshine_h']), SD=f(r['snow_depth_cm']), ET=f(r['evapotranspiration_mm']), Td=f(r['Td_mean_C']), dir=r['prevailing_dir'], G=f(r['gust_max_m_s']))
    return S
A = load(sys.argv[1], datetime.date(2026, 11, 1)); B = load(sys.argv[2], datetime.date(2026, 1, 1))
print('stacje wspólne:', [s for s in COMMON if s in A and s in B], '| zakres stary', min(next(iter(A.values()))), max(next(iter(A.values()))))
SEAS = collections.OrderedDict([('DJF', [12, 1, 2]), ('MAM', [3, 4, 5]), ('JJA', [6, 7, 8]), ('SON', [9, 10, 11]), ('ROK', list(range(1, 13)))])
def stats(S, ms, cut=None):
    out = {}
    for k in ['T', 'Tx', 'Tn', 'RH', 'W', 'CL', 'Td']:
        out[k] = SS.mean(SS.mean(e[k] for dt, e in S[s].items() if dt.month in ms and (not cut or dt <= cut)) for s in COMMON)
    def per_year(fn):
        v = []
        for s in COMMON:
            L = [e for dt, e in S[s].items() if dt.month in ms and (not cut or dt <= cut)]
            v.append(sum(1 for e in L if fn(e)) / (len(L) / (365.25 * len(ms) / 12)))
        return SS.mean(v)
    def sum_year(k):
        v = []
        for s in COMMON:
            L = [e for dt, e in S[s].items() if dt.month in ms and (not cut or dt <= cut)]
            v.append(sum(e[k] for e in L) / (len(L) / (365.25 * len(ms) / 12)))
        return SS.mean(v)
    out.update(P=sum_year('P'), S=sum_year('S'), ET=sum_year('ET'), d30=per_year(lambda e: e['Tx'] >= 30), d25=per_year(lambda e: e['Tx'] >= 25), tr=per_year(lambda e: e['Tn'] >= 20), tn18=per_year(lambda e: e['Tn'] >= 18), d50=per_year(lambda e: e['P'] >= 50), d20=per_year(lambda e: e['P'] >= 20), d1=per_year(lambda e: e['P'] >= 1))
    sect = {'SE', 'SSE', 'S', 'SSW', 'SW'}
    n = sum(1 for s in COMMON for dt, e in S[s].items() if dt.month in ms and e['dir'] in sect); t = sum(1 for s in COMMON for dt, e in S[s].items() if dt.month in ms)
    out['south'] = 100 * n / t
    return out
print('stary / nowy (śr. 9 stacji południa): T Tx Tn amp | RH Td | W | CL | S h | P | ET | d25 d30 Tn≥18 Tn≥20 | P≥1 ≥20 ≥50 | wiatr SE–SW %')
for sk, ms in SEAS.items():
    a, b = stats(A, ms, datetime.date(2028, 10, 31)), stats(B, ms)
    print(f"{sk}: T {a['T']:5.1f}/{b['T']:5.1f} Tx {a['Tx']:5.1f}/{b['Tx']:5.1f} Tn {a['Tn']:5.1f}/{b['Tn']:5.1f} amp {a['Tx']-a['Tn']:4.1f}/{b['Tx']-b['Tn']:4.1f} | RH {a['RH']:3.0f}/{b['RH']:3.0f} Td {a['Td']:5.1f}/{b['Td']:5.1f} | W {a['W']:.1f}/{b['W']:.1f} | CL {a['CL']:3.0f}/{b['CL']:3.0f} | S {a['S']:4.0f}/{b['S']:4.0f} | P {a['P']:4.0f}/{b['P']:4.0f} | ET {a['ET']:3.0f}/{b['ET']:3.0f} | d25 {a['d25']:4.1f}/{b['d25']:4.1f} d30 {a['d30']:4.1f}/{b['d30']:4.1f} n18 {a['tn18']:4.1f}/{b['tn18']:4.1f} n20 {a['tr']:4.1f}/{b['tr']:4.1f} | P≥1 {a['d1']:4.0f}/{b['d1']:4.0f} ≥20 {a['d20']:4.1f}/{b['d20']:4.1f} ≥50 {a['d50']:4.2f}/{b['d50']:4.2f} | S {a['south']:3.0f}/{b['south']:3.0f}")
