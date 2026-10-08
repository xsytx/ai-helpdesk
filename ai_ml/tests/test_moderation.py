import json
import unittest
from unittest.mock import Mock
from kb.llm import LLMError
from kb.moderation import ModerationService


def svc(reply):
    client = Mock()
    if isinstance(reply, Exception):
        client.chat_json.side_effect = reply
    else:
        client.chat_json.return_value = reply
    return ModerationService(client), client


class ModerationTests(unittest.TestCase):
    def test_profanity_blocked_without_llm(self):
        s, client = svc('{}')
        for text in ['ты хуйло', 'х у й', 'xуй', 'ХУУУЙ', 'fuck you', 'сиктір кет', 'какой пиздец']:
            r = s.moderate(text)
            self.assertEqual((r['decision'], r['categories'], r['publish_allowed']), ('block', ['profanity'], False), text)
        client.chat_json.assert_not_called()

    def test_no_false_positives_on_normal_words(self):
        s, _ = svc(json.dumps({'decision': 'allow', 'categories': []}))
        for text in ['Страхуйте вещи', 'Что такое GPA?', 'Қайда деканат?', 'небаловаться', 'употреблять']:
            self.assertEqual(s.moderate(text)['decision'], 'allow', text)

    def test_llm_block_and_review(self):
        s, _ = svc(json.dumps({'decision': 'block', 'categories': ['threat']}))
        self.assertEqual(s.moderate('I will find you')['categories'], ['threat'])
        s, _ = svc(json.dumps({'decision': 'review', 'categories': []}))
        self.assertFalse(s.moderate('hmm')['publish_allowed'])

    def test_allow_with_stray_categories_is_cleaned(self):
        s, _ = svc(json.dumps({'decision': 'allow', 'categories': ['hate']}))
        r = s.moderate('hello')
        self.assertEqual((r['decision'], r['categories']), ('allow', []))

    def test_invalid_output_fails_closed(self):
        for reply in ['garbage', json.dumps({'decision': 'block', 'categories': []}), json.dumps({'decision': 'maybe'})]:
            s, _ = svc(reply)
            r = s.moderate('hello')
            self.assertEqual((r['decision'], r['publish_allowed'], r['reason']), ('review', False, 'invalid_model_output'))

    def test_llm_down_fails_closed(self):
        s, _ = svc(LLMError('down', 'llm_unavailable'))
        r = s.moderate('hello')
        self.assertEqual((r['decision'], r['reason']), ('review', 'llm_unavailable'))

    def test_input_validation(self):
        s, _ = svc('{}')
        with self.assertRaises(ValueError):
            s.moderate('   ')
