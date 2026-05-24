#!/usr/bin/env python3
"""永續100講 — 新聞回填腳本

從 2026/01/01 回填到昨天，每天 3 篇不同來源。
使用 Google News RSS + 日期區間搜尋歷史文章。

用法:
  python3 s100-news-backfill.py                  # 回填所有缺少的日期
  python3 s100-news-backfill.py --start 2026-01-15  # 從指定日期開始
  python3 s100-news-backfill.py --end 2026-02-10    # 到指定日期
  python3 s100-news-backfill.py --dry-run           # 只看不做
  python3 s100-news-backfill.py --no-image          # 不生成圖片（加速測試）
"""

import argparse
import base64
import datetime
import hashlib
import json
import logging
import os
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path
import io

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("pip3 install Pillow")
    sys.exit(1)

FONT_PATH = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
FONT_INDEX = 3  # TC (Traditional Chinese)

try:
    import feedparser
except ImportError:
    print("pip3 install feedparser")
    sys.exit(1)

try:
    import httpx
except ImportError:
    print("pip3 install httpx")
    sys.exit(1)

# ============================================================
# 設定
# ============================================================

AI_HUB_BASE = os.environ.get("AI_HUB_URL", "http://127.0.0.1:8760")
IMAGE_API_BASE = os.environ.get("IMAGE_API_BASE", AI_HUB_BASE)
IMAGE_API_MODEL = os.environ.get("IMAGE_API_MODEL", "pro")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
LLM_BACKEND = os.environ.get("LLM_BACKEND", "aihub")  # "aihub" (gemini_chat) or "gemini-api"

REPO_DIR = "/home/ac-mac/sustainability-100"
POSTS_DIR = os.path.join(REPO_DIR, "_posts")
NEWS_IMG_DIR = os.path.join(REPO_DIR, "assets", "images", "news")

ARTICLES_PER_DAY = 3

# 搜尋關鍵字組（輪替使用，確保多元來源）
SEARCH_QUERIES = [
    "台灣 碳費 碳權 碳交易",
    "永續 ESG 碳排放 企業",
    "氣候變遷 淨零 再生能源 台灣",
    "碳盤查 供應鏈 CBAM 碳關稅",
    "綠電 能源轉型 減碳 永續報告",
]

# 系列主題對應
SERIES_TOPICS = {
    "S1": "淨零基礎與碳盤查 (EP001-EP010)",
    "S2": "節能減碳技術 (EP011-EP020)",
    "S3": "再生能源與綠電 (EP021-EP030)",
    "S4": "碳交易與碳定價 (EP031-EP040)",
    "S5": "永續揭露與法規 (EP041-EP050)",
    "S6": "永續報告實務 (EP051-EP060)",
    "S7": "供應鏈碳管理 (EP061-EP070)",
    "S8": "前瞻減碳技術 (EP071-EP080)",
    "S9": "AI × 永續管理 (EP081-EP090)",
    "S10": "永續策略與展望 (EP091-EP100)",
}

def send_telegram(msg: str):
    """發送 Telegram 通知。"""
    try:
        subprocess.run(
            ["/usr/local/bin/telegram-notify.sh", msg],
            timeout=10, capture_output=True,
        )
    except Exception as e:
        log.warning(f"TG 通知失敗: {e}")


STATE_FILE = os.path.expanduser("~/.s100-news-backfill-state.json")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("/var/log/ai-hub/sustainability-news-backfill.log"),
    ],
)
log = logging.getLogger("s100-backfill")


# ============================================================
# 狀態管理
# ============================================================

def load_state() -> dict:
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"completed_dates": [], "processed_urls": []}


def save_state(state: dict):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def article_id(url: str) -> str:
    return hashlib.md5(url.encode()).hexdigest()[:12]


# ============================================================
# 查詢已有文章的日期
# ============================================================

def get_existing_post_dates() -> dict[str, int]:
    """掃描 _posts 目錄，回傳每個日期已有幾篇文章。"""
    counts = {}
    if os.path.isdir(POSTS_DIR):
        for f in os.listdir(POSTS_DIR):
            if f.endswith(".md") and len(f) >= 10:
                date_str = f[:10]  # YYYY-MM-DD
                counts[date_str] = counts.get(date_str, 0) + 1
    return counts


# ============================================================
# Google News RSS 歷史搜尋
# ============================================================

def fetch_google_news(query: str, date: datetime.date) -> list[dict]:
    """用 Google News RSS 搜尋指定日期前後的文章。"""
    # Google News RSS after/before 語法
    after = (date - datetime.timedelta(days=1)).isoformat()
    before = (date + datetime.timedelta(days=1)).isoformat()

    encoded_q = urllib.parse.quote(f"{query} after:{after} before:{before}")
    url = f"https://news.google.com/rss/search?q={encoded_q}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"

    articles = []
    try:
        resp = httpx.get(url, timeout=15, follow_redirects=True,
                         headers={"User-Agent": "S100-Backfill/1.0"})
        feed = feedparser.parse(resp.text)

        for entry in feed.entries[:8]:
            title = entry.get("title", "").strip()
            link = entry.get("link", "").strip()
            summary = entry.get("summary", "").strip()
            source = entry.get("source", {}).get("title", "")

            if not title or not link:
                continue

            summary = re.sub(r"<[^>]+>", "", summary)[:300]

            articles.append({
                "title": title,
                "link": link,
                "summary": summary,
                "source_name": source or "Google News",
                "lang": "zh",
                "id": article_id(link),
            })
    except Exception as e:
        log.warning(f"Google News 搜尋失敗 ({query}): {e}")

    return articles


def fetch_articles_for_date(date: datetime.date, processed_urls: set) -> list[dict]:
    """為指定日期取得候選文章（多個查詢輪替）。"""
    all_articles = []
    seen_sources = set()

    # 用多個查詢組搜尋，確保來源多元
    day_offset = (date - datetime.date(2026, 1, 1)).days
    queries_order = SEARCH_QUERIES.copy()
    # 每天用不同順序的查詢
    for i in range(day_offset % len(queries_order)):
        queries_order.append(queries_order.pop(0))

    for query in queries_order:
        articles = fetch_google_news(query, date)
        for a in articles:
            if a["link"] in processed_urls:
                continue
            if a["id"] in {x["id"] for x in all_articles}:
                continue
            # 不同來源優先
            if a["source_name"] in seen_sources and len(all_articles) < 10:
                all_articles.append(a)  # 還是加入但排後面
            else:
                all_articles.insert(0, a)
                seen_sources.add(a["source_name"])

        time.sleep(1)  # 避免被 Google 限流

    return all_articles


# ============================================================
# 網頁內容抓取
# ============================================================

def fetch_article_content(url: str) -> str:
    """透過 AI Hub web_fetch (level=http) 抓取文章全文。
    Google News URL 是 JS 轉址，無法用 HTTP 抓取，直接回傳空讓 caller fallback 用 RSS 摘要。
    """
    if "news.google.com" in url:
        return ""

    try:
        resp = httpx.post(
            f"{AI_HUB_BASE}/api/web/fetch",
            json={"url": url, "level": "http"},
            timeout=30,
        )
        data = resp.json()
        if data.get("success"):
            content = (data.get("content", "") or data.get("message", ""))[:2000]
            if len(content) > 100:
                return content
    except Exception as e:
        log.warning(f"  AI Hub web_fetch 失敗: {e}")
    return ""


# ============================================================
# LLM 分析
# ============================================================

def _call_gemini(prompt: str) -> str | None:
    """Call Gemini API directly. Returns response text or None."""
    for attempt in range(4):
        try:
            if attempt > 0:
                wait = 15 * (2 ** attempt)
                log.info(f"  Gemini 重試 {attempt+1}/4（等待 {wait}s）")
                time.sleep(wait)
            resp = httpx.post(
                f"{GEMINI_API_URL}?key={GEMINI_API_KEY}",
                json={"contents": [{"parts": [{"text": prompt}]}]},
                timeout=120,
            )
            if resp.status_code == 429:
                log.warning(f"  Gemini 429（attempt {attempt+1}）")
                continue
            data = resp.json()
            return data["candidates"][0]["content"]["parts"][0]["text"]
        except Exception as e:
            log.warning(f"  Gemini error: {e}")
    return None


def _call_aihub(prompt: str) -> str | None:
    """Call AI Hub LLM (gemini_chat). Returns response text or None."""
    try:
        resp = httpx.post(
            f"{AI_HUB_BASE}/api/llm/chat",
            json={"prompt": prompt, "provider": "gemini"},
            timeout=120,
        )
        data = resp.json()
        if data.get("success"):
            return data.get("content", "") or data.get("message", "")
        else:
            log.warning(f"  AI Hub LLM 失敗: {data.get('message', resp.status_code)}")
    except Exception as e:
        log.warning(f"  AI Hub error: {e}")
    return None


def analyze_article(article: dict, content: str) -> dict | None:
    """使用 LLM 產出結構化中文新聞摘要。"""
    series_desc = "\n".join(f"  {k}: {v}" for k, v in SERIES_TOPICS.items())

    prompt = f"""你是「低碳永續100講」的新聞編輯。請嚴格判斷這篇文章是否與以下主題直接相關：
- 碳排放、碳盤查、碳費、碳權、碳交易
- ESG、永續報告、永續揭露
- 淨零排放、氣候變遷政策
- 再生能源、綠電、節能減碳技術
- 供應鏈碳管理、CBAM、碳關稅

如果文章與上述主題**無直接關係**（例如：一般環保、生態保育、登山安全、食安、動物保護），relevance_score 必須給 4 以下。

文章標題: {article['title']}
來源: {article['source_name']}
原始摘要: {article['summary'][:200]}
完整內容（節錄）: {content[:800]}

請以 JSON 回覆（不要加 markdown code block）:
{{
  "title_zh": "繁體中文標題15-25字",
  "summary": "摘要50字內",
  "body": "正文100-150字，白話解說重點與影響",
  "tags": ["標籤1", "標籤2"],
  "related_series": ["S1"],
  "related_episodes": ["EP007"],
  "image_prompt": "English scene description, 20 words max",
  "image_title_zh": "8-12字大標題",
  "relevance_score": 8
}}

系列: {series_desc}
只回 JSON，不要其他文字。"""

    if LLM_BACKEND == "gemini-api":
        text = _call_gemini(prompt)
    else:
        # Default: use AI Hub (provider=gemini → gemini_chat)
        text = _call_aihub(prompt)
    if not text:
        return None

    try:
        text = re.sub(r"^```json?\s*", "", text.strip())
        text = re.sub(r"\s*```$", "", text.strip())
        return json.loads(text)
    except json.JSONDecodeError as e:
        log.warning(f"LLM JSON 解析失敗: {e}")
        log.warning(f"  回應（前200字）: {text[:200]}")
        return None


# ============================================================
# 圖片生成
# ============================================================

def _pil_overlay(img_bytes: bytes, title_zh: str) -> bytes:
    """PIL overlay: add Chinese title on semi-transparent band at top of image."""
    img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
    w, h = img.size

    # Crop to 16:9 if square (Nano Banana fallback produces 878x878)
    target_h = int(w * 9 / 16)
    if h > target_h + 10:
        img = img.crop((0, 0, w, target_h))
        h = target_h

    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Semi-transparent dark band at top
    band_h = int(h * 0.30)
    draw.rectangle([(0, 0), (w, band_h)], fill=(0, 0, 0, 140))

    # Load font, auto-shrink to fit
    font_size = int(w * 0.06)
    font = ImageFont.truetype(FONT_PATH, font_size, index=FONT_INDEX)
    bbox = draw.textbbox((0, 0), title_zh, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    max_text_w = int(w * 0.85)
    while text_w > max_text_w and font_size > 24:
        font_size -= 2
        font = ImageFont.truetype(FONT_PATH, font_size, index=FONT_INDEX)
        bbox = draw.textbbox((0, 0), title_zh, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]

    x = (w - text_w) // 2
    y = (band_h - text_h) // 2

    # Shadow + white text
    shadow = max(2, font_size // 20)
    draw.text((x + shadow, y + shadow), title_zh, font=font, fill=(0, 0, 0, 200))
    draw.text((x, y), title_zh, font=font, fill=(255, 255, 255, 255))

    result = Image.alpha_composite(img, overlay).convert("RGB")
    buf = io.BytesIO()
    result.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def generate_image(prompt: str, title_zh: str, filename: str) -> bool:
    """生成新聞配圖：text-free BG via Gemini + PIL overlay Chinese title."""
    bg_prompt = (
        f"Generate a professional sustainability news card background illustration. "
        f"Dark green gradient background (#1b4332 to #2d6a4f). "
        f"DO NOT include any text, words, letters, or characters in the image. "
        f"Include subtle glowing eco-friendly icons and accents. "
        f"Scene context: {prompt}. "
        f"Clean modern editorial style, 16:9 aspect ratio."
    )

    for attempt in range(3):
        try:
            if attempt > 0:
                wait = 30 * attempt
                log.info(f"  圖片重試 {attempt + 1}/3（等待 {wait}s）")
                time.sleep(wait)

            resp = httpx.post(
                f"{IMAGE_API_BASE}/api/image/generate",
                json={"prompt": bg_prompt, "timeout": 180, "model": "fast"},
                timeout=200,
            )
            data = resp.json()
            if data.get("success") and data.get("image_base64"):
                img_data = base64.b64decode(data["image_base64"])

                # PIL overlay Chinese title
                final_data = _pil_overlay(img_data, title_zh)

                os.makedirs(NEWS_IMG_DIR, exist_ok=True)
                img_path = os.path.join(NEWS_IMG_DIR, filename)
                with open(img_path, "wb") as f:
                    f.write(final_data)
                log.info(f"  圖片: {filename} ({len(final_data)} bytes, PIL overlay)")
                return True

            status = resp.status_code
            msg = data.get("message", "")
            log.warning(f"  圖片失敗 (HTTP {status}): {msg}")
        except Exception as e:
            log.warning(f"  圖片異常: {e}")

    log.warning(f"  圖片放棄（3 次失敗）")
    return False




# ============================================================
# Jekyll Post 產出
# ============================================================

def create_post(article: dict, analysis: dict, has_image: bool, target_date: datetime.date) -> str:
    """產出 Jekyll _posts markdown 文件，使用指定日期。"""
    filename = f"{target_date.isoformat()}-{article['id']}.md"
    img_filename = f"{target_date.isoformat()}-{article['id']}.png"

    tags = analysis.get("tags", [])
    related_series = analysis.get("related_series", [])
    related_eps = analysis.get("related_episodes", [])

    tags_yaml = "[" + ", ".join(f'"{t}"' for t in tags) + "]"

    related_series_yaml = ""
    if related_series:
        related_series_yaml = "related_series:\n"
        for s in related_series:
            related_series_yaml += f'  - "{s}"\n'

    related_eps_yaml = ""
    if related_eps:
        related_eps_yaml = "related_episodes:\n"
        for ep in related_eps:
            related_eps_yaml += f'  - "{ep}"\n'

    title_safe = analysis["title_zh"].replace('"', '\\"')
    summary_safe = analysis["summary"].replace('"', '\\"')

    post_content = f"""---
title: "{title_safe}"
date: {target_date.isoformat()}
source: "{article['source_name']}"
source_url: "{article['link']}"
summary: "{summary_safe}"
tags: {tags_yaml}
{related_series_yaml}{related_eps_yaml}{"image: " + img_filename if has_image else ""}
layout: post
---

{analysis['body']}
"""

    os.makedirs(POSTS_DIR, exist_ok=True)
    post_path = os.path.join(POSTS_DIR, filename)
    with open(post_path, "w", encoding="utf-8") as f:
        f.write(post_content)

    log.info(f"  文章: {filename}")
    return filename


# ============================================================
# Git batch push
# ============================================================

def git_commit_and_push(message: str) -> bool:
    """Git commit 並 push（batch）。"""
    try:
        os.chdir(REPO_DIR)
        subprocess.run(["git", "add", "-A"], check=True, capture_output=True)

        # 檢查是否有東西要 commit
        result = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True)
        if not result.stdout.strip():
            log.info("Git: 沒有變更")
            return True

        subprocess.run(["git", "commit", "-m", message], check=True, capture_output=True)
        subprocess.run(
            ["git", "push", "origin", "main"],
            check=True, capture_output=True, timeout=180,
        )
        log.info(f"Git push: {message}")
        return True
    except subprocess.CalledProcessError as e:
        log.warning(f"Git 失敗: {e}")
    except subprocess.TimeoutExpired:
        log.warning("Git push timeout")
    return False


# ============================================================
# 主流程
# ============================================================

def run_backfill(start_date: datetime.date, end_date: datetime.date,
                 dry_run=False, no_image=False, no_push=False):
    """三階段流水線：1. 全抓新聞 → 2. 批次 LLM 分析 → 3. 批次生圖 + 上傳"""
    log.info("=" * 60)
    log.info(f"永續100講 — 新聞回填 {start_date} → {end_date}")
    log.info("=" * 60)

    state = load_state()
    completed_dates = set(state.get("completed_dates", []))
    processed_urls = set(state.get("processed_urls", []))

    # 掃描現有文章
    existing = get_existing_post_dates()
    log.info(f"現有文章: {sum(existing.values())} 篇 / {len(existing)} 天")

    # 計算需要回填的日期
    current = start_date
    dates_to_fill = []
    while current <= end_date:
        date_str = current.isoformat()
        existing_count = existing.get(date_str, 0)
        if existing_count < ARTICLES_PER_DAY and date_str not in completed_dates:
            dates_to_fill.append((current, ARTICLES_PER_DAY - existing_count))
        current += datetime.timedelta(days=1)

    log.info(f"需回填: {len(dates_to_fill)} 天")
    if not dates_to_fill:
        log.info("全部已完成！")
        return

    # ============================================================
    # 階段 1: 全量抓取 RSS 新聞（不用 Chrome，純 HTTP）
    # ============================================================
    log.info("\n" + "=" * 60)
    log.info("階段 1/3: 抓取 RSS 新聞")
    log.info("=" * 60)

    # {date: [article, ...]} — 每天選好的候選文章
    daily_candidates: dict[datetime.date, list[dict]] = {}

    for i, (date, needed) in enumerate(dates_to_fill):
        log.info(f"  [{i+1}/{len(dates_to_fill)}] {date.isoformat()} (需 {needed} 篇)")

        articles = fetch_articles_for_date(date, processed_urls)

        if not articles:
            log.warning(f"    找不到文章")
            continue

        # 選出候選（不同來源優先）
        selected = []
        used_sources = set()
        for article in articles:
            if len(selected) >= needed + 5:  # 多抓幾篇備用（LLM 可能過濾掉一些）
                break
            # 不同來源優先
            if article["source_name"] not in used_sources:
                selected.append(article)
                used_sources.add(article["source_name"])
            elif len(selected) < needed + 5:
                selected.append(article)

        # 補上 RSS 摘要作為 content（Google News URL 無法抓全文）
        for article in selected:
            content = fetch_article_content(article["link"])
            if len(content) < 50:
                content = f"{article['title']}。{article['summary']}"
            article["_content"] = content

        daily_candidates[date] = selected
        log.info(f"    候選 {len(selected)} 篇 (來源: {', '.join(used_sources)})")
        time.sleep(1)

    total_candidates = sum(len(v) for v in daily_candidates.values())
    log.info(f"\n階段 1 完成: {len(daily_candidates)} 天, {total_candidates} 篇候選")

    if dry_run:
        for date, articles in sorted(daily_candidates.items()):
            for a in articles[:5]:
                log.info(f"  {date}: [{a['source_name']}] {a['title'][:50]}")
        return

    # ============================================================
    # 階段 2: 批次 LLM 分析（Gemini 2.5 Flash API 直呼）
    # ============================================================
    log.info("\n" + "=" * 60)
    log.info("階段 2/3: LLM 分析與篩選")
    log.info("=" * 60)

    # {date: [(article, analysis), ...]} — 通過篩選的文章
    daily_approved: dict[datetime.date, list[tuple[dict, dict]]] = {}
    llm_ok = 0
    llm_skip = 0
    llm_fail = 0

    for date in sorted(daily_candidates.keys()):
        needed = dict(dates_to_fill).get(date, ARTICLES_PER_DAY)
        candidates = daily_candidates[date]
        approved = []

        for article in candidates:
            if len(approved) >= needed:
                break

            analysis = analyze_article(article, article["_content"])
            if not analysis:
                llm_fail += 1
                log.warning(f"  LLM 失敗: {article['title'][:40]}")
                time.sleep(7)
                continue

            score = analysis.get("relevance_score", 0)
            if score < 7:
                llm_skip += 1
                log.info(f"  [{score}/10] 跳過: {article['title'][:40]}")
                processed_urls.add(article["link"])
                time.sleep(7)
                continue

            llm_ok += 1
            log.info(f"  ✓ {date} [{score}/10] {analysis['title_zh']}")
            approved.append((article, analysis))
            processed_urls.add(article["link"])
            time.sleep(7)  # Gemini free tier: 10 RPM

        if approved:
            daily_approved[date] = approved

    state["processed_urls"] = list(processed_urls)
    save_state(state)
    total_approved = sum(len(v) for v in daily_approved.values())
    log.info(f"\n階段 2 完成: {total_approved} 篇通過 (跳過 {llm_skip}, 失敗 {llm_fail})")

    # ============================================================
    # 階段 3: 批次生成圖片 + 建立 Posts + Git Push
    # ============================================================
    log.info("\n" + "=" * 60)
    log.info("階段 3/3: 生成圖片 + 建立文章")
    log.info("=" * 60)

    total_created = 0
    batch_count = 0
    img_fail_count = 0

    for date in sorted(daily_approved.keys()):
        items = daily_approved[date]
        log.info(f"\n  {date}: {len(items)} 篇")

        for article, analysis in items:
            # 生圖
            has_image = False
            img_filename = f"{date.isoformat()}-{article['id']}.png"
            if not no_image and analysis.get("image_prompt"):
                title_zh = analysis.get("image_title_zh", analysis["title_zh"][:12])
                has_image = generate_image(analysis["image_prompt"], title_zh, img_filename)
                if not has_image:
                    img_fail_count += 1
                time.sleep(5)  # 圖片生成間隔

            # 建立 post
            create_post(article, analysis, has_image, date)
            total_created += 1
            batch_count += 1

        # 標記日期完成
        needed = dict(dates_to_fill).get(date, ARTICLES_PER_DAY)
        if len(items) >= needed:
            state.setdefault("completed_dates", []).append(date.isoformat())
            save_state(state)

        # 每 15 篇 push 一次
        if batch_count >= 15 and not no_push:
            git_commit_and_push(f"news: 回填永續動態 (batch, {total_created} articles)")
            batch_count = 0
            time.sleep(3)

    # 最後 push
    if batch_count > 0 and not no_push:
        git_commit_and_push(f"news: 回填永續動態 完成 ({total_created} articles total)")

    log.info(f"\n{'='*60}")
    log.info(f"回填完成！共產出 {total_created} 篇")
    log.info(f"{'='*60}")

    # Telegram 結果通知
    tg_lines = [f"📰 新聞回填完成"]
    tg_lines.append(f"文章: {total_created} 篇")
    if img_fail_count > 0:
        tg_lines.append(f"⚠️ 圖片失敗: {img_fail_count} 張")
    if llm_fail > 0:
        tg_lines.append(f"⚠️ LLM 失敗: {llm_fail} 篇")
    # TG notification moved to dashboard heartbeat
    log.info("Backfill summary: " + ", ".join(tg_lines))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="永續100講新聞回填")
    parser.add_argument("--start", default="2026-01-01", help="起始日期 (YYYY-MM-DD)")
    parser.add_argument("--end", default=None, help="結束日期 (預設: 昨天)")
    parser.add_argument("--dry-run", action="store_true", help="只搜尋不處理")
    parser.add_argument("--no-image", action="store_true", help="跳過圖片生成")
    parser.add_argument("--no-push", action="store_true", help="不 git push")
    args = parser.parse_args()

    start = datetime.date.fromisoformat(args.start)
    end = datetime.date.fromisoformat(args.end) if args.end else (datetime.date.today() - datetime.timedelta(days=1))

    run_backfill(start, end, dry_run=args.dry_run, no_image=args.no_image, no_push=args.no_push)
