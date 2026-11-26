# Tropopauza (WMO, gradient < 2 K/km przez 2 km) z sondaży IGRA 12 UTC, wszystkie miesiące: zależność od T na 5.6 km i od T przy gruncie
# Argumenty: ścieżka site-packages, zipy IGRA...
import sys
sys.path.insert(0, sys.argv[1])
import numpy as np, zipfile
G, RD = 9.81, 287.04
Y0, Y1 = 2005, 2020
Zg = np.arange(0, 20001, 100.0)
def rd(zp):
    z = zipfile.ZipFile(zp); f = z.open(z.namelist()[0]); out = []; cur = None; hdr = None
    def fl():
        if hdr is None or not cur or len(cur) < 25: return
        L = sorted(cur, key=lambda x: -x[0]); p = np.array([x[0] for x in L]); T = np.array([x[1] for x in L])
        if p[0] < 90000 or p[-1] > 12000: return
        zz = np.zeros_like(p)
        for k in range(1, len(p)): zz[k] = zz[k - 1] + RD * 0.5 * (T[k] + T[k - 1]) / G * np.log(p[k - 1] / p[k])
        if zz[-1] < 16000: return
        Tg = np.interp(Zg, zz, T)
        lr = -(Tg[1:] - Tg[:-1]) / 0.1      # K/km
        zt = np.nan
        for k in range(50, len(lr) - 21):   # od 5 km
            if lr[k] < 2.0 and np.mean(lr[k:k + 20]) < 2.0: zt = Zg[k]; break
        if np.isfinite(zt): out.append((hdr[1], zt, Tg[0] - 273.15, Tg[56] - 273.15, Tg[30] - 273.15, Tg[90] - 273.15))
    for b in f:
        l = b.decode('latin-1')
        if l[0] == '#':
            fl(); cur = []
            y, m, h = int(l[13:17]), int(l[18:20]), int(l[24:26])
            hdr = (y, m) if (Y0 <= y <= Y1 and h in (11, 12)) else None
            continue
        if hdr is None: continue
        try: P = int(l[9:15]); T = int(l[22:27])
        except ValueError: continue
        if P > 0 and T > -8888: cur.append((float(P), T / 10 + 273.15))
    fl(); return out
A = []
for z in sys.argv[2:]:
    r = rd(z); print(z[-26:], len(r)); A += r
A = np.array(A)
m, zt, ts, t56, t3, t9 = A.T
print('sred. tropopauza [km] wg miesiaca:', ' '.join(f'{zt[m==k].mean()/1000:.1f}' for k in range(1, 13)))
print('wzor modelu (11.2 km + 110 m/K * (T_grunt - 10 C), T_grunt 12 UTC - 2 K): sred. wg miesiaca:', ' '.join(f'{(11200+110*(ts[m==k]-2-10)).mean()/1000:.1f}' for k in range(1, 13)))
def fit(x, nm, sel=None):
    if sel is None: sel = np.ones_like(x, bool)
    c = np.polyfit(x[sel], zt[sel], 1); e = zt[sel] - np.polyval(c, x[sel]); print(f'  {nm}: z = {c[1]:.0f} + {c[0]:.1f}*T, RMSE {e.std():.0f} m, R2 {1-e.var()/zt[sel].var():.2f}'); return c
print('Wszystkie miesiace'); fit(ts, 'T przy gruncie 12 UTC'); c56 = fit(t56, 'T 5.6 km'); fit(t3, 'T 3 km'); fit(t9, 'T 9 km')
J = (m >= 6) & (m <= 8)
print('VI-VIII'); fit(ts, 'T przy gruncie 12 UTC', J); fit(t56, 'T 5.6 km', J); fit(t3, 'T 3 km', J); fit(t9, 'T 9 km', J)
print('blad wzoru modelu w VI-VIII wg T 5.6 km (tercyle: zimno, srednio, cieplo): z_tr obs, wzor')
q = np.percentile(t56[J], [33, 67])
for a, b in ((-99, q[0]), (q[0], q[1]), (q[1], 99)):
    s = J & (t56 >= a) & (t56 < b)
    print(f'  T5.6 {t56[s].mean():6.1f} C: obs {zt[s].mean()/1000:.2f} km, wzor modelu {(11200+110*(ts[s]-2-10)).mean()/1000:.2f} km, regresja z T5.6 {np.polyval(c56, t56[s]).mean()/1000:.2f}')
print('blad wzoru regresji T5.6 (wszystkie mies.) wg miesiaca:', ' '.join(f'{(zt[m==k]-np.polyval(c56, t56[m==k])).mean():.0f}' for k in range(1, 13)))
print('--- funkcja kwadratowa T5.6 (wszystkie miesiace)')
c2 = np.polyfit(t56, zt, 2); e = zt - np.polyval(c2, t56); print('  z = %.1f*T^2 + %.1f*T + %.0f, RMSE %.0f m, R2 %.2f' % (c2[0], c2[1], c2[2], e.std(), 1 - e.var() / zt.var()))
print('  blad wg miesiaca:', ' '.join(f'{(zt[m==k]-np.polyval(c2, t56[m==k])).mean():.0f}' for k in range(1, 13)))
q = np.percentile(t56[J], [33, 67])
for a, b in ((-99, q[0]), (q[0], q[1]), (q[1], 99)):
    s = J & (t56 >= a) & (t56 < b)
    print(f'  VI-VIII T5.6 {t56[s].mean():6.1f}: obs {zt[s].mean()/1000:.2f}, kwadr. {np.polyval(c2, t56[s]).mean()/1000:.2f}')
for v in (-35, -30, -25, -20, -15, -10, -5, 0): print(f'  T5.6 {v}: {np.polyval(c2, v)/1000:.2f} km', end=';')
print()
print('--- T5.6 + pora roku (s = 0.5 - 0.5*cos(2*pi*(mies-1)/12): 0 styczen, 1 lipiec)')
s = 0.5 - 0.5 * np.cos(2 * np.pi * (m - 1) / 12)
X = np.vstack([np.ones_like(t56), t56, s]).T
b, *_ = np.linalg.lstsq(X, zt, rcond=None); e = zt - X @ b
print('  z = %.0f + %.1f*T5.6 + %.0f*s, RMSE %.0f m, R2 %.2f' % (b[0], b[1], b[2], e.std(), 1 - e.var() / zt.var()))
print('  blad wg miesiaca:', ' '.join(f'{e[m==k].mean():.0f}' for k in range(1, 13)))
q = np.percentile(t56[J], [33, 67])
for a_, b_ in ((-99, q[0]), (q[0], q[1]), (q[1], 99)):
    w = J & (t56 >= a_) & (t56 < b_)
    print(f'  VI-VIII T5.6 {t56[w].mean():6.1f}: obs {zt[w].mean()/1000:.2f}, wzor {(X[w] @ b).mean()/1000:.2f}')
print('--- T5.6 + sunf jak P.summer (szer. 49.5, doba srodka miesiaca)')
doy = 30.4 * (m - 0.5); decl = 23.44 * np.sin(2 * np.pi * (doy - 81) / 365); sn = np.cos(np.radians(49.5 - decl)); sf = np.clip((sn - 0.25) / 0.65, 0, 1)
X = np.vstack([np.ones_like(t56), t56, sf]).T; b, *_ = np.linalg.lstsq(X, zt, rcond=None); e = zt - X @ b
print('  z = %.0f + %.1f*T5.6 + %.0f*sunf, RMSE %.0f m, R2 %.2f' % (b[0], b[1], b[2], e.std(), 1 - e.var() / zt.var()))
print('  blad wg miesiaca:', ' '.join(f'{e[m==k].mean():.0f}' for k in range(1, 13)))
print('--- T5.6 + sunf opozniony o 25 dob')
sn2 = np.cos(np.radians(49.5 - 23.44 * np.sin(2 * np.pi * (doy - 25 - 81) / 365))); sf2 = np.clip((sn2 - 0.25) / 0.65, 0, 1)
X = np.vstack([np.ones_like(t56), t56, sf2]).T; b, *_ = np.linalg.lstsq(X, zt, rcond=None); e = zt - X @ b
print('  z = %.0f + %.1f*T5.6 + %.0f*sunf25, RMSE %.0f m, R2 %.2f' % (b[0], b[1], b[2], e.std(), 1 - e.var() / zt.var()))
print('  blad wg miesiaca:', ' '.join(f'{e[m==k].mean():.0f}' for k in range(1, 13)))
q = np.percentile(t56[J], [33, 67])
for a_, b_ in ((-99, q[0]), (q[0], q[1]), (q[1], 99)):
    w = J & (t56 >= a_) & (t56 < b_)
    print(f'  VI-VIII T5.6 {t56[w].mean():6.1f}: obs {zt[w].mean()/1000:.2f}, wzor {(X[w] @ b).mean()/1000:.2f}')
