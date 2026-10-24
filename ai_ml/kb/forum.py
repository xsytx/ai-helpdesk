"""Ответы форума как кандидаты (Stories 8-9).

Go-backend присылает вместе с вопросом опубликованные вопросы форума с лучшим ответом
(принятым, с лайками или от сотрудника). Здесь они ранжируются по смыслу той же моделью E5,
что и FAQ: вектор вопроса форума (заголовок + начало текста) сравнивается с вектором вопроса
студента. Векторы кэшируются в памяти (ключ — сам текст), так что после первого вопроса
считаются только новые или изменённые вопросы.
"""
import threading
from collections import OrderedDict

import numpy as np


class ForumSearch:
    def __init__(self, encoder, top_k=2, floor=0.75, cache_size=5000):
        self.encoder, self.top_k, self.floor, self.cache_size = encoder, top_k, floor, cache_size
        self._cache, self._lock = OrderedDict(), threading.Lock()

    def _vectors(self, titles):
        with self._lock:
            missing = list(dict.fromkeys(t for t in titles if t not in self._cache))
        if missing:
            vectors = self.encoder.encode(missing)
            with self._lock:
                for title, vector in zip(missing, vectors):
                    self._cache[title] = vector
        with self._lock:
            out = []
            for title in titles:
                self._cache.move_to_end(title)
                out.append(self._cache[title])
            while len(self._cache) > self.cache_size:
                self._cache.popitem(last=False)
        return np.stack(out)

    def search(self, question, items, previous=None):
        """Лучшие ответы форума для вопроса (по убыванию сходства), не ниже floor.
        previous — предыдущий вопрос студента: для уточнений ищем и вместе с ним."""
        items = [i for i in items or [] if (i.get('title') or '').strip() and (i.get('answer') or '').strip()]
        if not items:
            return []
        titles = [' '.join(i['title'].split()) for i in items]
        # Короткий заголовок («Red Canteen») сам по себе плохо находится на другом языке: текст помогает.
        passages = [(t + '\n' + ' '.join((i.get('body') or '').split())[:300]).strip() for t, i in zip(titles, items)]
        matrix = self._vectors(passages)
        queries = [question.strip()[:2000]]
        if previous:
            queries.append((previous + '\n' + question).strip()[:2000])
        scores = np.max(np.stack([matrix @ self.encoder.encode([q], query=True)[0] for q in queries]), axis=0)
        found = []
        for i in np.argsort(-scores, kind='stable')[:self.top_k]:
            if scores[i] < self.floor:
                break
            item = items[int(i)]
            found.append({'id': f'forum-{item["thread_id"]}', 'kind': 'forum', 'question': titles[int(i)],
                          'answer': item['answer'].strip(), 'score': float(scores[i]),
                          'thread_id': item['thread_id'], 'accepted': bool(item.get('accepted')),
                          'likes': int(item.get('likes') or 0), 'staff': bool(item.get('staff')),
                          'category': '', 'language': '', 'source_row': ''})
        return found
