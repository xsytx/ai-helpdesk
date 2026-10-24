"""Ответы форума как кандидаты (Stories 8-9): ранжирование по смыслу и итог с source_type='forum'."""
import json
import unittest
from unittest.mock import Mock

import numpy as np

from kb.forum import ForumSearch
from kb.generation import AnswerService

DIM = 768


def unit(seed):
    v = np.random.default_rng(seed).normal(size=DIM).astype(np.float32)
    return v / np.linalg.norm(v)


class FakeEncoder:
    """Тексты из словаря — заданный вектор, остальные — случайный (не похожий ни на что)."""
    def __init__(self, known):
        self.known, self.calls = known, []

    def encode(self, texts, query=False):
        self.calls.append((tuple(texts), query))
        return np.stack([self.known.get(t, unit(abs(hash(t)) % 2**32)) for t in texts])


DORM, FOOD = unit(1), unit(2)
ITEMS = [
    {'thread_id': 7, 'title': 'How to get a dorm room?', 'body': '', 'answer': 'Apply on the portal in August.',
     'accepted': True, 'likes': 3, 'staff': False},
    {'thread_id': 9, 'title': 'Canteen prices?', 'body': '', 'answer': 'Lunch is about 1500 tenge.',
     'accepted': False, 'likes': 1, 'staff': False},
]


def encoder():
    near_dorm = DORM + 0.15 * unit(3)
    return FakeEncoder({'How to get a dorm room?': DORM, 'Canteen prices?': FOOD,
                        'Where do I apply for the dormitory?': near_dorm / np.linalg.norm(near_dorm)})


class ForumSearchTests(unittest.TestCase):
    def test_closest_question_above_floor_only(self):
        found = ForumSearch(encoder(), top_k=2, floor=0.8).search('Where do I apply for the dormitory?', ITEMS)
        self.assertEqual([f['thread_id'] for f in found], [7])
        self.assertEqual((found[0]['kind'], found[0]['id'], found[0]['accepted']), ('forum', 'forum-7', True))
        self.assertEqual(found[0]['answer'], 'Apply on the portal in August.')

    def test_titles_are_encoded_once(self):
        enc = encoder()
        search = ForumSearch(enc, floor=0.8)
        search.search('Where do I apply for the dormitory?', ITEMS)
        search.search('Where do I apply for the dormitory?', ITEMS)
        passages = [texts for texts, query in enc.calls if not query]
        self.assertEqual(passages, [('How to get a dorm room?', 'Canteen prices?')])

    def test_empty_or_broken_items_are_skipped(self):
        search = ForumSearch(encoder(), floor=0.8)
        self.assertEqual(search.search('Q?', []), [])
        self.assertEqual(search.search('Q?', [{'thread_id': 1, 'title': ' ', 'answer': 'x'}]), [])


class ForumAnswerTests(unittest.TestCase):
    def make(self, reply):
        retriever = Mock()
        retriever.retrieve.return_value = {'candidates': [], 'top_score': 0.5}
        client = Mock(model='qwen3:4b')
        client.chat_json.return_value = json.dumps({'match': 1, 'answer': reply})
        service = AnswerService(retriever, client, '', 0.9, ForumSearch(encoder(), floor=0.8))
        return service, client

    def test_forum_answer_becomes_the_community_answer(self):
        service, client = self.make('Apply for a dorm room on the student portal in August.')
        r = service.answer('Where do I apply for the dormitory?', 'en', forum=ITEMS)
        self.assertEqual((r['basis'], r['source_type']), ('retrieved', 'forum'))
        self.assertEqual(r['forum_answer'], 'Apply on the portal in August.')
        self.assertEqual(r['source']['thread_id'], 7)
        self.assertTrue(r['source']['accepted'])
        user = client.chat_json.call_args[0][0][1]['content']
        self.assertIn('[1] Q: How to get a dorm room?', user)

    def test_without_forum_items_nothing_changes(self):
        service, client = self.make('x')
        client.chat_json.return_value = json.dumps({'match': 0, 'answer': 'A general answer about it.'})
        r = service.answer('Where do I apply for the dormitory?', 'en')
        self.assertEqual((r['basis'], r['source']), ('general', None))

    def test_broken_forum_search_still_answers(self):
        service, client = self.make('x')
        service.forum_search = Mock(search=Mock(side_effect=RuntimeError('boom')))
        client.chat_json.return_value = json.dumps({'match': 0, 'answer': 'A general answer about it.'})
        with self.assertLogs('kb.generation', 'ERROR'):
            r = service.answer('Where do I apply for the dormitory?', 'en', forum=ITEMS)
        self.assertEqual(r['status'], 'answered')


if __name__ == '__main__':
    unittest.main()
