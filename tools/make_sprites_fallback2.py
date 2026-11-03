# -*- coding: utf-8 -*-
"""Phase C3 兜底 v2: 修 巧克力(裁阴影)/牛奶糖(滤小组件)/香草(白围栏反向泛洪)。"""
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

WHITE = np.array([255.0, 255.0, 255.0])


def keep_major(mask, frac=0.04):
    """保留面积 >= 最大组件面积*frac 的所有组件。"""
    lab, n = ndimage.label(mask)
    if n <= 1:
        return mask
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    thr = sizes.max() * frac
    keep_ids = np.flatnonzero(sizes >= thr) + 1
    return np.isin(lab, keep_ids)


def flood_key_cutout(img, tol=60.0, feather=1.0, frac=0.0):
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
    alpha = np.where(fg, 255, 0).astype(np.uint8)
    out = img.convert("RGBA")
    out.putalpha(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(feather)))
    return _trim(out)


def _largest(mask):
    lab, n = ndimage.label(mask)
    if n <= 1:
        return mask
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    return lab == (1 + int(np.argmax(sizes)))


def white_fence_cutout(img, dist_thr=60.0, feather=1.0):
    """白围栏法: 背景为彩色花纹，白色光晕围住角色。泛洪只走'远离白色'的彩色像素，
    被白晕挡住 => 非泛洪区 = 白晕+角色整体。"""
    rgb = np.asarray(img.convert("RGB")).astype(np.float64)
    h, w, _ = rgb.shape
    dist_white = np.sqrt(((rgb - WHITE.reshape(1, 1, 3)) ** 2).sum(-1))
    bg_like = dist_white > dist_thr  # 只有彩色区可被泛洪
    seed = np.zeros((h, w), bool)
    seed[0, :] = seed[-1, :] = True
    seed[:, 0] = seed[:, -1] = True
    seed &= bg_like
    flooded = ndimage.binary_propagation(seed, mask=bg_like)
    fg = ~flooded
    fg = _largest(fg)
    alpha = np.where(fg, 255, 0).astype(np.uint8)
    out = img.convert("RGBA")
    out.putalpha(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(feather)))
    return _trim(out)


def _trim(out, pad=6):
    bbox = out.getbbox()
    if bbox:
        l, t, r, b = bbox
        out = out.crop((max(0, l - pad), max(0, t - pad),
                        min(out.width, r + pad), min(out.height, b + pad)))
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
    bg.save(os.path.join(QA, f"qa_fb2_{name}.png"))


# 巧克力: 裁掉底部地面阴影带(y<=566)，纯白底 tol=40 只留最大域
img = Image.open(os.path.join(RAW, "candid_chocolat_431412.jpg")).convert("RGBA")
out = flood_key_cutout(img.crop((395, 30, 841, 566)), tol=40.0)
out = resize_long(out, 480)
out.save(os.path.join(ASSETS, "fairy_chocolat.png"))
checker_qa(out, "fairy_chocolat")
print("chocolat", out.size)

# 牛奶糖: 白底 tol=40；保留 >=4% 组件滤掉彩点与花边
img = Image.open(os.path.join(RAW, "candid_caramel_431417.jpg")).convert("RGBA")
out = flood_key_cutout(img.crop((0, 235, 1152, 1491)), tol=40.0, frac=0.04)
out = resize_long(out, 480)
out.save(os.path.join(ASSETS, "fairy_caramel.png"))
checker_qa(out, "fairy_caramel")
print("caramel", out.size)

# 香草: 白围栏反向泛洪
img = Image.open(os.path.join(RAW, "精灵 五月莓 1a94b36e986b2ce280cb4a4c-bkimg-process,v_1,rw_313,rh_252,maxl_627.webp")).convert("RGBA")
if getattr(img, "is_animated", False):
    img.seek(0)
out = white_fence_cutout(img.crop((285, 35, 450, 380)), dist_thr=60.0)
out = resize_long(out, 480)
out.save(os.path.join(ASSETS, "fairy_vanilla.png"))
checker_qa(out, "fairy_vanilla")
print("vanilla", out.size)
