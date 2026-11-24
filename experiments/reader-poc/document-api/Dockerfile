FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends pandoc poppler-utils util-linux \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 reader && install -d -o reader -g reader /data /sockets
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY *.py ./
USER reader
ENV READER_DB=/data/reader.sqlite3 PYTHONDONTWRITEBYTECODE=1
EXPOSE 8788
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8788", "--limit-concurrency", "16", "--no-access-log", "--no-proxy-headers"]
