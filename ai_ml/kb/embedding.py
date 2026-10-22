"""Локальные эмбеддинги multilingual-e5-base (768 измерений). Индекс построен на этой модели."""
from pathlib import Path

import numpy as np

MODEL = 'intfloat/multilingual-e5-base'
DIMENSION = 768
STRATEGY = 'question_only_e5_base_v1'


def normalize(vectors, count=None):
    a = np.asarray(vectors, dtype=np.float32)
    if a.ndim == 1:
        a = a.reshape(1, -1)
    if a.ndim != 2 or a.shape[1] != DIMENSION or (count is not None and a.shape[0] != count):
        raise ValueError(f'Expected vectors of dimension {DIMENSION}, got shape {a.shape}.')
    if not np.isfinite(a).all():
        raise ValueError('Embedding contains NaN or infinity.')
    norms = np.linalg.norm(a, axis=1, keepdims=True)
    if np.any(norms < 1e-8):
        raise ValueError('A zero embedding is not valid.')
    return a / norms


class E5:
    """Создавайте один раз при старте процесса: загрузка модели занимает секунды."""

    def __init__(self, device='cpu', batch_size=16):
        from sentence_transformers import SentenceTransformer
        if batch_size < 1:
            raise ValueError('Batch size must be positive.')
        cache = Path(__file__).resolve().parents[1] / '.cache' / 'huggingface'
        self.model = SentenceTransformer(MODEL, device=device, cache_folder=str(cache))
        self.batch_size = batch_size

    def encode(self, texts, query=False):
        if not texts or any(not t.strip() for t in texts):
            raise ValueError('Embedding input must contain nonempty text.')
        prefix = 'query: ' if query else 'passage: '
        # Слишком длинный текст модель обрезает сама (max_seq_length) — это не ошибка для пользователя.
        return normalize(self.model.encode(
            [prefix + t.strip() for t in texts], batch_size=self.batch_size,
            normalize_embeddings=True, convert_to_numpy=True,
            show_progress_bar=not query), len(texts))
