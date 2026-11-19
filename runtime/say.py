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

# ── 火山（Volcengine）语音 2.0 后端（可选，配置存在就用它；失败自动退回 edge-tts）──
# 皮套嘴型参数名：不同模型可能用别的名字，可用环境变量覆盖。
MOUTH_PARAM = os.environ.get("DSH_WHALE_LIVE_MOUTH_PARAM", "MouthOpen")
SMILE_PARAM = os.environ.get("DSH_WHALE_LIVE_SMILE_PARAM", "MouthSmile")

VOLC_DEFAULT_CONFIG = os.environ.get("DSH_WHALE_LIVE_VOLC", os.path.join(os.path.expanduser("~"), ".dsh", "whale-live", "volc.json"))
VOLC_URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"


def volc_config(path=""):
    p = path or os.environ.get("VOLC_VOICE_CONFIG") or VOLC_DEFAULT_CONFIG
    try:
        with open(p, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        if cfg.get("enabled") and cfg.get("appid") and cfg.get("access_key") and cfg.get("speaker"):
            cfg["_path"] = p
            return cfg
    except Exception:
        pass
    return None


def pad_silences(wav_in, wav_out, extra_ms=60, thr=300, min_ms=120):
    """把句子之间的静音稍微拉长一点（不碰头尾）。"""
    import array
    import wave

    w = wave.open(wav_in, "rb")
    nch, sw, fr = w.getnchannels(), w.getsampwidth(), w.getframerate()
    a = array.array("h")
    a.frombytes(w.readframes(w.getnframes()))
    w.close()
    min_len = int(fr * min_ms / 1000.0)
    extra = int(fr * extra_ms / 1000.0)
    regions, i, n = [], 0, len(a)
    while i < n:
        if abs(a[i]) <= thr:
            j = i
            while j < n and abs(a[j]) <= thr:
                j += 1
            if (j - i) >= min_len and i > 0 and j < n:
                regions.append((i, j))
            i = j
        else:
            i += 1
    out = array.array("h")
    last = 0
    for s, e in regions:
        mid = (s + e) // 2
        out.extend(a[last:mid])
        out.extend(array.array("h", [0]) * extra)
        last = mid
    out.extend(a[last:])
    ww = wave.open(wav_out, "wb")
    ww.setnchannels(nch)
    ww.setsampwidth(sw)
    ww.setframerate(fr)
    ww.writeframes(out.tobytes())
    ww.close()
    return len(regions)


def synth_volc(text, out_dir, cfg):
    import base64
    import subprocess
    import urllib.request
    import uuid

    body = {
        "req_params": {
            "text": text,
            "speaker": cfg["speaker"],
            "audio_params": {
                "format": "mp3",
                "sample_rate": 24000,
                "speech_rate": int(cfg.get("speech_rate", 0) or 0),
            },
        }
    }
    req = urllib.request.Request(
        cfg.get("url", VOLC_URL),
        data=json.dumps(body).encode("utf-8"),
        headers={
            "X-Api-App-Id": str(cfg["appid"]),
            "X-Api-Access-Key": str(cfg["access_key"]),
            "X-Api-Resource-Id": cfg.get("resource_id", "seed-tts-2.0"),
            "X-Api-Request-Id": str(uuid.uuid4()),
            "Content-Type": "application/json",
        },
        method="POST",
    )
    resp = urllib.request.urlopen(req, timeout=120)
    parts = []
    for line in resp.read().decode("utf-8", "replace").splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if obj.get("data"):
            parts.append(obj["data"])
    if not parts:
        raise RuntimeError("火山没有返回音频")

    os.makedirs(out_dir, exist_ok=True)
    name = "say-%s-%s-volc.mp3" % (time.strftime("%Y%m%d-%H%M%S"), os.getpid())
    path = os.path.join(out_dir, name)
    with open(path, "wb") as f:
        f.write(base64.b64decode("".join(parts)))

    # 后期：音高微调 → 句间停顿微调 → 轻混响 → 编码
    ff = cfg.get("ffmpeg") or "ffmpeg"
    semis = float(cfg.get("pitch_semitone") or 0)
    tempo = float(cfg.get("atempo") or 1.0)
    pause_ms = int(cfg.get("pause_extra_ms") or 0)
    reverb = cfg.get("reverb")
    cur = path
    if semis or abs(tempo - 1.0) > 1e-6:
        k = 2 ** (semis / 12.0) if semis else 1.0
        chain = []
        if semis:
            chain += ["asetrate=%d" % int(round(24000 * k)), "aresample=24000"]
        at = (1.0 / k) * tempo
        if abs(at - 1.0) > 1e-6:
            chain.append("atempo=%.6f" % at)
        nxt = path + ".t.wav"
        subprocess.run([ff, "-y", "-i", cur, "-af", ",".join(chain),
                        "-ac", "1", "-ar", "24000", "-acodec", "pcm_s16le", nxt],
                       capture_output=True)
        if os.path.exists(nxt) and os.path.getsize(nxt) > 0:
            cur = nxt
    if pause_ms:
        nxt = path + ".p.wav"
        try:
            pad_silences(cur, nxt, pause_ms)
            cur = nxt
        except Exception:
            pass
    out = path + ".fx.mp3"
    args = [ff, "-y", "-i", cur]
    if reverb:
        args += ["-af", cfg.get("reverb_af") or "aecho=0.9:0.9:18|29|41:0.10|0.06|0.04"]
    args += ["-b:a", "160k", out]
    subprocess.run(args, capture_output=True)
    if os.path.exists(out) and os.path.getsize(out) > 0:
        os.replace(out, path)
    for tmp in (path + ".t.wav", path + ".p.wav"):
        try:
            os.remove(tmp)
        except OSError:
            pass
    return path


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
            self.vts.inject({MOUTH_PARAM: self.frames[idx]})
        except Exception as exc:  # noqa: BLE001
            self.error = str(exc)[:200]
            self.vts = None

    def reset(self):
        if self.vts is None:
            return
        try:
            self.vts.inject({MOUTH_PARAM: 0.0, SMILE_PARAM: 0.0})
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
    parser.add_argument("--volc-config", default="")
    args = parser.parse_args()

    text = (args.text or "").strip()
    if not text:
        emit({"ok": False, "error": "没有要念的字"}, 2)

    started = time.time()
    path = ""
    last = ""
    vcfg = volc_config(args.volc_config)
    for attempt in range(RETRY):
        try:
            if vcfg:
                path = synth_volc(text, args.out_dir, vcfg)
            else:
                path = synth(text, args.voice, args.rate, args.pitch, args.out_dir)
            last = ""
            break
        except ImportError as exc:
            emit({"ok": False, "error": "没有 edge-tts：%s" % exc, "code": "NO_EDGE_TTS"}, 2)
        except Exception as exc:  # noqa: BLE001
            last = str(exc)[:200]
            if vcfg:
                # 火山挂了就退回 edge，别让声音断掉
                try:
                    path = synth(text, args.voice, args.rate, args.pitch, args.out_dir)
                    print("[volc] 失败，已退回 edge：%s" % last, file=sys.stderr)
                    last = ""
                    break
                except Exception as exc2:  # noqa: BLE001
                    last = str(exc2)[:200]
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
