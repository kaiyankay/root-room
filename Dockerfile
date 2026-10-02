# Root Room as one container: the page, the engine and the exporter behind scripts/serve_web.py.
# Hugging Face Spaces (Docker) and Render both run it as is; the port comes from $PORT (Spaces: 7860).
FROM python:3.12-slim
WORKDIR /app
COPY . /app
RUN pip install --no-cache-dir jsonschema
ENV PORT=7860 \
    ROOT_ROOM_JSON_CACHE_MB=96
EXPOSE 7860
CMD ["sh", "-c", "python3 scripts/serve_web.py --host 0.0.0.0 --port ${PORT}"]
