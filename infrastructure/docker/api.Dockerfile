FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY requirements.txt requirements.lock ./
# exact tested versions as constraints (Windows-only pins such as colorama are simply unused here)
RUN pip install --no-cache-dir -r requirements.txt -c requirements.lock boto3
COPY . .
RUN useradd -m app && chown -R app /app
USER app
EXPOSE 8000
