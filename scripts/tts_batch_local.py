#!/usr/bin/env python3
"""
ac-3090 本地 TTS 批次生成腳本

直接載入 Qwen3-TTS Base model，用 voice clone 生成中文 podcast。
不經 HTTP API，避免 timeout 問題。

用法（在 ac-3090 上執行）：
  source ~/qwen3-tts-env/bin/activate
  python3 tts_batch_local.py                    # 跑全部
  python3 tts_batch_local.py --episodes EP002 EP058  # 只跑特定集
  python3 tts_batch_local.py --dry-run          # 只列出會做什麼

前置：
  1. podcast_scripts.json 上傳到同目錄
  2. ~/alan_voice.wav 存在
"""
import argparse
import gc
import json
import os
import sys
import time

import numpy as np
import soundfile as sf
import torch

# ── Configuration ──────────────────────────────────────────────
REF_AUDIO = os.path.expanduser("~/alan_voice.wav")
REF_TEXT = "大家好，歡迎收聽今天的節目，我是你們的主持人，今天我們要一起來聊聊"
MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
DEVICE = "cuda:0"
DTYPE = torch.bfloat16
MAX_NEW_TOKENS = 8192  # ~655s max audio

OUTPUT_DIR = os.path.expanduser("~/s100_podcast_output")
SCRIPTS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "podcast_scripts.json")


def load_model():
    """Load Qwen3-TTS Base model for voice cloning."""
    print(f"Loading model {MODEL_ID}...")
    t0 = time.time()
    from qwen_tts import Qwen3TTSModel
    model = Qwen3TTSModel.from_pretrained(
        MODEL_ID,
        device_map=DEVICE,
        dtype=DTYPE,
        attn_implementation="sdpa",
    )
    vram = torch.cuda.memory_allocated() / 1024 / 1024
    print(f"  Model loaded in {time.time()-t0:.1f}s, VRAM: {vram:.0f} MB")
    return model


def create_voice_prompt(model):
    """Create cached voice clone prompt from reference audio."""
    print(f"Creating voice clone prompt from {REF_AUDIO}...")
    t0 = time.time()
    prompt = model.create_voice_clone_prompt(
        ref_audio=REF_AUDIO,
        ref_text=REF_TEXT,
        x_vector_only_mode=False,
    )
    print(f"  Voice prompt created in {time.time()-t0:.1f}s")
    return prompt


def generate_one(model, voice_prompt, text, output_path):
    """Generate one podcast episode audio."""
    t0 = time.time()
    wavs, sr = model.generate_voice_clone(
        text=text,
        language="Chinese",
        voice_clone_prompt=voice_prompt,
        max_new_tokens=MAX_NEW_TOKENS,
        non_streaming_mode=True,
    )
    gen_time = time.time() - t0
    wav_data = wavs[0]
    duration = len(wav_data) / sr

    # Save WAV
    sf.write(output_path, wav_data, sr)
    size_kb = os.path.getsize(output_path) / 1024

    return duration, gen_time, size_kb


def main():
    parser = argparse.ArgumentParser(description="Batch TTS voice clone on ac-3090")
    parser.add_argument("--episodes", nargs="*", help="Specific episodes (e.g. EP002 EP058)")
    parser.add_argument("--dry-run", action="store_true", help="Only show what would be done")
    parser.add_argument("--scripts", default=SCRIPTS_FILE, help="Path to podcast_scripts.json")
    args = parser.parse_args()

    # Load scripts
    if not os.path.exists(args.scripts):
        print(f"ERROR: {args.scripts} not found")
        sys.exit(1)

    with open(args.scripts, encoding="utf-8") as f:
        data = json.load(f)
    all_scripts = data.get("scripts", {})

    # Filter episodes
    if args.episodes:
        episodes = []
        for e in args.episodes:
            e = e.upper()
            if not e.startswith("EP"):
                e = f"EP{int(e):03d}"
            episodes.append(e)
    else:
        episodes = sorted(all_scripts.keys())

    # Filter to only episodes that have scripts
    episodes = [ep for ep in episodes if ep in all_scripts]
    print(f"Episodes to generate: {len(episodes)}")
    for ep in episodes:
        s = all_scripts[ep]
        print(f"  {ep}: {s['title'][:40]}... ({s['chars']} chars)")

    if args.dry_run:
        print("\n[DRY RUN] Would generate above episodes. Exiting.")
        return

    # Create output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Check ref audio
    if not os.path.exists(REF_AUDIO):
        print(f"ERROR: Reference audio not found: {REF_AUDIO}")
        sys.exit(1)

    # Stop TTS server if running to free GPU
    print("\nStopping TTS server to free GPU memory...")
    os.system("sudo systemctl stop qwen3-tts 2>/dev/null || true")
    os.system("pkill -f qwen3-tts-server 2>/dev/null || true")
    time.sleep(3)
    vram_free = torch.cuda.mem_get_info()[0] / 1024 / 1024
    print(f"  GPU free: {vram_free:.0f} MB")

    # Load model
    model = load_model()
    voice_prompt = create_voice_prompt(model)

    # Generate
    success = 0
    failed = 0
    total_audio = 0
    total_gen = 0

    for i, ep in enumerate(episodes):
        s = all_scripts[ep]
        output_path = os.path.join(OUTPUT_DIR, f"{ep}.wav")

        print(f"\n[{i+1}/{len(episodes)}] {ep} — {s['title'][:35]}... ({s['chars']} chars)")

        try:
            duration, gen_time, size_kb = generate_one(
                model, voice_prompt, s["script"], output_path
            )
            rtf = gen_time / duration if duration > 0 else 0
            print(f"  ✓ {duration:.0f}s audio | {gen_time:.0f}s gen | RTF {rtf:.2f}x | {size_kb:.0f}KB")

            if duration < 30:
                print(f"  ⚠ Very short audio ({duration:.0f}s)")
            elif duration > 360:
                print(f"  ⚠ Audio over 6 min ({duration:.0f}s)")

            success += 1
            total_audio += duration
            total_gen += gen_time

        except Exception as e:
            print(f"  ✗ Error: {e}")
            failed += 1
            # Try to recover GPU memory
            torch.cuda.empty_cache()
            gc.collect()

    # Summary
    print(f"\n{'='*60}")
    print(f"Results: {success} success, {failed} failed")
    if success > 0:
        print(f"Total audio: {total_audio/60:.1f} min")
        print(f"Total gen time: {total_gen/60:.1f} min")
        print(f"Output: {OUTPUT_DIR}/")

    # Cleanup
    del model, voice_prompt
    torch.cuda.empty_cache()
    gc.collect()
    print("Model unloaded.")


if __name__ == "__main__":
    main()
