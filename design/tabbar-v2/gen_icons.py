#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate tabbar icons (天气 / 潮汐) for the mini-program.

Shapes are authored in a 64x64 design space, drawn at 6x supersampling with
Pillow, auto-fit and centred, then downscaled with LANCZOS to the final
128x128 PNG (same spec as the existing miniprogram/images/icon-*.png).

Outputs into this folder only -- nothing in miniprogram/ is touched.

Usage:  python gen_icons.py
Requires: Pillow  (python -m pip install Pillow)
"""
import math
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
APP_IMGS = os.path.join(HERE, '..', '..', 'miniprogram', 'images')

SIZE = int(os.environ.get('ICON_SIZE', '128'))   # 128 = same as existing
                                            # 81  = WeChat's recommended size
DS = 64             # design space edge length
SS = 6              # supersample factor
TARGET = SIZE * 108 // 128   # fitted glyph extent, ~84% of SIZE
OUT_DIR = os.path.join(HERE, os.environ.get('ICON_OUT', '.'))

GRAY = (0x8E, 0x8E, 0x93, 255)   # app.json -> tabBar.color
BLUE = (0x16, 0x77, 0xFF, 255)   # app.json -> tabBar.selectedColor
INKS = [GRAY, BLUE, GRAY, BLUE]
NAMES = ['icon-weather.png', 'icon-weather-active.png',
         'icon-tide.png', 'icon-tide-active.png']

FONT = r'C:\Windows\Fonts\msyh.ttc'
WAVE_PERIODS = 1.5   # sine periods in the tide wave


# ------------------------------------------------------------------ drawing

def disc(d, cx, cy, r):
    x, y, rr = cx * SS, cy * SS, r * SS
    d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=255)


def capsule(d, p0, p1, w):
    """Design-space line segment with rounded ends."""
    a = (p0[0] * SS, p0[1] * SS)
    b = (p1[0] * SS, p1[1] * SS)
    r = w * SS / 2.0
    d.line([a, b], fill=255, width=max(1, int(round(w * SS))))
    d.ellipse([a[0] - r, a[1] - r, a[0] + r, a[1] + r], fill=255)
    d.ellipse([b[0] - r, b[1] - r, b[0] + r, b[1] + r], fill=255)


def draw_weather(d):
    """Sun with rays, its lower-right rays tucked behind the cloud."""
    cx, cy, r = 24.0, 25.0, 7.2
    disc(d, cx, cy, r)
    r1, r2, w = 10.8, 14.2, 3.4
    for i in range(8):
        a = math.radians(i * 45)
        ca, sa = math.cos(a), math.sin(a)
        capsule(d, (cx + r1 * ca, cy + r1 * sa),
                (cx + r2 * ca, cy + r2 * sa), w)
    # cloud: flat base with rounded ends, three bumps of differing height
    x0, y0, x1, y1 = 22.0, 47.0, 60.0, 56.0
    d.rounded_rectangle([x0 * SS, y0 * SS, x1 * SS, y1 * SS],
                        radius=4.5 * SS, fill=255)
    disc(d, 30.0, 45.5, 9.0)
    disc(d, 42.0, 40.0, 12.0)
    disc(d, 52.0, 46.0, 8.0)


def draw_tide(d):
    """Tide wave (tapered) with a droplet above the crest."""
    # droplet: apex + two tangent lines + bulb (tangent join -> no kink)
    cx, cy, r, ay = 23.0, 16.5, 5.6, 5.0
    dd = cy - ay
    sb = r / dd
    cb = math.sqrt(max(0.0, 1.0 - sb * sb))
    tri = [(cx, ay), (cx - r * sb, cy - r * cb), (cx + r * sb, cy - r * cb)]
    d.polygon([(p[0] * SS, p[1] * SS) for p in tri], fill=255)
    disc(d, cx, cy, r)

    # wave: tapered band around a sine, tapered to points at both ends
    x0, x1, yc, amp, n = 6.0, 57.0, 44.5, 9.0, 200
    line = [(x0 + (x1 - x0) * t / n,
             yc - amp * math.sin(WAVE_PERIODS * math.pi * t / n))
            for t in range(n + 1)]
    wmax = 11.2
    left, right = [], []
    for i, (x, y) in enumerate(line):
        t = i / n
        w = wmax * math.sin(math.pi * t) ** 0.75
        p0 = line[max(0, i - 1)]
        p1 = line[min(n, i + 1)]
        tx, ty = p1[0] - p0[0], p1[1] - p0[1]
        L = math.hypot(tx, ty) or 1.0
        nx, ny = -ty / L, tx / L
        hx, hy = nx * w * 0.5, ny * w * 0.5
        left.append(((x + hx) * SS, (y + hy) * SS))
        right.append(((x - hx) * SS, (y - hy) * SS))
    d.polygon(left + right[::-1], fill=255)


DRAWERS = [draw_weather, draw_weather, draw_tide, draw_tide]


def render(drawer):
    """Rasterise a drawer into a SIZE x SIZE alpha mask (mode 'L')."""
    m = Image.new('L', (DS * SS, DS * SS), 0)
    drawer(ImageDraw.Draw(m))
    crop = m.crop(m.getbbox())
    sc = TARGET / max(crop.size)
    nw = int(round(crop.width * sc))
    nh = int(round(crop.height * sc))
    crop = crop.resize((nw, nh), Image.LANCZOS)
    out = Image.new('L', (SIZE, SIZE), 0)
    out.paste(crop, ((SIZE - nw) // 2, (SIZE - nh) // 2))
    return out


def tint(mask, color):
    """Coloured RGBA image from an alpha mask."""
    im = Image.new('RGBA', mask.size, (0, 0, 0, 0))
    im.paste(Image.new('RGBA', mask.size, color), (0, 0), mask)
    return im


# ------------------------------------------------------------------- preview

def checker(size, tile=16):
    im = Image.new('RGB', (size, size), (0xFF, 0xFF, 0xFF))
    d = ImageDraw.Draw(im)
    for y in range(0, size, tile):
        for x in range(0, size, tile):
            if (x // tile + y // tile) % 2 == 0:
                d.rectangle([x, y, x + tile - 1, y + tile - 1],
                            fill=(0xF2, 0xF4, 0xF7))
    return im


def icon_cell(cv, x, y, im, size, border=(0xD8, 0xDC, 0xE4)):
    """Paste one icon onto a checkerboard cell, scaled to `size`."""
    pad = 12
    if im.width != size:
        im = im.resize((size, size), Image.LANCZOS)
    cv.paste(checker(size + pad * 2), (x - pad, y - pad))
    ImageDraw.Draw(cv).rectangle([x - pad, y - pad,
                                  x + size - 1 + pad, y + size - 1 + pad],
                                 outline=border, width=1)
    cv.paste(im, (x, y), im)


def build_preview(masks, path):
    W, H = 780, 640
    cv = Image.new('RGB', (W, H), (0xFF, 0xFF, 0xFF))
    d = ImageDraw.Draw(cv)
    f_title = ImageFont.truetype(FONT, 20)
    f_small = ImageFont.truetype(FONT, 15)
    f_tab = ImageFont.truetype(FONT, 16)
    labels = ['天气 · 未选中', '天气 · 选中', '潮汐 · 未选中', '潮汐 · 选中']

    d.text((40, 26), 'tabBar 图标 · 新版方案', font=f_title, fill=(0x26, 0x26, 0x26))
    d.text((40, 54), '128x128 PNG · 形状一致，仅颜色区分选中态',
           font=f_small, fill=(0x8C, 0x8C, 0x8C))

    y = 96
    for i in range(4):
        x = 44 + i * 186
        icon_cell(cv, x, y, tint(masks[i], INKS[i]), SIZE)
        tw = d.textlength(labels[i], font=f_small)
        d.text((x + SIZE / 2 - tw / 2, y + SIZE + 18), labels[i],
               font=f_small, fill=(0x59, 0x59, 0x59))
    d.line([0, 312, W, 312], fill=(0xE3, 0xE6, 0xEC), width=1)

    # two tab-bar mocks at display scale
    iw = 56
    for s, sel in enumerate((0, 1)):
        x, y = 90, 344 + s * 140
        w, h = 600, 128
        d.rectangle([x, y, x + w, y + h], outline=(0xD8, 0xDC, 0xE4), width=1)
        caption = '选中「天气」' if sel == 0 else '选中「潮汐」'
        d.text((x, y - 26), caption, font=f_small, fill=(0x8C, 0x8C, 0x8C))
        for t in range(2):
            ink = BLUE[:3] if t == sel else GRAY[:3]
            idx = t * 2 + (1 if t == sel else 0)
            im = tint(masks[idx], INKS[idx]).resize((iw, iw), Image.LANCZOS)
            cx = x + w // 4 + t * w // 2
            cv.paste(im, (cx - iw // 2, y + 22), im)
            txt = '天气' if t == 0 else '潮汐'
            tw = d.textlength(txt, font=f_tab)
            d.text((cx - tw / 2, y + 92), txt, font=f_tab, fill=ink)
    cv.save(path, optimize=True)
    return os.path.getsize(path)


def build_compare(masks, path):
    """Row 0: existing icons from miniprogram/images. Row 1: new ones."""
    W, H = 780, 480
    cv = Image.new('RGB', (W, H), (0xFF, 0xFF, 0xFF))
    d = ImageDraw.Draw(cv)
    f_title = ImageFont.truetype(FONT, 20)
    f_row = ImageFont.truetype(FONT, 16)
    f_small = ImageFont.truetype(FONT, 14)

    d.text((40, 24), 'tabBar 图标 · 新旧对比', font=f_title,
           fill=(0x26, 0x26, 0x26))

    rows = [
        ('现有图标',
         tuple(os.path.join(APP_IMGS, NAMES[i]) for i in range(4)),
         (0xC4, 0xCA, 0xD3)),
        ('新版图标', [tint(masks[i], INKS[i]) for i in range(4)],
         (0x16, 0x77, 0xFF)),
    ]
    for r, (title, items, frame) in enumerate(rows):
        y = 84 + r * 190
        d.text((40, y - 4), title, font=f_row, fill=(0x59, 0x59, 0x59))
        for i in range(4):
            x = 44 + i * 186
            im = Image.open(items[i]) if isinstance(items[i], str) else items[i]
            icon_cell(cv, x, y + 24, im.convert('RGBA'), SIZE, border=frame)
    cv.save(path, optimize=True)
    return os.path.getsize(path)


def build_zoom(masks, path):
    """Large 2x2 view for shape / antialiasing inspection."""
    cell, pad = 300, 44
    W = H = cell * 2 + pad * 3
    cv = Image.new('RGB', (W, H), (0xFF, 0xFF, 0xFF))
    for i in range(4):
        x = pad + (i % 2) * (cell + pad)
        y = pad + (i // 2) * (cell + pad)
        im = tint(masks[i], INKS[i]).resize((cell, cell), Image.LANCZOS)
        cv.paste(im, (x, y), im)
    cv.save(path, optimize=True)
    return os.path.getsize(path)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    masks = [render(fn) for fn in DRAWERS]
    for n, m, c in zip(NAMES, masks, INKS):
        p = os.path.join(OUT_DIR, n)
        tint(m, c).save(p, optimize=True)
        print('%-26s %6.1f KB' % (n, os.path.getsize(p) / 1024.0))
    for label, fn in [('preview.png', build_preview),
                      ('compare.png', build_compare),
                      ('zoom.png', build_zoom)]:
        p = os.path.join(OUT_DIR, label)
        print('%-26s %6.1f KB' % (label, fn(masks, p) / 1024.0))


if __name__ == '__main__':
    main()
