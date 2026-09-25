"""生成应用图标：深底 + 金色「一圈」笔意（enso），并输出多尺寸 .ico。"""

from PIL import Image, ImageDraw
import math
import os

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build")
os.makedirs(OUT_DIR, exist_ok=True)

S = 1024
BG = (24, 27, 33, 255)
GOLD = (217, 164, 65, 255)
GOLD_HI = (240, 197, 108, 255)


def rounded_square(size, radius, fill):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=fill)
    return img


def enso(size):
    """画一个带缺口的粗圆环，缺口在右上，模仿一笔圈。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = size * 0.185
    box = (pad, pad, size - pad, size - pad)
    width = int(size * 0.108)
    d.arc(box, start=36, end=318, fill=GOLD, width=width)
    # 收笔处点一个小圆，像顿笔留下的墨点
    cx = cy = size / 2
    r = (size - 2 * pad) / 2
    a = math.radians(318)
    tip = (cx + math.cos(a) * r, cy + math.sin(a) * r)
    t = width * 0.5
    d.ellipse((tip[0] - t, tip[1] - t, tip[0] + t, tip[1] + t), fill=GOLD_HI)
    return img


def main():
    base = rounded_square(S, int(S * 0.22), BG)
    base.alpha_composite(enso(S))
    png = os.path.join(OUT_DIR, "icon.png")
    base.save(png)
    sizes = [256, 128, 64, 48, 32, 24, 16]
    frames = [base.resize((s, s), Image.LANCZOS) for s in sizes]
    ico = os.path.join(OUT_DIR, "icon.ico")
    frames[0].save(ico, format="ICO", sizes=[(s, s) for s in sizes])
    print("wrote", png, ico)


if __name__ == "__main__":
    main()
