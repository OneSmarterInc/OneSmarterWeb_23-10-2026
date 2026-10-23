# Docker Deployment Guide for OneSmarter Web

This project includes a production-ready, multi-stage Docker setup supporting both the static React Single Page Application (SPA) and all serverless/API agent routes (`/api/agents/*`).

---

## Quick Start (Production)

### 1. Build and Run with Docker Compose (Recommended)

```bash
docker compose up --build -d
```

The web application will be accessible at:
- **Web App & APIs**: [http://localhost:3000](http://localhost:3000)
- **Health Check**: [http://localhost:3000/api/health](http://localhost:3000/api/health)

To view logs:
```bash
docker compose logs -f app
```

To stop:
```bash
docker compose down
```

---

### 2. Build and Run with Docker CLI directly

#### Build image:
```bash
docker build -t onesmarter-web .
```

#### Run container:
```bash
docker run -d \
  -p 3000:3000 \
  --name onesmarter-web \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -e MIRA_LLM_MODE=staging_llm \
  -e MIRA_LLM_PROVIDER=ollama \
  -e MIRA_LLM_MODEL=qwen2.5:0.5b \
  -e OLLAMA_BASE_URL=http://host.docker.internal:11434 \
  onesmarter-web
```

---

## Architecture Overview

| Component | In Docker Container | Details |
|-----------|---------------------|---------|
| **Base Image** | `node:20-alpine` | Lightweight, minimal attack surface (~140MB). |
| **User** | `node` (non-root) | Security best practice; does not run as root. |
| **Frontend** | Static Vite bundle in `dist/` | Gzip compression, SPA route fallback, HTTP caching. |
| **API Backend** | Node.js HTTP server (`server.js`) | Handles all `/api/agents/*` endpoints seamlessly. |
| **Security Headers** | Enforced on all responses | CSP, HSTS, X-Frame-Options, X-Content-Type-Options. |
| **Health Check** | `GET /api/health` | Docker HEALTHCHECK pings every 30s. |

---

## Local Development in Docker

If you prefer to run live development with Hot Module Replacement (HMR) inside Docker:

```bash
docker compose -f docker-compose.dev.yml up --build
```
Your local code is mounted directly into the container.
Accessible at: [http://localhost:5173](http://localhost:5173).

---

## Running with Ollama in Docker

If you want to run Ollama inside Docker alongside the application (instead of using host Ollama):

```bash
docker compose --profile with-ollama up --build -d
```

Then pull the desired model inside the Ollama container:
```bash
docker exec -it onesmarter-ollama ollama pull qwen2.5:0.5b
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port for the HTTP server |
| `NODE_ENV` | `production` | Environment mode |
| `MIRA_LLM_MODE` | `staging_llm` | `staging_llm` or `mock` |
| `MIRA_LLM_PROVIDER` | `ollama` | `ollama` or `openai` |
| `MIRA_LLM_MODEL` | `qwen2.5:0.5b` | Model name |
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | Ollama URL reachable from container |
| `CAFE_OLLAMA_BASE_URL`| `http://host.docker.internal:11434` | Café Ollama URL |
| `OPENAI_API_KEY` | *(empty)* | Optional OpenAI API Key if using OpenAI provider |
