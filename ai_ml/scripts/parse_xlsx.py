"""
parse_xlsx.py

raw/survey_responses.xlsx -> interim/qa_split.jsonl (+ rejected/qa_unmatched.jsonl)

Splits the numbered Q&A lists inside a single cell (Google Forms export) into
individual {question, answer} pairs, matched by their number.

Usage:
    python parse_xlsx.py --input data/raw/survey_responses.xlsx \
                          --out-interim data/interim/qa_split.jsonl \
                          --out-rejected data/rejected/qa_unmatched.jsonl
"""

import argparse
import json
import re
from pathlib import Path

import openpyxl

# Column indices in the Google Forms export (0-based). Adjust if the form changes.
COL_TIMESTAMP = 0
COL_EMAIL = 1
COL_REFERRER = 2
COL_CATEGORY_RAW = 3
COL_QUESTION = 4
COL_ANSWER = 5

NUMBER_SPLIT_RE = re.compile(r'\n?\s*(\d+)[\.\)]\s*')


def split_numbered(text: str) -> dict:
    """Split a cell like '1) foo\n2) bar' into {'1': 'foo', '2': 'bar'}."""
    if not text or not str(text).strip():
        return {}
    parts = NUMBER_SPLIT_RE.split(str(text))
    # re.split with a capturing group returns: [pre, num, chunk, num, chunk, ...]
    parts = [p for p in parts if p is not None and p.strip() != '']
    result = {}
    i = 0
    while i < len(parts) - 1:
        num, chunk = parts[i], parts[i + 1]
        if num.isdigit():
            result[num] = chunk.strip()
            i += 2
        else:
            # leading text with no number prefix — skip it
            i += 1
    # cell had content but no numbering at all -> treat whole cell as pair "1"
    if not result and str(text).strip():
        result["1"] = str(text).strip()
    return result


def parse_row(row_idx: int, row: tuple) -> tuple[list, list]:
    """Returns (matched_pairs, unmatched_entries) for one survey row."""
    timestamp = row[COL_TIMESTAMP]
    email = row[COL_EMAIL]
    category_raw = row[COL_CATEGORY_RAW]
    q_text = row[COL_QUESTION]
    a_text = row[COL_ANSWER]

    questions = split_numbered(q_text)
    answers = split_numbered(a_text)

    matched, unmatched = [], []

    for num, question in questions.items():
        base = {
            "row": row_idx,
            "timestamp": str(timestamp) if timestamp else None,
            "email": email,
            "category_raw": category_raw,
            "question": question,
        }
        if num in answers:
            matched.append({**base, "answer": answers[num]})
        else:
            unmatched.append({**base, "answer": None, "reason": "no_matching_answer_number"})

    # answers with no corresponding question number also go to unmatched,
    # for manual review (numbering mismatch between Q and A cells)
    for num, answer in answers.items():
        if num not in questions:
            unmatched.append({
                "row": row_idx,
                "timestamp": str(timestamp) if timestamp else None,
                "email": email,
                "category_raw": category_raw,
                "question": None,
                "answer": answer,
                "reason": "no_matching_question_number",
            })

    return matched, unmatched


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out-interim", required=True)
    ap.add_argument("--out-rejected", required=True)
    args = ap.parse_args()

    Path(args.out_interim).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out_rejected).parent.mkdir(parents=True, exist_ok=True)

    wb = openpyxl.load_workbook(args.input, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))[1:]  # skip header

    all_matched, all_unmatched = [], []
    for i, row in enumerate(rows, start=2):  # sheet row number, 1-indexed + header
        matched, unmatched = parse_row(i, row)
        all_matched.extend(matched)
        all_unmatched.extend(unmatched)

    with open(args.out_interim, "w", encoding="utf-8") as f:
        for p in all_matched:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")

    with open(args.out_rejected, "w", encoding="utf-8") as f:
        for p in all_unmatched:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")

    print(f"matched pairs:   {len(all_matched)} -> {args.out_interim}")
    print(f"unmatched items: {len(all_unmatched)} -> {args.out_rejected}")


if __name__ == "__main__":
    main()
