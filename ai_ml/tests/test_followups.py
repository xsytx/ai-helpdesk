"""Предложенные следующие вопросы (followups) под ответом."""
import json
import unittest

from kb.generation import build_schema, clean_followups, parse_output
from tests.test_generation import make


class FollowupTests(unittest.TestCase):
    def test_answer_carries_cleaned_followups(self):
        reply = json.dumps({'match': 1, 'answer': 'You can keep a book for two weeks.',
                            'followups': ['Can I extend the loan?', 'How long can I borrow a book?',
                                          'Можно ли продлить?', 'Can I extend the loan', '', 42,
                                          'Where do I return books?', 'Is there a fine for late books?']})
        s, c = make(reply=reply)
        r = s.answer('How long can I borrow a book?', 'en')
        # No repeat of the question or of each other, only English, at most 3.
        self.assertEqual(r['followups'], ['Can I extend the loan?', 'Where do I return books?', 'Is there a fine for late books?'])
        self.assertIn('followups', c.chat_json.call_args[0][1]['required'])

    def test_missing_or_broken_followups_do_not_fail_the_answer(self):
        s, _ = make(reply=json.dumps({'match': 0, 'answer': 'GPA is the grade point average.', 'followups': 'oops'}))
        r = s.answer('What is GPA?', 'en')
        self.assertEqual((r['status'], r['followups']), ('answered', []))

    def test_output_cut_off_in_followups_keeps_the_answer(self):
        raw = '{"match": 1, "answer": "Only two weeks, then return it.", "followups": ["Can I ext'
        self.assertEqual(parse_output(raw, 2, 'en', 'q'), (1, 'Only two weeks, then return it.', []))
        with self.assertRaises(ValueError):
            parse_output('{"match": 1, "answer": "Only two we', 2, 'en', 'q')

    def test_fallback_has_no_followups(self):
        s, _ = make(reply=['not json', 'still not json'])
        self.assertEqual(s.answer('What is GPA?', 'en')['followups'], [])

    def test_schema_limits_followups(self):
        self.assertEqual(build_schema(1)['properties']['followups']['maxItems'], 3)
        self.assertEqual(clean_followups(['Қанша тұрады?', 'How much?'], 'kk', 'x'), ['Қанша тұрады?'])


if __name__ == '__main__':
    unittest.main()
