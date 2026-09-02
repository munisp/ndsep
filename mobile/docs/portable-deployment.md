# Portable Deployment Guide

This platform has been refactored toward a **portable stack** so it can run outside the Manus environment. The remaining architecture keeps the existing Expo, React Native, Express, tRPC, and Drizzle foundations, but the platform-specific assumptions are replaced by **standard environment-driven integrations**.

## Replacement map

| Previous dependency style | Portable replacement |
| --- | --- |
| Hosted built-in LLM proxy | Any OpenAI-compatible endpoint, including **Ollama**, vLLM, LM Studio, or standard hosted providers |
| Hosted storage proxy | Local filesystem uploads or any S3-compatible object store such as MinIO, Cloudflare R2, AWS S3, or Backblaze B2 |
| Hosted OAuth bridge | Local JWT sessions issued by the app backend; optional future upgrade to Keycloak, Authentik, or Zitadel |
| Hosted preview hostname inference | Explicit `EXPO_PUBLIC_API_BASE_URL` and `PUBLIC_STORAGE_BASE_URL` environment configuration |

## Required environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string for Drizzle, using `postgresql://` or `postgres://` |
| `JWT_SECRET` or `SESSION_SECRET` | Secret used to sign local JWT sessions |
| `APP_ID` | Logical app identifier used in local sessions |
| `AUTH_ISSUER` | JWT issuer string for local auth |
| `AUTH_AUDIENCE` | JWT audience string for local auth |
| `AI_API_URL` | OpenAI-compatible chat API base URL, e.g. `http://localhost:11434/v1` |
| `AI_API_KEY` | API key for the selected provider; for local Ollama, use any placeholder such as `ollama` |
| `AI_MODEL` | Default model, for example `llama3.1:8b` or another available model |
| `PUBLIC_STORAGE_BASE_URL` | Public base URL used to serve uploaded files |
| `APP_BUNDLE_ID` | Mobile bundle or package identifier |
| `EXPO_PUBLIC_API_BASE_URL` | Mobile and web client base URL for the backend |
| `EXPO_PUBLIC_APP_SCHEME` | Native deep-link scheme |

## Recommended open-source deployment pattern

The backend can run as a standard Node.js service behind Nginx, Caddy, or Traefik. Uploaded files are served from `server/uploads/` locally or mapped to external object storage. For AI extraction, start with **Ollama** for local development and move to a compatible provider only if you need larger multimodal models.

A starter orchestration file is included at `docker-compose.portable.yml`. It brings up the app, PostgreSQL, MinIO, and Ollama so teams can reproduce the portable baseline quickly in non-Manus environments. The file requires explicit PostgreSQL and object-storage credentials; it supplies no default database credential.

## Suggested next infrastructure steps

Use **Keycloak** or **Authentik** if you want enterprise-grade identity beyond the local JWT login. Use **MinIO** if you want object storage parity in development and production. Use **Temporal**, **Kafka**, and **Redis** only when you are ready to deploy the wider workflow and event topology introduced elsewhere in this platform.

If you are taking this to production, the recommended sequence is to replace local JWT login with Keycloak or Authentik, move uploads from the local filesystem to MinIO or S3-compatible storage, front the APIs with Caddy or Traefik, and pin the AI runtime to a managed Ollama or OpenAI-compatible model endpoint.
