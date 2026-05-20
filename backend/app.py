from flask import Flask, request, jsonify
from flask_cors import CORS
import html
import os
import pickle
import re
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus, urlparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

import numpy as np

app = Flask(__name__)
CORS(app)

current_dir = os.path.dirname(os.path.abspath(__file__))
model_path = os.path.join(current_dir, "model", "model.pkl")
vectorizer_path = os.path.join(current_dir, "model", "vectorizer.pkl")

model = None
vectorizer = None

STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "been", "being", "by", "for",
    "from", "has", "have", "he", "in", "is", "it", "its", "of", "on", "or",
    "she", "that", "the", "their", "this", "to", "was", "were", "will", "with",
    "about", "after", "all", "also", "am", "any", "because", "before", "can",
    "did", "do", "does", "had", "her", "hers", "him", "his", "if", "into",
    "just", "more", "most", "new", "not", "now", "our", "out", "over", "said",
    "say", "says", "than", "them", "they", "too", "under", "up", "we", "what",
    "when", "where", "which", "who", "why", "you", "your"
}

SUPPORT_CUES = {
    "confirmed", "confirms", "verified", "officially confirmed", "announced",
    "announcement", "shows", "showed", "found", "finds", "data shows",
    "evidence shows", "study finds", "official data", "according to officials",
    "collected", "collects", "collecting", "returned", "landed", "launched",
    "approved", "published", "released", "issued", "opened", "reported"
}

OPPOSE_CUES = {
    "false", "fake", "debunked", "debunks", "debunk", "misleading", "denies",
    "deny", "denied", "refutes", "refuted", "no evidence", "hoax", "untrue",
    "incorrect", "wrong", "baseless", "fabricated", "not true", "not real",
    "falsely claims", "false claim", "fake news", "old video", "altered video",
    "ai-generated", "does not show", "no proof", "rumor", "rumour", "satire",
    "misrepresented", "out of context", "missing context", "misleading claim",
    "no cure", "won't cure", "wont cure", "doesn't cure", "does not cure",
    "doesn't kill", "does not kill", "deadly", "poisoning", "conspiracy theorists",
    "poses serious risks", "serious risks"
}

FACT_CHECK_CUES = {
    "fact check", "fact-check", "factcheck", "claim", "viral claim", "social media post",
    "posts claim", "online claim", "rumor", "rumour", "hoax", "debunk"
}

FAKE_CLAIM_CUES = {
    "miracle cure", "cures all", "guarantees", "secret documents reveal",
    "doctors hate", "scientists are hiding", "aliens", "reptilian", "shape-shifting",
    "moon is made", "flat earth", "bleach cures", "vaccine contains microchips",
    "5g causes", "government is hiding", "mainstream media won't tell you",
    "one weird trick", "instant cure", "100% guaranteed"
}

LANGUAGES = {
    "en": {"hl": "en-IN", "ceid": "IN:en", "label": "English"},
    "hi": {"hl": "hi-IN", "ceid": "IN:hi", "label": "Hindi"},
    "bn": {"hl": "bn-IN", "ceid": "IN:bn", "label": "Bengali"},
    "ta": {"hl": "ta-IN", "ceid": "IN:ta", "label": "Tamil"},
    "te": {"hl": "te-IN", "ceid": "IN:te", "label": "Telugu"},
}

RECENCY_WINDOWS = {
    "day": 1,
    "week": 7,
    "month": 30,
    "quarter": 90,
    "all": None,
}

HIGH_CREDIBILITY_SOURCES = {
    "reuters": 1.0,
    "associated press": 0.99,
    "ap news": 0.99,
    "bbc": 0.97,
    "bbc news": 0.97,
    "the guardian": 0.95,
    "financial times": 0.95,
    "wall street journal": 0.95,
    "the new york times": 0.94,
    "washington post": 0.94,
    "npr": 0.92,
    "pbs": 0.92,
    "bloomberg": 0.93,
    "cnn": 0.9,
    "abc news": 0.9,
    "cbs news": 0.9,
    "nbc news": 0.9,
    "al jazeera": 0.9,
    "usa today": 0.88,
    "hindustan times": 0.86,
    "the hindu": 0.89,
    "indian express": 0.88,
    "times of india": 0.84,
    "ndtv": 0.85,
}

ANALYSIS_CACHE = {}
CONTACT_MESSAGES = []
CACHE_TTL_SECONDS = 900
MAX_ARTICLE_BODY_CHARS = 3200
MAX_EXTRACTED_URL_CHARS = 9000
MIN_RELEVANT_ARTICLE_SCORE = 24.0
OCR_UI_NOISE_TERMS = {
    "advertisement", "subscribe", "login", "sign in", "menu", "share", "comment",
    "comments", "read more", "follow us", "watch", "video", "cookie", "privacy",
    "terms", "newsletter", "download app", "home", "latest news", "related news",
}


def load_models():
    global model, vectorizer
    try:
        with open(model_path, "rb") as model_file:
            model = pickle.load(model_file)
        with open(vectorizer_path, "rb") as vectorizer_file:
            vectorizer = pickle.load(vectorizer_file)
        print("Models loaded successfully.")
    except Exception as exc:
        print(f"Warning: model fallback unavailable: {exc}")


load_models()


def normalize_whitespace(value):
    return re.sub(r"\s+", " ", value or "").strip()


def tokenize(text):
    return [
        token for token in re.findall(r"[a-zA-Z0-9']+", (text or "").lower())
        if token not in STOP_WORDS and len(token) > 2
    ]


def strip_search_noise(text):
    cleaned = normalize_whitespace(text)
    cleaned = re.sub(r"https?://\S+|www\.\S+", " ", cleaned)
    cleaned = re.sub(r"\S+@\S+", " ", cleaned)
    cleaned = re.sub(r"(?i)\b(?:{})\b".format("|".join(re.escape(term) for term in OCR_UI_NOISE_TERMS)), " ", cleaned)
    return normalize_whitespace(cleaned)


def split_claim_candidates(text):
    cleaned = strip_search_noise(text)
    chunks = re.split(r"(?:\n+|(?<=[.!?])\s+|[•|]+)", cleaned)
    candidates = []

    for chunk in chunks:
        candidate = normalize_whitespace(chunk)
        tokens = tokenize(candidate)
        if len(tokens) < 4 or len(candidate) < 24:
            continue
        if len(candidate) > 240:
            candidate = normalize_whitespace(candidate[:240])

        lower_candidate = candidate.lower()
        noise_hits = sum(1 for term in OCR_UI_NOISE_TERMS if term in lower_candidate)
        cue_bonus = 0
        if re.search(r"\b(claims?|says?|shows?|confirms?|denies?|false|fake|viral|video|photo|report|study|official)\b", lower_candidate):
            cue_bonus += 4
        if re.search(r"\b\d{2,4}\b", candidate):
            cue_bonus += 1
        if re.search(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b", candidate):
            cue_bonus += 1

        score = len(set(tokens)) + cue_bonus - noise_hits * 3
        if score > 2:
            candidates.append((score, candidate))

    if not candidates and cleaned:
        fallback = normalize_whitespace(cleaned[:220])
        if fallback:
            candidates.append((1, fallback))

    ranked = []
    seen = set()
    for _, candidate in sorted(candidates, key=lambda item: item[0], reverse=True):
        normalized = re.sub(r"[^a-z0-9]+", "", candidate.lower())[:120]
        if normalized and normalized not in seen:
            seen.add(normalized)
            ranked.append(candidate)
    return ranked[:4]


def claim_focus_text(text):
    candidates = split_claim_candidates(text)
    if candidates:
        return normalize_whitespace(" ".join(candidates[:2]))
    return strip_search_noise(text)


def extract_claim_focus(text, max_terms=8):
    tokens = tokenize(text)
    if not tokens:
        return []
    counts = Counter(tokens)
    ranked = [token for token, _ in counts.most_common(max_terms)]
    return ranked


def build_search_queries(text):
    candidates = split_claim_candidates(text)
    primary_claim = candidates[0] if candidates else strip_search_noise(text)[:180]
    focus_text = claim_focus_text(text)
    focus_terms = extract_claim_focus(focus_text, max_terms=8)

    queries = []
    if primary_claim:
        queries.append(primary_claim[:180])
        queries.append(f'"{primary_claim[:120]}"')
        queries.append(f"{primary_claim[:150]} fact check")
    if len(candidates) > 1:
        queries.append(candidates[1][:160])
    if len(focus_terms) >= 4:
        precise_terms = " ".join(focus_terms[:6])
        queries.append(f"{precise_terms} latest news")
        queries.append(f"{precise_terms} false debunked")

    deduped = []
    seen = set()
    for query in queries:
        normalized = query.lower()
        if query and normalized not in seen:
            seen.add(normalized)
            deduped.append(query)
    return deduped[:5]


def recency_query_suffix(recency):
    days = RECENCY_WINDOWS.get(recency)
    if not days:
        return ""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    return f" after:{cutoff}"


def html_to_text(value):
    value = html.unescape(value or "")
    value = re.sub(r"<[^>]+>", " ", value)
    return normalize_whitespace(value)


def parse_published_at(value):
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def recency_weight(published_at):
    if published_at is None:
        return 0.78
    age_days = max((datetime.now(timezone.utc) - published_at).days, 0)
    if age_days <= 2:
        return 1.0
    if age_days <= 7:
        return 0.94
    if age_days <= 30:
        return 0.86
    if age_days <= 90:
        return 0.76
    return 0.66


def source_weight(source_name, link):
    source_name = (source_name or "").lower()
    for known_source, weight in HIGH_CREDIBILITY_SOURCES.items():
        if known_source in source_name:
            return weight

    hostname = (urlparse(link).hostname or "").lower().replace("www.", "")
    for known_source, weight in HIGH_CREDIBILITY_SOURCES.items():
        compact_name = known_source.replace(" ", "")
        compact_host = hostname.replace(".", "")
        if compact_name in compact_host:
            return weight
    return 0.72


def credibility_label(weight):
    if weight >= 0.92:
        return "High trust"
    if weight >= 0.84:
        return "Established"
    if weight >= 0.74:
        return "Standard"
    return "Needs review"


def cue_hits(text, cues):
    lowered = (text or "").lower()
    return [cue for cue in cues if cue in lowered]


def estimate_claim_risk(text, model_signal=None):
    lowered = normalize_whitespace(text).lower()
    reasons = cue_hits(lowered, FAKE_CLAIM_CUES)
    risk = min(0.65, len(reasons) * 0.18)

    if re.search(r"\b(cure|guarantee|secret|shocking|viral|anonymous source)\b", lowered):
        risk += 0.12
    if re.search(r"\b(all|every|always|never|100%)\b", lowered):
        risk += 0.08
    if model_signal and model_signal["label"].lower() == "fake":
        risk += min(0.35, model_signal["confidence"] / 250)

    return {
        "score": round(min(1.0, risk), 2),
        "reasons": reasons[:5],
    }


def fetch_google_news(query, language="en", recency="week", limit=8):
    language_config = LANGUAGES.get(language, LANGUAGES["en"])
    dated_query = f"{query}{recency_query_suffix(recency)}"
    rss_url = (
        "https://news.google.com/rss/search?q="
        f"{quote_plus(dated_query)}&hl={language_config['hl']}&gl=IN&ceid={language_config['ceid']}"
    )
    request = Request(
        rss_url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            )
        },
    )

    with urlopen(request, timeout=12) as response:
        xml_data = response.read()

    root = ET.fromstring(xml_data)
    items = []

    for item in root.findall("./channel/item")[:limit]:
        title = normalize_whitespace(item.findtext("title", default=""))
        link = normalize_whitespace(item.findtext("link", default=""))
        description = html_to_text(item.findtext("description", default=""))
        source_node = item.find("source")
        source_name = normalize_whitespace(source_node.text if source_node is not None else "")
        published_at = parse_published_at(item.findtext("pubDate", default=""))

        items.append(
            {
                "title": title,
                "link": link,
                "snippet": description,
                "source": source_name or (urlparse(link).hostname or "Unknown source"),
                "published_at": published_at,
            }
        )

    return items


def extract_title(raw_html):
    title_match = re.search(
        r'(?is)<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']',
        raw_html or "",
    )
    if not title_match:
        title_match = re.search(
            r'(?is)<meta[^>]+name=["\']twitter:title["\'][^>]+content=["\']([^"\']+)["\']',
            raw_html or "",
        )
    if title_match:
        return html_to_text(title_match.group(1))

    title_match = re.search(r"(?is)<title[^>]*>(.*?)</title>", raw_html or "")
    return html_to_text(title_match.group(1)) if title_match else ""


def extract_article_text(raw_html, max_chars=MAX_ARTICLE_BODY_CHARS):
    cleaned_html = re.sub(
        r"(?is)<(script|style|nav|footer|aside|header|noscript|svg).*?>.*?</\1>",
        " ",
        raw_html or "",
    )
    paragraphs = re.findall(r"(?is)<p[^>]*>(.*?)</p>", cleaned_html)
    text = " ".join(html_to_text(paragraph) for paragraph in paragraphs)

    if len(text) < 280:
        body_match = re.search(r"(?is)<body[^>]*>(.*?)</body>", cleaned_html)
        fallback_html = body_match.group(1) if body_match else cleaned_html
        text = html_to_text(fallback_html)

    return normalize_whitespace(text)[:max_chars]


def fetch_html(link, timeout=8, max_bytes=MAX_ARTICLE_BODY_CHARS * 4):
    if not link:
        return "", ""

    request = Request(
        link,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            )
        },
    )
    with urlopen(request, timeout=timeout) as response:
        content_type = response.headers.get("content-type", "")
        if "text/html" not in content_type:
            return "", content_type
        raw_html = response.read(max_bytes).decode("utf-8", errors="ignore")
        return raw_html, content_type


def fetch_article_text(link):
    try:
        raw_html, _ = fetch_html(link)
    except Exception:
        return ""

    return extract_article_text(raw_html)


def extract_url_content(link):
    parsed = urlparse(link or "")
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Enter a valid http or https URL.")

    raw_html, content_type = fetch_html(
        link,
        timeout=12,
        max_bytes=MAX_EXTRACTED_URL_CHARS * 4,
    )
    if not raw_html:
        raise ValueError(f"Unable to extract readable HTML from this URL ({content_type or 'unknown content type'}).")

    title = extract_title(raw_html)
    text = extract_article_text(raw_html, max_chars=MAX_EXTRACTED_URL_CHARS)
    if len(text) < 80:
        raise ValueError("Could not find enough readable article text on this URL.")

    hostname = parsed.hostname or "Unknown source"
    return {
        "url": link,
        "title": title or hostname,
        "source": hostname.replace("www.", ""),
        "text": text,
        "wordCount": len(text.split()),
    }


def dedupe_articles(articles, limit=12):
    deduped = []
    seen = set()
    for article in articles:
        key = (
            article["link"].lower(),
            re.sub(r"[^a-z0-9]+", "", article["title"].lower())[:120],
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(article)
        if len(deduped) >= limit:
            break
    return deduped


def classify_stance(claim_text, article, model_signal=None):
    focus_text = claim_focus_text(claim_text)
    claim_tokens = set(tokenize(focus_text))
    article_body = fetch_article_text(article["link"])
    title_snippet_text = f"{article['title']} {article['snippet']}"
    article_text = f"{title_snippet_text} {article_body}"
    title_snippet_tokens = set(tokenize(title_snippet_text))
    article_tokens = set(tokenize(article_text))
    overlap = len(claim_tokens & article_tokens)
    title_overlap = len(claim_tokens & title_snippet_tokens)
    minimum_overlap = 2 if len(claim_tokens) <= 6 else 3
    overlap_denominator = max(min(len(claim_tokens), 12), 1)
    title_denominator = max(min(len(claim_tokens), 8), 1)
    overlap_ratio = overlap / overlap_denominator
    title_overlap_ratio = title_overlap / title_denominator

    lower_article_text = article_text.lower()
    support_matches = cue_hits(lower_article_text, SUPPORT_CUES)
    oppose_matches = cue_hits(lower_article_text, OPPOSE_CUES)
    fact_check_matches = cue_hits(lower_article_text, FACT_CHECK_CUES)
    support_hits = len(support_matches)
    oppose_hits = len(oppose_matches)
    fact_check_hits = len(fact_check_matches)
    primary_claim = split_claim_candidates(claim_text)
    exact_target = normalize_whitespace(primary_claim[0] if primary_claim else focus_text).lower()[:90]
    exact_phrase_bonus = 0.18 if exact_target and exact_target in lower_article_text else 0.0
    fact_check_bonus = min(0.2, fact_check_hits * 0.06)

    relevance = min(
        1.0,
        title_overlap_ratio * 0.72
        + overlap_ratio * 0.42
        + (0.16 if overlap >= minimum_overlap else 0)
        + exact_phrase_bonus,
    )
    source_reliability = source_weight(article["source"], article["link"])
    freshness = recency_weight(article["published_at"])

    support_score = (
        relevance * 0.42
        + support_hits * 0.18
        + source_reliability * 0.06
        + freshness * 0.04
    )
    oppose_score = (
        relevance * 0.38
        + oppose_hits * 0.24
        + source_reliability * 0.06
        + freshness * 0.04
        + fact_check_bonus
    )

    if oppose_hits and support_hits:
        oppose_score += 0.08
    if fact_check_hits and oppose_hits:
        oppose_score += 0.18
    if fact_check_hits and not support_hits:
        oppose_score += 0.08

    has_support_basis = support_hits >= 1 or exact_phrase_bonus > 0
    has_oppose_basis = (
        (oppose_hits >= 1 and relevance >= 0.22 and overlap >= 2)
        or (fact_check_hits >= 1 and relevance >= 0.25 and overlap >= 3)
    )
    model_supports_claim = (
        model_signal
        and model_signal["label"].lower() == "real"
        and model_signal["confidence"] >= 52
    )

    has_topic_match = (
        exact_phrase_bonus > 0
        or title_overlap >= minimum_overlap
        or (overlap >= minimum_overlap + 1 and title_overlap >= 1)
    )

    if not has_topic_match or relevance * 100 < MIN_RELEVANT_ARTICLE_SCORE:
        stance = "unrelated"
        strength = round(relevance * 100, 1)
    elif has_oppose_basis and oppose_score - support_score > 0.02:
        stance = "oppose"
        strength = round(min(1.0, oppose_score) * 100, 1)
    elif (
        has_support_basis
        and not has_oppose_basis
        and (support_score - oppose_score > 0.04 or relevance >= 0.45)
    ):
        stance = "support"
        strength = round(min(1.0, max(support_score, relevance * 0.72)) * 100, 1)
    elif model_supports_claim and not has_oppose_basis and relevance >= 0.62 and overlap_ratio >= 0.65:
        stance = "support"
        strength = round(min(1.0, max(support_score, relevance * 0.62)) * 100, 1)
    else:
        stance = "mixed"
        strength = round(min(1.0, (support_score + oppose_score) / 2) * 100, 1)

    article["stance"] = stance
    article["strength"] = strength
    article["relevance"] = round(relevance * 100, 1)
    article["source_weight"] = round(source_reliability, 2)
    article["freshness_weight"] = round(freshness, 2)
    article["support_hits"] = int(support_hits)
    article["oppose_hits"] = int(oppose_hits)
    article["fact_check_hits"] = int(fact_check_hits)
    article["stance_reason"] = ", ".join((oppose_matches or support_matches or fact_check_matches)[:3])
    article["article_body_checked"] = bool(article_body)
    article["published_label"] = (
        article["published_at"].strftime("%d %b %Y") if article["published_at"] else "Date unavailable"
    )
    return article


def get_model_signal(text):
    if model is None or vectorizer is None:
        return None

    vectorized_text = vectorizer.transform([text])
    prediction = model.predict(vectorized_text)[0]
    probabilities = model.predict_proba(vectorized_text)[0]
    confidence = float(np.max(probabilities))
    return {
        "label": str(prediction),
        "confidence": round(confidence * 100, 2),
    }


def build_verdict_explanation(
    verdict,
    counts,
    support_weight,
    oppose_weight,
    mixed_weight,
    articles,
    model_signal,
    claim_risk,
):
    explanation = []
    relevant_count = counts.get("support", 0) + counts.get("oppose", 0) + counts.get("mixed", 0)
    fact_check_total = sum(article.get("fact_check_hits", 0) for article in articles)
    trusted_sources = sum(1 for article in articles if article.get("source_weight", 0) >= 0.84)

    if relevant_count:
        explanation.append(
            f"{relevant_count} relevant live sources were weighed: "
            f"{counts.get('support', 0)} support, {counts.get('oppose', 0)} oppose, "
            f"and {counts.get('mixed', 0)} need context."
        )
    else:
        explanation.append("Live search did not surface enough relevant coverage for a strong evidence-only verdict.")

    if support_weight > oppose_weight:
        explanation.append(
            f"Credibility-weighted evidence leans toward support "
            f"({support_weight:.2f} vs {oppose_weight:.2f})."
        )
    elif oppose_weight > support_weight:
        explanation.append(
            f"Credibility-weighted evidence leans against the claim "
            f"({oppose_weight:.2f} vs {support_weight:.2f})."
        )
    elif mixed_weight > 0:
        explanation.append("The strongest articles are mixed, so context matters more than a simple true/false label.")

    if trusted_sources:
        explanation.append(f"{trusted_sources} established or high-trust sources influenced the score.")

    if fact_check_total:
        explanation.append(f"Fact-check language appeared {fact_check_total} time(s) in the surfaced coverage.")

    if model_signal:
        explanation.append(
            f"The local classifier voted {model_signal['label']} with "
            f"{model_signal['confidence']:.1f}% confidence."
        )

    if claim_risk.get("score", 0) >= 0.35:
        explanation.append("The claim also contains wording patterns often seen in misinformation.")

    return explanation[:6]


def aggregate_analysis(claim_text, articles, model_signal):
    counts = Counter(article["stance"] for article in articles)
    claim_risk = estimate_claim_risk(claim_text, model_signal)

    support_weight = sum(
        article["source_weight"] * article["freshness_weight"] * (article["strength"] / 100)
        for article in articles
        if article["stance"] == "support"
    )
    oppose_weight = sum(
        article["source_weight"] * article["freshness_weight"] * (article["strength"] / 100)
        for article in articles
        if article["stance"] == "oppose"
    )
    mixed_weight = sum(
        article["source_weight"] * article["freshness_weight"] * (article["strength"] / 100)
        for article in articles
        if article["stance"] == "mixed"
    )

    evidence_total = support_weight + oppose_weight + mixed_weight
    if evidence_total <= 0:
        if model_signal and model_signal["label"].lower() == "fake":
            verdict = "Likely fake"
            confidence = round(max(55.0, model_signal["confidence"] * 0.82, claim_risk["score"] * 100), 1)
            summary = "Live coverage did not return enough relevant articles, and the fallback model flags the claim as likely fake."
        elif claim_risk["score"] >= 0.45:
            verdict = "Likely fake"
            confidence = round(max(52.0, claim_risk["score"] * 100), 1)
            summary = "Live coverage is thin, but the claim contains common misinformation patterns."
        else:
            verdict = "Insufficient live evidence"
            confidence = model_signal["confidence"] * 0.65 if model_signal else 32.0
            summary = "Live coverage did not return enough relevant articles, so the result leans on fallback analysis."
    else:
        balance = support_weight - oppose_weight
        certainty = min(0.96, abs(balance) / max(evidence_total, 0.01) + min(len(articles), 8) * 0.03)
        model_bonus = 0.0

        if model_signal:
            if model_signal["label"].lower() == "real" and balance > 0:
                model_bonus = 0.04
            elif model_signal["label"].lower() != "real" and balance < 0:
                model_bonus = 0.04

        if oppose_weight > support_weight and model_signal and model_signal["label"].lower() == "fake":
            model_bonus += 0.08
        if support_weight > oppose_weight and model_signal and model_signal["label"].lower() == "fake":
            model_bonus -= 0.08

        confidence = round(max(28.0, min(0.98, certainty + model_bonus) * 100), 1)

        if oppose_weight >= 0.45 and oppose_weight >= support_weight * 1.35:
            verdict = "False or debunked"
            summary = "Relevant fact-check or news coverage disputes the pasted claim."
        elif support_weight >= 0.8 and support_weight > oppose_weight * 1.8:
            verdict = "Verified"
            summary = "Recent credible reporting strongly supports the pasted claim."
        elif support_weight > 0 and oppose_weight == 0 and model_signal and model_signal["label"].lower() == "real":
            verdict = "Mostly true"
            summary = "Relevant coverage and the fallback model support the pasted claim, with no opposing sources found."
            confidence = max(confidence, min(82.0, 54.0 + support_weight * 18 + model_signal["confidence"] * 0.18))
        elif balance > 0.35:
            verdict = "Mostly true"
            summary = "Most credible sources align with the pasted claim, though manual review is still useful."
        elif balance < -0.2:
            verdict = "Unsupported"
            summary = "Credible coverage leans against the pasted claim or flags it as misleading."
        elif model_signal and model_signal["label"].lower() == "fake" and support_weight < 0.45:
            verdict = "Likely fake"
            summary = "Live evidence is weak, and the fallback model flags the claim as likely fake."
            confidence = max(58.0, confidence, round(model_signal["confidence"] * 0.85, 1))
        elif oppose_weight == 0 and mixed_weight > 0 and model_signal and model_signal["label"].lower() == "real":
            verdict = "Likely real, needs fresher sources"
            summary = "The fallback model reads this as real, but recent live coverage did not clearly verify the exact claim."
            confidence = max(confidence, min(62.0, 44.0 + model_signal["confidence"] * 0.22 + mixed_weight * 5))
        elif mixed_weight > max(support_weight, oppose_weight) * 0.75:
            verdict = "Mixed or context needed"
            summary = "Coverage exists, but the reporting is split or too nuanced for a clean verdict."
        else:
            verdict = "Not enough evidence"
            summary = "The evidence is too balanced or too weak to issue a strong verdict."

    credibility_scores = [article["source_weight"] for article in articles]
    average_credibility = (
        round((sum(credibility_scores) / len(credibility_scores)) * 100, 1)
        if credibility_scores
        else 0
    )
    trusted_sources = sum(1 for score in credibility_scores if score >= 0.84)
    explanation = build_verdict_explanation(
        verdict,
        counts,
        support_weight,
        oppose_weight,
        mixed_weight,
        articles,
        model_signal,
        claim_risk,
    )
    evidence_separation = (
        round(abs(support_weight - oppose_weight) / max(evidence_total, 0.01) * 100, 1)
        if evidence_total > 0
        else 0
    )
    source_volume_score = round(min(len(articles), 8) / 8 * 100, 1)
    model_alignment = 0
    if model_signal and evidence_total > 0:
        evidence_direction = "real" if support_weight >= oppose_weight else "fake"
        model_alignment = 100 if model_signal["label"].lower() == evidence_direction else 35
    elif model_signal:
        model_alignment = round(model_signal["confidence"], 1)

    score_breakdown = {
        "verdictConfidence": {
            "value": round(float(confidence), 1),
            "formula": "Evidence separation + relevant source volume + model agreement, capped and reduced when sources are thin.",
            "parts": [
                {
                    "label": "Evidence separation",
                    "value": evidence_separation,
                    "detail": "How clearly support evidence outweighs opposing evidence, or the reverse.",
                },
                {
                    "label": "Relevant source volume",
                    "value": source_volume_score,
                    "detail": f"{len(articles)} relevant sources passed the topic-match filter.",
                },
                {
                    "label": "Model agreement",
                    "value": model_alignment,
                    "detail": "Whether the fallback classifier agrees with the live evidence direction.",
                },
            ],
        },
        "sourceCredibility": {
            "value": average_credibility,
            "formula": "Average credibility weight of relevant sources that passed the topic-match filter.",
            "parts": [
                {
                    "label": "Trusted sources",
                    "value": trusted_sources,
                    "detail": "Sources matching the high-trust or established source list.",
                },
                {
                    "label": "Relevant sources",
                    "value": len(articles),
                    "detail": "Unrelated Google News results are excluded before this average is calculated.",
                },
            ],
        },
        "fakeRisk": {
            "value": round(claim_risk["score"] * 100, 1),
            "formula": "Local classifier fake vote + misinformation cue phrases + absolute wording such as always, never, or 100%.",
            "parts": [
                {
                    "label": "Risk cues",
                    "value": len(claim_risk.get("reasons", [])),
                    "detail": ", ".join(claim_risk.get("reasons", [])) or "No strong cue phrase found.",
                },
                {
                    "label": "Classifier contribution",
                    "value": round(model_signal["confidence"], 1) if model_signal else 0,
                    "detail": model_signal["label"] if model_signal else "Fallback classifier unavailable.",
                },
            ],
        },
    }

    top_sources = [
        {
            "title": article["title"],
            "source": article["source"],
            "link": article["link"],
            "snippet": article["snippet"],
            "stance": article["stance"],
            "strength": article["strength"],
            "relevance": article["relevance"],
            "sourceWeight": article["source_weight"],
            "freshnessWeight": article["freshness_weight"],
            "supportSignals": article["support_hits"],
            "opposeSignals": article["oppose_hits"],
            "factCheckSignals": article["fact_check_hits"],
            "stanceReason": article["stance_reason"],
            "bodyChecked": article["article_body_checked"],
            "publishedAt": article["published_label"],
            "credibilityScore": round(article["source_weight"] * 100, 1),
            "credibilityLabel": credibility_label(article["source_weight"]),
        }
        for article in sorted(
            articles,
            key=lambda item: (
                item["stance"] == "support" or item["stance"] == "oppose",
                item["strength"],
                item["source_weight"],
            ),
            reverse=True,
        )[:8]
    ]

    support_count = counts.get("support", 0)
    oppose_count = counts.get("oppose", 0)
    mixed_count = counts.get("mixed", 0)
    unrelated_count = counts.get("unrelated", 0)

    return {
        "claim": normalize_whitespace(claim_text),
        "verdict": verdict,
        "confidence": confidence,
        "summary": summary,
        "evidence": {
            "support": support_count,
            "oppose": oppose_count,
            "mixed": mixed_count,
            "unrelated": unrelated_count,
            "weightedSupport": round(support_weight, 2),
            "weightedOppose": round(oppose_weight, 2),
        },
        "modelSignal": model_signal,
        "riskSignals": claim_risk,
        "sourceCredibility": {
            "average": average_credibility,
            "label": credibility_label(average_credibility / 100) if average_credibility else "No live sources",
            "trustedSources": trusted_sources,
        },
        "scoreBreakdown": score_breakdown,
        "explanation": explanation,
        "sources": top_sources,
        "checkedAt": datetime.now(timezone.utc).isoformat(),
    }


def analyze_claim(text, language="en", recency="week"):
    language = language if language in LANGUAGES else "en"
    recency = recency if recency in RECENCY_WINDOWS else "week"
    cache_key = f"{language}:{recency}:{normalize_whitespace(text).lower()}"
    cached = ANALYSIS_CACHE.get(cache_key)
    if cached and time.time() - cached["created_at"] < CACHE_TTL_SECONDS:
        cached_result = dict(cached["result"])
        cached_result["cacheHit"] = True
        return cached_result

    queries = build_search_queries(text)
    collected_articles = []
    fetch_errors = []

    for query in queries:
        try:
            collected_articles.extend(fetch_google_news(query, language=language, recency=recency))
        except Exception as exc:
            fetch_errors.append(str(exc))

    deduped_articles = dedupe_articles(collected_articles)
    model_signal = get_model_signal(text)
    analyzed_articles = [classify_stance(text, article, model_signal) for article in deduped_articles]
    relevant_articles = [
        article for article in analyzed_articles
        if article["stance"] != "unrelated" and article["relevance"] >= MIN_RELEVANT_ARTICLE_SCORE
    ]
    analysis = aggregate_analysis(text, relevant_articles, model_signal)
    analysis["queries"] = queries
    analysis["language"] = LANGUAGES[language]["label"]
    analysis["recency"] = recency
    analysis["searchStatus"] = "partial" if fetch_errors and relevant_articles else "ok"
    analysis["fallbackUsed"] = not relevant_articles
    analysis["searchQuality"] = {
        "candidatesFound": len(deduped_articles),
        "relevantSources": len(relevant_articles),
        "rejectedIrrelevant": max(0, len(analyzed_articles) - len(relevant_articles)),
        "minimumRelevance": MIN_RELEVANT_ARTICLE_SCORE,
        "claimFocus": claim_focus_text(text)[:280],
    }
    analysis["cacheHit"] = False
    if fetch_errors:
        analysis["debug"] = {
            "searchErrors": fetch_errors[:2]
        }
    ANALYSIS_CACHE[cache_key] = {
        "created_at": time.time(),
        "result": analysis,
    }
    return analysis


@app.route("/predict", methods=["POST"])
def predict():
    try:
        data = request.get_json()
        if not data or "text" not in data:
            return jsonify({"error": "No text provided. Please send JSON with a 'text' key."}), 400

        news_text = normalize_whitespace(data["text"])
        if not news_text:
            return jsonify({"error": "Text cannot be empty."}), 400

        language = normalize_whitespace(data.get("language", "en")).lower()
        recency = normalize_whitespace(data.get("recency", "week")).lower()

        result = analyze_claim(news_text, language=language, recency=recency)
        return jsonify(result)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/extract-url", methods=["POST"])
def extract_url():
    try:
        data = request.get_json()
        if not data or "url" not in data:
            return jsonify({"error": "No URL provided. Please send JSON with a 'url' key."}), 400

        link = normalize_whitespace(data["url"])
        extracted = extract_url_content(link)
        return jsonify(extracted)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/contact", methods=["POST"])
def contact():
    try:
        data = request.get_json() or {}
        name = normalize_whitespace(data.get("name", ""))
        email = normalize_whitespace(data.get("email", ""))
        topic = normalize_whitespace(data.get("topic", "Support request"))[:80]
        message = normalize_whitespace(data.get("message", ""))

        if not name:
            return jsonify({"error": "Name is required."}), 400
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            return jsonify({"error": "Enter a valid email address."}), 400
        if len(message) < 12:
            return jsonify({"error": "Message should be at least 12 characters."}), 400

        ticket_id = f"TL-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{len(CONTACT_MESSAGES) + 1:03d}"
        support_message = {
            "ticketId": ticket_id,
            "name": name,
            "email": email,
            "topic": topic,
            "message": message,
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        CONTACT_MESSAGES.append(support_message)

        return jsonify({
            "ok": True,
            "ticketId": ticket_id,
            "message": "Support request received.",
        })
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({"status": "healthy"})


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
