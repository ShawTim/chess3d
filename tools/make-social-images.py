#!/usr/bin/env python3
"""
Generate the social share images from the captured 3D render.

Produces:
  docs/og-image.png          1200x630  Open Graph / Twitter summary_large_image
  docs/og-twitter.png        1200x600  a 2:1 mirror for platforms that crop
  docs/icon-512.png          512x512   PWA manifest icon
  docs/apple-touch-icon.png  180x180   iOS home screen
  docs/favicon-32.png        32x32     classic favicon fallback

Why the composition is built this way
-------------------------------------
Two earlier attempts had real defects that a review caught, and both came from
the same mistake: compositing two images side by side.

  1. Text over the board. The copy spanned the full width and printed across the
     pieces, so legibility depended on what happened to be behind each word.
  2. A vertical seam. The render was pasted at an x offset and the scrim reached
     partially-transparent exactly at that offset, so one column of pixels sat
     over flat background and the next sat over the image. A 12-level step, which
     `tools/dev/detect-seam.py` measures directly.

So there is no side-by-side composition here at all. The render is pasted to
cover the FULL card, and then a single smooth gradient is drawn over the whole
thing. Every pixel is scrim-over-image, so there is no junction anywhere, and the
copy sits in the darkest part of the gradient. The measured max jump is now at
text glyph edges only, which is expected of any image containing type.
"""
from PIL import Image, ImageDraw, ImageFont
import os

SRC = "/tmp/hero-render.png"
OUT_DIR = "docs"

BG   = (10, 11, 14)
GOLD = (217, 176, 106)
TEXT = (233, 230, 223)
DIM  = (172, 169, 161)

FONT_DIR = "/System/Library/Fonts/Supplemental"
FONT_BOLD = f"{FONT_DIR}/Avenir Next.ttc"
FONT_REG = f"{FONT_DIR}/Avenir Next.ttc"
FONT_SYM = "/System/Library/Fonts/Apple Symbols.ttf"


def font(path, size, index=0):
    try:
        return ImageFont.truetype(path, size, index=index)
    except Exception:
        return ImageFont.load_default()


def cover(im, w, h):
    """Scale and centre-crop to exactly w x h, preserving aspect."""
    iw, ih = im.size
    if iw / ih > w / h:
        nw = int(ih * w / h)
        left = (iw - nw) // 2
        im = im.crop((left, 0, left + nw, ih))
    else:
        nh = int(iw * h / w)
        top = (ih - nh) // 2
        im = im.crop((0, top, iw, top + nh))
    return im.resize((w, h), Image.LANCZOS)


def build_card(W, H):
    """One card: full-bleed render plus a single smooth horizontal scrim."""
    hero = Image.open(SRC).convert("RGB")

    # Bias the crop rightwards so the board sits in the right two thirds and the
    # left third is the quieter background, which is where the type goes.
    hw, hh = hero.size
    right = hero.crop((int(hw * 0.26), 0, hw, hh))
    card = cover(right, W, H)

    # The scrim: one gradient across the whole width, opaque on the left, clear by
    # ~72%. Because it is drawn over the entire card there is no paste boundary to
    # step across.
    scrim = Image.new("L", (W, H), 0)
    sd = ImageDraw.Draw(scrim)
    solid_to = int(W * 0.30)      # fully covered
    fade_to = int(W * 0.74)       # fully clear
    for x in range(W):
        if x <= solid_to:
            a = 250
        elif x < fade_to:
            t = (x - solid_to) / (fade_to - solid_to)
            a = int(250 * (1 - t) ** 1.7)
        else:
            a = 0
        sd.line([(x, 0), (x, H)], fill=a)
    card = Image.composite(Image.new("RGB", (W, H), BG), card, scrim)

    # Gentle vertical seating so the type has depth at the top and the frame does
    # not float at the bottom.
    vg = Image.new("L", (W, H), 0)
    vd = ImageDraw.Draw(vg)
    for y in range(H):
        if y < H * 0.22:
            a = int(80 * (1 - y / (H * 0.22)))
        elif y > H * 0.78:
            a = int(95 * ((y - H * 0.78) / (H * 0.22)) ** 1.5)
        else:
            a = 0
        vd.line([(0, y), (W, y)], fill=a)
    card = Image.composite(Image.new("RGB", (W, H), BG), card, vg)

    draw = ImageDraw.Draw(card)
    # Scale the type with the card so 1200x630 and 1200x600 stay consistent.
    s = H / 630
    pad = int(76 * s)

    # --- brand ----------------------------------------------------------------
    draw.text((pad, int(60 * s)), "\u265e", font=font(FONT_SYM, int(52 * s)), fill=GOLD)
    brand = font(FONT_BOLD, int(38 * s))
    bx = pad + int(64 * s)
    draw.text((bx, int(68 * s)), "CHESS", font=brand, fill=TEXT)
    draw.text((bx + draw.textlength("CHESS", font=brand), int(68 * s)), "3D",
              font=brand, fill=GOLD)

    # --- headline: split so no line can reach past the scrim ------------------
    h1 = font(FONT_BOLD, int(66 * s))
    draw.text((pad, int(190 * s)), "Cinematic", font=h1, fill=TEXT)
    draw.text((pad, int(264 * s)), "3D chess", font=h1, fill=TEXT)

    # --- subhead --------------------------------------------------------------
    sub = font(FONT_REG, int(36 * s))
    draw.text((pad, int(350 * s)), "against an offline AI", font=sub, fill=GOLD)

    # --- rule -----------------------------------------------------------------
    draw.rectangle([pad, int(410 * s), pad + int(180 * s), int(413 * s)], fill=GOLD)

    # --- feature lines, kept short -------------------------------------------
    feat = font(FONT_REG, int(24 * s))
    for i, line in enumerate([
        "No server \u00b7 no API \u00b7 no network",
        "Runs entirely in your browser",
    ]):
        draw.text((pad, int(448 * s) + i * int(36 * s)), line, font=feat, fill=DIM)

    return card


def make_og():
    os.makedirs(OUT_DIR, exist_ok=True)
    card = build_card(1200, 630)
    card.save(f"{OUT_DIR}/og-image.png", "PNG", optimize=True)
    print(f"  docs/og-image.png        1200x630")
    card.resize((1200, 600), Image.LANCZOS).save(f"{OUT_DIR}/og-twitter.png", "PNG", optimize=True)
    print(f"  docs/og-twitter.png      1200x600")


def make_icon(size, name):
    """A rounded dark tile with the knight glyph, matching the app's accent."""
    S = size * 4
    icon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(icon)

    grad = Image.new("RGB", (S, S))
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        t = y / S
        gd.line([(0, y), (S, y)],
                fill=(int(22 + 12 * t), int(23 + 10 * t), int(28 + 8 * t)))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
    icon.paste(grad, (0, 0), mask)

    d.rounded_rectangle([2, 2, S - 3, S - 3], radius=int(S * 0.22),
                        outline=GOLD + (150,), width=max(2, S // 80))

    gf = font(FONT_SYM, int(S * 0.66))
    bbox = d.textbbox((0, 0), "\u265e", font=gf)
    gw, gh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((S - gw) / 2 - bbox[0], (S - gh) / 2 - bbox[1] - S * 0.02),
           "\u265e", font=gf, fill=GOLD)

    icon.resize((size, size), Image.LANCZOS).save(f"{OUT_DIR}/{name}", "PNG", optimize=True)
    print(f"  docs/{name:<21} {size}x{size}")


def make_favicon():
    S = 128
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    gf = font(FONT_SYM, int(S * 0.86))
    bbox = d.textbbox((0, 0), "\u265e", font=gf)
    gw, gh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((S - gw) / 2 - bbox[0], (S - gh) / 2 - bbox[1]),
           "\u265e", font=gf, fill=GOLD)
    img.resize((32, 32), Image.LANCZOS).save(f"{OUT_DIR}/favicon-32.png", "PNG", optimize=True)
    print(f"  docs/favicon-32.png    32x32")


if __name__ == "__main__":
    print("generating social + icon assets")
    make_og()
    make_icon(512, "icon-512.png")
    make_icon(180, "apple-touch-icon.png")
    make_favicon()
    print("done")
