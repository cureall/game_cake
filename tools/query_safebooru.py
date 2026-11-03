# -*- coding: utf-8 -*-
"""Phase B: 查询 safebooru 各角色标签下的图片候选清单。"""
import re
import urllib.request

TAGS = [
    "chocolat_(yumeiro)",
    "caramel_(yumeiro)",
    "vanilla_(yumeiro)",
    "amano_ichigo",
    "yumeiro_patissiere",  # 全部，用于厨房背景等
]

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


for tag in TAGS:
    url = f"https://safebooru.org/index.php?page=dapi&s=post&q=index&tags={tag}&limit=100"
    try:
        xml = fetch(url).decode("utf-8", "ignore")
    except Exception as e:
        print(f"### {tag}: FETCH FAIL {e}")
        continue
    m = re.search(r'count="(\d+)"', xml)
    total = m.group(1) if m else "?"
    print(f"### {tag}: {total} posts")
    posts = re.findall(r"<post [^>]*/>", xml)
    for p in posts:
        attr = dict(re.findall(r'(\w+)="([^"]*)"', p))
        if attr.get("rating") not in ("s", "q"):
            continue
        tags = attr.get("tags", "")
        print(
            f"  id={attr.get('id')} {attr.get('width')}x{attr.get('height')} "
            f"file={attr.get('file_url')}"
        )
        print(f"    tags: {tags}")
    print()
