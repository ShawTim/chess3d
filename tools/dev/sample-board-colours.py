#!/usr/bin/env python3
"""
Sample the rendered board's square colours from a saved screenshot.

Two visual reviews disagreed about this image — one read a1 as dark and h1 as
light (the correct standard), the other read them inverted. Both were describing
the same file, so at least one was wrong. Rather than take a third opinion, this
measures the actual pixels: a dark square and a light square differ by roughly
120 levels per channel, which no amount of misreading can hide.

It samples a row of points across the near rank and prints the alternation, so
the pattern can be read off directly.
"""
import sys
from PIL import Image

path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/hero-render.png"
im = Image.open(path).convert("RGB")
W, H = im.size
print(f"{path}  {W}x{H}")


def mean_rgb(x0, y0, x1, y1):
    """Mean colour of a rectangle, which is more stable than a single pixel."""
    box = im.crop((x0, y0, x1, y1))
    px = list(box.getdata())
    n = len(px)
    return tuple(sum(c[i] for c in px) // n for i in range(3))


def luma(rgb):
    r, g, b = rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def classify(rgb):
    return "dark" if luma(rgb) < 130 else "light"


# The reviews gave these locations for the two near corners.
print("\n--- reviewer-claimed corner locations ---")
for label, box in [("a1", (420, 500, 470, 560)), ("h1", (670, 570, 730, 630))]:
    rgb = mean_rgb(*box)
    print(f"  {label}  rgb={rgb}  luma={luma(rgb):6.1f}  -> {classify(rgb)}")

# A horizontal scan across the lower-middle of the image, which crosses the near
# rank. Alternating dark/light proves the checkerboard is present and readable.
print("\n--- horizontal scan (looking for alternation) ---")
for y in (500, 530, 560, 590):
    row = []
    for x in range(360, 940, 24):
        rgb = mean_rgb(x, y, x + 20, y + 20)
        row.append("D" if classify(rgb) == "dark" else "L")
    print(f"  y={y}: {''.join(row)}")

print("\nA correct board read from White's near-left corner alternates,")
print("and a1 (first square of the near rank) must be D.")
