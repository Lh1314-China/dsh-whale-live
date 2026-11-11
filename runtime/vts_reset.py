# -*- coding: utf-8 -*-
"""掐断之后，把皮套的嘴合上。

say.py 被 kill 时走不到 finally，MouthOpen 会停在最后一帧。
这个小脚本连一次 VTS，把嘴归零；VTS 没开就安静退出。
"""
import argparse
import os
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--vts-dir", required=True)
    args = parser.parse_args()
    if not os.path.isdir(args.vts_dir):
        return
    if args.vts_dir not in sys.path:
        sys.path.insert(0, args.vts_dir)
    try:
        from vts_client import VTS

        vts = VTS(timeout=3.0)
        if vts.auth():
            vts.inject({"MouthOpen": 0.0, "MouthSmile": 0.0})
    except Exception:
        pass


if __name__ == "__main__":
    main()
