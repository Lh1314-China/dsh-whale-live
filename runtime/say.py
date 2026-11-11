# -*- coding: utf-8 -*-
"""把一句话念出来：edge-tts 合成 mp3，再用 Windows 自带 MCI 播放。

皮套（VTube Studio）开着的话，播的同时按音量包络推 MouthOpen，让模型真的动嘴；
连不上就只出声，不耽误说话。

单独一个进程，是为了让插件能“掐断这一句”：
杀掉这个进程，它手里的 MCI 设备跟着关掉，声音就停了。

用法（由插件调用）：
  python say.py --text "..." --voice zh-CN-XiaoyiNeural --rate +8% --pitch +4Hz \
      --out-dir <dir> --stop-file <file> [--vts-dir <vtube-bridge>] [--max-sec 60]
输出最后一行是 JSON：{"ok": true, "path": "...", "ms": 1234, "avatar": true}
"""
import argparse
import asyncio
import ctypes
import json
import os
import sys
import time
from ctypes import wintypes

RETRY = 3
FPS = 30.0


def emit(payload, code=0):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    sys.exit(code)


def synth(text, voice, rate, pitch, out_dir):
    import edge_tts

    os.makedirs(out_dir, exist_ok=True)
    name = "say-%s-%s.mp3" % (time.strftime("%Y%m%d-%H%M%S"), os.getpid())
    path = os.path.join(out_dir, name)
    tmp = path + ".part"

    async def run():
        comm = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
        await comm.save(tmp)

    asyncio.run(run())
    if not os.path.isfile(tmp) or os.path.getsize(tmp) <= 0:
        raise RuntimeError("合成结果为空")
    os.replace(tmp, path)
    return path


_winmm = ctypes.WinDLL("winmm")
_winmm.mciSendStringW.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.UINT, wintypes.HANDLE]
_winmm.mciSendStringW.restype = wintypes.UINT

_alias_seq = 0


def mci(cmd, size=256):
    buf = ctypes.create_unicode_buffer(size)
    code = _winmm.mciSendStringW(cmd, buf, size, None)
    return code, buf.value


def mci_error(code):
    buf = ctypes.create_unicode_buffer(256)
    _winmm.mciGetErrorStringW(code, buf, 256)
    return buf.value


class Mouth:
    """VTS 的嘴：连不上就当没有。"""

    def __init__(self, vts_dir):
        self.vts = None
        self.frames = []
        self.error = ""
        try:
            if vts_dir and os.path.isdir(vts_dir) and vts_dir not in sys.path:
                sys.path.insert(0, vts_dir)
            import vts_speak
            from vts_client import VTS

            self._envelope = vts_speak.envelope
            self.vts = VTS()
            if not self.vts.auth():
                raise RuntimeError("VTS 授权失败（在 VTS 里点允许）")
        except Exception as exc:  # noqa: BLE001
            self.error = str(exc)[:200]
            self.vts = None

    def load(self, path):
        if self.vts is None:
            return False
        try:
            self.frames = self._envelope(path, FPS)
            return bool(self.frames)
        except Exception as exc:  # noqa: BLE001
            self.error = str(exc)[:200]
            self.vts = None
            return False

    def tick(self, elapsed):
        if self.vts is None or not self.frames:
            return
        idx = int(elapsed * FPS)
        if idx >= len(self.frames):
            return
        try:
            self.vts.inject({"MouthOpen": self.frames[idx]})
        except Exception as exc:  # noqa: BLE001
            self.error = str(exc)[:200]
            self.vts = None

    def reset(self):
        if self.vts is None:
            return
        try:
            self.vts.inject({"MouthOpen": 0.0, "MouthSmile": 0.0})
        except Exception:
            pass


def play(path, stop_file, max_sec, mouth=None):
    global _alias_seq
    _alias_seq += 1
    alias = "dshwl%d" % _alias_seq
    code, _ = mci('open "%s" type mpegvideo alias %s' % (path, alias))
    if code != 0:
        code, _ = mci('open "%s" alias %s' % (path, alias))
    if code != 0:
        raise RuntimeError("打不开音频：%s" % mci_error(code))

    started = time.time()
    stopped = False
    step = 0.03 if (mouth is not None and mouth.frames) else 0.08
    try:
        code, _ = mci("play %s" % alias)
        if code != 0:
            raise RuntimeError("播放失败：%s" % mci_error(code))
        while True:
            if stop_file and os.path.exists(stop_file):
                stopped = True
                break
            if max_sec and time.time() - started > max_sec:
                stopped = True
                break
            if mouth is not None:
                mouth.tick(time.time() - started)
            code, mode = mci("status %s mode" % alias)
            if code != 0 or mode.strip() != "playing":
                break
            time.sleep(step)
    finally:
        mci("stop %s" % alias)
        mci("close %s" % alias)
        if mouth is not None:
            mouth.reset()
    return not stopped


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", required=True)
    parser.add_argument("--voice", default="zh-CN-XiaoyiNeural")
    parser.add_argument("--rate", default="+0%")
    parser.add_argument("--pitch", default="+0Hz")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--stop-file", default="")
    parser.add_argument("--vts-dir", default="")
    parser.add_argument("--max-sec", type=float, default=60.0)
    args = parser.parse_args()

    text = (args.text or "").strip()
    if not text:
        emit({"ok": False, "error": "没有要念的字"}, 2)

    started = time.time()
    path = ""
    last = ""
    for attempt in range(RETRY):
        try:
            path = synth(text, args.voice, args.rate, args.pitch, args.out_dir)
            last = ""
            break
        except ImportError as exc:
            emit({"ok": False, "error": "没有 edge-tts：%s" % exc, "code": "NO_EDGE_TTS"}, 2)
        except Exception as exc:  # noqa: BLE001
            last = str(exc)[:200]
            time.sleep(1.2 * (attempt + 1))

    if not path:
        emit({"ok": False, "error": last or "合成失败", "code": "SYNTH_FAILED"}, 2)

    mouth = None
    if args.vts_dir:
        # miniaudio 在 Windows 上打不开含中文的路径（error -7），
        # 解码前先复制到英文临时文件，播放也用这份。
        import shutil
        import tempfile

        ascii_path = os.path.join(tempfile.gettempdir(), "dsh-whale-say-%d.mp3" % os.getpid())
        try:
            shutil.copyfile(path, ascii_path)
            probe_path = ascii_path
        except Exception:
            probe_path = path
        mouth = Mouth(args.vts_dir)
        if mouth.vts is not None:
            if not mouth.load(probe_path):
                print("[vts] 包络算不出来，只出声：%s" % mouth.error, file=sys.stderr)
                mouth = None
            else:
                path = probe_path
        else:
            print("[vts] 皮套没连上，只出声：%s" % mouth.error, file=sys.stderr)
            mouth = None

    try:
        finished = play(path, args.stop_file, args.max_sec, mouth)
    except Exception as exc:  # noqa: BLE001
        emit({"ok": False, "error": str(exc)[:200], "code": "PLAY_FAILED", "path": path}, 3)

    emit({
        "ok": True,
        "path": path,
        "ms": int((time.time() - started) * 1000),
        "interrupted": not finished,
        "avatar": mouth is not None,
    })


if __name__ == "__main__":
    main()
