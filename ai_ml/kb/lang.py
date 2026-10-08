"""Определение языка (ru/kk/en) по алфавиту и грубая проверка языка ответа."""
import re

KK_LETTERS = set('әғқңөұүһіӘҒҚҢӨҰҮҺІ')
LANGUAGES = ('ru', 'kk', 'en')
LANGUAGE_NAMES = {'ru': 'Russian', 'kk': 'Kazakh', 'en': 'English'}


def _counts(text):
    cyr = lat = kk = 0
    for ch in text:
        if not ch.isalpha():
            continue
        if ch in KK_LETTERS:
            kk += 1
            cyr += 1
        elif '\u0400' <= ch <= '\u04ff':
            cyr += 1
        elif ch.isascii():
            lat += 1
    return cyr, lat, kk


def detect_language(text):
    """kk — если есть казахские буквы; ru — кириллица; иначе en."""
    cyr, lat, kk = _counts(text)
    if kk:
        return 'kk'
    if cyr >= lat and cyr > 0:
        return 'ru'
    return 'en'


def looks_like(language, text):
    """Грубая проверка, что модель ответила на нужном языке (не перевела в другой алфавит)."""
    cyr, lat, kk = _counts(text)
    letters = cyr + lat
    if letters < 12:
        return True
    if language == 'en':
        return lat / letters >= 0.5
    if cyr / letters < 0.4:   # допускаем латинские названия: Student Service Center, Moodle, GPA
        return False
    if language == 'ru':
        return kk / letters < 0.03
    # kk: в связном казахском тексте почти всегда встречаются специфические буквы
    return kk > 0 or letters < 30


def has_cyrillic(text):
    return bool(re.search('[\u0400-\u04ff]', text))
