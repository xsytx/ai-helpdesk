import unittest
from kb.lang import detect_language, looks_like


class LangTests(unittest.TestCase):
    def test_detect(self):
        self.assertEqual(detect_language('Как получить справку?'), 'ru')
        self.assertEqual(detect_language('How to get a certificate?'), 'en')
        self.assertEqual(detect_language('Жатақханада қалай тұруға болады?'), 'kk')
        self.assertEqual(detect_language('ДШ да атенденс қалай алад?'), 'kk')
        self.assertEqual(detect_language('Как работает Moodle?'), 'ru')

    def test_looks_like(self):
        self.assertTrue(looks_like('ru', 'Для этого нужно обратиться в Student Service Center.'))
        self.assertFalse(looks_like('ru', 'You should contact the Student Service Center for this.'))
        self.assertFalse(looks_like('en', 'Для этого нужно обратиться в деканат вашего факультета.'))
        self.assertTrue(looks_like('kk', 'Бұл үшін студенттік қызмет орталығына барып, өтініш жазу керек.'))
        self.assertFalse(looks_like('kk', 'Для этого нужно обратиться в деканат вашего факультета, там помогут.'))
        self.assertTrue(looks_like('ru', 'Да'))  # короткие ответы не проверяем
