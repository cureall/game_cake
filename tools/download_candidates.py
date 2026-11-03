# -*- coding: utf-8 -*-
"""Phase B: 下载 safebooru 候选图到 raw/，文件名带 candid_ 前缀与 safebooru post id。"""
import os
import urllib.request

RAW = r"D:\workdir\SynologyDrive\prog_main\python\game_cake\raw"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Referer": "https://safebooru.org/"}

# (post_id, 描述, url, 扩展名)
CANDIDATES = [
    ("chocolat", 533833, "https://safebooru.org/images/531/d1b9a7f8fe23aaebf05f1b15fe6acf77c9f11359.jpg", "jpg"),
    ("chocolat", 431412, "https://safebooru.org/images/431/8aabdbb6d0670ba8d92335126ee3f0eb8143dc7c.jpg", "jpg"),
    ("caramel", 431417, "https://safebooru.org/images/431/82e9f77bc34fc704ea1741ec07d9de583d161621.jpg", "jpg"),
    ("caramel", 7183438, "https://safebooru.org/images/3921/0c22eb8adcef3ab1f073cafdb8f721738d71b4f9.jpg", "jpg"),
    ("caramel", 489599, "https://safebooru.org/images/488/72a0fd37d6ae14b103b00030bb8642d83ba764fb.jpg", "jpg"),
    ("vanilla", 7182847, "https://safebooru.org/images/1105/d830552181744ecf70942faa7834578118751099.png", "png"),
    ("ichigo", 7182708, "https://safebooru.org/images/1105/d61ebc9b0f0a1d7d87005250e7e147da6815c970.jpg", "jpg"),
    ("ichigo", 7182793, "https://safebooru.org/images/1105/10f7fc6c7396f8bebffef7df2cb899c625b4711f.jpg", "jpg"),
    ("ichigo", 4952302, "https://safebooru.org/images/4619/de080b917156ed0ba49bfa0e134454af5751b6b6.jpg", "jpg"),
    ("ichigo", 7182695, "https://safebooru.org/images/1105/017c500e15e6cdcfa4c140bdcad2d875f85a5d68.jpg", "jpg"),
]

for name, pid, url, ext in CANDIDATES:
    dst = os.path.join(RAW, f"candid_{name}_{pid}.{ext}")
    if os.path.exists(dst):
        print(f"SKIP {dst}")
        continue
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r, open(dst, "wb") as f:
            f.write(r.read())
        print(f"OK   {os.path.basename(dst)}  {os.path.getsize(dst)//1024}KB")
    except Exception as e:
        print(f"FAIL {name} {pid}: {e}")
