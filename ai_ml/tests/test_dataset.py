import csv
import tempfile
import unittest
from pathlib import Path
from kb.dataset import prepare_records


class DatasetTests(unittest.TestCase):
    def make_csv(self, rows):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        path = Path(temp.name) / 'faq.csv'
        with path.open('w', encoding='utf-8-sig', newline='') as f:
            w = csv.writer(f)
            w.writerow(['id', 'question', 'answer', 'language', 'status', 'category_original'])
            w.writerows(rows)
        return path

    def test_filtering(self):
        path = self.make_csv([['1', 'Можно?', 'Да', 'ru', 'needs_review', 'portal'],
                              ['2', 'Where?', '', 'en', 'missing_answer', ''],
                              ['3', 'Which?', 'Shared', 'en', 'alignment_review', '']])
        rows, rejected, report = prepare_records(path)
        self.assertEqual([r['id'] for r in rows], ['1'])
        self.assertEqual(report['excluded'], 2)

    def test_duplicate_id_rejected(self):
        path = self.make_csv([['1', 'Q?', 'A', 'ru', 'needs_review', ''], ['1', 'Q2?', 'A2', 'ru', 'needs_review', '']])
        with self.assertRaises(ValueError):
            prepare_records(path)

    def test_shipped_csv_matches_index(self):
        import json
        from kb.config import ROOT
        rows = prepare_records(ROOT / 'data/raw/faq.csv')[0]
        recs = json.loads((ROOT / 'data/index/records.json').read_text(encoding='utf-8'))
        self.assertEqual([r['id'] for r in rows], [r['id'] for r in recs])
