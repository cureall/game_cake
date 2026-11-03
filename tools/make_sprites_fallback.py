# -*- coding: utf-8 -*-
"""Phase C3 兜底: 免模型的色键+边界泛洪抠图。
原理: 选取四角颜色为背景种子，判定"类背景色"像素集，从图像边界泛洪(形态学重建)，
只淹没与边界连通的背景区域，不进角色轮廓内部; 再保留最大连通域+羽化+裁边。
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


def largest_component_only(mask):
    lab, n = ndimage.label(mask)
    if n <= 1:
        return mask
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    return lab == (1 + int(np.argmax(sizes)))


def flood_key_cutout(img, tol=60.0, feather=1.0):
    """img: RGBA PIL.Image。返回抠好的 RGBA。"""
    rgb = np.asarray(img.convert("RGB")).astype(np.int16)
    h, w, _ = rgb.shape
    # 背景参考色: 四角各 12px 块的均值
    corners = np.concatenate([
        rgb[:12, :12].reshape(-1, 3), rgb[:12, -12:].reshape(-1, 3),
        rgb[-12:, :12].reshape(-1, 3), rgb[-12:, -12:].reshape(-1, 3),
    ])
    # 类背景: 与任一角颜色接近（覆盖渐变多色底）
    d = [np.sqrt(((rgb - c.reshape(1, 1, 3)) ** 2).sum(-1)) for c in corners]
    bg_like = np.min(d, axis=0) < tol
    # 边界泛洪: 从边界种子在 bg_like 内扩散
    seed = np.zeros((h, w), bool)
    seed[0, :] = seed[-1, :] = True
    seed[:, 0] = seed[:, -1] = True
    seed &= bg_like
    flooded = ndimage.binary_propagation(seed, mask=bg_like)
    fg = ~flooded
    fg = largest_component_only(fg)
    alpha = np.where(fg, 255, 0).astype(np.uint8)
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
    bg.save(os.path.join(QA, f"qa_fb_{name}.png"))


JOBS = [
    ("ichigo", "candid_ichigo_7182708.jpg", None, 60.0, 640),
    ("fairy_vanilla", "精灵 五月莓 1a94b36e986b2ce280cb4a4c-bkimg-process,v_1,rw_313,rh_252,maxl_627.webp", (285, 35, 450, 380), 70.0, 480),
    ("fairy_chocolat", "candid_chocolat_431412.jpg", (395, 30, 841, 595), 40.0, 480),
    ("fairy_caramel", "candid_caramel_431417.jpg", (0, 235, 1152, 1491), 40.0, 480),
]

for name, src, box, tol, long_side in JOBS:
    img = Image.open(os.path.join(RAW, src)).convert("RGBA")
    if getattr(img, "is_animated", False):
        img.seek(0)
    if box:
        img = img.crop(box)
    out = flood_key_cutout(img, tol=tol)
    out = resize_long(out, long_side)
    out.save(os.path.join(ASSETS, f"{name}.png"))
    checker_qa(out, name)
    print(f"OK {name}.png {out.size[0]}x{out.size[1]} (fallback)")
