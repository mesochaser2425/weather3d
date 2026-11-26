# Porównanie profili i CAPE: model (domena, duża skala) wobec sondaży IGRA, wg T na 850 hPa (masa powietrza)
# Argumenty: katalog z plikami s*.txt (model), katalog z zipami IGRA, ścieżka site-packages, [rok początkowy IGRA]
import sys
sys.path.insert(0, sys.argv[3])
import numpy as np, json, zipfile, glob, os, math
G, CP, RD, LV, EPS = 9.81, 1004.0, 287.04, 2.5e6, 0.622
ZG = np.arange(0, 16001, 50.0)                  # wysokość nad gruntem [m]
def esat(T): return 610.78 * np.exp(17.27 * (T - 273.16) / (T - 35.86))
def rsat(T, p):
    e = esat(T); return EPS * e / np.maximum(p - e, 1.0)
def rs1(T, p):
    e = 610.78 * math.exp(17.27 * (T - 273.16) / (T - 35.86)); return EPS * e / max(p - e, 1.0)
def dTdp(T, p):
    rs = rs1(T, p); return (RD * T + LV * rs) / (p * (CP + LV * LV * rs * EPS / (RD * T * T)))
BINS = [(-99, 10), (10, 14), (14, 18), (18, 99)]
NAM = ['T850 < 10', '10-14', '14-18', '>= 18']

def to_grid(z, p, T, r):
    """profil na siatkę ZG (z – nad gruntem, rosnąco): T i r liniowo, ln p liniowo"""
    return np.interp(ZG, z, np.log(p)), np.interp(ZG, z, T), np.interp(ZG, z, r)

def cape(lnp, T, r, kml=None):
    """CAPE cząstki 0–500 m: pseudoadiabata bez lodu, poprawka wirtualna; lnp, T, r na ZG co 50 m. Zwraca (cape, r_ml, th_ml, z_lcl)"""
    p = [math.exp(x) for x in lnp]
    n = 11   # poziomy 0–500 m
    sw = sum(p[:n]); thm = sum(float(T[i]) * (100000.0 / p[i]) ** 0.2854 * p[i] for i in range(n)) / sw; rm = sum(float(r[i]) * p[i] for i in range(n)) / sw
    Tp = thm * (p[0] / 100000.0) ** 0.2854
    c = 0.0; sat = False; zl = float('nan')
    for k in range(1, len(ZG)):
        pk = p[k]
        if not sat:
            Tp = thm * (pk / 100000.0) ** 0.2854
            if rm >= rs1(Tp, pk): sat = True; zl = float(ZG[k])
        else:
            dp = pk - p[k - 1]; pm = 0.5 * (pk + p[k - 1])
            Tq = Tp + 0.5 * dp * dTdp(Tp, p[k - 1])
            Tp = Tp + dp * dTdp(Tq, pm)
        if sat:
            Tve = float(T[k]) * (1 + 0.61 * float(r[k])); Tvp = Tp * (1 + 0.61 * rs1(Tp, pk))
            if Tvp > Tve: c += G * (Tvp - Tve) / Tve * 50.0
    return c, rm, thm, zl

def t850(lnp, T):
    lp = np.log(85000.0)
    # lnp maleje z wysokością
    if lnp[0] < lp: return np.nan
    return float(np.interp(-lp, -lnp, T))

# --- model ---
def load_model(d):
    out = []
    base = None
    for f in sorted(glob.glob(os.path.join(d, 's*.txt'))):
        seed = os.path.basename(f)
        mass = {}
        with open(f, encoding='utf-8', errors='replace') as fh:
            for l in fh:
                if ' BASE ' in l[:20]: base = json.loads(l.split('BASE ', 1)[1])
                elif ' DAY ' in l[:20]:
                    a = json.loads(l.split('DAY ', 1)[1]); mass[a['d']] = a['mass']
                elif ' COL ' in l[:20]:
                    a = json.loads(l.split('COL ', 1)[1])
                    if a['d'] < 3: continue
                    a['seed'] = seed; a['mass'] = mass.get(a['d']); out.append(a)
    return base, out

def prof_model(base, a, key_th, key_q):
    kb = a['kb']; zc = np.array(base['zc'])[kb:]; exc = np.array(base['exc'])[kb:]; prs = np.array(base['prs'])[kb:]
    th = np.array(a[key_th]); r = np.maximum(np.array(a[key_q]) / 1000.0, 1e-7)
    T = th * exc
    # ciśnienie hydrostatycznie od pierwszego poziomu
    p = np.empty_like(T); p[0] = prs[0]
    Tv = T * (1 + 0.61 * r)
    for k in range(1, len(T)):
        p[k] = p[k - 1] * np.exp(-G * (zc[k] - zc[k - 1]) / (RD * 0.5 * (Tv[k] + Tv[k - 1])))
    z = np.maximum(zc - a['h'], 5.0)
    p0 = p[0] * np.exp(G * z[0] / (RD * Tv[0]))
    z = np.concatenate(([0.0], z)); p = np.concatenate(([p0], p)); T = np.concatenate(([T[0]], T)); r = np.concatenate(([r[0]], r))
    return to_grid(z, p, T, r)

# --- IGRA ---
def load_igra(zpath, y0=1991, y1=2020, months=(6, 7, 8), hours=(11, 12)):
    out = []
    z = zipfile.ZipFile(zpath); f = z.open(z.namelist()[0])
    cur = None; hdr = None
    def flush():
        if not cur or hdr is None or len(cur) < 15: return
        lv = sorted(cur, key=lambda x: -x[0])
        p = np.array([x[0] for x in lv]); T = np.array([x[1] for x in lv]); td = np.array([x[2] for x in lv])
        if p[0] < 90000 or p[-1] > 15000: return
        # wymagane: wilgotność do ~500 hPa, gęstość poziomów w dole
        if np.sum((p > 85000)) < 4: return
        ok = np.isfinite(T)
        p, T, td = p[ok], T[ok], td[ok]
        r = np.where(np.isfinite(td), rsat(td, p), np.nan)
        if not np.isfinite(r[:5]).all(): return
        # ponad brak wilgotności – 0
        r = np.where(np.isfinite(r), r, 1e-6)
        r = np.maximum(r, 1e-7)
        # wysokość hydrostatycznie
        Tv = T * (1 + 0.61 * r); zz = np.zeros_like(p)
        for k in range(1, len(p)): zz[k] = zz[k - 1] + RD * 0.5 * (Tv[k] + Tv[k - 1]) / G * np.log(p[k - 1] / p[k])
        if zz[-1] < 12000: return
        out.append(dict(ymd=hdr, g=to_grid(zz, p, T, r)))
    for b in f:
        l = b.decode('latin-1')
        if l[0] == '#':
            flush(); cur = []
            y, m, d, h = int(l[13:17]), int(l[18:20]), int(l[21:23]), int(l[24:26])
            hdr = (y, m, d) if (y0 <= y <= y1 and m in months and h in hours) else None
            continue
        if hdr is None: continue
        try:
            lt = l[0:2]; P = int(l[9:15]); T = int(l[22:27]); rh = int(l[28:33]); dp = int(l[34:39])
        except ValueError:
            continue
        if P <= 0 or T <= -8888: continue
        tk = T / 10.0 + 273.15
        if dp > -8888: td = tk - dp / 10.0
        elif rh > -8888 and rh > 0:
            e = max(rh / 1000.0, 0.01) * esat(tk); a = np.log(e / 610.78); td = (237.3 * a / (17.27 - a)) + 273.15
        else: td = np.nan
        cur.append((float(P), tk, td))
    flush()
    return out

def stats(c):
    c = np.asarray(c)
    return dict(n=len(c), mean=c.mean(), p50=np.percentile(c, 50), p90=np.percentile(c, 90), p99=np.percentile(c, 99), f1=100 * (c >= 1000).mean(), f2=100 * (c >= 2000).mean(), f3=100 * (c >= 3000).mean())

def compute(lst):
    """lst – krotki (lnp, T, r); słownik macierzy: T850, cape, rml, thml, T, r, lnp"""
    n = len(lst)
    L = np.array([x[0] for x in lst]); T = np.array([x[1] for x in lst]); R = np.array([x[2] for x in lst])
    c = np.zeros(n); rm = np.zeros(n); tm = np.zeros(n); t8 = np.zeros(n); zl = np.zeros(n)
    for i in range(n):
        c[i], rm[i], tm[i], zl[i] = cape(L[i], T[i], R[i]); t8[i] = t850(L[i], T[i]) - 273.15
    return dict(L=L, T=T, R=R, c=c, rm=rm, tm=tm, t8=t8, zl=zl)

def at(zm): return int(round(zm / 50.0))
def report(name, D):
    print(f'\n== {name}: {len(D["c"])} profili')
    print('  bin        n   udzial  CAPE sr / p50 / p90 / p99   %>=1000 %>=2000 %>=3000 | r0-500  th0-500 | T1.5 T3 T5.6 T9 T12 [C] | r1.5 r3 r5')
    for b, nm in zip(BINS, NAM):
        m = (D['t8'] >= b[0]) & (D['t8'] < b[1])
        if m.sum() < 5: print(f'  {nm:9s} {m.sum():4d}'); continue
        s = stats(D['c'][m]); T = D['T'][m].mean(0) - 273.15; R = D['R'][m].mean(0) * 1000
        print(f'  {nm:9s} {m.sum():5d} {100*m.mean():5.1f}%  {s["mean"]:5.0f} /{s["p50"]:5.0f} /{s["p90"]:5.0f} /{s["p99"]:5.0f}   {s["f1"]:5.1f} {s["f2"]:5.1f} {s["f3"]:5.1f} | {D["rm"][m].mean()*1000:5.2f} {D["tm"][m].mean():6.1f} | ' +
              ' '.join(f'{T[at(z)]:5.1f}' for z in (1500, 3000, 5600, 9000, 12000)) + ' | ' + ' '.join(f'{R[at(z)]:4.1f}' for z in (1500, 3000, 5000)))

def main():
    base, cols = load_model(sys.argv[1])
    print('model: kolumn', len(cols))
    # tylko niziny
    cols = [a for a in cols if a['h'] < 250]
    print('po filtrze wysokosci < 250 m:', len(cols))
    MD = compute([prof_model(base, a, 'thD', 'qD') for a in cols])
    MT = compute([prof_model(base, a, 'thT', 'qT') for a in cols])
    y0 = int(sys.argv[4]) if len(sys.argv) > 4 else 1991
    obs = []
    for z in sorted(glob.glob(os.path.join(sys.argv[2], '*.zip'))):
        o = load_igra(z, y0=y0); print(os.path.basename(z), len(o), 'sondazy'); obs += [x['g'] for x in o]
    OB = compute(obs)
    report('SONDAZE', OB); report('MODEL domena', MD); report('MODEL duza skala (cel)', MT)
    print('\nMapa CAPE (kolumny) wg binow T850 domeny: sr', end=' ')
    mc = np.array([a['map'] for a in cols])
    for b, nm in zip(BINS, NAM):
        m = (MD['t8'] >= b[0]) & (MD['t8'] < b[1])
        if m.sum(): print(f'{nm}: {mc[m].mean():.0f}', end='  ')
    print()
    print('\nRoznice skladowe (domena - sondaze; srednie w binie T850): sr. zmiana CAPE po podmianie warstwy na wartosc ze sondazy (na kazdym profilu model + (obs - model) w warstwie)')
    LAY = {'q 0-500 m': ('R', 0, 500), 'q 0.5-1.5 km': ('R', 500, 1500), 'q 1.5-5 km': ('R', 1500, 5000), 'T 0-500 m': ('T', 0, 500), 'T 0.5-1.5': ('T', 500, 1500), 'T 1.5-5.6': ('T', 1500, 5600), 'T 5.6-12 km': ('T', 5600, 12000)}
    for src, S in (('domena', MD), ('cel', MT)):
        print(' ', src)
        for b, nm in zip(BINS, NAM):
            m = (S['t8'] >= b[0]) & (S['t8'] < b[1]); mo = (OB['t8'] >= b[0]) & (OB['t8'] < b[1])
            if m.sum() < 20 or mo.sum() < 20: continue
            idx = np.where(m)[0]; idx = idx[:: max(1, len(idx) // 250)]
            base_c = S['c'][idx].mean(); res = []
            for k, (v, z0, z1) in LAY.items():
                d = OB[v][mo].mean(0) - S[v][m].mean(0)
                sel = (ZG >= z0) & (ZG < z1)
                c2 = 0
                for i in idx:
                    T = S['T'][i].copy(); R = S['R'][i].copy()
                    if v == 'T': T[sel] += d[sel]
                    else: R[sel] = np.maximum(R[sel] + d[sel], 1e-7)
                    c2 += cape(S['L'][i], T, R)[0]
                res.append(f'{k}: {base_c - c2 / len(idx):+5.0f}')
            print(f'   {nm:9s} CAPE modelu {base_c:5.0f} (sond. {OB["c"][mo].mean():5.0f}) wklad do nadwyzki [J/kg]: ' + ', '.join(res))
    # OGON: górne 10% CAPE w binie i rozkład pary 0–500 m
    print('OGON (gorne 10% CAPE w binie; srednie: CAPE, r0-500, th0-500, T1.5, T3, T5.6, T12, r1.5, r3) i percentyle r0-500 (p10/p50/p90 g/kg)')
    for src, S in (('SOND', OB), ('DOM ', MD), ('CEL ', MT)):
        for b, nm in zip(BINS, NAM):
            m = np.where((S['t8'] >= b[0]) & (S['t8'] < b[1]))[0]
            if len(m) < 10: continue
            th = np.percentile(S['c'][m], 90); t = m[S['c'][m] >= th]; T = S['T'][t].mean(0) - 273.15; R = S['R'][t].mean(0) * 1000
            r = S['rm'][m] * 1000
            print(f'  {src} {nm:9s} n={len(t):3d} CAPE {S["c"][t].mean():5.0f} r {S["rm"][t].mean()*1000:5.2f} th {S["tm"][t].mean():6.1f} T ' + ' '.join(f'{T[at(z)]:6.1f}' for z in (1500, 3000, 5600, 12000)) + f' r1.5 {R[at(1500)]:4.1f} r3 {R[at(3000)]:4.1f} | r0-500 p10/50/90 {np.percentile(r,10):.1f}/{np.percentile(r,50):.1f}/{np.percentile(r,90):.1f}')
    # domena − cel
    print('\nDomena - cel (ten sam bin T850 domeny): q 0-500 [g/kg], T 0-500 [K], q 1.5 km, T 1.5 km, T 5.6 km')
    for b, nm in zip(BINS, NAM):
        m = (MD['t8'] >= b[0]) & (MD['t8'] < b[1])
        if m.sum() < 5: continue
        dR = 1000 * (MD['R'][m] - MT['R'][m]).mean(0); dT = (MD['T'][m] - MT['T'][m]).mean(0)
        print(f'  {nm:9s} q0-500 {dR[:11].mean():+5.2f}  T0-500 {dT[:11].mean():+5.2f}  q1.5 {dR[at(1500)]:+5.2f}  T1.5 {dT[at(1500)]:+5.2f}  T5.6 {dT[at(5600)]:+5.2f}')
main()
