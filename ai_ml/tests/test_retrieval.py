import unittest
import numpy as np
from kb.embedding import DIMENSION
from kb.index import VectorIndex
from kb.retrieval import Retriever


def vec(*pairs):
    v = np.zeros(DIMENSION, dtype=np.float32)
    for i, x in pairs:
        v[i] = x
    return v


class FakeEncoder:
    def __init__(self, v):
        self.v = v

    def encode(self, texts, query=False):
        return np.asarray([self.v])


def records(n):
    return [{'id': f'r{i}', 'question': f'q{i}', 'answer': f'a{i}', 'language': 'ru'} for i in range(n)]


class IndexTests(unittest.TestCase):
    def test_search_order_and_scores(self):
        vectors = np.stack([vec((0, 1)), vec((0, 1), (1, 1)), vec((2, 1))])
        index = VectorIndex(vectors, records(3))
        found = index.search(vec((0, 1)), top_k=3)
        self.assertEqual([f['id'] for f in found], ['r0', 'r1', 'r2'])
        self.assertAlmostEqual(found[0]['score'], 1.0, places=5)
        self.assertAlmostEqual(found[1]['score'], 0.7071, places=3)

    def test_top_k_larger_than_index(self):
        index = VectorIndex(np.stack([vec((0, 1))]), records(1))
        self.assertEqual(len(index.search(vec((0, 1)), top_k=10)), 1)

    def test_size_mismatch_rejected(self):
        with self.assertRaises(ValueError):
            VectorIndex(np.stack([vec((0, 1))]), records(2))

    def test_shipped_index_loads(self):
        from kb.config import resolve_path
        index = VectorIndex.load(resolve_path('data/index'))
        self.assertEqual(len(index), 941)


class RetrieverTests(unittest.TestCase):
    def test_floor_dedupe_and_no_hard_gate(self):
        vectors = np.stack([vec((0, 1)), vec((0, 1), (1, 0.1)), vec((0, 1), (1, 0.5)), vec((5, 1))])
        recs = records(4)
        recs[1]['answer'] = recs[0]['answer']  # дубль ответа
        index = VectorIndex(vectors, recs)
        r = Retriever(FakeEncoder(vec((0, 1))), index, top_k=5, floor=0.82).retrieve('x')
        self.assertEqual([c['id'] for c in r['candidates']], ['r0', 'r2'])  # r1 — дубль, r3 — ниже порога
        self.assertAlmostEqual(r['top_score'], 1.0, places=5)

    def test_nothing_above_floor_returns_empty_candidates(self):
        index = VectorIndex(np.stack([vec((5, 1))]), records(1))
        r = Retriever(FakeEncoder(vec((0, 1))), index, floor=0.82).retrieve('x')
        self.assertEqual(r['candidates'], [])
        self.assertIsNotNone(r['top_score'])

    def test_blank_question(self):
        index = VectorIndex(np.stack([vec((0, 1))]), records(1))
        with self.assertRaises(ValueError):
            Retriever(FakeEncoder(vec((0, 1))), index).retrieve('  ')
