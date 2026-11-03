# -*- coding: utf-8 -*-
"""Phase A: 把 raw/ 下所有图片转为 PNG 副本到临时目录，便于 Read 工具目检。"""
import os
import shutil

from PIL import Image

SRC = r"D:\workdir\SynologyDrive\prog_main\python\game_cake\raw"
DST = os.path.join(os.environ.get("TEMP", r"C:\Temp"), "game_cake_preview")

os.makedirs(DST, exist_ok=True)

report = []
for name in sorted(os.listdir(SRC)):
    path = os.path.join(SRC, name)
    if not os.path.isfile(path):
        continue
    base = os.path.splitext(name)[0]
    # 文件名含中文/特殊字符，统一清洗为安全 slug
    safe = "".join(c if c.isalnum() else "_" for c in base)[:60]
    out = os.path.join(DST, safe + ".png")
    try:
        if name.lower().endswith((".jpg", ".jpeg", ".png")):
            shutil.copy(path, out)
            size = Image.open(path).size
        else:
            im = Image.open(path)
            im.load()
            if getattr(im, "is_animated", False):
                im.seek(0)
            im.convert("RGB").save(out)
            size = im.size
        report.append(f"OK   {size[0]}x{size[1]}  {name}  ->  {os.path.basename(out)}")
    except Exception as e:
        report.append(f"FAIL {name}: {e}")

print("\n".join(report))
print("DST =", DST)
