# -*- coding: utf-8 -*-
"""Phase D QA: 把 4 张精灵按游戏内示意位置贴到 bg_kitchen 上合成预览图（仅供目检，不进项目）。"""
import os

from PIL import Image

ASSETS = r"D:\workdir\SynologyDrive\prog_main\python\game_cake\yumeiro_game\assets"
TEMP = os.environ.get("TEMP", r"C:\Temp")
QA = os.path.join(TEMP, "game_cake_qa")
os.makedirs(QA, exist_ok=True)

bg = Image.open(os.path.join(ASSETS, "bg_kitchen.jpg")).convert("RGBA")
ichigo = Image.open(os.path.join(ASSETS, "ichigo.png"))
sprites = {
    "vanilla": Image.open(os.path.join(ASSETS, "fairy_vanilla.png")),
    "chocolat": Image.open(os.path.join(ASSETS, "fairy_chocolat.png")),
    "caramel": Image.open(os.path.join(ASSETS, "fairy_caramel.png")),
}


def paste_scaled(base, im, height, xy, anchor="lt"):
    s = height / im.height
    im2 = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    x, y = xy
    if anchor[0] == "c":
        x -= im2.width // 2
    if anchor[1] == "b":
        y -= im2.height
    base.alpha_composite(im2, (int(x), int(y)))
    return im2.size


canvas = bg.copy()
# 游戏内示意：右下角草莓(高400)、左上香草(150)、蓄力条旁巧克力(130,左中)、右下缓速牛奶糖(120)
paste_scaled(canvas, ichigo, 400, (750 - 30, 1334), anchor="rb")
paste_scaled(canvas, sprites["vanilla"], 150, (40, 60), anchor="lt")
paste_scaled(canvas, sprites["chocolat"], 130, (60, 640), anchor="lt")
paste_scaled(canvas, sprites["caramel"], 120, (640, 830), anchor="lt")
canvas.convert("RGB").save(os.path.join(QA, "qa_ingame_layout.jpg"), quality=90)
print("qa_ingame_layout.jpg saved", canvas.size)

# 单独尺寸报告
for n, im in [("ichigo", ichigo), *sprites.items()]:
    alpha = im.getchannel("A")
    nonzero = alpha.getbbox()
    print(f"{n}: {im.size} bbox={nonzero}")
