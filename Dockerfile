FROM python:3.11-slim

ENV HOST=0.0.0.0 \
    PORT=8080 \
    GITE_OPEN_BROWSER=0 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY . .

RUN mkdir -p /app/data

EXPOSE 8080

CMD ["python", "server.py"]
