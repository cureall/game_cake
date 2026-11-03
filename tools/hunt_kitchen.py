# -*- coding: utf-8 -*-
"""Phase B: 多组关键词搜厨房背景候选，下载到 raw/candid_kitchen_*.jpg 再统一预览。"""
import json
import os
import re
import urllib.parse
import urllib.request

RAW = r"D:\workdir\SynologyDrive\prog_main\python\game_cake\raw"
UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7",
}

QUERIES = [
    "anime kitchen interior background art",
    "アニメ背景 無料 キッチン",
    "夢色パティシエール 料理室 背景",
    "anime bakery cafe interior background illustration",
    "动漫 厨房 内景 背景 插画",
]

# 采集 (url) 去重
murls = {}
for q in QUERIES:
    bing = "https://www.bing.com/images/search?q=" + urllib.parse.quote(q) + "&form=HDRSC2&first=1"
    try:
        html = urllib.request.urlopen(urllib.request.Request(bing, headers=UA), timeout=30).read().decode("utf-8", "ignore")
    except Exception as e:
        print(f"FAIL search {q}: {e}")
        continue
    items = re.findall(r'm="(\{[^"]+?\})"', html)
    got = 0
    for it in items:
        try:
            d = json.loads(it.replace("&quot;", '"').replace("\\u0026", "&"))
        except Exception:
            continue
        murl = d.get("murl", "")
        ext = os.path.splitext(murl)[1].lower()
        if not murl or murl in murls or ext not in (".jpg", ".jpeg", ".png", ".webp"):
            continue
        murls[murl] = q
        got += 1
        if got >= 8:
            break
    print(f"search [{q}] -> {got} urls")

# 下载前 20 张
ok = 0
for i, (murl, q) in enumerate(list(murls.items())[:20]):
    ext = os.path.splitext(murl)[1].lower() or ".jpg"
    dst = os.path.join(RAW, f"candid_kitchen_{i:02d}{ext}")
    if os.path.exists(dst):
        ok += 1
        continue
    try:
        req = urllib.request.Request(murl, headers={**UA, "Referer": "https://www.bing.com/"})
        data = urllib.request.urlopen(req, timeout=25).read()
        if len(data) < 20000:  # 太小的可能是防盗链占位图
            print(f"SKIP small {len(data)//1024}KB {murl[:80]}")
            continue
        with open(dst, "wb") as f:
            f.write(data)
        print(f"OK {os.path.basename(dst)} {len(data)//1024}KB  [{q}] {murl[:90]}")
        ok += 1
    except Exception as e:
        print(f"FAIL {murl[:80]}: {e}")
print(f"downloaded {ok}")
