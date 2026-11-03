# -*- coding: utf-8 -*-
"""Phase C3 兜底 v3（终）: 巧克力/香草 同图左右分裁 + 阴影饱和度擦除；牛奶糖 tol=25。"""
import os

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

RAW = r"D:\workdir\SynologyDrive\prog_main\python\game_cake\raw"
ASSETS = r"D:\workdir\SynologyDrive\prog_main\python\game_cake\yumeiro_game\assets"
TEMP = os.environ.get("TEMP", r"C:\Temp")
QA = os.path.join(TEMP, "game_cake_qa")
os.makedirs(ASSETS, exist_ok=True)
os.makedirs(QA, exist_ok=True)


def _largest(mask):
    lab, n = ndimage.label(mask)
    if n <= 1:
        return mask
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    return lab == (1 + int(np.argmax(sizes)))


def keep_major(mask, frac):
    lab, n = ndimage.label(mask)
    if n <= 1:
        return mask
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    keep_ids = np.flatnonzero(sizes >= sizes.max() * frac) + 1
    return np.isin(lab, keep_ids)


def flood_white_key(img, tol, frac=0.0):
    """白底泛洪抠图: 类背景(与四角颜色近)从边界泛洪，保留前景。"""
    rgb = np.asarray(img.convert("RGB")).astype(np.float64)
    h, w, _ = rgb.shape
    corners = np.concatenate([
        rgb[:12, :12].reshape(-1, 3), rgb[:12, -12:].reshape(-1, 3),
        rgb[-12:, :12].reshape(-1, 3), rgb[-12:, -12:].reshape(-1, 3),
    ])
    d = [np.sqrt(((rgb - c.reshape(1, 1, 3)) ** 2).sum(-1)) for c in corners]
    bg_like = np.min(d, axis=0) < tol
    seed = np.zeros((h, w), bool)
    seed[0, :] = seed[-1, :] = True
    seed[:, 0] = seed[:, -1] = True
    seed &= bg_like
    flooded = ndimage.binary_propagation(seed, mask=bg_like)
    fg = ~flooded
    fg = keep_major(fg, frac) if frac else _largest(fg)
    return fg


def erase_gray_band(img, y_from, sat_thr=28, val_min=110):
    """擦除 y>=y_from 区域中的低饱和灰色像素（地面阴影带）。"""
    a = np.asarray(img.convert("RGBA")).astype(np.int16)
    band = a[y_from:]
    rgb = band[..., :3]
    sat = rgb.max(-1) - rgb.min(-1)
    val = rgb.mean(-1)
    gray = (sat < sat_thr) & (val > val_min)
    band[..., 3] = np.where(gray, 0, band[..., 3])
    a[y_from:] = band
    return Image.fromarray(a.astype(np.uint8))


def finish(fg_mask, img, feather=1.0):
    alpha = np.where(fg_mask, 255, 0).astype(np.uint8)
    out = img.convert("RGBA")
    out.putalpha(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(feather)))
    bbox = out.getbbox()
    if bbox:
        l, t, r, b = bbox
        out = out.crop((max(0, l - 6), max(0, t - 6),
                        min(out.width, r + 6), min(out.height, b + 6)))
    return out


def resize_long(im, target):
    w, h = im.size
    s = target / max(w, h)
    if s < 1:
        im = im.resize((round(w * s), round(h * s)), Image.LANCZOS)
    return im


def checker_qa(im, name):
    cell = 24
    w, h = im.size
    yy, xx = np.mgrid[0:h, 0:w]
    mask = ((xx // cell + yy // cell) % 2 == 0)
    arr = np.where(mask[..., None], 200, 255).astype(np.uint8)
    bg = Image.fromarray(np.broadcast_to(arr, (h, w, 3)).copy())
    bg.paste(im, (0, 0), im)
    bg.save(os.path.join(QA, f"qa_v3_{name}.png"))


SRC = Image.open(os.path.join(RAW, "candid_chocolat_431412.jpg"))

# 巧克力: 右半 x>=398, 白键 tol40, 擦阴影(local y>=515 即全局>=545)
part = SRC.crop((398, 30, 841, 595))
fg = flood_white_key(part, tol=40.0)
out = finish(fg, part)
out = erase_gray_band(out, 515)
out = resize_long(out, 480)
out.save(os.path.join(ASSETS, "fairy_chocolat.png"))
checker_qa(out, "fairy_chocolat")
print("chocolat", out.size)

# 香草: 左半 x<=398, 同参数
part = SRC.crop((0, 30, 398, 595))
fg = flood_white_key(part, tol=40.0)
out = finish(fg, part)
out = erase_gray_band(out, 515)
out = resize_long(out, 480)
out.save(os.path.join(ASSETS, "fairy_vanilla.png"))
checker_qa(out, "fairy_vanilla")
print("vanilla", out.size)

# 牛奶糖: tol=25 严格白键 + 4% 组件过滤
part = Image.open(os.path.join(RAW, "candid_caramel_431417.jpg")).crop((0, 235, 1152, 1491))
fg = flood_white_key(part, tol=25.0, frac=0.04)
out = finish(fg, part)
out = resize_long(out, 480)
out.save(os.path.join(ASSETS, "fairy_caramel.png"))
checker_qa(out, "fairy_caramel")
print("caramel", out.size)
