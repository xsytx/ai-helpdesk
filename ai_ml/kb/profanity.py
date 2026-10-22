"""Fast deterministic profanity filter (ru / kk / en) used before the LLM moderation.

Idea: normalise the text (case, Latin/Cyrillic look-alikes, leetspeak, separators,
repeated letters), then compare tokens with word lists from config/profanity/*.txt.
Only whole words (plus a few inflection endings) match, so ordinary words that merely
contain a bad substring are not blocked.
"""
import re
import unicodedata
from pathlib import Path

LIST_DIR = Path(__file__).resolve().parent.parent / 'config' / 'profanity'

# Latin letters that look like Cyrillic ones (used to catch "блya", "xуй", ...)
LATIN_LOOKALIKE = str.maketrans('aeopcxykmthb', 'аеорсхукмтнв')
# Leetspeak for Latin words ("f*ck", "sh1t", "a$$")
LEET = str.maketrans({'0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't',
                      '@': 'a', '$': 's', '!': 'i'})
# Cyrillic digits/symbols look-alikes and Kazakh letters folded to base letters
CYR_FOLD = str.maketrans({'ё': 'е', 'ә': 'а', 'ғ': 'г', 'қ': 'к', 'ң': 'н', 'ө': 'о',
                          'ұ': 'у', 'ү': 'у', 'һ': 'х', 'і': 'и', 'й': 'и'})

EN_SUFFIXES = ('', 's', 'es', 'ed', 'ing', 'er', 'ers', 'y', 'in')
WORD = re.compile(r'[^\W\d_]+|\d+', re.UNICODE)


def _squeeze(word):
    """Collapse repeated letters: 'хуууй' -> 'хуи'. Applied to lists and text alike."""
    return re.sub(r'(.)\1+', r'\1', word)


def _is_cyrillic(word):
    return any('\u0400' <= ch <= '\u04ff' for ch in word)


def _cyr_key(word):
    return _squeeze(word.translate(CYR_FOLD))


def _lat_key(word):
    return _squeeze(word)


def _tokens(text):
    """Return word tokens; glue runs of single letters ('б.л.я', 'f u c k')."""
    text = unicodedata.normalize('NFKC', text).lower()
    text = text.translate(LEET) if re.search(r'[a-z]', text) else text
    raw = WORD.findall(text)
    out, run = [], []
    for tok in raw:
        if len(tok) == 1 and tok.isalpha():
            run.append(tok)
            continue
        if len(run) >= 3:
            out.append(''.join(run))
        else:
            out.extend(run)
        run = []
        out.append(tok)
    if len(run) >= 3:
        out.append(''.join(run))
    else:
        out.extend(run)
    return out


def _read(path):
    if not path.exists():
        return []
    lines = path.read_text(encoding='utf-8').splitlines()
    return [ln.strip().lower() for ln in lines if ln.strip() and not ln.startswith('#')]


class ProfanityFilter:
    def __init__(self, list_dir=LIST_DIR):
        self.cyr, self.lat, self.cyr_phrases, self.lat_phrases = set(), set(), set(), set()
        allow = {a for a in _read(list_dir / 'allow.txt')}
        self.allow_cyr = {_cyr_key(a) for a in allow}
        self.allow_lat = {_lat_key(a) for a in allow}
        for name in ('en', 'ru', 'kk', 'custom'):
            for entry in _read(list_dir / f'{name}.txt'):
                parts = WORD.findall(unicodedata.normalize('NFKC', entry))
                if not parts:
                    continue
                if _is_cyrillic(entry):
                    keys = [_cyr_key(p) for p in parts]
                    (self.cyr_phrases if len(keys) > 1 else self.cyr).add(' '.join(keys))
                else:
                    keys = [_lat_key(p) for p in parts]
                    (self.lat_phrases if len(keys) > 1 else self.lat).add(' '.join(keys))

    def _match_cyr(self, key):
        if key in self.allow_cyr:
            return None
        if key in self.cyr:
            return key
        for bad in self.cyr:
            # inflections: word starts with a listed word of 4+ letters and adds up to 3 letters
            if len(bad) >= 4 and key.startswith(bad) and len(key) - len(bad) <= 3:
                return bad
        return None

    def _match_lat(self, key):
        if key in self.allow_lat:
            return None
        for bad in self.lat:
            if any(key == _squeeze(bad + suf) for suf in EN_SUFFIXES):
                return bad
        return None

    def check(self, text):
        """Return {'hit': bool, 'matches': [normalised words]} for one text."""
        tokens = _tokens(text)
        matches = []
        cyr_seq, lat_seq = [], []
        for tok in tokens:
            variants = [tok]
            if re.search(r'[a-z]', tok) and re.search(r'[а-я]', tok.translate(LATIN_LOOKALIKE)):
                variants.append(tok.translate(LATIN_LOOKALIKE))  # mixed-script word
            if re.fullmatch(r'[a-z]+', tok):
                variants.append(tok.translate(LATIN_LOOKALIKE))  # Latin-spelled Russian
            for v in variants:
                if _is_cyrillic(v):
                    key = _cyr_key(v)
                    hit = self._match_cyr(key)
                    cyr_seq.append(key)
                else:
                    key = _lat_key(v)
                    hit = self._match_lat(key)
                    lat_seq.append(key)
                if hit:
                    matches.append(hit)
                    break
        joined_cyr, joined_lat = ' ' + ' '.join(cyr_seq) + ' ', ' ' + ' '.join(lat_seq) + ' '
        for phrase in self.cyr_phrases:
            if f' {phrase} ' in joined_cyr:
                matches.append(phrase)
        for phrase in self.lat_phrases:
            if f' {phrase} ' in joined_lat:
                matches.append(phrase)
        return {'hit': bool(matches), 'matches': sorted(set(matches))}
