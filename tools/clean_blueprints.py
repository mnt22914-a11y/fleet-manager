# 図面画像(reference/)から車の絵だけを残す: 車の外側を白に、方眼線を除去、車の中の引き出し線・注記を消す。
# 実行: python3 tools/clean_blueprints.py   → img/*.jpg を書き出す
from PIL import Image, ImageDraw
import math, pathlib

K = 2816 / 2000   # 表示座標(2000 幅)→ 元画像
CROPS = {         # 表示座標でのクロップ枠(regions2d.js と同じ)
    'side':  (255, 128, 1725, 895),
    'front': (560, 120, 1445, 965),
    'rear':  (625, 115, 1375, 945),
    'top':   (440, 215, 1680, 850),
}
SRC = {'side': 'reference/every-side.jpg', 'front': 'reference/every-front.jpg', 'rear': 'reference/every-rear.jpg', 'top': 'reference/every-top.jpg'}

def crop(key, max_w=1400, rotate=None):
    im = Image.open(SRC[key]).convert('RGB')
    x0, y0, x1, y1 = [v * K for v in CROPS[key]]
    im = im.crop((int(x0), int(y0), int(x1), int(y1)))
    if rotate: im = im.rotate(rotate, expand=True)
    s = min(1.0, max_w / im.width)
    if s < 1: im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    return im

def lum(p): return (p[0] * 299 + p[1] * 587 + p[2] * 114) // 1000

def keep_only(im, poly):
    """多角形の外側を白にする。"""
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).polygon(poly, fill=255)
    white = Image.new('RGB', im.size, (255, 255, 255))
    return Image.composite(im, white, mask)

def remove_grid(im):
    """薄い細線(方眼)を消す: 明るめの画素で、左右または上下 3px 先が両方ほぼ白なら白にする。"""
    w, h = im.size
    px = im.load()
    out = im.copy(); op = out.load()
    for y in range(3, h - 3):
        for x in range(3, w - 3):
            l = lum(px[x, y])
            if 140 <= l <= 246:
                if (lum(px[x - 3, y]) > 240 and lum(px[x + 3, y]) > 240) or (lum(px[x, y - 3]) > 240 and lum(px[x, y + 3]) > 240):
                    op[x, y] = (255, 255, 255)
    return out

def clone_segment(im, p0, p1, width=2, offset=(0, -6)):
    """線分の上の画素を、offset だけずらした位置の画素で置き換える(細い線を周囲の色で埋める)。"""
    px = im.load(); w, h = im.size
    (x0, y0), (x1, y1) = p0, p1
    n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy) or 1
    nx, ny = -dy / L, dx / L   # 法線
    src = {}
    for i in range(n):
        t = i / max(1, n - 1)
        cx, cy = x0 + dx * t, y0 + dy * t
        for k in range(-width, width + 1):
            x, y = int(round(cx + nx * k)), int(round(cy + ny * k))
            sx, sy = x + offset[0], y + offset[1]
            if 0 <= x < w and 0 <= y < h and 0 <= sx < w and 0 <= sy < h:
                src[(x, y)] = px[sx, sy]
    for (x, y), c in src.items(): px[x, y] = c

def fill_rows(im, x0, x1, y0, y1, sample_x):
    """矩形の各行を、sample_x の画素の色で塗る(窓の中の文字を消す)。"""
    px = im.load()
    for y in range(y0, y1 + 1):
        c = px[sample_x, y]
        for x in range(x0, x1 + 1): px[x, y] = c

def find_row(im, y_approx, x0, x1, search=8):
    """x0..x1 の範囲で最も暗い行を y_approx±search から探す(横線の正確な y)。"""
    px = im.load(); best, by = 1e9, y_approx
    for y in range(y_approx - search, y_approx + search + 1):
        m = sum(lum(px[x, y]) for x in range(x0, x1, 2))
        if m < best: best, by = m, y
    return by

def find_col(im, x_approx, y0, y1, search=8):
    px = im.load(); best, bx = 1e9, x_approx
    for x in range(x_approx - search, x_approx + search + 1):
        m = sum(lum(px[x, y]) for y in range(y0, y1, 2))
        if m < best: best, bx = m, x
    return bx

def erase_hline(im, y_approx, x0, x1, offset_y=-8, width=3):
    y = find_row(im, y_approx, x0, x1)
    clone_segment(im, (x0, y), (x1, y), width=width, offset=(0, offset_y))

def erase_vline(im, x_approx, y0, y1, offset_x=-8, width=3):
    x = find_col(im, x_approx, y0, y1)
    clone_segment(im, (x, y0), (x, y1), width=width, offset=(offset_x, 0))

def erase_band(im, p0, p1, half=8, thr=205, reach=12):
    """線分の周囲 ±half px の帯の中で、暗い画素だけを「帯の外側(法線方向 ±reach)の明るい方の色」で埋める。
    斜めの引き出し線のように位置が数 px ずれていても消せる。"""
    px = im.load(); w, h = im.size
    (x0, y0), (x1, y1) = p0, p1
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy) or 1
    nx, ny = -dy / L, dx / L
    n = int(L) + 1
    done = set()
    for i in range(n):
        t = i / max(1, n - 1)
        cx, cy = x0 + dx * t, y0 + dy * t
        for k in range(-half, half + 1):
            x, y = int(round(cx + nx * k)), int(round(cy + ny * k))
            if (x, y) in done or not (0 <= x < w and 0 <= y < h): continue
            done.add((x, y))
            if lum(px[x, y]) >= thr: continue
            cands = []
            for sgn in (1, -1):
                sx, sy = int(round(x + nx * reach * sgn)), int(round(y + ny * reach * sgn))
                if 0 <= sx < w and 0 <= sy < h: cands.append(px[sx, sy])
            if cands: px[x, y] = max(cands, key=lum)

def dotted_col(im, x0, x1, y0, y1, thr=228):
    """点線の縦線: 範囲内で「thr より暗い画素の数」が最も多い列。"""
    px = im.load()
    return max(range(x0, x1 + 1), key=lambda x: sum(lum(px[x, y]) < thr for y in range(y0, y1 + 1)))

def dotted_row(im, y0, y1, x0, x1, thr=228):
    px = im.load()
    return max(range(y0, y1 + 1), key=lambda y: sum(lum(px[x, y]) < thr for x in range(x0, x1 + 1)))

def erase_col(im, x, y0, y1, width=2, offset=8):
    clone_segment(im, (x, y0), (x, y1), width=width, offset=(offset, 0))

def erase_row(im, y, x0, x1, width=2, offset=-8):
    clone_segment(im, (x0, y), (x1, y), width=width, offset=(0, offset))

def band_mean(im, p0, p1, half):
    px = im.load(); w, h = im.size
    (x0, y0), (x1, y1) = p0, p1
    dx, dy = x1 - x0, y1 - y0; L = math.hypot(dx, dy) or 1; nx, ny = -dy / L, dx / L
    tot = cnt = 0
    for i in range(int(L) + 1):
        t = i / max(1, int(L)); cx, cy = x0 + dx * t, y0 + dy * t
        for k in range(-half, half + 1):
            x, y = int(round(cx + nx * k)), int(round(cy + ny * k))
            if 0 <= x < w and 0 <= y < h: tot += lum(px[x, y]); cnt += 1
    return tot / max(1, cnt)

def erase_diag(im, p0, p1, width=6, dist=16):
    """斜めの線を、線に直交する向きに dist だけ離れた(より明るい側の)帯の色で埋める。"""
    (x0, y0), (x1, y1) = p0, p1
    dx, dy = x1 - x0, y1 - y0; L = math.hypot(dx, dy) or 1; nx, ny = -dy / L, dx / L
    best = None
    for sgn in (1, -1):
        off = (nx * dist * sgn, ny * dist * sgn)
        m = band_mean(im, (x0 + off[0], y0 + off[1]), (x1 + off[0], y1 + off[1]), width)
        if best is None or m > best[0]: best = (m, off)
    clone_segment(im, p0, p1, width=width, offset=(int(round(best[1][0])), int(round(best[1][1]))))

def thin_cols(im, x0, x1, y0, y1, thr=236, n=2, minfrac=0.02):
    """細い縦線(点線を含む)の列を、暗い画素の数が多い順に n 本返す。隣接列はまとめる。"""
    px = im.load()
    score = {x: sum(lum(px[x, y]) < thr for y in range(y0, y1 + 1)) for x in range(x0, x1 + 1)}
    picked = []
    for x in sorted(score, key=lambda x: -score[x]):
        if score[x] < (y1 - y0) * minfrac: break
        if all(abs(x - q) > 2 for q in picked): picked.append(x)
        if len(picked) >= n: break
    return picked

def erase_thin_cols(im, x0, x1, y0, y1, py0, py1, n=2, width=1, thr=236):
    """x0..x1 の範囲にある細い縦線を消す。色は左右どちらか明るい側の列から写す。"""
    px = im.load()
    out = []
    for x in thin_cols(im, x0, x1, py0, py1, thr=thr, n=n):
        best = None
        for off in (8, -8, 12, -12, 16, -16):
            sx = x + off
            if not (0 <= sx < im.size[0]): continue
            m = sum(lum(px[sx, y]) for y in range(py0, py1 + 1)) / (py1 - py0 + 1)
            if best is None or m > best[0]: best = (m, off)
        clone_segment(im, (x, y0), (x, y1), width=width, offset=(best[1], 0))
        out.append(x)
    return out

def erase_thin_in_poly(im, poly, lo=60, hi=226, guard=60, win=5):
    """多角形の中で、中間の濃さ(lo <= 明度 < hi)の画素 = 細い引き出し線・点線だけを、周囲の地の色で埋める。
    濃い車体の線(明度 < guard)とその隣の画素は触らない。"""
    px = im.load(); w, h = im.size
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).polygon(poly, fill=255)
    mp = mask.load()
    xs = [q[0] for q in poly]; ys = [q[1] for q in poly]
    targets = []
    for y in range(max(1, min(ys)), min(h - 1, max(ys) + 1)):
        for x in range(max(1, min(xs)), min(w - 1, max(xs) + 1)):
            if not mp[x, y]: continue
            l = lum(px[x, y])
            if not (lo <= l < hi): continue
            if any(lum(px[x + i, y + j]) < guard for i in (-1, 0, 1) for j in (-1, 0, 1)): continue
            targets.append((x, y))
    for x, y in targets:
        acc = [0, 0, 0]; n = 0
        for j in range(-win, win + 1):
            for i in range(-win, win + 1):
                sx, sy = x + i, y + j
                if 0 <= sx < w and 0 <= sy < h and lum(px[sx, sy]) >= hi:
                    c = px[sx, sy]; acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; n += 1
        if n: px[x, y] = (acc[0] // n, acc[1] // n, acc[2] // n)
    return len(targets)

def line_mean(im, p0, p1):
    px = im.load(); w, h = im.size
    (x0, y0), (x1, y1) = p0, p1
    n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
    tot = cnt = 0
    for i in range(n):
        t = i / max(1, n - 1)
        x, y = int(round(x0 + (x1 - x0) * t)), int(round(y0 + (y1 - y0) * t))
        if 0 <= x < w and 0 <= y < h: tot += lum(px[x, y]); cnt += 1
    return tot / max(1, cnt)

def snap_line(im, p0, p1, search=6):
    """両端を法線方向に ±search px ずらして、最も暗くなる位置(= 実際の線)に合わせる。"""
    (x0, y0), (x1, y1) = p0, p1
    dx, dy = x1 - x0, y1 - y0; L = math.hypot(dx, dy) or 1; nx, ny = -dy / L, dx / L
    best = None
    for a in range(-search, search + 1):
        for b in range(-search, search + 1):
            q0 = (x0 + nx * a, y0 + ny * a); q1 = (x1 + nx * b, y1 + ny * b)
            m = line_mean(im, q0, q1)
            if best is None or m < best[0]: best = (m, q0, q1)
    return best[1], best[2], best[0]

def erase_line_interp(im, p0, p1, half=2, reach=4, snap=6, trim=0):
    """濃い細い直線を消す。位置を snap で合わせ、線の帯(±half)の各画素を、法線方向 ±reach の両脇の画素の平均で埋める。
    車体の線と交差する所は両脇も濃いので、車体の線は残る。trim で両端を少し短くできる。"""
    q0, q1, m = snap_line(im, p0, p1, snap) if snap else (p0, p1, None)
    px = im.load(); w, h = im.size
    (x0, y0), (x1, y1) = q0, q1
    dx, dy = x1 - x0, y1 - y0; L = math.hypot(dx, dy) or 1; ux, uy = dx / L, dy / L; nx, ny = -dy / L, dx / L
    x0, y0, x1, y1 = x0 + ux * trim, y0 + uy * trim, x1 - ux * trim, y1 - uy * trim
    src = {}
    n = int(L) + 1
    for i in range(n):
        t = i / max(1, n - 1); cx, cy = x0 + dx * t, y0 + dy * t
        for k in range(-half, half + 1):
            x, y = int(round(cx + nx * k)), int(round(cy + ny * k))
            if not (0 <= x < w and 0 <= y < h) or (x, y) in src: continue
            a = (int(round(cx + nx * (reach + half))), int(round(cy + ny * (reach + half))))
            b = (int(round(cx - nx * (reach + half))), int(round(cy - ny * (reach + half))))
            cols = [px[q] for q in (a, b) if 0 <= q[0] < w and 0 <= q[1] < h]
            if cols: src[(x, y)] = tuple(sum(c[i] for c in cols) // len(cols) for i in range(3))
    for q, c in src.items(): px[q] = c
    return round(m) if m is not None else None

def erase_specks_in_poly(im, poly, dark=215, max_cluster=6, win=4):
    """多角形の中の「孤立した暗い点」(5x5 の中に暗い画素が max_cluster 個以下)を、周囲の明るい画素の平均で埋める。
    太い車体の線は 5x5 に暗い画素が多いので残る。"""
    px = im.load(); w, h = im.size
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).polygon(poly, fill=255)
    mp = mask.load()
    xs = [q[0] for q in poly]; ys = [q[1] for q in poly]
    targets = []
    for y in range(max(2, min(ys)), min(h - 2, max(ys) + 1)):
        for x in range(max(2, min(xs)), min(w - 2, max(xs) + 1)):
            if not mp[x, y] or lum(px[x, y]) >= dark: continue
            c = sum(lum(px[x + i, y + j]) < dark for i in range(-2, 3) for j in range(-2, 3))
            if c <= max_cluster: targets.append((x, y))
    for x, y in targets:
        acc = [0, 0, 0]; n = 0
        for j in range(-win, win + 1):
            for i in range(-win, win + 1):
                sx, sy = x + i, y + j
                if 0 <= sx < w and 0 <= sy < h and lum(px[sx, sy]) >= 236:
                    c = px[sx, sy]; acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; n += 1
        if n: px[x, y] = (acc[0] // n, acc[1] // n, acc[2] // n)
    return len(targets)

def erase_leader(im, p0, p1, half=3, snap=8, band=7):
    """濃い引き出し線を消す: 位置合わせ + 両脇からの補間 → 残った縁(中間色)を地の色で埋める。"""
    q0, q1, m = snap_line(im, p0, p1, snap)
    erase_line_interp(im, q0, q1, half=half, reach=4, snap=0)
    (x0, y0), (x1, y1) = q0, q1
    dx, dy = x1 - x0, y1 - y0; L = math.hypot(dx, dy) or 1; nx, ny = -dy / L * band, dx / L * band
    poly = [(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)]
    poly = [(int(round(a)), int(round(b))) for a, b in poly]
    n = erase_thin_in_poly(im, poly, lo=60, hi=234, guard=60, win=4)
    n2 = erase_specks_in_poly(im, poly)
    return (round(m), n, n2)

def darkest_col(im, x0, x1, y0, y1):
    px = im.load()
    return min(range(x0, x1 + 1), key=lambda x: sum(lum(px[x, y]) for y in range(y0, y1 + 1)))

def erase_dotted_col(im, x_approx, y0, y1, probe, search=10, width=2, offset=8):
    """点線の縦線を消す。probe=(py0, py1) の範囲(背景が白い所)で最も暗い列を探し、その列を offset 先の色で埋める。"""
    x = darkest_col(im, x_approx - search, x_approx + search, probe[0], probe[1])
    clone_segment(im, (x, y0), (x, y1), width=width, offset=(offset, 0))
    return x

def save(im, path):
    im.save(path, quality=85, optimize=True); print(path, im.size)

# ---- 側面(1400x731) ----
im = crop('side')
im = keep_only(im, [(5, 40), (60, 16), (1000, 16), (1180, 38), (1262, 118), (1396, 330), (1396, 642), (1300, 642), (1300, 727), (1065, 727), (1065, 642), (360, 642), (360, 727), (120, 727), (120, 642), (5, 642)])
im = remove_grid(im)
fill_rows(im, 212, 278, 28, 286, 204)     # クォーター窓の「roof Height」
fill_rows(im, 865, 917, 105, 290, 858)    # 前ドア窓の「Height」
for y in range(299, 305): clone_segment(im, (30, y), (1300, y), width=0, offset=(0, 12))    # 車体を横切る破線(窓の下)
for y in range(381, 397): clone_segment(im, (30, y), (1300, y), width=0, offset=(0, -16))   # 車体を横切る破線 2 本(ドア中央)
for cx in (235, 1182):   # 車輪の中心線(点線、2 本並ぶことがある)
    for _ in range(2):
        x = dotted_col(im, cx - 10, cx + 10, 486, 730)
        erase_col(im, x, 486, 730, width=2, offset=7)
print('  side susp leaders:', erase_thin_in_poly(im, [(326, 636), (400, 636), (400, 690), (326, 690)]), erase_leader(im, (696, 616), (708, 646), half=2, snap=6))
clone_segment(im, (41, 18), (41, 168), width=3, offset=(-8, 0))   # 後端の寸法補助線
save(im, 'img/side.jpg')

# ---- 正面(1246x1190) ----
im = crop('front')
im = keep_only(im, [(190, 6), (1050, 6), (1068, 70), (1088, 320), (1100, 330), (1224, 330), (1224, 480), (1130, 480), (1136, 1040), (1118, 1046), (1118, 1189), (988, 1189), (988, 1050), (258, 1050), (258, 1189), (122, 1189), (122, 1046), (110, 1040), (114, 480), (16, 480), (16, 330), (140, 330), (152, 320), (172, 70)])
im = remove_grid(im)
clone_segment(im, (620, 10), (620, 1185), width=2, offset=(-7, 0))   # 中心線
print('  front wiper leader snap lum:', erase_leader(im, (972, 184), (1078, 150)))
clone_segment(im, (945, 200), (1080, 200), width=3, offset=(0, -9))   # ドアハンドル(上)
clone_segment(im, (1088, 607), (1136, 607), width=3, offset=(0, -9))  # ヘッドライト
clone_segment(im, (798, 680), (1136, 680), width=3, offset=(0, -9))   # グリル
clone_segment(im, (1076, 788), (1140, 788), width=3, offset=(0, -9))  # フロントバンパー
clone_segment(im, (965, 486), (1136, 486), width=3, offset=(0, -9))   # ドアハンドル(下)
print('  front mirror leader snap lum:', erase_leader(im, (1183, 362), (1224, 332)))
clone_segment(im, (205, 0), (205, 240), width=3, offset=(9, 0))       # 寸法補助線(左上)
clone_segment(im, (1035, 0), (1035, 130), width=3, offset=(-9, 0))    # 寸法補助線(右上)
ImageDraw.Draw(im).rectangle([105, 1176, 275, 1189], fill=(255, 255, 255))   # タイヤ下の基準線
ImageDraw.Draw(im).rectangle([975, 1176, 1135, 1189], fill=(255, 255, 255))
ImageDraw.Draw(im).rectangle([180, 16, 345, 22], fill=(255, 255, 255))         # 屋根の上の寸法線
save(im, 'img/front.jpg')

# ---- 背面(1056x1169) ----
im = crop('rear')
im = keep_only(im, [(130, 18), (930, 18), (946, 40), (952, 378), (1032, 378), (1032, 482), (952, 482), (956, 930), (942, 936), (942, 1168), (858, 1168), (858, 1066), (200, 1066), (200, 1168), (104, 1168), (104, 936), (94, 930), (100, 482), (20, 482), (20, 378), (100, 378), (108, 40)])
im = remove_grid(im)
clone_segment(im, (528, 10), (528, 1165), width=2, offset=(-7, 0))   # 中心線
fill_rows(im, 312, 745, 174, 222, 300)                               # 窓の中の「HIGH-MOUNTED STOP LAMP」
clone_segment(im, (712, 325), (952, 325), width=3, offset=(0, -9))   # リアワイパーの引き出し線
clone_segment(im, (92, 478), (364, 478), width=3, offset=(0, -9))    # テールゲートハンドル
clone_segment(im, (712, 550), (952, 550), width=3, offset=(0, -9))   # テールランプ
clone_segment(im, (92, 695), (480, 695), width=3, offset=(0, -9))    # ナンバープレート
print('  rear himount leader:', erase_leader(im, (586, 124), (632, 164)), erase_leader(im, (634, 163), (955, 163), snap=6), erase_specks_in_poly(im, [(578, 118), (600, 112), (646, 160), (640, 176)], dark=228, max_cluster=8))
clone_segment(im, (628, 163), (956, 163), width=3, offset=(0, -9))   # 同(横)
print('  rear side dotted cols:', erase_thin_cols(im, 103, 117, 160, 1062, 200, 600, n=3), erase_thin_cols(im, 941, 957, 160, 1062, 200, 600, n=3))
clone_segment(im, (20, 478), (98, 478), width=3, offset=(0, -9))     # ミラー脇の線(左)
clone_segment(im, (958, 478), (1034, 478), width=3, offset=(0, -9))  # ミラー脇の線(右)
erase_band(im, (92, 838), (166, 878), half=9)                        # 後バンパーの引き出し線(左)
erase_band(im, (930, 856), (960, 832), half=9)                       # 同(右)
print('  rear leaf leader:', erase_leader(im, (778, 1015), (852, 1067)), erase_leader(im, (770, 1005), (845, 1050)), erase_leader(im, (853, 1066), (955, 1066), snap=6))
clone_segment(im, (704, 621), (956, 621), width=3, offset=(0, -9))   # 右からの引き出し線(シャシー)
clone_segment(im, (797, 629), (956, 629), width=3, offset=(0, 9))    # 同(燃料タンク)
clone_segment(im, (92, 691), (400, 691), width=3, offset=(0, -9))    # ナンバープレートの引き出し線(y 691)
erase_row(im, dotted_row(im, 540, 556, 730, 940), 720, 956, width=3, offset=-9)   # テールランプの引き出し線
save(im, 'img/rear.jpg')

# ---- 上面(894x1746、前が上) ----
im = crop('top', rotate=-90)
im = keep_only(im, [(58, 0), (836, 0), (836, 518), (892, 518), (892, 612), (842, 612), (842, 1746), (52, 1746), (52, 612), (6, 612), (6, 518), (58, 518)])
im = remove_grid(im)
print('  top center cols:', erase_thin_cols(im, 426, 446, 0, 1745, 100, 1500, n=3, thr=243))   # 中心線(ごく薄い点線)
clone_segment(im, (217, 0), (217, 330), width=2, offset=(8, 0))      # トレッドの寸法線(左)
clone_segment(im, (665, 0), (665, 330), width=2, offset=(-8, 0))     # 同(右)
clone_segment(im, (134, 0), (134, 200), width=2, offset=(8, 0))      # 寸法線(左)
clone_segment(im, (800, 0), (800, 600), width=2, offset=(-8, 0))     # 寸法線(右)
for y0, y1, py0, py1 in ((0, 880, 150, 450), (860, 1745, 1000, 1300)):   # 車体脇の点線(上半分・下半分)
    print('  top edge cols:', erase_thin_cols(im, 44, 68, y0, y1, py0, py1, n=3), erase_thin_cols(im, 812, 846, y0, y1, py0, py1, n=4), erase_thin_cols(im, 812, 846, y0, y1, py0, py1, n=2, thr=242))
save(im, 'img/top.jpg')

# ---- 座標を調べるとき ----
# from PIL import ImageDraw; 50px 格子と座標ラベルを重ねた画像を書き出して読むと、線の位置が読める。例:
#   im = Image.open('img/rear.jpg'); d = ImageDraw.Draw(im)
#   for x in range(0, im.width, 50): d.line([(x,0),(x,im.height)], fill=(0,180,0))
#   for y in range(0, im.height, 50): d.line([(0,y),(im.width,y)], fill=(0,180,0))
# 濃い直線は erase_leader(im, p0, p1)(位置は自動で合う)、点線の縦線は erase_thin_cols、
# 薄い中間色の線は erase_thin_in_poly、孤立した点は erase_specks_in_poly を使う。
