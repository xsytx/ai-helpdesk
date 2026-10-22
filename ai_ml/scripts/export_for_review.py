"""
export_for_review.py

interim/qa_split.jsonl -> a CSV that's easy to open in Google Sheets / Excel
for manual review before running clean_and_validate.py.

Adds an empty "approved" column (fill in y/n) and a "fixed_answer" column
(reviewer overrides the answer here instead of editing "answer" directly,
so the original stays intact for diffing).

Usage:
    python export_for_review.py --input data/interim/qa_split.jsonl \
                                 --output data/interim/qa_review.csv
"""

import argparse
import csv
import json
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)

    with open(args.input, "r", encoding="utf-8") as f:
        pairs = [json.loads(line) for line in f if line.strip()]

    fieldnames = [
        "row", "question", "answer", "category_raw",
        "approved", "fixed_question", "fixed_answer", "notes",
    ]

    with open(args.output, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for p in pairs:
            writer.writerow({
                "row": p.get("row"),
                "question": p.get("question"),
                "answer": p.get("answer"),
                "category_raw": p.get("category_raw"),
                "approved": "",
                "fixed_question": "",
                "fixed_answer": "",
                "notes": "",
            })

    print(f"exported {len(pairs)} pairs for review -> {args.output}")


if __name__ == "__main__":
    main()
