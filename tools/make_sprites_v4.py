# -*- coding: utf-8 -*-
"""Phase C3 v4 (保守重抠): fairy_caramel / fairy_vanilla。
原则: 泛洪只定外轮廓; 内部一律回填保护 —— 从存活前景向"非严格白"区域传播，
      再取最大域 + binary_fill_holes 填洞。宁多留 1~2px 白边，不伤内部。
"""
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


def corner_colors(rgb):
    return np.concatenate([
        rgb[:12, :12].reshape(-1, 3), rgb[:12, -12:].reshape(-1, 3),
        rgb[-12:, :12].reshape(-1, 3), rgb[-12:, -12:].reshape(-1, 3),
    ])


def dist_map(rgb, ref):
    return np.sqrt(((rgb - ref.reshape(1, 1, 3)) ** 2).sum(-1))


def conservative_mask(img, tol_normal, tol_strict, frac=0.0):
    """返回保守前景 bool mask。"""
    rgb = np.asarray(img.convert("RGB")).astype(np.float64)
    h, w, _ = rgb.shape
    d = np.min([dist_map(rgb, c) for c in corner_colors(rgb)], axis=0)

    bg_like = d < tol_normal                      # 泛洪区: 一般白底
    seed = np.zeros((h, w), bool)
    seed[0, :] = seed[-1, :] = True
    seed[:, 0] = seed[:, -1] = True
    seed &= bg_like
    flooded = ndimage.binary_propagation(seed, mask=bg_like)
    fg = ~flooded                                  # 外轮廓正确, 但内部可能被误食

    # 保守回填: 以存活前景为种子, 在"非严格白"区域传播(奶白/浅色内部全部长回)
    strict_bg = d < tol_strict                     # 只有接近纯白的才算背景
    fg = ndimage.binary_propagation(fg, mask=~strict_bg)
    fg = ndimage.binary_fill_holes(fg)             # 封闭的洞一律填上

    lab, n = ndimage.label(fg)
    if n > 1:
        sizes = ndimage.sum(fg, lab, range(1, n + 1))
        if frac:   # 保留 >=frac 的大组件(滤彩点/花边)
            keep = np.flatnonzero(sizes >= sizes.max() * frac) + 1
            fg = np.isin(lab, keep)
        else:      # 只留最大域
            fg = lab == (1 + int(np.argmax(sizes)))
    return fg


def to_sprite(img, fg, feather=1.0):
    alpha = np.where(fg, 255, 0).astype(np.uint8)
    out = img.convert("RGBA")
    out.putalpha(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(feather)))
    bbox = out.getbbox()
    if bbox:
        l, t, r, b = bbox
        out = out.crop((max(0, l - 6), max(0, t - 6),
                        min(out.width, r + 6), min(out.height, b + 6)))
    return out


def erase_stub_mask(fg, box):
    """在 mask 上定点擦除(裁断的勺子残段)。box=(y0,y1,x0,x1) 裁剪局部坐标。"""
    fg = fg.copy()
    y0, y1, x0, x1 = box
    fg[y0:y1, x0:x1] = False
    return fg


def erase_midgray_band_mask(fg, img, y_from, sat_thr=26, val_lo=125, val_hi=210):
    """在 mask 上擦除 y>=y_from 的中灰阴影带(避开纯白花边与深色鞋)。"""
    rgb = np.asarray(img.convert("RGB")).astype(np.int16)
    band = rgb[y_from:]
    gray = ((band.max(-1) - band.min(-1)) < sat_thr) & \
           (band.mean(-1) > val_lo) & (band.mean(-1) < val_hi)
    fg = fg.copy()
    fg[y_from:][gray] = False
    return fg


def resize_long(im, target):
    w, h = im.size
    s = target / max(w, h)
    if s < 1:
        im = im.resize((round(w * s), round(h * s)), Image.LANCZOS)
    return im


def checker_qa(im, name):
    """深色棋盘格 QA, 透明洞无处遁形。"""
    cell = 20
    w, h = im.size
    yy, xx = np.mgrid[0:h, 0:w]
    mask = ((xx // cell + yy // cell) % 2 == 0)
    arr = np.where(mask[..., None], 170, 255).astype(np.uint8)
    bg = Image.fromarray(np.broadcast_to(arr, (h, w, 3)).copy())
    bg.paste(im, (0, 0), im)
    bg.save(os.path.join(QA, f"qa_v4b_{name}.png"))


# --- 牛奶糖: 白底彩点图, tol 25/8 + 4% 组件过滤 ---
img = Image.open(os.path.join(RAW, "candid_caramel_431417.jpg")).crop((0, 235, 1152, 1491))
fg = conservative_mask(img, tol_normal=25.0, tol_strict=8.0, frac=0.04)
out = to_sprite(img, fg)
out = resize_long(out, 480)
out.save(os.path.join(ASSETS, "fairy_caramel.png"))
checker_qa(out, "fairy_caramel")
print("caramel", out.size)

# --- 香草: 左半白底, tol 40/6, mask 上擦勺残段(裁剪局部坐标) + 中灰阴影 ---
img = Image.open(os.path.join(RAW, "candid_chocolat_431412.jpg")).crop((0, 30, 398, 595))
fg = conservative_mask(img, tol_normal=40.0, tol_strict=6.0)
fg = erase_stub_mask(fg, (250, 340, 332, 398))       # 全局 y 280-370 处被裁断的勺子残段
fg = erase_midgray_band_mask(fg, img, 515)           # 地面阴影带(全局 545+ => 裁剪局部 515+)
out = to_sprite(img, fg)
out = resize_long(out, 480)
out.save(os.path.join(ASSETS, "fairy_vanilla.png"))
checker_qa(out, "fairy_vanilla")
print("vanilla", out.size)
