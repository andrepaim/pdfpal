# Stage 1: Build frontend
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/ .
RUN npm install && npm run build
RUN cp node_modules/react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs dist/pdf.worker.min.mjs

# Stage 2: Runtime
FROM python:3.12-slim
WORKDIR /app/backend

RUN apt-get update && apt-get install -y curl && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs && npm install -g @anthropic-ai/claude-code && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

ENV CLAUDE_BIN=claude
ENV PDFPAL_DB=/app/data/pdfpal.db

EXPOSE 8200

CMD ["python3", "cli.py", "--host", "0.0.0.0", "--port", "8200"]
