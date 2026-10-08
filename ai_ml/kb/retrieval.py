"""Поиск кандидатов. Здесь НЕТ жёсткого решения «подходит / не подходит»:
retriever только отбирает top-k похожих вопросов, а релевантность решает LLM."""


class Retriever:
    def __init__(self, encoder, index, top_k=5, floor=0.82):
        self.encoder, self.index, self.top_k, self.floor = encoder, index, top_k, floor

    def retrieve(self, question):
        if not isinstance(question, str) or not question.strip():
            raise ValueError('Question must be a nonempty string.')
        vector = self.encoder.encode([question.strip()[:2000]], query=True)[0]
        found = self.index.search(vector, top_k=self.top_k * 3)
        top_score = found[0]['score'] if found else None
        candidates, seen = [], set()
        for item in found:
            if item['score'] < self.floor:
                break
            key = ' '.join(item['answer'].casefold().split())
            if key in seen:  # один и тот же ответ на разных языках/формулировках — не тратим токены
                continue
            seen.add(key)
            candidates.append(item)
            if len(candidates) == self.top_k:
                break
        return {'candidates': candidates, 'top_score': top_score}
