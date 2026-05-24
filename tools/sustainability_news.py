#!/usr/bin/env python3
"""永續100講 — 永續新聞 Pipeline

從 RSS 來源抓取最新永續/ESG/碳排新聞，使用 LLM 分析，
生成 Jekyll _posts 文章推送到 GitHub Pages，TG 發送網站連結。

部署: ac-mac systemd timer 每日 08:00
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
from pathlib import Path

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
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("pip3 install Pillow")
    sys.exit(1)

# ============================================================
# 設定
# ============================================================

AI_HUB_BASE = os.environ.get("AI_HUB_URL", "http://127.0.0.1:8760")
IMAGE_API_BASE = os.environ.get("IMAGE_API_BASE", AI_HUB_BASE)
IMAGE_API_MODEL = os.environ.get("IMAGE_API_MODEL", "fast")
FONT_PATH = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
TITLE_IMAGE_SIZE = (1376, 768)
TITLE_BAR_HEIGHT = 160
TITLE_FONT_SIZE = 58
TITLE_LINE_SPACING = 72
TITLE_HORIZONTAL_PADDING = 120
TG_BOT_TOKEN = os.environ["TG_BOT_TOKEN"]
TG_CHAT_ID = int(os.environ.get("TG_CHAT_ID", "8550440980"))

REPO_DIR = "/home/ac-mac/sustainability-100"
POSTS_DIR = os.path.join(REPO_DIR, "_posts")
NEWS_IMG_DIR = os.path.join(REPO_DIR, "assets", "images", "news")
SITE_URL = "https://ai-cooperation.github.io/sustainability-100"

STATE_FILE = os.path.expanduser("~/.s100-news-state.json")

MAX_ARTICLES_PER_RUN = 3

# 永續 RSS 來源
RSS_SOURCES = [
    # Tier 1: 直接 RSS — 台灣
    {
        "name": "環境資訊中心",
        "url": "https://e-info.org.tw/rss.xml",
        "lang": "zh",
        "tier": 1,
        "filter_keywords": ["碳", "淨零", "永續", "ESG", "減碳", "綠電", "再生能源",
                            "氣候", "排放", "碳費", "碳權", "能源轉型", "CBAM"],
    },
    {
        "name": "綠學院",
        "url": "https://www.greenimpact.cc/rss",
        "lang": "zh",
        "tier": 1,
        "filter_keywords": ["碳", "淨零", "永續", "ESG", "減碳", "綠電", "再生能源",
                            "氣候", "排放", "碳費", "碳權", "能源轉型", "CBAM"],
    },
    # Tier 1: 直接 RSS — 國際
    {
        "name": "Carbon Brief",
        "url": "https://www.carbonbrief.org/feed",
        "lang": "en",
        "tier": 1,
    },
    {
        "name": "Climate Home",
        "url": "https://www.climatechangenews.com/feed/",
        "lang": "en",
        "tier": 1,
    },
    {
        "name": "Carbon Pulse",
        "url": "https://carbon-pulse.com/feed/",
        "lang": "en",
        "tier": 1,
    },
    # Tier 2: Google News RSS — 台灣永續
    {
        "name": "Google:永續ESG",
        "url": "https://news.google.com/rss/search?q=%E6%B0%B8%E7%BA%8C+ESG+%E7%A2%B3%E6%8E%92%E6%94%BE&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
        "lang": "zh",
        "tier": 2,
        "filter_keywords": ["永續", "ESG", "碳", "淨零", "減碳", "綠電", "CBAM", "碳費", "碳權"],
    },
    {
        "name": "Google:碳費碳權",
        "url": "https://news.google.com/rss/search?q=%E7%A2%B3%E8%B2%BB+%E7%A2%B3%E6%AC%8A+%E7%A2%B3%E4%BA%A4%E6%98%93&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
        "lang": "zh",
        "tier": 2,
        "filter_keywords": ["碳費", "碳權", "碳交易", "排放", "ETS", "CBAM"],
    },
    {
        "name": "Google:氣候淨零",
        "url": "https://news.google.com/rss/search?q=%E5%8F%B0%E7%81%A3+%E6%B0%A3%E5%80%99%E8%AE%8A%E9%81%B7+%E6%B7%A8%E9%9B%B6&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
        "lang": "zh",
        "tier": 2,
        "filter_keywords": ["氣候", "淨零", "減碳", "再生能源", "碳中和"],
    },
]

# 系列主題對應（用於反向連結到 EP）
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

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("/var/log/ai-hub/sustainability-news.log"),
    ],
)
log = logging.getLogger("s100-news")


# ============================================================
# 狀態管理
# ============================================================

def load_state() -> dict:
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"processed": []}


def save_state(state: dict):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def article_id(url: str) -> str:
    return hashlib.md5(url.encode()).hexdigest()[:12]


# ============================================================
# RSS 抓取
# ============================================================

def fetch_rss_articles() -> list[dict]:
    """從所有 RSS 來源抓取最新文章。"""
    articles = []
    client = httpx.Client(timeout=15, follow_redirects=True)

    for source in RSS_SOURCES:
        try:
            log.info(f"抓取 RSS: {source['name']}")
            resp = client.get(source["url"], headers={
                "User-Agent": "S100-News-Bot/1.0"
            })
            feed = feedparser.parse(resp.text)

            for entry in feed.entries[:10]:
                title = entry.get("title", "").strip()
                link = entry.get("link", "").strip()
                summary = entry.get("summary", "").strip()
                published = entry.get("published", "")

                if not title or not link:
                    continue

                # 關鍵字過濾
                if "filter_keywords" in source:
                    text = f"{title} {summary}".lower()
                    if not any(kw.lower() in text for kw in source["filter_keywords"]):
                        continue

                # 清理 HTML
                summary = re.sub(r"<[^>]+>", "", summary)
                summary = summary[:300]

                articles.append({
                    "title": title,
                    "link": link,
                    "summary": summary,
                    "published": published,
                    "source_name": source["name"],
                    "lang": source["lang"],
                    "tier": source["tier"],
                    "id": article_id(link),
                })
        except Exception as e:
            log.warning(f"RSS 抓取失敗 ({source['name']}): {e}")

    client.close()

    # Tier 1 優先
    articles.sort(key=lambda a: a["tier"])
    return articles


# ============================================================
# 網頁內容抓取
# ============================================================

def fetch_article_content(url: str) -> str:
    """透過 AI Hub web_fetch 抓取文章全文。"""
    try:
        resp = httpx.post(
            f"{AI_HUB_BASE}/api/web/fetch",
            json={"url": url, "level": "http"},
            timeout=30,
        )
        data = resp.json()
        if data.get("success"):
            return (data.get("content", "") or data.get("message", ""))[:2000]
    except Exception as e:
        log.warning(f"網頁抓取失敗 ({url}): {e}")
    return ""


# ============================================================
# LLM 分析
# ============================================================

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
如果文章是**商業促銷**（例如：限時免費、限時優惠、免費下載、課程促銷、產品折扣、抽獎活動），relevance_score 必須給 3 以下。

文章標題: {article['title']}
來源: {article['source_name']}
原始摘要: {article['summary']}
完整內容（節錄）: {content[:1500]}

請以 JSON 格式回覆（不要加 markdown code block）:
{{
  "title_zh": "繁體中文標題（15-25字，吸引人）",
  "summary": "一段話摘要（50-80字，白話說明重點）",
  "body": "正文（200-400字，白話解說這個新聞的重點、為什麼重要、對台灣企業的影響。分2-3段。）",
  "tags": ["標籤1", "標籤2", "標籤3"],
  "related_series": ["S1", "S4"],
  "related_episodes": ["EP007", "EP031"],
  "image_prompt": "圖片場景描述（英文，30字內，必須根據這篇文章的獨特內容設計具體場景，禁止使用 carbon trading floor 等通用場景。每篇文章的場景必須不同。）",
  "image_title_zh": "圖片上顯示的繁體中文大標題（8-12字，簡潔有力）",
  "relevance_score": 8
}}

系列主題對照:
{series_desc}

注意:
- related_series: 選 1-3 個最相關的系列
- related_episodes: 選 1-3 個最精確對應的集數 ID
- relevance_score: 1-10，這則新聞與永續/ESG 學習的相關程度
- 如果是英文文章，標題和正文請翻譯成繁體中文
- 只回 JSON，不要加任何其他文字
"""

    try:
        resp = httpx.post(
            f"{AI_HUB_BASE}/api/llm/chat",
            json={"prompt": prompt, "provider": "auto"},
            timeout=120,
        )
        data = resp.json()
        if data.get("success"):
            text = data.get("content", "") or data.get("message", "")
            text = re.sub(r"^```json?\s*", "", text.strip())
            text = re.sub(r"\s*```$", "", text.strip())
            return json.loads(text)
    except json.JSONDecodeError as e:
        log.warning(f"LLM JSON 解析失敗: {e}")
    except Exception as e:
        log.warning(f"LLM 分析失敗: {e}")
    return None


# ============================================================
# 圖片生成
# ============================================================

def generate_image(prompt: str, title_zh: str, filename: str) -> bool:
    """生成 text-free 寬屏背景圖，再用 PIL 疊加繁體中文標題。"""
    full_prompt = (
        f"A professional sustainability news background image. "
        f"1376x768 widescreen 16:9 landscape aspect ratio, cinematic, "
        f"The scene depicts {prompt} with cinematic lighting and rich color grading "
        f"in dark green-to-teal tones (#1b4332 to #2d6a4f). "
        f"The overall aesthetic resembles an editorial news magazine cover with shallow depth of field. "
        f"no text, no chinese characters, no watermarks, no logos."
    )

    for attempt in range(3):
        try:
            if attempt > 0:
                wait = 30 * attempt
                log.info(f"  圖片重試 {attempt + 1}/3（等待 {wait}s）")
                time.sleep(wait)

            resp = httpx.post(
                f"{IMAGE_API_BASE}/api/image/generate",
                json={"prompt": full_prompt, "timeout": 180, "model": IMAGE_API_MODEL},
                timeout=200,
            )
            # 503: distinguish quota exhaustion vs transient errors
            if resp.status_code == 503:
                detail = resp.json().get("detail", "")
                if "quota" in detail.lower() and "exhausted" in detail.lower():
                    log.warning(f"Image model quota exhausted: {detail}")
                    return False
                # Transient error (timeout, tab crash) — retry
                log.warning(f"  圖片暫時失敗 ({attempt + 1}/3): {detail}")
                continue
            data = resp.json()
            if data.get("success") and data.get("image_base64"):
                img_data = base64.b64decode(data["image_base64"])
                final_img = add_title_overlay(img_data, title_zh)
                os.makedirs(NEWS_IMG_DIR, exist_ok=True)
                img_path = os.path.join(NEWS_IMG_DIR, filename)
                final_img.save(img_path, "PNG", optimize=True)
                file_size = os.path.getsize(img_path)
                log.info(f"圖片生成: {filename} ({file_size} bytes, {IMAGE_API_MODEL} + PIL overlay)")
                return True

            status = resp.status_code
            log.warning(f"  圖片生成失敗 (HTTP {status}): {data.get('message', '')}")
        except Exception as e:
            log.warning(f"  圖片生成異常: {e}")

    log.warning(f"  圖片生成放棄（3 次失敗）")
    return False


def add_title_overlay(img_data: bytes, title: str) -> Image.Image:
    """PIL 疊加中文標題到 1376x768 圖片底部。"""
    from io import BytesIO
    img = Image.open(BytesIO(img_data)).convert("RGBA")
    img = _fit_widescreen(img)

    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    bar_h = TITLE_BAR_HEIGHT
    for i in range(bar_h):
        alpha = int(220 * (i / bar_h))
        y = img.height - bar_h + i
        draw.rectangle([(0, y), (img.width, y)], fill=(0, 0, 0, alpha))

    font = ImageFont.truetype(FONT_PATH, TITLE_FONT_SIZE)
    lines = _wrap_title(title, font, img.width - TITLE_HORIZONTAL_PADDING)

    block_h = TITLE_FONT_SIZE + (len(lines) - 1) * TITLE_LINE_SPACING
    y_start = img.height - bar_h + (bar_h - block_h) // 2
    for i, line in enumerate(lines):
        bbox = draw.textbbox((0, 0), line, font=font)
        tw = bbox[2] - bbox[0]
        x = (img.width - tw) // 2
        y = y_start + i * TITLE_LINE_SPACING
        draw.text((x + 4, y + 4), line, fill=(0, 0, 0, 200), font=font)
        draw.text((x, y), line, fill=(255, 255, 255, 240), font=font)

    return Image.alpha_composite(img, overlay).convert("RGB")


def _fit_widescreen(img: Image.Image) -> Image.Image:
    """Resize/crop to 1376x768 without forcing a square image."""
    target_w, target_h = TITLE_IMAGE_SIZE
    if img.size == TITLE_IMAGE_SIZE:
        return img

    src_w, src_h = img.size
    scale = max(target_w / src_w, target_h / src_h)
    new_w = int(src_w * scale + 0.5)
    new_h = int(src_h * scale + 0.5)
    resized = img.resize((new_w, new_h), Image.LANCZOS)

    left = max(0, (new_w - target_w) // 2)
    top = max(0, (new_h - target_h) // 2)
    return resized.crop((left, top, left + target_w, top + target_h))


def _wrap_title(title: str, font, max_width: int) -> list[str]:
    """智慧換行：在標點或空格處斷行。"""
    if _text_width(title, font) <= max_width:
        return [title]

    break_chars = " ，、的了是在與：，；！？，"
    mid = len(title) // 2
    best = mid
    for offset in range(len(title) // 2):
        for pos in [mid + offset, mid - offset]:
            if 0 <= pos < len(title) and title[pos] in break_chars:
                best = pos + 1
                break
        else:
            continue
        break

    line1 = title[:best].rstrip()
    line2 = title[best:].lstrip()
    if not line2:
        line1 = title[:mid]
        line2 = title[mid:]

    return [line1, line2]


def _text_width(text: str, font) -> int:
    bbox = font.getbbox(text)
    return bbox[2] - bbox[0]


# ============================================================
# Jekyll Post 產出
# ============================================================

def create_post(article: dict, analysis: dict, has_image: bool) -> str:
    """產出 Jekyll _posts markdown 文件。"""
    today = datetime.date.today()
    filename = f"{today.isoformat()}-{article['id']}.md"
    img_filename = f"{today.isoformat()}-{article['id']}.png"

    related_series = analysis.get("related_series", [])
    related_eps = analysis.get("related_episodes", [])
    tags = analysis.get("tags", [])

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

    # Escape quotes in title and summary
    title_safe = analysis["title_zh"].replace('"', '\\"')
    summary_safe = analysis["summary"].replace('"', '\\"')

    post_content = f"""---
title: "{title_safe}"
date: {today.isoformat()}
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

    log.info(f"文章產出: {filename}")
    return filename


# ============================================================
# Git + TG
# ============================================================

def git_commit_and_push(files: list[str]) -> bool:
    """Git commit 並 push。"""
    try:
        os.chdir(REPO_DIR)
        subprocess.run(["git", "add", "-A"], check=True, capture_output=True)
        today = datetime.date.today().isoformat()
        msg = f"news: 永續動態更新 {today}"
        subprocess.run(["git", "commit", "-m", msg], check=True, capture_output=True)
        subprocess.run(["git", "pull", "--rebase"], check=True, capture_output=True, timeout=120)
        subprocess.run(
            ["git", "push", "origin", "main"],
            check=True, capture_output=True, timeout=120,
        )
        log.info("Git push 完成")
        return True
    except subprocess.CalledProcessError as e:
        log.warning(f"Git 操作失敗: {e}")
    except subprocess.TimeoutExpired:
        log.warning("Git push timeout")
    return False


def send_tg(message: str):
    """發送 TG 通知。"""
    try:
        httpx.post(
            f"https://api.telegram.org/bot{TG_BOT_TOKEN}/sendMessage",
            json={
                "chat_id": TG_CHAT_ID,
                "text": message,
                "parse_mode": "HTML",
                "disable_web_page_preview": False,
            },
            timeout=10,
        )
    except Exception as e:
        log.warning(f"TG 發送失敗: {e}")


# ============================================================
# 主流程
# ============================================================

def run_pipeline(dry_run=False, no_image=False, no_push=False):
    log.info("=" * 50)
    log.info("永續100講 — 新聞 Pipeline 開始")
    log.info("=" * 50)

    # Warmup: fast image generate to warm Chrome/Gemini
    if not dry_run:
        try:
            log.info("Warmup: 暖機 Chrome/Gemini (fast image)...")
            wr = httpx.post(
                f"{IMAGE_API_BASE}/api/image/generate",
                json={"prompt": "A simple green gradient background", "model": "fast", "timeout": 90},
                timeout=120,
            )
            if wr.status_code == 200 and wr.json().get("success"):
                log.info(f"Warmup: OK ({wr.json().get('generation_time', 0):.1f}s)")
            else:
                log.warning("Warmup: 失敗，繼續執行 pipeline")
        except Exception as e:
            log.warning(f"Warmup: {e}")

    state = load_state()
    processed_ids = set(state.get("processed", []))
    log.info(f"已處理: {len(processed_ids)} 篇")

    # 1. 抓取 RSS
    articles = fetch_rss_articles()
    log.info(f"RSS 共 {len(articles)} 篇")

    # 2. 過濾已處理
    new_articles = [a for a in articles if a["id"] not in processed_ids]
    log.info(f"新文章: {len(new_articles)} 篇")

    if not new_articles:
        log.info("沒有新文章")
        return

    # 3. 處理 batch
    batch = new_articles[:MAX_ARTICLES_PER_RUN]
    created_files = []
    created_posts = []

    for i, article in enumerate(batch, 1):
        log.info(f"\n--- [{i}/{len(batch)}] {article['title'][:60]} ---")

        if dry_run:
            log.info("  [DRY RUN] 跳過")
            state.setdefault("processed", []).append(article["id"])
            continue

        # 排除促銷型內容（節省 LLM 呼叫）
        promo_kw = ["限時免費", "限時優惠", "免費下載", "限免", "特價", "折扣", "促銷", "抽獎"]
        title_text = article["title"]
        if any(kw in title_text for kw in promo_kw):
            log.info(f"  促銷型內容，跳過: {title_text[:30]}")
            state.setdefault("processed", []).append(article["id"])
            save_state(state)
            continue

        # 抓全文
        content = fetch_article_content(article["link"])
        log.info(f"  內容: {len(content)} 字")

        # LLM 分析
        analysis = analyze_article(article, content)
        if not analysis:
            log.warning("  LLM 分析失敗，跳過")
            continue

        score = analysis.get("relevance_score", 0)
        if score < 7:
            log.info(f"  相關度太低 ({score}/10)，跳過")
            state.setdefault("processed", []).append(article["id"])
            save_state(state)
            continue

        log.info(f"  標題: {analysis['title_zh']}")
        log.info(f"  相關度: {score}/10, 系列: {analysis.get('related_series', [])}")

        # 生成圖片
        has_image = False
        img_filename = f"{datetime.date.today().isoformat()}-{article['id']}.png"
        if not no_image and analysis.get("image_prompt"):
            title_zh = analysis.get("image_title_zh", analysis["title_zh"][:12])
            has_image = generate_image(analysis["image_prompt"], title_zh, img_filename)
            if has_image:
                created_files.append(os.path.join("assets", "images", "news", img_filename))

        # 產出 post
        post_filename = create_post(article, analysis, has_image)
        created_files.append(os.path.join("_posts", post_filename))
        created_posts.append(analysis)

        state.setdefault("processed", []).append(article["id"])
        save_state(state)

        time.sleep(2)

    save_state(state)

    # 4. Git push
    pushed = False
    if created_files and not dry_run and not no_push:
        pushed = git_commit_and_push(created_files)

    # 5. TG 通知 — 發送網站連結
    if created_posts and not dry_run:
        today = datetime.date.today().strftime("%Y-%m-%d")
        news_url = f"{SITE_URL}/news/"

        lines = [f"<b>\U0001F33F 永續動態 {today}</b>\n"]
        for p in created_posts:
            title = p["title_zh"]
            tags = " ".join(f"#{t}" for t in p.get("tags", [])[:3])
            lines.append(f"\u2022 <b>{title}</b>\n  {p['summary']}\n  {tags}\n")

        lines.append(f'\U0001F517 <a href="{news_url}">查看完整報導</a>')
        send_tg("\n".join(lines))
        log.info("TG 通知已發送")

    log.info(f"\n完成！產出 {len(created_files)} 個檔案")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="永續100講新聞 Pipeline")
    parser.add_argument("--dry-run", action="store_true", help="只抓取不處理")
    parser.add_argument("--no-image", action="store_true", help="跳過圖片生成")
    parser.add_argument("--no-push", action="store_true", help="不 git push")
    parser.add_argument("--max", type=int, default=MAX_ARTICLES_PER_RUN)
    args = parser.parse_args()

    MAX_ARTICLES_PER_RUN = args.max
    run_pipeline(dry_run=args.dry_run, no_image=args.no_image, no_push=args.no_push)
