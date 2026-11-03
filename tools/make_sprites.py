# -*- coding: utf-8 -*-
"""Phase C3: 四张角色抠图 -> assets/*.png
流程: 预裁剪 -> rembg(isnet-anime) -> 保留最大连通域 -> 1px 羽化 -> 裁边 -> 缩放 -> 保存
同时在临时目录输出棋盘格 QA 图供目检。
"""
import os

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

from rembg import new_session, remove

RAW = r"D:\workdir\SynologyDrive\prog_main\python\game_cake\raw"
ASSETS = r"D:\workdir\SynologyDrive\prog_main\python\game_cake\yumeiro_game\assets"
TEMP = os.environ.get("TEMP", r"C:\Temp")
QA = os.path.join(TEMP, "game_cake_qa")
os.makedirs(ASSETS, exist_ok=True)
os.makedirs(QA, exist_ok=True)

SESSION = new_session("isnet-anime")


def largest_component_only(alpha):
    """只保留最大连通前景域，去掉散落的杂点（彩纸屑等）。"""
    m = alpha > 40
    lab, n = ndimage.label(m)
    if n <= 1:
        return alpha
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    keep = 1 + int(np.argmax(sizes))
    out = alpha.copy()
    out[lab != keep] = 0
    return out


def cutout(img, box=None, keep_largest=True, feather=1.0):
    if box:
        img = img.crop(box)
    out = remove(img, session=SESSION)
    a = np.array(out)
    alpha = a[..., 3]
    if keep_largest:
        alpha = largest_component_only(alpha)
    a[..., 3] = alpha
    res = Image.fromarray(a)
    if feather:
        res.putalpha(res.getchannel("A").filter(ImageFilter.GaussianBlur(feather)))
    # 裁掉透明边，留 6px padding
    bbox = res.getbbox()
    if bbox:
        l, t, r, b = bbox
        l = max(0, l - 6); t = max(0, t - 6)
        r = min(res.width, r + 6); b = min(res.height, b + 6)
        res = res.crop((l, t, r, b))
    return res


def resize_long(im, target):
    w, h = im.size
    s = target / max(w, h)
    if s < 1:
        im = im.resize((round(w * s), round(h * s)), Image.LANCZOS)
    return im


def checker_qa(im, name):
    """棋盘格底 QA 合成。"""
    cell = 24
    w, h = im.size
    bg = Image.new("RGB", (w, h))
    for y in range(0, h, cell):
        for x in range(0, w, cell):
            c = 200 if (x // cell + y // cell) % 2 == 0 else 255
            for yy in range(y, min(y + cell, h)):
                pass
    # 用 numpy 更快
    yy, xx = np.mgrid[0:h, 0:w]
    mask = ((xx // cell + yy // cell) % 2 == 0)
    arr = np.where(mask[..., None], 200, 255).astype(np.uint8)
    bg = Image.fromarray(np.broadcast_to(arr, (h, w, 3)).copy())
    bg.paste(im, (0, 0), im)
    bg.save(os.path.join(QA, f"qa_{name}.png"))


JOBS = [
    # (输出名, 源文件, 预裁剪框, 保留最大域, 长边)
    ("ichigo", "candid_ichigo_7182708.jpg", None, True, 640),
    ("fairy_vanilla", "精灵 五月莓 1a94b36e986b2ce280cb4a4c-bkimg-process,v_1,rw_313,rh_252,maxl_627.webp", (285, 35, 450, 380), True, 480),
    ("fairy_chocolat", "candid_chocolat_431412.jpg", (360, 30, 841, 595), True, 480),
    ("fairy_caramel", "candid_caramel_431417.jpg", (0, 235, 1152, 1491), True, 480),
]

for name, src, box, keep, long_side in JOBS:
    path = os.path.join(RAW, src)
    img = Image.open(path).convert("RGBA")
    if getattr(img, "is_animated", False):
        img.seek(0)
    out = cutout(img, box=box, keep_largest=keep)
    out = resize_long(out, long_side)
    out.save(os.path.join(ASSETS, f"{name}.png"))
    checker_qa(out, name)
    print(f"OK {name}.png {out.size[0]}x{out.size[1]}")
