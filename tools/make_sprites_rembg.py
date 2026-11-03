# -*- coding: utf-8 -*-
"""Phase C3 升级: 模型到位后用 rembg(isnet-anime) 重抠 草莓(7182708) 与 香草(百科合成图)。
产出 qa_rembg_ichigo.png / qa_rembg_vanilla.png 至 QA 目录，不直接覆盖定稿，目检后再定。"""
import os

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

from rembg import new_session, remove

RAW = r"D:\workdir\SynologyDrive\prog_main\python\game_cake\raw"
TEMP = os.environ.get("TEMP", r"C:\Temp")
QA = os.path.join(TEMP, "game_cake_qa")
os.makedirs(QA, exist_ok=True)

SESSION = new_session("isnet-anime")


def largest_component_only(alpha):
    m = alpha > 40
    lab, n = ndimage.label(m)
    if n <= 1:
        return alpha
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    out = alpha.copy()
    out[lab != (1 + int(np.argmax(sizes)))] = 0
    return out


def cutout(img, feather=1.0):
    out = remove(img, session=SESSION)
    a = np.array(out)
    a[..., 3] = largest_component_only(a[..., 3])
    res = Image.fromarray(a)
    if feather:
        res.putalpha(res.getchannel("A").filter(ImageFilter.GaussianBlur(feather)))
    bbox = res.getbbox()
    if bbox:
        l, t, r, b = bbox
        res = res.crop((max(0, l - 6), max(0, t - 6),
                        min(res.width, r + 6), min(res.height, b + 6)))
    return res


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
    bg.save(os.path.join(QA, f"qa_rembg_{name}.png"))


# 草莓: 白帽西点装+端蛋糕
img = Image.open(os.path.join(RAW, "candid_ichigo_7182708.jpg")).convert("RGBA")
out = resize_long(cutout(img), 640)
out.save(os.path.join(QA, "cand_ichigo_rembg.png"))
checker_qa(out, "ichigo")
print("ichigo", out.size)

# 香草: 百科合成图右侧全身站姿
img = Image.open(os.path.join(RAW, "精灵 五月莓 1a94b36e986b2ce280cb4a4c-bkimg-process,v_1,rw_313,rh_252,maxl_627.webp")).convert("RGBA")
if getattr(img, "is_animated", False):
    img.seek(0)
out = resize_long(cutout(img.crop((285, 35, 450, 380))), 480)
out.save(os.path.join(QA, "cand_vanilla_rembg.png"))
checker_qa(out, "vanilla")
print("vanilla", out.size)
