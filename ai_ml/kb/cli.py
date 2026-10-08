"""Команды:  python -m kb.cli <prepare|index|search|ask|doctor>"""
import argparse
import hashlib
import json
import logging
from pathlib import Path

from .config import ROOT, Settings, resolve_path
from .dataset import prepare_records


def load_source(path):
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    records, excluded, report = prepare_records(path)
    if hashlib.sha256(path.read_bytes()).hexdigest() != before:
        raise ValueError('CSV changed during reading. Retry with a stable file.')
    report['source_sha256'] = before
    return records, excluded, report


def write_prepared(records, excluded, report):
    for directory, filename, rows in [('processed', 'qa_clean.jsonl', records), ('rejected', 'faq_excluded.jsonl', excluded)]:
        folder = ROOT / 'data' / directory
        folder.mkdir(parents=True, exist_ok=True)
        (folder / filename).write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows), encoding='utf-8')
    (ROOT / 'data/processed/index_report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')


def dump(value):
    print(json.dumps(value, ensure_ascii=False, indent=2))


def build_encoder(settings):
    from .embedding import E5
    return E5(settings.device, settings.batch_size)


def doctor(settings):
    """Проверка окружения: что именно мешает работать."""
    ok = True

    def line(flag, text):
        nonlocal ok
        ok = ok and flag
        print(('[ OK ] ' if flag else '[FAIL] ') + text)

    from .index import VectorIndex
    try:
        index = VectorIndex.load(resolve_path(settings.index_dir))
        line(True, f'Индекс: {len(index)} вопросов ({settings.index_dir})')
        meta = json.loads((resolve_path(settings.index_dir) / 'metadata.json').read_text(encoding='utf-8'))
        csv_hash = hashlib.sha256((ROOT / 'data/raw/faq.csv').read_bytes()).hexdigest()
        if meta.get('source_sha256') and meta['source_sha256'] != csv_hash:
            print('[WARN] faq.csv изменился после построения индекса -> python -m kb.cli index')
    except Exception as exc:  # noqa: BLE001
        line(False, f'Индекс: {exc}')
    try:
        import sentence_transformers  # noqa: F401
        line(True, 'sentence-transformers установлен (модель e5 скачается при первом запуске, ~1.1 ГБ)')
    except ImportError:
        line(False, 'sentence-transformers не установлен: pip install -r requirements.txt')
    from .llm import make_client
    try:
        client = make_client(settings)
        info = client.ping()
        line(info['reachable'], f'{settings.llm_provider}: сервер {"доступен" if info["reachable"] else "НЕ доступен (ollama serve?)"}')
        if info['reachable']:
            line(info['model_available'], f'Модель {settings.llm_model} ' + ('установлена' if info['model_available']
                 else f'не найдена. Выполните: ollama pull {settings.llm_model}'))
    except ValueError as exc:
        line(False, f'Настройки LLM: {exc}')
    print('\nВсё готово к запуску.' if ok else '\nИсправьте пункты [FAIL] и запустите снова.')
    return 0 if ok else 1


def main():
    parser = argparse.ArgumentParser(description='SDU helpdesk: база знаний + Ollama')
    parser.add_argument('command', choices=['prepare', 'index', 'search', 'ask', 'doctor'])
    parser.add_argument('--input', type=Path, default=ROOT / 'data/raw/faq.csv')
    parser.add_argument('--question')
    parser.add_argument('--language', choices=['auto', 'ru', 'kk', 'en'], default='auto')
    parser.add_argument('--top-k', type=int, default=5)
    args = parser.parse_args()

    from dotenv import load_dotenv
    load_dotenv(ROOT / '.env')
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(name)s: %(message)s')
    settings = Settings.from_env()

    if args.command == 'doctor':
        raise SystemExit(doctor(settings))
    if args.command in {'prepare', 'index'}:
        records, excluded, report = load_source(args.input)
        write_prepared(records, excluded, report)
        dump(report)
        if args.command == 'prepare':
            return
        from .index import VectorIndex
        encoder = build_encoder(settings)
        vectors = encoder.encode([r['question'] for r in records])
        VectorIndex.save(resolve_path(settings.index_dir), records, vectors, report['source_sha256'])
        print(f'Индекс построен: {len(records)} вопросов.')
        return

    if not args.question or not args.question.strip():
        parser.error('--question is required')
    from .index import VectorIndex
    from .retrieval import Retriever
    index = VectorIndex.load(resolve_path(settings.index_dir))
    encoder = build_encoder(settings)
    retriever = Retriever(encoder, index, args.top_k if args.command == 'search' else settings.top_k, 0.0 if args.command == 'search' else settings.candidate_floor)
    if args.command == 'search':
        found = retriever.retrieve(args.question)
        dump([{**c, 'answer': c['answer'][:200]} for c in found['candidates']])
        return
    from .generation import AnswerService
    from .llm import make_client
    service = AnswerService(retriever, make_client(settings), settings.read_context(), settings.source_only_min)
    dump(service.answer(args.question, args.language))


if __name__ == '__main__':
    main()
