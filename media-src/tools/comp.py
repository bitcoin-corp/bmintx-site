#!/usr/bin/env python3
# bMintX hero mashup compositor. usage: comp.py edl.json W H out.mp4
import sys, json, subprocess, math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

edl = json.load(open(sys.argv[1])); W = int(sys.argv[2]); H = int(sys.argv[3]); OUT = sys.argv[4]
FPS = 30; BEAT = edl['beat']; GOLD = (255, 210, 77)
V = W < H  # vertical
U = min(W, H) / 1080.0
BEBAS = '/Users/b0ase/Library/Fonts/BebasNeue-Regular.ttf'
MONO = '/System/Library/Fonts/Menlo.ttc'
def F(p, s): return ImageFont.truetype(p, int(s))
random.seed(7); rng = np.random.default_rng(7)

# ---------- static assets ----------
def make_seal(S):
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im); c = S / 2
    for k in range(48):  # scalloped rim
        a = k / 48 * 2 * math.pi; r = S * 0.47
        x, y = c + r * math.cos(a), c + r * math.sin(a); rr = S * 0.035
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(201, 143, 0, 255))
    for i, r in enumerate(np.linspace(S * 0.46, 0, 40)):
        t = i / 40; col = tuple(int(a + (b - a) * t) for a, b in zip((201, 143, 0), (255, 236, 160)))
        d.ellipse([c - r, c - r, c + r, c + r], fill=col + (255,))
    d.ellipse([c - S * .36, c - S * .36, c + S * .36, c + S * .36], outline=(120, 80, 0, 255), width=max(2, S // 70))
    f = F(BEBAS, S * 0.12); txt = 'MINTED · ON BITCOIN · MINTED · ON BITCOIN · '
    for i, ch in enumerate(txt):
        a = i / len(txt) * 2 * math.pi - math.pi / 2; r = S * 0.405
        g = Image.new('RGBA', (int(S * .14), int(S * .14)), (0, 0, 0, 0))
        ImageDraw.Draw(g).text((S * .07, S * .07), ch, font=f, fill=(90, 55, 0, 255), anchor='mm')
        g = g.rotate(-math.degrees(a) - 90, resample=Image.BICUBIC)
        im.alpha_composite(g, (int(c + r * math.cos(a) - g.width / 2), int(c + r * math.sin(a) - g.height / 2)))
    logo = Image.open(edl['logo_png']).convert('RGBA')
    lw = int(S * 0.42); logo = logo.resize((lw, int(lw * logo.height / logo.width)))
    # darken logo to engrave
    arr = np.array(logo); arr[..., :3] = (arr[..., :3] * 0.35).astype(np.uint8); logo = Image.fromarray(arr)
    im.alpha_composite(logo, (int(c - logo.width / 2), int(c - logo.height / 2)))
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0)); sh.putalpha(im.split()[3].filter(ImageFilter.GaussianBlur(S / 30)))
    out = Image.new('RGBA', (S, S)); out.alpha_composite(Image.eval(sh, lambda v: v // 2)); out.alpha_composite(im)
    return out
SEAL = make_seal(int(300 * U))
LOGO = Image.open(edl['logo_png']).convert('RGBA')

def hud_static():
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im); m = int(36 * U); L = int(40 * U)
    a = (255, 255, 255, 150)
    for (x, y, sx, sy) in [(m, m, 1, 1), (W - m, m, -1, 1), (m, H - m, 1, -1), (W - m, H - m, -1, -1)]:
        d.line([(x, y), (x + sx * L, y)], fill=a, width=2); d.line([(x, y), (x, y + sy * L)], fill=a, width=2)
    f = F(MONO, 15 * U)
    d.text((m + 14 * U, m + 12 * U), 'bMINTX // PROOF OF MAKING', font=f, fill=(255, 210, 77, 230))
    d.text((W - m - 14 * U, m + 12 * U), 'LIVE · BSV', font=f, fill=(255, 255, 255, 170), anchor='ra')
    tick = 'REAL WORK · VEXVOID · NINJA PUNK GIRLS · NPGX · bMOVIES ORIGINALS · ' * 4
    d.text((m + 14 * U, H - m - 30 * U), tick[:int(W / (9.2 * U))], font=F(MONO, 12 * U), fill=(255, 255, 255, 110))
    return im
HUD = hud_static()

def vignette():
    y, x = np.ogrid[:H, :W]; r = np.sqrt(((x - W / 2) / (W / 2)) ** 2 + ((y - H / 2) / (H / 2)) ** 2)
    return np.clip(1.08 - 0.42 * r ** 2, 0.45, 1.0).astype(np.float32)[..., None]
VIG = vignette()

def leak_img(seed):
    r = np.random.default_rng(seed); img = np.zeros((H // 4, W // 4, 3), np.float32)
    y, x = np.ogrid[:H // 4, :W // 4]
    for _ in range(3):
        cx, cy = r.uniform(-.2, 1.2) * W / 4, r.uniform(-.2, 1.2) * H / 4; rad = r.uniform(.3, .7) * max(W, H) / 4
        col = np.array(random.choice([(255, 150, 40), (255, 210, 77), (255, 90, 30), (255, 230, 170)]), np.float32)
        img += col * np.exp(-(((x - cx) ** 2 + (y - cy) ** 2) / rad ** 2))[..., None]
    return np.array(Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).resize((W, H), Image.BILINEAR), np.float32)
LEAKS = [leak_img(s) for s in range(4)]

# ---------- helpers ----------
def alpha_over(base, ov, x=0, y=0):
    """base float32 HxWx3, ov RGBA PIL at (x,y)."""
    a = np.asarray(ov, np.float32); h, w = a.shape[:2]
    x0, y0 = max(0, x), max(0, y); x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0: return
    s = a[y0 - y:y1 - y, x0 - x:x1 - x]; al = s[..., 3:4] / 255.0
    base[y0:y1, x0:x1] = base[y0:y1, x0:x1] * (1 - al) + s[..., :3] * al

def hblur(img, r):
    if r < 1: return img
    r = int(r); c = np.cumsum(np.pad(img, ((0, 0), (r + 1, r), (0, 0)), mode='edge'), axis=1)
    return (c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / (2 * r + 1)

def ease_out(t): t = min(max(t, 0), 1); return 1 - (1 - t) ** 3

def text_img(txt, size, col=(255, 255, 255), font=BEBAS, stroke=0):
    f = F(font, size); b = f.getbbox(txt, stroke_width=stroke)
    im = Image.new('RGBA', (b[2] + 8, b[3] + 8), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((4 - b[0] + b[0], 4), txt, font=f, fill=col + (255,), stroke_width=stroke, stroke_fill=(0, 0, 0, 255))
    return im

def chip_img(txt):
    f = F(MONO, 18 * U); b = f.getbbox(txt); pw, ph = int(18 * U), int(11 * U); dot = int(10 * U)
    w, h = b[2] + pw * 2 + dot + int(10 * U), int(24 * U) + ph * 2
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=h // 2, fill=(10, 8, 2, 215), outline=(255, 210, 77, 255), width=2)
    d.ellipse([pw, h / 2 - dot / 2, pw + dot, h / 2 + dot / 2], fill=(255, 210, 77, 255))
    d.text((pw + dot + int(10 * U), h / 2), txt, font=f, fill=(255, 240, 200, 255), anchor='lm')
    return im

# ---------- decode ----------
def decode(seg, n):
    lay = seg.get('layout', 'cover')
    if V and lay == 'tri': lay = 'cover'
    dur = n / FPS + 0.2; sp = seg.get('speed', 1.0)
    if lay == 'tri':
        srcs = seg['srcs']; tw = W // 3; args = []; fc = []
        for k, s in enumerate(srcs):
            args += ['-ss', str(s[1]), '-t', str(dur * sp), '-i', s[0]]
            fc.append(f'[{k}:v]setpts=PTS/{sp},fps={FPS},scale={tw}:{H}:force_original_aspect_ratio=increase,crop={tw}:{H},setsar=1[v{k}]')
        fc.append(f'[v0][v1][v2]hstack=3,pad={W}:{H}:0:0[o]')
        cmd = ['ffmpeg', '-v', 'error', *args, '-filter_complex', ';'.join(fc), '-map', '[o]']
    else:
        src, ss = seg['srcs'][0]
        cmd = ['ffmpeg', '-v', 'error', '-ss', str(ss), '-t', str(dur * sp), '-i', src, '-vf',
               f'setpts=PTS/{sp},fps={FPS},scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1']
    cmd += ['-frames:v', str(n), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
    raw = subprocess.run(cmd, capture_output=True).stdout
    fr = np.frombuffer(raw, np.uint8); k = len(fr) // (W * H * 3)
    fr = fr[:k * W * H * 3].reshape(k, H, W, 3)
    if k == 0: fr = np.zeros((1, H, W, 3), np.uint8)
    # loop / hold if short
    idx = [min(i, len(fr) - 1) for i in range(n)]
    return fr, idx

# ---------- render ----------
enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                        '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-pix_fmt', 'yuv420p', OUT], stdin=subprocess.PIPE)
gframe = 0; seg_start_beat = 0.0
total_beats = sum(s['beats'] for s in edl['segments'])
for si, seg in enumerate(edl['segments']):
    f0 = round(seg_start_beat * BEAT * FPS); f1 = round((seg_start_beat + seg['beats']) * BEAT * FPS); n = f1 - f0
    fx = seg.get('fx', []); kind = seg.get('kind', 'clip')
    if kind == 'clip': frames, idx = decode(seg, n)
    words = seg.get('words', []); chip = chip_img(seg['chip']) if seg.get('chip') else None
    leak = LEAKS[si % 4]
    for i in range(n):
        t_local = i / FPS; tb = t_local / BEAT  # beats into segment
        if kind == 'clip':
            img = frames[idx[i]]
            z = 1 + (0.12 if 'punch' in fx else 0.04) * math.exp(-i / 3.0) + 0.03 * i / n  # punch + slow push
            if z > 1.001:
                cw, ch = int(W / z), int(H / z); x0, y0 = (W - cw) // 2, (H - ch) // 2
                img = np.asarray(Image.fromarray(img[y0:y0 + ch, x0:x0 + cw]).resize((W, H), Image.BILINEAR))
            f = img.astype(np.float32)
            # grade: contrast + warm
            f = (f - 128) * 1.12 + 124; f[..., 2] *= 0.94; f[..., 0] *= 1.03
        else:
            f = np.zeros((H, W, 3), np.float32) + 6
        if 'dim' in fx:
            sm=Image.fromarray(np.clip(f,0,255).astype(np.uint8)).resize((W//8,H//8),Image.BILINEAR).resize((W,H),Image.BILINEAR)
            f=np.asarray(sm,np.float32)*0.32
        # whip in
        if 'whip' in fx and i < 5:
            off = int(W * 0.35 * (1 - i / 5) ** 2) * (1 if si % 2 else -1)
            f = hblur(np.roll(f, off, axis=1), 60 * (1 - i / 5) * U)
        # rgb split + glitch
        g = 0
        if 'rgb' in fx and i < 5: g = 26 * (1 - i / 5) * U
        if 'glitch' in fx and (i % 7 == 3): g = 18 * U
        if g:
            s = int(g); f[..., 0] = np.roll(f[..., 0], s, axis=1); f[..., 2] = np.roll(f[..., 2], -s, axis=1)
            if 'glitch' in fx or i < 3:
                for _ in range(5):
                    y = random.randrange(0, H - 40); hh = random.randrange(8, int(60 * U) + 9)
                    f[y:y + hh] = np.roll(f[y:y + hh], random.randrange(-int(80 * U), int(80 * U)), axis=1)
        # light leak
        if 'leak' in fx:
            amp = (0.25 if kind=='black' else 0.55) * math.sin(math.pi * min(1, i / max(1, n))) + (0.4 if i < 3 else 0)
            f += np.roll(leak, int(i * 9 * U), axis=1) * amp
        # flash
        if i == 0 and 'flash' in fx: f = f * 0.3 + np.array([255, 235, 180], np.float32) * 0.7
        elif i == 1 and 'flash' in fx: f = f * 0.7 + 255 * 0.3
        # beat bump (every beat, subtle exposure pulse)
        bp = (tb % 1.0); f *= 1 + 0.08 * math.exp(-bp * 6)
        f *= VIG
        # ---- overlays ----
        if seg.get('hud', True): alpha_over(f, HUD)
        # frame counter
        cnt = text_img(f'{(gframe / FPS):05.2f}s · {si + 1:02d}/{len(edl["segments"]):02d}', 15 * U, (255, 255, 255), MONO)
        alpha_over(f, cnt, W - int(50 * U) - cnt.width, H - int(66 * U))
        # kinetic words: one per beat
        if words:
            size = seg.get('size', 170) * U * (0.62 if V else 1)
            y = int((seg.get('wy', 0.16)) * H)
            for k, wd in enumerate(words):
                tw = tb - k * seg.get('wstep', 1)
                if tw < 0: break
                gold = wd.startswith('*'); wd = wd.lstrip('*')
                im = text_img(wd, size, GOLD if gold else (255, 255, 255))
                s = 1 + 0.25 * (1 - ease_out(tw * 3))
                if s > 1.01: im = im.resize((int(im.width * s), int(im.height * s)), Image.BICUBIC)
                x = int(64 * U) if seg.get('walign', 'l') == 'l' else (W - im.width) // 2
                alpha_over(f, im, x, y); y += int(size * 0.92)
        # chip
        if chip is not None:
            tc = tb - seg.get('chip_at', 0.5)
            if tc >= 0:
                p = ease_out(tc * 2.2); x = int(-chip.width + (chip.width + 64 * U) * p)
                cy = H - int((150 if not V else 260) * U)
                alpha_over(f, chip, x, cy)
        # seal stamp
        if seg.get('seal'):
            ts = tb - seg.get('seal_at', 0.25)
            if ts >= 0:
                p = min(1, ts * 4); sc = (2.2 - 1.2 * ease_out(p)) * seg.get('seal_scale', 0.75); rot = -24 * (1 - ease_out(p))
                im = SEAL.rotate(rot, resample=Image.BICUBIC, expand=True)
                im = im.resize((max(2, int(im.width * sc)), max(2, int(im.height * sc))), Image.BICUBIC)
                if p < 1: im.putalpha(im.split()[3].point(lambda v: int(v * min(1, p * 2.5))))
                sx, sy = seg.get('seal_pos', (0.86, 0.72 if not V else 0.78))
                alpha_over(f, im, int(sx * W - im.width / 2), int(sy * H - im.height / 2))
                if 0.2 < p < 0.6:  # stamp impact flash
                    f = f * 1.0 + 40
        # finale logo
        if seg.get('logo'):
            tl = tb - seg['logo']
            if tl >= 0:
                p = ease_out(tl * 1.5); lh = int((260 if not V else 300) * U)
                lg = LOGO.resize((int(lh * LOGO.width / LOGO.height), lh), Image.LANCZOS)
                wm = text_img('bMintX', 104 * U * (0.9 if V else 1), (255, 255, 255), '/System/Library/Fonts/Supplemental/Arial Bold.ttf')
                url = text_img('bmintx.com  ·  mint in bWalletX', 30 * U, GOLD, MONO)
                if V:
                    cx = W // 2; y0 = int(H * 0.56)
                    alpha_over(f, lg, cx - lg.width // 2, y0 + int(40 * U * (1 - p)))
                    alpha_over(f, wm, cx - wm.width // 2, y0 + lh + int(20 * U))
                    alpha_over(f, url, cx - url.width // 2, y0 + lh + wm.height + int(40 * U))
                else:
                    tot = lg.width + int(34 * U) + max(wm.width, url.width); x0 = W - int(110 * U) - tot; y0 = int(H * 0.58)
                    alpha_over(f, lg, x0, y0 + int(40 * U * (1 - p)))
                    alpha_over(f, wm, x0 + lg.width + int(30 * U), y0 + lh // 2 - wm.height // 2 - int(20 * U))
                    alpha_over(f, url, x0 + lg.width + int(34 * U), y0 + lh // 2 + wm.height // 2 - int(10 * U))
        # fade out at very end
        if seg.get('fadeout') and i > n - 12: f *= (n - i) / 12
        enc.stdin.write(np.clip(f, 0, 255).astype(np.uint8).tobytes()); gframe += 1
    seg_start_beat += seg['beats']
    print(f'seg {si + 1}/{len(edl["segments"])} done', file=sys.stderr, flush=True)
enc.stdin.close(); enc.wait()
print('frames', gframe, 'secs', gframe / FPS)
