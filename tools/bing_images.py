# -*- coding: utf-8 -*-
"""Phase B: Bing 图片搜索抓取原图直链。用法: python bing_images.py "关键词" [数量]"""
import json
import re
import sys
import urllib.parse
import urllib.request

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.8",
}

query = sys.argv[1]
count = int(sys.argv[2]) if len(sys.argv) > 2 else 12
url = "https://www.bing.com/images/search?q=" + urllib.parse.quote(query) + "&form=HDRSC2&first=1"
req = urllib.request.Request(url, headers=UA)
html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore")

# Bing 把元数据放在 m 属性里（JSON）
items = re.findall(r'm="(\{[^"]+?\})"', html)
seen = set()
n = 0
for it in items:
    try:
        d = json.loads(it.replace("&quot;", '"').replace("\\u0026", "&"))
    except Exception:
        continue
    murl = d.get("murl", "")
    if not murl or murl in seen:
        continue
    seen.add(murl)
    print(f'{d.get("turl", "")} | {murl} | {d.get("md5","")}')
    n += 1
    if n >= count:
        break
print(f"-- got {n} results for: {query}")
