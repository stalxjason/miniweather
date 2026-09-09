#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Compare the 128px and 81px icon sets at native size and at the
tab-bar display size, to show whether the size choice matters visually."""
import os

from PIL import Image, ImageDraw, ImageFont

import gen_icons as G

HERE = os.path.dirname(os.path.abspath(__file__))
NAMES = G.NAMES


def build(path):
    W, H = 680, 576
    cv = Image.new('RGB', (W, H), (0xFF, 0xFF, 0xFF))
    d = ImageDraw.Draw(cv)
    f_t = ImageFont.truetype(G.FONT, 19)
    f_s = ImageFont.truetype(G.FONT, 14)
    f_n = ImageFont.truetype(G.FONT, 13)

    d.text((40, 22), '128×128 与 81×81 · 实际显示效果对比',
           font=f_t, fill=(0x26, 0x26, 0x26))

    sets = [(128, '.', 62, '原生分辨率 · 128×128（现有图标的规格）'),
            (81, os.path.join(HERE, '81px'), 246,
             '原生分辨率 · 81×81（微信官方建议）')]
    for size, folder, y, title in sets:
        d.text((40, y), title, font=f_s, fill=(0x59, 0x59, 0x59))
        for i in range(4):
            im = Image.open(os.path.join(HERE, folder, NAMES[i])).convert('RGBA')
            G.icon_cell(cv, 40 + i * 160, y + 28, im, size)

    d.line([0, 385, W, 385], fill=(0xE3, 0xE6, 0xEC), width=1)
    d.text((40, 402),
           '缩放到 tabBar 实际显示尺寸（约 40×40）：两种规格肉眼无差别',
           font=f_s, fill=(0x59, 0x59, 0x59))

    for gi, (label, folder) in enumerate([('源图 128px', '.'),
                                          ('源图 81px', os.path.join(HERE, '81px'))]):
        y = 436 + gi * 62
        d.text((40, y + 10), label, font=f_n, fill=(0x8C, 0x8C, 0x8C))
        for i in range(4):
            im = Image.open(os.path.join(HERE, folder, NAMES[i])).convert('RGBA')
            im = im.resize((40, 40), Image.LANCZOS)
            cv.paste(im, (110 + i * 58, y), im)

    cv.save(path, optimize=True)
    return os.path.getsize(path)


if __name__ == '__main__':
    p = os.path.join(HERE, 'size-compare.png')
    print('size-compare.png  %6.1f KB' % (build(p) / 1024.0))
