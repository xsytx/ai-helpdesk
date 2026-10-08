"""Stage 1: prepare FAQ data, using only the Python standard library."""
import csv
from collections import Counter
from pathlib import Path

# The author confirmed the answers; previous review labels are not fact checks.
ACCEPTED_STATUSES = {"needs_review", "content_review", "verified"}


def prepare_records(path: Path):
    accepted, excluded, seen = [], [], set()
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        required = {"id", "language", "question", "answer", "status"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError(f"CSV must contain columns: {sorted(required)}")
        for line, row in enumerate(reader, 2):
            if None in row or any(row.get(k) is None for k in required):
                raise ValueError(f"Malformed CSV record {line}")
            record_id = row["id"].strip()
            if not record_id or record_id in seen:
                raise ValueError(f"Empty or duplicate record id: {record_id!r}")
            seen.add(record_id)
            question, answer, status = (row[k].strip() for k in ("question", "answer", "status"))
            reason = None
            if status == "alignment_review":
                reason = "ambiguous_alignment"
            elif not question:
                reason = "empty_question"
            elif not answer:
                reason = "empty_answer"
            elif status not in ACCEPTED_STATUSES:
                reason = "excluded_status"
            if reason:
                excluded.append({**row, "exclusion_reason": reason})
                continue
            language = row["language"].strip()
            if language not in {"ru", "kk", "en"}:
                raise ValueError(f"Unsupported language in {record_id}: {language!r}")
            accepted.append({
                "id": record_id,
                "language": language,
                "question": question,
                "answer": answer,
                # Preserve the supplied category. Do not invent topic labels.
                "category": (row.get("category_original") or "").strip(),
                "source_row": row.get("source_row", ""),
                "source_date": row.get("source_date", ""),
                "faq_id": row.get("faq_id", ""),
                "review_notes": row.get("review_notes", ""),
            })
    if not accepted:
        raise ValueError("No usable question-answer pairs in CSV.")
    report = {
        "total": len(seen), "accepted": len(accepted), "excluded": len(excluded),
        "exclusion_reasons": dict(Counter(r["exclusion_reason"] for r in excluded)),
        "accepted_languages": dict(Counter(r["language"] for r in accepted)),
        "approval_basis": "Author confirmed the answers in the conversation.",
        "category_note": "Original category text, not normalized topic labels.",
    }
    return accepted, excluded, report


def read_records(path: Path):
    return prepare_records(path)[0]
