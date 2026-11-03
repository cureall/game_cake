# -*- coding: utf-8 -*-
"""Phase C2: 产出 bg_title.jpg 与 bg_kitchen.jpg（750x1334，JPG 品质 92）。"""
import os

from PIL import Image, ImageFilter

RAW = r"D:\workdir\SynologyDrive\prog_main\python\game_cake\raw"
ASSETS = r"D:\workdir\SynologyDrive\prog_main\python\game_cake\yumeiro_game\assets"
TW, TH = 750, 1334  # 游戏虚拟画布尺寸
os.makedirs(ASSETS, exist_ok=True)


def fit_crop_9_16(im, x_bias=0.0):
    """全高裁出 9:16 竖版窗口，x_bias: -1(靠左) ~ +1(靠右)。"""
    w, h = im.size
    cw = round(h * TW / TH)
    if cw >= w:
        # 太窄裁不动：整宽居中裁高（不太可能走到）
        ch = round(w * TH / TW)
        y = (h - ch) // 2
        return im.crop((0, y, w, y + ch))
    x = round((w - cw) / 2 + (w - cw) / 2 * x_bias)
    x = max(0, min(w - cw, x))
    return im.crop((x, 0, x + cw, h))


# --- bg_title: DVD 封面全家福，轻微左偏保留左上角香草 ---
src = Image.open(os.path.join(RAW, "游戏封面c2cec3fdfc039245760ff7698d94a4c27d1e2519.jfif"))
title = fit_crop_9_16(src.convert("RGB"), x_bias=-0.35)
title = title.resize((TW, TH), Image.LANCZOS)
title.save(os.path.join(ASSETS, "bg_title.jpg"), quality=92)
print("bg_title.jpg", title.size)

# --- bg_kitchen: min-chi 岛台厨房，取灶台+吊柜窗口后放大 ---
src = Image.open(os.path.join(RAW, "candid_kitchen_minchi.png")).convert("RGB")
w, h = src.size
cw = round(h * TW / TH)
x = 170  # 灶台+微波炉+吊柜窗口
kitchen = src.crop((x, 0, x + cw, h))
kitchen = kitchen.resize((TW, TH), Image.LANCZOS)
# 轻微柔化消除放大锯齿（背景本身要柔，不影响主体辨识）
kitchen = kitchen.filter(ImageFilter.GaussianBlur(0.6))
kitchen.save(os.path.join(ASSETS, "bg_kitchen.jpg"), quality=92)
print("bg_kitchen.jpg", kitchen.size)
