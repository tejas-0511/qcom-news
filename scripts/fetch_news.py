#!/usr/bin/env python3
"""
News Engine - Daily fetch script
Pulls RSS feeds, filters for relevance, deduplicates, and writes articles.json
"""

import gzip
import json
import os
import re
import hashlib
import logging
import time
from datetime import datetime, timezone, timedelta
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
from xml.etree import ElementTree as ET
from html import unescape

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(ROOT_DIR, "data")

TOPICS_FILE = os.path.join(DATA_DIR, "topics.json")
SOURCES_FILE = os.path.join(DATA_DIR, "sources.json")
OUTPUT_FILE = os.path.join(DATA_DIR, "articles.json")


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def clean_html(text):
    """Strip HTML tags and decode entities."""
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:400] if len(text) > 400 else text


def parse_date(date_str):
    """Parse various date formats, return ISO string or None."""
    if not date_str:
        return None
    formats = [
        "%a, %d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M:%S GMT",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%SZ",
        "%a, %d %b %Y %H:%M:%S +0000",
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(date_str.strip(), fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.isoformat()
        except ValueError:
            continue
    return datetime.now(timezone.utc).isoformat()


USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
]

_ua_index = 0

def next_user_agent():
    global _ua_index
    ua = USER_AGENTS[_ua_index % len(USER_AGENTS)]
    _ua_index += 1
    return ua


def fetch_feed(url, source_name, timeout=15):
    """Fetch and parse a single RSS feed. Returns list of raw article dicts."""
    headers = {
        "User-Agent": next_user_agent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
        "Accept-Encoding": "gzip, deflate",
        "Connection": "keep-alive",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    }
    try:
        req = Request(url, headers=headers)
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            content_encoding = resp.headers.get("Content-Encoding", "")
        # Decompress if gzip (urlopen doesn't auto-decompress when we set Accept-Encoding)
        if content_encoding == "gzip" or raw[:2] == b"\x1f\x8b":
            try:
                raw = gzip.decompress(raw)
            except Exception:
                pass
        root = ET.fromstring(raw)
    except HTTPError as e:
        log.warning(f"HTTP {e.code} fetching {url}")
        return []
    except URLError as e:
        log.warning(f"URL error fetching {url}: {e.reason}")
        return []
    except ET.ParseError as e:
        log.warning(f"XML parse error for {url}: {e}")
        return []
    except Exception as e:
        log.warning(f"Unexpected error fetching {url}: {e}")
        return []

    # Handle both RSS and Atom
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    items = root.findall(".//item") or root.findall(".//atom:entry", ns)

    articles = []
    for item in items:
        def get(tag, attr=None):
            el = item.find(tag) or item.find(f"atom:{tag}", ns)
            if el is None:
                return ""
            if attr:
                return el.get(attr, "")
            return (el.text or "").strip()

        def get_link():
            # Standard RSS: <link> is unusual — its text is stored as the .tail
            # of the previous sibling, or as .text if the parser handles it.
            # Try multiple strategies in order.
            
            # 1. Atom-style <link href="...">
            atom_link = item.find("atom:link", ns)
            if atom_link is not None:
                href = atom_link.get("href", "").strip()
                if href.startswith("http"):
                    return href

            # 2. <link> element with text (some parsers)
            link_el = item.find("link")
            if link_el is not None:
                if link_el.text and link_el.text.strip().startswith("http"):
                    return link_el.text.strip()
                # 3. <link> tail text (standard RSS quirk in ElementTree)
                if link_el.tail and link_el.tail.strip().startswith("http"):
                    return link_el.tail.strip()

            # 4. <guid> often contains the article URL in Indian RSS feeds
            guid_el = item.find("guid")
            if guid_el is not None:
                guid = (guid_el.text or "").strip()
                if guid.startswith("http") and "?" not in guid:
                    return guid

            return ""

        title = clean_html(get("title"))
        raw_link = get_link()
        link = clean_url(raw_link)
        pub_date = get("pubDate") or get("published") or get("updated")
        summary_raw = get("description") or get("summary") or get("content")
        summary = clean_html(summary_raw)

        if not title or not link:
            continue

        articles.append({
            "title": title,
            "url": link,
            "source": source_name,
            "published_at": parse_date(pub_date),
            "summary": summary,
        })

    log.info(f"  {source_name}: fetched {len(articles)} items from {url}")
    return articles


def clean_url(url):
    """Strip known tracking wrappers and validate the URL looks like an article."""
    from urllib.parse import urlparse
    if not url:
        return ""
    url = url.strip()

    # Unwrap feedburner redirects — they resolve to homepage, not article
    if "feedburner.com/~r/" in url or "feedproxy.google.com" in url:
        return ""

    # Strip common tracking query params but keep the base URL
    if "?" in url:
        base = url.split("?")[0]
        parsed_base = urlparse(base)
        segments = [s for s in parsed_base.path.split("/") if s]
        if len(segments) >= 1:  # has at least one path segment
            url = base

    if not url.startswith("http"):
        return ""

    # Reject bare domains / homepages (no meaningful path)
    parsed = urlparse(url)
    segments = [s for s in parsed.path.split("/") if s]
    if len(segments) < 1:
        return ""

    return url



    """Create dedup key from URL and normalised title."""
    url_key = article["url"].split("?")[0].rstrip("/")
    title_key = re.sub(r"\W+", "", article["title"].lower())[:60]
    return hashlib.md5(f"{url_key}|{title_key}".encode()).hexdigest()


def tag_topics(article, topics):
    """Return list of topic IDs that match this article."""
    text = (article["title"] + " " + article["summary"]).lower()
    matched = []
    for topic in topics:
        for kw in topic["keywords"]:
            if kw.lower() in text:
                matched.append(topic["id"])
                break
    return matched


def is_recent(article, max_age_days):
    """Return True if article is within max_age_days."""
    pub = article.get("published_at")
    if not pub:
        return True
    try:
        dt = datetime.fromisoformat(pub)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
        return dt >= cutoff
    except Exception:
        return True


def load_fallback():
    """Return sample articles so the site never looks empty."""
    now = datetime.now(timezone.utc).isoformat()
    return [
        {
            "id": "fallback-1",
            "title": "Blinkit crosses 1,000 dark stores milestone across India",
            "url": "https://inc42.com/",
            "source": "Inc42",
            "published_at": now,
            "summary": "Blinkit, the Zomato-owned quick commerce platform, has crossed the 1,000 dark store mark, cementing its lead in the hyperlocal grocery delivery segment.",
            "topics": ["quick_commerce"],
            "is_fallback": True
        },
        {
            "id": "fallback-2",
            "title": "Swiggy Instamart doubles down on private label strategy amid margin pressure",
            "url": "https://entrackr.com/",
            "source": "Entrackr",
            "published_at": now,
            "summary": "Swiggy Instamart is expanding its private label portfolio to improve unit economics as the quick commerce battle intensifies across metro cities.",
            "topics": ["quick_commerce", "fmcg"],
            "is_fallback": True
        },
        {
            "id": "fallback-3",
            "title": "Zepto raises fresh capital to accelerate dark store expansion in Tier 2 cities",
            "url": "https://yourstory.com/",
            "source": "YourStory",
            "published_at": now,
            "summary": "Zepto is deploying capital into Tier 2 city expansion, with new dark stores planned in Jaipur, Lucknow, and Indore over the next two quarters.",
            "topics": ["quick_commerce", "funding"],
            "is_fallback": True
        },
        {
            "id": "fallback-4",
            "title": "Meesho overtakes Flipkart in monthly active users; hits 150 million mark",
            "url": "https://economictimes.indiatimes.com/",
            "source": "Economic Times",
            "published_at": now,
            "summary": "Meesho has overtaken Flipkart in monthly active users for the first time, driven by its value-first strategy and deep penetration in non-metro markets.",
            "topics": ["ecommerce"],
            "is_fallback": True
        },
        {
            "id": "fallback-5",
            "title": "HUL reports strong QCom contribution as quick commerce now 8% of overall ecommerce revenue",
            "url": "https://www.livemint.com/",
            "source": "Mint",
            "published_at": now,
            "summary": "Hindustan Unilever's quick commerce channel contribution has surged, with platforms like Blinkit and Zepto now accounting for nearly 8% of the company's total ecommerce revenue.",
            "topics": ["quick_commerce", "fmcg"],
            "is_fallback": True
        },
        {
            "id": "fallback-6",
            "title": "Retail media ad spend in India expected to cross ₹4,000 crore in FY26",
            "url": "https://www.financialexpress.com/",
            "source": "Financial Express",
            "published_at": now,
            "summary": "India's retail media market is on an exponential growth curve, with brands allocating larger slices of digital budgets to in-platform advertising on Flipkart, Blinkit, and Amazon.",
            "topics": ["ecommerce", "retail_tech"],
            "is_fallback": True
        }
    ]


def main():
    topics_cfg = load_json(TOPICS_FILE)
    sources_cfg = load_json(SOURCES_FILE)

    topics = topics_cfg["topics"]
    feeds = [f for f in sources_cfg["feeds"] if f.get("active", True)]
    settings = sources_cfg["settings"]

    max_articles = settings.get("max_articles", 150)
    max_age_days = settings.get("max_age_days", 7)
    timeout = settings.get("fetch_timeout_seconds", 15)

    all_articles = []
    seen = set()

    for i, feed in enumerate(feeds):
        if i > 0:
            time.sleep(1)  # be polite — avoid rate limits
        raw = fetch_feed(feed["url"], feed["source"], timeout=timeout)
        for art in raw:
            fp = fingerprint(art)
            if fp in seen:
                continue
            if not is_recent(art, max_age_days):
                continue
            topics_matched = tag_topics(art, topics)
            if not topics_matched:
                continue
            seen.add(fp)
            art["id"] = fp
            art["topics"] = topics_matched
            art["is_fallback"] = False
            all_articles.append(art)

    log.info(f"Total relevant articles after filtering: {len(all_articles)}")

    # Sort newest first
    def sort_key(a):
        pub = a.get("published_at") or ""
        return pub

    all_articles.sort(key=sort_key, reverse=True)

    # Trim to limit
    all_articles = all_articles[:max_articles]

    # If no articles fetched, use fallback
    if not all_articles:
        log.warning("No articles fetched — using fallback sample data")
        all_articles = load_fallback()

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total": len(all_articles),
        "articles": all_articles
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    log.info(f"Written {len(all_articles)} articles to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
