"""
clean_and_validate.py

interim/qa_split.jsonl -> processed/qa_clean.jsonl (+ rejected additions)

- normalizes category_raw -> category using config/categories.yaml
- tags each pair with a detected language (kk / ru / en)
- drops empty / too-short / duplicate pairs (dedup by normalized question hash)

Usage:
    python clean_and_validate.py --input data/interim/qa_split.jsonl \
                                  --categories config/categories.yaml \
                                  --out-processed data/processed/qa_clean.jsonl \
                                  --out-rejected data/rejected/qa_unmatched.jsonl
"""

import argparse
import hashlib
import json
import re
from pathlib import Path

import yaml

MIN_QUESTION_LEN = 5
MIN_ANSWER_LEN = 5

# Letters unique to Kazakh Cyrillic — if present, treat as Kazakh even though
# langdetect-style tools generally don't distinguish kk from ru well.
KAZAKH_ONLY_CHARS = set("әғқңөұүһі")
CYRILLIC_RE = re.compile(r"[а-яА-ЯёЁ]")
LATIN_RE = re.compile(r"[a-zA-Z]")


def detect_language(text: str) -> str:
    if not text:
        return "unknown"
    if any(ch in KAZAKH_ONLY_CHARS for ch in text.lower()):
        return "kk"
    cyr = len(CYRILLIC_RE.findall(text))
    lat = len(LATIN_RE.findall(text))
    if cyr == 0 and lat == 0:
        return "unknown"
    return "ru" if cyr >= lat else "en"


def load_category_map(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    # invert: raw string -> normalized category
    mapping = {}
    for normalized, variants in raw.items():
        for v in variants:
            mapping[v.strip().lower()] = normalized
    return mapping


def normalize_category(category_raw: str, mapping: dict) -> str:
    if not category_raw:
        return "other"
    return mapping.get(str(category_raw).strip().lower(), "other")


def question_hash(question: str) -> str:
    normalized = re.sub(r"\s+", " ", question.strip().lower())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--categories", required=True)
    ap.add_argument("--out-processed", required=True)
    ap.add_argument("--out-rejected", required=True)
    args = ap.parse_args()

    Path(args.out_processed).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out_rejected).parent.mkdir(parents=True, exist_ok=True)

    category_map = load_category_map(args.categories)

    seen_hashes = set()
    clean, rejected = [], []

    with open(args.input, "r", encoding="utf-8") as f:
        pairs = [json.loads(line) for line in f if line.strip()]

    for p in pairs:
        question = (p.get("question") or "").strip()
        answer = (p.get("answer") or "").strip()

        if len(question) < MIN_QUESTION_LEN or len(answer) < MIN_ANSWER_LEN:
            rejected.append({**p, "reason": "too_short"})
            continue

        h = question_hash(question)
        if h in seen_hashes:
            rejected.append({**p, "reason": "duplicate_question"})
            continue
        seen_hashes.add(h)

        clean.append({
            "id": h[:12],
            "question": question,
            "answer": answer,
            "category": normalize_category(p.get("category_raw"), category_map),
            "category_raw": p.get("category_raw"),
            "language": detect_language(question),
            "source_row": p.get("row"),
        })

    with open(args.out_processed, "w", encoding="utf-8") as f:
        for p in clean:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")

    # append cleaning-stage rejects to the existing rejected file (from parse_xlsx.py)
    with open(args.out_rejected, "a", encoding="utf-8") as f:
        for p in rejected:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")

    print(f"clean pairs:        {len(clean)} -> {args.out_processed}")
    print(f"rejected (cleaning): {len(rejected)} -> appended to {args.out_rejected}")


if __name__ == "__main__":
    main()
