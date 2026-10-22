"""Score the forum moderation on a labelled test set (eval/moderation_cases.jsonl).

"flag" = should NOT be published automatically (block or review);
"allow" = a normal message that must go through.

Two modes are compared:
  * dictionary  - only the instant word filter (what runs before publishing)
  * dictionary + LLM - the full check (what runs in the background)

Run (with Ollama running):
    docker compose run --rm ai_ml python scripts/eval_moderation.py
Prints precision / recall / false-positive rate per mode and every mistake.
"""
import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from kb.config import Settings  # noqa: E402
from kb.llm import make_client  # noqa: E402
from kb.moderation import ModerationService  # noqa: E402


def load_cases(path):
    return [json.loads(line) for line in Path(path).read_text(encoding='utf-8').splitlines() if line.strip()]


def score(results):
    tp = sum(1 for r in results if r['expected'] == 'flag' and r['flagged'])
    fn = sum(1 for r in results if r['expected'] == 'flag' and not r['flagged'])
    fp = sum(1 for r in results if r['expected'] == 'allow' and r['flagged'])
    tn = sum(1 for r in results if r['expected'] == 'allow' and not r['flagged'])
    precision = tp / (tp + fp) if tp + fp else 1.0
    recall = tp / (tp + fn) if tp + fn else 1.0
    fpr = fp / (fp + tn) if fp + tn else 0.0
    return {'tp': tp, 'fn': fn, 'fp': fp, 'tn': tn, 'precision': precision, 'recall': recall, 'false_positive_rate': fpr}


def run(cases, check):
    out = []
    for case in cases:
        verdict = check(case['text'])
        out.append({**case, 'decision': verdict['decision'], 'categories': verdict['categories'],
                    'flagged': verdict['decision'] != 'allow'})
    return out


def report(name, results, seconds):
    s = score(results)
    print(f"\n=== {name} ({len(results)} cases, {seconds:.0f}s) ===")
    print(f"precision {s['precision']:.0%} | recall {s['recall']:.0%} | false positives {s['fp']} of {s['fp'] + s['tn']} "
          f"normal messages ({s['false_positive_rate']:.0%}) | missed {s['fn']} of {s['tp'] + s['fn']} toxic")
    for r in results:
        if r['flagged'] != (r['expected'] == 'flag'):
            what = 'FALSE ALARM' if r['flagged'] else 'MISSED     '
            print(f"  {what} [{r['lang']}/{r['kind']}] {r['text']!r} -> {r['decision']} {r['categories']}")
    return s


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    parser.add_argument('--cases', default=str(ROOT / 'eval' / 'moderation_cases.jsonl'))
    parser.add_argument('--json', help='also save per-case results to this file')
    args = parser.parse_args()
    cases = load_cases(args.cases)

    dictionary_only = ModerationService(client=None)
    t0 = time.time()
    dict_results = run(cases, dictionary_only.quick_check)
    dict_score = report('dictionary only', dict_results, time.time() - t0)

    full = ModerationService(make_client(Settings.from_env()))
    t0 = time.time()
    full_results = run(cases, full.moderate)
    full_score = report(f"dictionary + LLM ({Settings.from_env().llm_model})", full_results, time.time() - t0)

    if args.json:
        Path(args.json).write_text(json.dumps({'dictionary': dict_score, 'full': full_score, 'cases': full_results},
                                              ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
