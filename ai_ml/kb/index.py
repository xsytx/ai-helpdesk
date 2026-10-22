"""Векторный индекс в памяти: 941 вектор × 768 — точный косинусный поиск за доли миллисекунды.
Postgres/pgvector не нужен."""
import json
from pathlib import Path

import numpy as np

from .embedding import DIMENSION, MODEL, STRATEGY, normalize


class VectorIndex:
    def __init__(self, vectors, records):
        self.vectors = normalize(vectors, len(records))
        self.records = records
        if len(records) == 0:
            raise ValueError('Index is empty.')

    def __len__(self):
        return len(self.records)

    def search(self, vector, top_k=5):
        q = normalize(vector, 1)[0]
        scores = self.vectors @ q
        k = min(top_k, len(scores))
        top = np.argpartition(-scores, k - 1)[:k]
        top = top[np.argsort(-scores[top], kind='stable')]
        out = []
        for i in top:
            r = self.records[int(i)]
            out.append({'id': r['id'], 'question': r['question'], 'answer': r['answer'],
                        'category': r.get('category', ''), 'language': r['language'],
                        'source_row': r.get('source_row', ''), 'score': float(scores[i])})
        return out

    @classmethod
    def load(cls, folder):
        folder = Path(folder)
        meta_path = folder / 'metadata.json'
        if meta_path.exists():
            meta = json.loads(meta_path.read_text(encoding='utf-8'))
            if meta.get('model') != MODEL or meta.get('dimension') != DIMENSION:
                raise ValueError('Index was built with another embedding model. Run: python -m kb.cli index')
        vectors = np.load(folder / 'embeddings.npy', allow_pickle=False)
        records = json.loads((folder / 'records.json').read_text(encoding='utf-8'))
        if len(records) != len(vectors):
            raise ValueError('records.json and embeddings.npy have different sizes. Run: python -m kb.cli index')
        return cls(vectors, records)

    @staticmethod
    def save(folder, records, vectors, source_sha256=''):
        folder = Path(folder)
        folder.mkdir(parents=True, exist_ok=True)
        vectors = normalize(vectors, len(records))
        np.save(folder / 'embeddings.npy', vectors, allow_pickle=False)
        (folder / 'records.json').write_text(json.dumps(records, ensure_ascii=False), encoding='utf-8')
        (folder / 'metadata.json').write_text(json.dumps({
            'model': MODEL, 'strategy': STRATEGY, 'dimension': DIMENSION,
            'records': len(records), 'source_sha256': source_sha256}, ensure_ascii=False, indent=2), encoding='utf-8')
