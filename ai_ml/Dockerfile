# AI service (knowledge-base search + answers/moderation via Ollama).
# Started by the root docker-compose.yml; Ollama itself runs on the host.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # Slow connections: wait longer and retry instead of failing the build.
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=10

WORKDIR /app

# CPU-only PyTorch first: the default Linux wheel bundles CUDA (~2.5 GB),
# which the search model doesn't need — Ollama does the heavy work on the GPU.
COPY requirements.txt .
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch \
 && pip install -r requirements.txt

COPY . .

EXPOSE 8001
# 0.0.0.0 inside the container is fine: the port is only reachable on the
# Docker network (and from this computer, see docker-compose.yml).
CMD ["python", "-m", "uvicorn", "kb.api:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
