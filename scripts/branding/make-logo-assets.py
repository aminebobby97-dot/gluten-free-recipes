"""Build the clean (text-free) leaf logo and favicon files from the original PNG.
Usage: python3 -I make_logo.py <source.png> <out_dir>
"""
import io, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
rgb = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
h, w, _ = rgb.shape
GREEN = np.array([133, 199, 36], np.float32)

# 1. Background = light pixels connected to the image border.
light = Image.fromarray(((rgb[..., 2] > 150) * 255).astype(np.uint8))
light = light.copy()  # detach from the numpy buffer so the fill is visible
ImageDraw.floodfill(light, (0, 0), 128)
outside = np.asarray(light) == 128
# 2. Band of anti-aliased edge pixels next to the background.
band = np.asarray(Image.fromarray((outside * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(7))) > 0
# 3. Alpha from how far the blue channel dropped from white toward leaf green.
alpha = np.ones((h, w), np.float32)
# Off-white noise in the background (blue >= 235) becomes fully transparent.
a = np.clip((235 - rgb[..., 2]) / (235 - GREEN[2]), 0, 1)
alpha[band] = a[band]
color = rgb.copy()
# Un-blend the white from edge pixels so no light halo shows on any background.
safe = np.maximum(alpha, 1e-3)[..., None]
unblend = np.clip((rgb - (1 - alpha[..., None]) * 255) / safe, 0, 255)
color[band] = unblend[band]
color[band & (alpha < 0.15)] = GREEN
# The leaf is a flat green, so paint the whole interior that green: this removes
# the white lettering and leaves a clean, text-free leaf.
color[~band] = GREEN
rgba = np.dstack([color, alpha * 255]).round().astype(np.uint8)
img = Image.fromarray(rgba, "RGBA")
img = img.crop(img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox())
print("trimmed leaf", img.size)

def save_png(im, path, colors=None):
    if colors:  # palette PNG: much smaller, the flat two-color logo loses nothing visible
        im = im.quantize(colors=colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    im.save(path, optimize=True)
    print(path, im.size, os.path.getsize(path), "bytes")

def square(size, pad_ratio, bg=None):
    side = round(max(img.size) * (1 + 2 * pad_ratio))
    canvas = Image.new("RGBA", (side, side), bg or (0, 0, 0, 0))
    canvas.alpha_composite(img, ((side - img.width) // 2, (side - img.height) // 2))
    return canvas.resize((size, size), Image.Resampling.LANCZOS)

# Header/footer logo: 3x of the largest display height (56px) is enough for sharp retina display.
logo_h = 192
logo = img.resize((round(img.width * logo_h / img.height), logo_h), Image.Resampling.LANCZOS)
save_png(logo, f"{out}/logo-leaf.png", colors=128)

# Favicons (transparent, tight padding so the leaf is as large as possible).
icons = {s: square(s, 0.02) for s in (16, 32, 48, 192, 512)}
save_png(icons[16], f"{out}/icon-16.png")
save_png(icons[32], f"{out}/icon-32.png")
save_png(icons[192], f"{out}/icon-192.png", colors=128)
save_png(icons[512], f"{out}/icon-512.png", colors=128)
icons[48].save(f"{out}/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)], bitmap_format="png")
print("favicon.ico", os.path.getsize(f"{out}/favicon.ico"), "bytes")
# Apple touch icon: opaque (iOS shows transparency as black), original white background, more padding.
save_png(square(180, 0.08, bg=(255, 255, 255, 255)).convert("RGB"), f"{out}/apple-touch-icon.png", colors=128)
