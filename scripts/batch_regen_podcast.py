#!/usr/bin/env python3
"""
批次重新生成中文 Podcast（voice clone 版）

三階段流程：
  Phase 1 (--scripts): 從 ac-mac 讀取 research.md → 萃取 podcast 腳本 → 存入 scripts.json
  Phase 2 (--audio):   讀取 scripts.json → 呼叫 TTS /clone API → WAV → M4A
  Phase 3 (--check):   品質檢查所有新生成的 M4A
  --all:               依序執行三個 Phase

用法：
  python3 scripts/batch_regen_podcast.py --scripts   # 先產腳本，可人工 review
  python3 scripts/batch_regen_podcast.py --audio     # 跑 TTS
  python3 scripts/batch_regen_podcast.py --check     # 品質檢查
  python3 scripts/batch_regen_podcast.py --all       # 一次跑完
  python3 scripts/batch_regen_podcast.py --audio --episodes EP002 EP058  # 只跑特定集

依賴：
  - ac-3090 Qwen3-TTS server (port 3003)
  - ac-mac research.md 檔案 (SSH)
  - 本地 ffmpeg
"""
import argparse
import base64
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

# ── Configuration ──────────────────────────────────────────────
EPISODES = [
    2, 4, 7, 10, 11, 12, 14, 15, 20, 21, 26, 28, 30, 33, 34,
    43, 47, 57, 58, 59, 61, 65, 68, 69, 70, 71, 80, 81, 84,
    92, 98, 99,
]

TTS_URL = "http://100.108.119.78:3003/clone"
TTS_HEALTH_URL = "http://100.108.119.78:3003/health"
REF_AUDIO_PATH = "/home/ac3090/alan_voice.wav"  # on ac-3090
AC_MAC_CONTENT = "/usr/local/bin/ai-hub/content/sustainability100"

REPO_ROOT = Path(__file__).resolve().parent.parent
LOCAL_AUDIO_DIR = REPO_ROOT / "assets" / "audio"
SCRIPTS_JSON = REPO_ROOT / "scripts" / "podcast_scripts.json"

# Voice clone 語速 ~380 chars/min → 1700 chars ≈ 4.5 min
TARGET_CHARS = 1700
MAX_CHARS = 1900

# ── Episode metadata (title + outline) ────────────────────────
def load_episode_meta():
    """Read frontmatter from _episodes/*.md to get title and outline."""
    import yaml
    meta = {}
    for n in EPISODES:
        ep_id = f"EP{n:03d}"
        path = REPO_ROOT / "_episodes" / f"{ep_id}.md"
        if not path.exists():
            print(f"  ⚠ {ep_id}: _episodes/{ep_id}.md not found")
            continue
        text = path.read_text(encoding="utf-8")
        if text.startswith("---"):
            end = text.index("---", 3)
            fm = yaml.safe_load(text[3:end])
            meta[ep_id] = {
                "title": fm.get("title", ""),
                "outline": fm.get("outline", ""),
                "number": fm.get("number", n),
            }
    return meta


# ── Phase 1: Script Generation ────────────────────────────────
def fetch_research(ep_id: str) -> str:
    """SSH to ac-mac and read research.md."""
    path = f"{AC_MAC_CONTENT}/{ep_id}/research.md"
    r = subprocess.run(
        ["ssh", "ac-mac", f"cat {path}"],
        capture_output=True, text=True, timeout=15,
    )
    if r.returncode != 0:
        raise FileNotFoundError(f"{ep_id} research.md not found on ac-mac")
    return r.stdout


def extract_section(text: str, header: str, max_chars: int = 600) -> str:
    """Extract content under a markdown ## header, truncate to max_chars."""
    pattern = rf"## {re.escape(header)}\s*\n(.*?)(?=\n## |\Z)"
    m = re.search(pattern, text, re.DOTALL)
    if not m:
        return ""
    content = m.group(1).strip()
    # Remove markdown formatting
    content = re.sub(r"\*\*(.+?)\*\*", r"\1", content)
    content = re.sub(r"#{1,4}\s+", "", content)
    content = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", content)
    content = re.sub(r"```[\s\S]*?```", "", content)
    content = re.sub(r"`([^`]+)`", r"\1", content)
    content = re.sub(r"\n{3,}", "\n\n", content)
    if len(content) > max_chars:
        # Truncate at sentence boundary
        cut = content[:max_chars]
        last_period = max(cut.rfind("。"), cut.rfind("！"), cut.rfind("？"))
        if last_period > max_chars * 0.5:
            content = cut[:last_period + 1]
        else:
            content = cut
    return content.strip()


def extract_bullet_points(text: str, header: str, max_items: int = 5) -> list[str]:
    """Extract bullet points under a section header."""
    section = extract_section(text, header, max_chars=2000)
    bullets = []
    for line in section.split("\n"):
        line = line.strip()
        if line.startswith(("* ", "- ", "• ")):
            item = line.lstrip("*-• ").strip()
            item = re.sub(r"\*\*(.+?)\*\*", r"\1", item)
            if item:
                bullets.append(item)
    return bullets[:max_items]


def extract_subsection_titles(text: str, header: str) -> list[str]:
    """Extract ### subsection titles under a ## header."""
    section = extract_section(text, header, max_chars=5000)
    titles = re.findall(r"^###\s+(.+)", section, re.MULTILINE)
    # Clean titles
    return [re.sub(r"\*\*(.+?)\*\*", r"\1", t).strip() for t in titles]


def take_sentences(text: str, max_chars: int) -> str:
    """Take complete sentences (ending with 。！) up to max_chars.
    Avoids cutting at ？ mid-sentence to prevent hanging questions."""
    sentences = re.split(r"(?<=[。！])", text)
    result = ""
    for s in sentences:
        s = s.strip()
        if not s:
            continue
        if len(result) + len(s) > max_chars:
            break
        result += s
    return result


def clean_markdown(text: str) -> str:
    """Remove markdown formatting, keep plain text."""
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"#{1,4}\s+", "", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"```[\s\S]*?```", "", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"!\[.*?\]\(.*?\)", "", text)
    return text.strip()


def extract_body_paragraphs(research: str, max_paras: int = 30) -> list:
    """Extract readable paragraphs from research.md (any format).

    Skips frontmatter, headers, tables, lists, code blocks, blockquotes.
    Returns list of plain-text paragraphs.
    """
    lines = research.split("\n")

    # Filter out blockquotes, headers, dividers, and metadata lines
    filtered = []
    skip_next_blank = False
    for line in lines:
        stripped = line.strip()
        # Skip blockquotes (metadata like >系列, >事實查核)
        if stripped.startswith(">"):
            continue
        # Skip H1/H2 headers and dividers
        if stripped.startswith(("#", "---")):
            continue
        # Skip table rows
        if stripped.startswith("|"):
            continue
        # Skip standalone labels (e.g., "優點：", "缺點：")
        if re.match(r"^[^\s]{1,6}[：:]$", stripped):
            continue
        filtered.append(line)

    body = "\n".join(filtered)
    body = clean_markdown(body)

    # Split into paragraphs
    raw_paras = re.split(r"\n{2,}", body)
    result = []
    for p in raw_paras:
        p = p.strip()
        # Remove numbered prefixes like "一、", "1. ", "A. "
        p = re.sub(r"^[一二三四五六七八九十]+[、．.]\s*", "", p)
        p = re.sub(r"^\d+[.、）]\s*", "", p)
        p = re.sub(r"^[A-Z][.、]\s+", "", p)
        # Normalize whitespace (keep single spaces for readability)
        p = re.sub(r"[ \t]+", "", p)  # Remove spaces in CJK text
        p = re.sub(r"\n", "", p)
        p = p.strip()
        if len(p) < 40:
            continue
        # Skip list-only blocks
        if all(c in "-*•" for c in p[:3]):
            continue
        # Skip meta-like paragraphs
        if "生成時間" in p or "事實查核" in p or "AI夥伴" in p:
            continue
        result.append(p)
        if len(result) >= max_paras:
            break
    return result


def has_standard_sections(research: str) -> bool:
    """Check if research.md uses standard section headers."""
    return "## 議題概述" in research and "## 核心知識點" in research


def generate_script_standard(research: str, title: str, outline: str, number: int) -> str:
    """Generate script from standard-format research.md (with ## headers)."""
    parts = []

    # Opening
    parts.append(
        f"歡迎收聽永續一百講，我是主持人 Alan。"
        f"今天是第{number}集，主題是「{title}」。"
    )

    # Overview (~500 chars)
    overview = extract_section(research, "議題概述", max_chars=2000)
    if overview:
        chunk = take_sentences(overview, 500)
        if chunk:
            parts.append(chunk)

    # Key points (~700 chars)
    knowledge = extract_section(research, "核心知識點", max_chars=5000)
    if knowledge:
        subsections = re.split(r"\n###\s+", knowledge)
        kp_budget, kp_used = 700, 0
        for sub in subsections:
            sub = sub.strip()
            if not sub:
                continue
            paragraphs = sub.split("\n\n")
            for para in paragraphs[1:]:
                para = para.strip()
                if not para or para.startswith(("| ", "```", "- ", "* ", "1.")):
                    continue
                chunk = take_sentences(para, min(kp_budget - kp_used, 300))
                if chunk and len(chunk) > 30:
                    parts.append(chunk)
                    kp_used += len(chunk)
                    break
            if kp_used >= kp_budget:
                break

    # Trends (~250 chars)
    trends = extract_section(research, "最新趨勢與新聞整合", max_chars=1200)
    if trends:
        chunk = take_sentences(trends, 250)
        if chunk:
            parts.append(chunk)

    # Taiwan (~300 chars)
    tw = extract_section(research, "台灣觀點與實務建議", max_chars=1200)
    if tw:
        chunk = take_sentences(tw, 300)
        if chunk:
            parts.append(chunk)

    # Summary bullets (fill remaining)
    current_len = sum(len(p) for p in parts)
    remaining = TARGET_CHARS - current_len - 40
    if remaining > 80:
        bullets = extract_bullet_points(research, "重點摘要", max_items=6)
        if bullets:
            cleaned = [b.rstrip("。！？") for b in bullets]
            summary_text = "最後幫大家整理幾個重點。" + "。".join(cleaned) + "。"
            if len(summary_text) > remaining:
                summary_text = take_sentences(summary_text, remaining)
            if summary_text and len(summary_text) > 40:
                parts.append(summary_text)

    # Closing
    parts.append(f"以上就是今天關於{outline}的分享。感謝收聽，我們下集見。")
    return "\n".join(parts)


def generate_script_freeform(research: str, title: str, outline: str, number: int) -> str:
    """Generate script from free-form research.md (no standard headers)."""
    parts = []

    # Opening
    opening = (
        f"歡迎收聽永續一百講，我是主持人 Alan。"
        f"今天是第{number}集，主題是「{title}」。"
    )
    parts.append(opening)
    budget = TARGET_CHARS - len(opening) - 40  # reserve for closing

    # Extract all usable paragraphs
    paragraphs = extract_body_paragraphs(research)

    # Fill budget from paragraphs
    used = 0
    for para in paragraphs:
        remaining = budget - used
        if remaining < 50:
            break
        chunk = take_sentences(para, min(remaining, 350))
        if chunk and len(chunk) > 30:
            parts.append(chunk)
            used += len(chunk)

    # Closing
    parts.append(f"以上就是今天關於{outline}的分享。感謝收聽，我們下集見。")
    return "\n".join(parts)


def generate_script(research: str, title: str, outline: str, number: int) -> str:
    """Generate podcast narration script from research.md content.

    Target: ~1100 chars → ~4.5 min audio.
    Auto-detects format (standard headers vs free-form).
    """
    if has_standard_sections(research):
        script = generate_script_standard(research, title, outline, number)
    else:
        script = generate_script_freeform(research, title, outline, number)

    # Enforce MAX_CHARS
    if len(script) > MAX_CHARS:
        cut = script[:MAX_CHARS]
        last_p = max(cut.rfind("。"), cut.rfind("！"))
        if last_p > MAX_CHARS * 0.6:
            script = cut[:last_p + 1]

    return script


def phase_scripts(episodes: list[str]):
    """Phase 1: Generate podcast scripts from research.md."""
    print("=" * 60)
    print("Phase 1: Generating podcast scripts")
    print("=" * 60)

    meta = load_episode_meta()
    scripts = {}

    # Load existing scripts if any
    if SCRIPTS_JSON.exists():
        existing = json.loads(SCRIPTS_JSON.read_text(encoding="utf-8"))
        scripts = existing.get("scripts", {})
        print(f"  Loaded {len(scripts)} existing scripts")

    for ep_id in episodes:
        print(f"\n  [{ep_id}] ", end="", flush=True)

        if ep_id not in meta:
            print("⚠ no metadata, skipping")
            continue

        try:
            research = fetch_research(ep_id)
            print(f"fetched research ({len(research)} chars) → ", end="", flush=True)
        except Exception as e:
            print(f"✗ {e}")
            continue

        m = meta[ep_id]
        script = generate_script(research, m["title"], m["outline"], m["number"])
        scripts[ep_id] = {
            "title": m["title"],
            "outline": m["outline"],
            "script": script,
            "chars": len(script),
            "estimated_min": round(len(script) / 380, 1),
        }
        print(f"✓ {len(script)} chars (~{len(script)/240:.1f} min)")

    # Save
    output = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "count": len(scripts),
        "scripts": scripts,
    }
    SCRIPTS_JSON.write_text(
        json.dumps(output, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n  ✓ Saved {len(scripts)} scripts to {SCRIPTS_JSON}")

    # Summary
    chars_list = [s["chars"] for s in scripts.values()]
    if chars_list:
        print(f"  Char range: {min(chars_list)}-{max(chars_list)}, "
              f"avg: {sum(chars_list)/len(chars_list):.0f}")


# ── Phase 2: Audio Generation ─────────────────────────────────
LOCAL_REF_B64 = Path("/tmp/alan_voice_ref.b64")


def fetch_ref_audio_b64() -> str:
    """Get reference audio as base64, using local cache if available."""
    # Use local cache if exists
    if LOCAL_REF_B64.exists():
        b64 = LOCAL_REF_B64.read_text().strip()
        if len(b64) > 1000:
            print(f"  ✓ Reference audio from cache ({len(b64)} bytes)")
            return b64

    # Fetch from ac-3090 and cache
    print("  Fetching reference audio from ac-3090...")
    r = subprocess.run(
        ["ssh", "ac-3090", f"base64 -w0 {REF_AUDIO_PATH}"],
        capture_output=True, text=True, timeout=60,
    )
    if r.returncode != 0:
        raise RuntimeError(f"Failed to fetch ref audio: {r.stderr}")
    b64 = r.stdout.strip().replace("\n", "")
    LOCAL_REF_B64.write_text(b64)
    print(f"  ✓ Reference audio: {len(b64)} bytes (cached)")
    return b64


def check_tts_health() -> bool:
    """Check if TTS server is reachable."""
    try:
        import urllib.request
        req = urllib.request.Request(TTS_HEALTH_URL)
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            return data.get("status") == "ok"
    except Exception:
        return False


REF_TEXT = "大家好，歡迎收聽今天的節目，我是你們的主持人，今天我們要一起來聊聊"


def call_tts_clone(text: str, ref_b64: str, timeout: int = 900):
    """Call TTS /clone via curl (same approach as AI100 batch).

    Uses curl with temp payload file + 15 min timeout to avoid
    urllib timeout issues with long TTS generations.
    Returns (wav_bytes, duration, gen_time).
    """
    payload = {
        "text": text,
        "language": "Chinese",
        "ref_audio_base64": ref_b64,
        "ref_text": REF_TEXT,
    }

    # Write payload to temp file (can be very large due to base64 audio)
    payload_path = "/tmp/s100_tts_payload.json"
    with open(payload_path, "w") as f:
        json.dump(payload, f, ensure_ascii=False)

    t0 = time.time()
    r = subprocess.run(
        [
            "curl", "-s", "-X", "POST", TTS_URL,
            "-H", "Content-Type: application/json",
            "-d", f"@{payload_path}",
            "--max-time", str(timeout),
            "-o", "/tmp/s100_tts_output.wav",
            "-w", "%{http_code}|%{size_download}",
        ],
        capture_output=True, text=True, timeout=timeout + 30,
    )
    wall_time = time.time() - t0

    if r.returncode != 0:
        raise RuntimeError(f"curl failed (rc={r.returncode}): {r.stderr[:200]}")

    parts = r.stdout.strip().split("|")
    http_code = parts[0] if parts else "?"
    size = int(parts[1]) if len(parts) > 1 else 0

    if http_code != "200":
        raise RuntimeError(f"HTTP {http_code}")
    if size < 1000:
        raise RuntimeError(f"Response too small ({size} bytes)")

    wav_data = Path("/tmp/s100_tts_output.wav").read_bytes()

    # Estimate duration from WAV: 24000 Hz mono 16-bit → 48000 bytes/sec
    duration = max((len(wav_data) - 44) / 48000, 0.1)

    return wav_data, duration, wall_time


def convert_wav_to_m4a(wav_path: Path, m4a_path: Path):
    """Convert WAV to M4A (AAC-LC 128k) using ffmpeg."""
    r = subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(wav_path),
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            str(m4a_path),
        ],
        capture_output=True, text=True, timeout=60,
    )
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {r.stderr[:200]}")
    wav_path.unlink()  # Remove WAV after successful conversion


def phase_audio(episodes: list[str]):
    """Phase 2: Generate audio from scripts using TTS voice clone."""
    print("=" * 60)
    print("Phase 2: Generating audio (voice clone)")
    print("=" * 60)

    if not SCRIPTS_JSON.exists():
        print("  ✗ No scripts.json found. Run --scripts first.")
        sys.exit(1)

    data = json.loads(SCRIPTS_JSON.read_text(encoding="utf-8"))
    scripts = data.get("scripts", {})

    if not check_tts_health():
        print("  ✗ TTS server not reachable. Is qwen3-tts-server.py running on ac-3090?")
        print(f"    Start: ssh ac-3090 'cd ~ && source qwen3-tts-env/bin/activate && "
              f"python3 qwen3-tts-server.py &'")
        sys.exit(1)
    print("  ✓ TTS server healthy")

    ref_b64 = fetch_ref_audio_b64()

    success = 0
    failed = 0
    total_gen_time = 0
    total_audio_time = 0

    for ep_id in episodes:
        if ep_id not in scripts:
            print(f"\n  [{ep_id}] ⚠ no script, skipping")
            continue

        s = scripts[ep_id]
        ep_dir = LOCAL_AUDIO_DIR / ep_id
        wav_path = ep_dir / "podcast_zh_new.wav"
        m4a_path = ep_dir / "podcast_zh.m4a"

        print(f"\n  [{ep_id}] {s['title'][:30]}... ({s['chars']} chars)", flush=True)

        # Backup old file
        if m4a_path.exists():
            backup = ep_dir / "podcast_zh.m4a.bak"
            if not backup.exists():
                m4a_path.rename(backup)
                print(f"    Backed up old file → podcast_zh.m4a.bak")

        try:
            print(f"    Generating audio...", end="", flush=True)
            t0 = time.time()
            wav_data, duration, gen_time = call_tts_clone(s["script"], ref_b64)
            print(f" {duration:.0f}s audio in {gen_time:.0f}s (RTF {gen_time/duration:.2f}x)")

            # Check duration
            if duration > 330:  # > 5.5 min
                print(f"    ⚠ Audio too long ({duration:.0f}s), consider shortening script")
            elif duration < 60:  # < 1 min
                print(f"    ⚠ Audio too short ({duration:.0f}s), check script")

            # Save WAV then convert
            ep_dir.mkdir(parents=True, exist_ok=True)
            wav_path.write_bytes(wav_data)
            convert_wav_to_m4a(wav_path, m4a_path)
            size_mb = m4a_path.stat().st_size / 1024 / 1024
            print(f"    ✓ Saved {m4a_path.name} ({size_mb:.1f} MB)")

            success += 1
            total_gen_time += gen_time
            total_audio_time += duration

        except Exception as e:
            print(f"    ✗ Error: {e}")
            failed += 1
            # Clean up partial files
            if wav_path.exists():
                wav_path.unlink()

        # Brief pause between requests (same as AI100 batch)
        time.sleep(3)

    print(f"\n{'='*60}")
    print(f"Results: {success} success, {failed} failed")
    if success > 0:
        print(f"Total audio: {total_audio_time/60:.1f} min, "
              f"Total gen time: {total_gen_time/60:.1f} min")


# ── Phase 3: Quality Check ────────────────────────────────────
def get_volume_stats(filepath: str, start: int, duration: int = 5) -> tuple:
    """Get mean and max volume at a timestamp."""
    r = subprocess.run(
        ["ffmpeg", "-ss", str(start), "-i", filepath, "-t", str(duration),
         "-af", "volumedetect", "-f", "null", "-"],
        capture_output=True, text=True, timeout=30,
    )
    mean = max_v = None
    for line in r.stderr.split("\n"):
        if "mean_volume" in line:
            try:
                mean = float(line.split(":")[-1].strip().replace(" dB", ""))
            except ValueError:
                pass
        if "max_volume" in line:
            try:
                max_v = float(line.split(":")[-1].strip().replace(" dB", ""))
            except ValueError:
                pass
    return mean, max_v


def get_duration(filepath: str) -> float:
    """Get audio duration in seconds."""
    r = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json",
         "-show_format", filepath],
        capture_output=True, text=True, timeout=15,
    )
    data = json.loads(r.stdout)
    return float(data["format"]["duration"])


def phase_check(episodes: list[str]):
    """Phase 3: Quality check generated audio files."""
    print("=" * 60)
    print("Phase 3: Quality check")
    print("=" * 60)

    ok = 0
    issues_list = []

    for ep_id in episodes:
        m4a = LOCAL_AUDIO_DIR / ep_id / "podcast_zh.m4a"
        if not m4a.exists():
            print(f"  [{ep_id}] ✗ File not found")
            continue

        duration = get_duration(str(m4a))
        dur_min = duration / 60

        # Sample at start, middle, end
        issues = []
        samples = [5, int(duration * 0.5), max(int(duration - 15), 10)]

        for t in samples:
            if t >= duration:
                continue
            mean, max_v = get_volume_stats(str(m4a), t)
            if max_v is not None and max_v >= -0.5:
                issues.append(f"CLIPPING at {t//60}:{t%60:02d} (max={max_v:.1f}dB)")
            elif max_v is not None and max_v >= -3.0:
                issues.append(f"NEAR_CLIP at {t//60}:{t%60:02d} (max={max_v:.1f}dB)")

        # Check volume drift
        start_mean, start_max = get_volume_stats(str(m4a), 5)
        end_mean, end_max = get_volume_stats(str(m4a), max(int(duration - 15), 10))
        if start_max is not None and end_max is not None:
            drift = end_max - start_max
            if drift > 8:
                issues.append(f"VOLUME_DRIFT +{drift:.1f}dB")

        # Duration check
        dur_flag = ""
        if duration > 330:
            dur_flag = " ⚠ >5.5min"
            issues.append("TOO_LONG")
        elif duration < 60:
            dur_flag = " ⚠ <1min"
            issues.append("TOO_SHORT")

        size_mb = m4a.stat().st_size / 1024 / 1024
        status = "✗ FAIL" if issues else "✓ OK"

        print(f"  [{ep_id}] {status} | {dur_min:.1f}min | {size_mb:.1f}MB"
              f"{dur_flag}"
              + (f" | {'; '.join(issues)}" if issues else ""))

        if issues:
            issues_list.append((ep_id, issues))
        else:
            ok += 1

    print(f"\n  Results: {ok} OK, {len(issues_list)} issues")
    if issues_list:
        print(f"\n  Episodes needing attention:")
        for ep, iss in issues_list:
            print(f"    {ep}: {'; '.join(iss)}")


# ── Restore backup ────────────────────────────────────────────
def restore_backups(episodes: list[str]):
    """Restore .bak files for episodes that failed quality check."""
    for ep_id in episodes:
        ep_dir = LOCAL_AUDIO_DIR / ep_id
        backup = ep_dir / "podcast_zh.m4a.bak"
        target = ep_dir / "podcast_zh.m4a"
        if backup.exists():
            backup.rename(target)
            print(f"  [{ep_id}] Restored from backup")
        else:
            print(f"  [{ep_id}] No backup found")


# ── Main ──────────────────────────────────────────────────────
def parse_episodes(args_episodes):
    """Parse episode list from args or use default."""
    if args_episodes:
        eps = []
        for e in args_episodes:
            e = e.upper()
            if not e.startswith("EP"):
                e = f"EP{int(e):03d}"
            eps.append(e)
        return eps
    return [f"EP{n:03d}" for n in EPISODES]


def main():
    parser = argparse.ArgumentParser(description="Batch regenerate Chinese podcasts")
    parser.add_argument("--scripts", action="store_true", help="Phase 1: Generate scripts")
    parser.add_argument("--audio", action="store_true", help="Phase 2: Generate audio")
    parser.add_argument("--check", action="store_true", help="Phase 3: Quality check")
    parser.add_argument("--all", action="store_true", help="Run all phases")
    parser.add_argument("--restore", action="store_true", help="Restore backups")
    parser.add_argument("--episodes", nargs="*", help="Specific episodes (e.g. EP002 EP058)")
    args = parser.parse_args()

    if not any([args.scripts, args.audio, args.check, args.all, args.restore]):
        parser.print_help()
        sys.exit(1)

    episodes = parse_episodes(args.episodes)
    print(f"Target episodes: {len(episodes)} — {', '.join(episodes[:5])}{'...' if len(episodes) > 5 else ''}")

    if args.all or args.scripts:
        phase_scripts(episodes)
    if args.all or args.audio:
        phase_audio(episodes)
    if args.all or args.check:
        phase_check(episodes)
    if args.restore:
        restore_backups(episodes)


if __name__ == "__main__":
    main()
