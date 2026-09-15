#!/usr/bin/env python3
"""
Detect a vertical compositing seam, ignoring text.

A paste seam runs the full height of the card, whereas text glyph edges produce
sharp jumps only where the glyphs are. So scanning a horizontal band that contains
no text isolates the seam from the type.

The OG card has type between roughly y=55 and y=530 and is clean above and below,
so the default bands sample those margins. Pass a band explicitly as `y0 y1`.
"""

import sys
from PIL import Image

path = sys.argv[1] if len(sys.argv) > 1 else "docs/og-image.png"
im = Image.open(path).convert("RGB")
W, H = im.size
print(f"{path}  {W}x{H}")


def col_mean(x, y0, y1):
    px = [im.getpixel((x, y)) for y in range(y0, y1)]
    n = len(px)
    return tuple(sum(p[i] for p in px) // n for i in range(3))


def worst_jump(y0, y1):
    means = [col_mean(x, y0, y1) for x in range(W)]
    best = (0, 0)
    for x in range(1, W):
        a, b = means[x - 1], means[x]
        d = max(abs(a[i] - b[i]) for i in range(3))
        if d > best[0]:
            best = (d, x)
    return best


bands = []
if len(sys.argv) >= 4:
    bands.append(("custom", int(sys.argv[2]), int(sys.argv[3])))
else:
    bands.append(("top margin (no text)", 4, 48))
    bands.append(("bottom margin (no text)", H - 80, H - 8))

overall = 0
for label, y0, y1 in bands:
    d, x = worst_jump(y0, y1)
    overall = max(overall, d)
    print(f"  {label:<24} y={y0}-{y1:<4}  max jump={d:3d} at x={x}")

print(f"\nworst seam jump in text-free bands: {overall}")
print("a compositing seam reads >10; noise reads <5")
print("verdict:", "SEAM PRESENT" if overall > 10 else "no seam")
