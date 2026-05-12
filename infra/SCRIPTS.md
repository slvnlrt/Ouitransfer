# Infrastructure Scripts

## Docker Architecture

Ouitransfer runs as 3 containers via Docker Compose:

| Service   | Image                     | Port | Description                     |
|-----------|---------------------------|------|---------------------------------|
| storage   | `rustfs/rustfs:latest`    | 9000 | S3-compatible object storage    |
| server    | `ouitransfer/server`      | 3333 | Fastify API                     |
| web       | `ouitransfer/web`         | 5487 | Next.js frontend                |

## Files

| File              | Purpose                                      |
|-------------------|----------------------------------------------|
| `Dockerfile`      | Multi-target build (server-runner, web-runner)|
| `docker-compose.yaml` | 3-service orchestration                 |
| `server-start.sh` | Server entrypoint (DB setup, privilege drop) |
| `.env.example`    | Environment variable reference               |

## Common Commands

```bash
# Start all services
just docker-start

# Build images locally
just docker-build

# Build and push multi-platform images
just docker-push v3.4.0

# View logs
just docker-logs

# Shell into server
just docker-shell
```

See `just --list` for all available recipes.
