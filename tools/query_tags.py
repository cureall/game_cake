# -*- coding: utf-8 -*-
"""Phase B: 查询 safebooru 通用场景标签（厨房/面包店背景）。用法: python query_tags.py tag1 tag2 ..."""
import re
import sys
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "ignore")


for tag in sys.argv[1:]:
    url = f"https://safebooru.org/index.php?page=dapi&s=post&q=index&tags={tag}&limit=12"
    try:
        xml = fetch(url)
    except Exception as e:
        print(f"### {tag}: FAIL {e}")
        continue
    m = re.search(r'count="(\d+)"', xml)
    print(f"### {tag}: {m.group(1) if m else '?'} posts")
    for p in re.findall(r"<post [^>]*/>", xml):
        a = dict(re.findall(r'(\w+)="([^"]*)"', p))
        if a.get("rating") != "s":
            continue
        print(f"  id={a.get('id')} {a.get('width')}x{a.get('height')} {a.get('file_url')}")
        print(f"    {a.get('tags', '')[:140]}")
    print()
