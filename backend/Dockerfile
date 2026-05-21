FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

COPY pyproject.toml uv.lock* ./
RUN pip install --no-cache-dir \
  aiofiles \
  "anthropic>=0.40.0" \
  "fastapi>=0.136.1" \
  "httpx>=0.28.1" \
  "openai>=2.32.0" \
  "passlib[bcrypt]>=1.7.4" \
  "pydantic>=2.13.3" \
  "pydantic-settings>=2.14.0" \
  "python-dotenv>=1.2.2" \
  "python-jose[cryptography]>=3.5.0" \
  "python-multipart>=0.0.27" \
  "supabase>=2.29.0" \
  "uvicorn[standard]>=0.46.0"

COPY backend ./backend

EXPOSE 8000
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
