# Net

Social media scheduling tool — compose once, publish everywhere.

## Platforms

- **Farcaster** — via Neynar API
- **Twitter/X** — via bird CLI
- **LinkedIn** — coming soon
- **Threads** — coming soon
- **Instagram** — coming soon

## Features

- Cross-posting to multiple platforms
- Schedule posts for specific date/time
- Buffer-style queue with recurring time slots
- Recurring posts via cron expressions
- Full media support (images, video, GIFs)
- Dark web dashboard (React)
- SQLite persistence
- Twitter import tool
- CLI for quick status checks

## Quick Start

```bash
# Install backend dependencies
npm install

# Install frontend dependencies
cd frontend && npm install && cd ..

# Copy and configure environment
cp .env.example .env
# Edit .env with your API keys

# Build frontend
npm run build:frontend

# Start
npm start
```

Open http://localhost:3000

## Development

```bash
# Terminal 1: Backend (auto-restart on changes)
npm run dev

# Terminal 2: Frontend (Vite dev server with HMR)
npm run dev:frontend
```

Frontend dev server runs at http://localhost:5173 and proxies API calls to :3000.

## CLI

```bash
npm run cli -- status     # Show platform and post stats
npm run cli -- posts      # List posts
npm run cli -- logs       # Show activity log
```

## Twitter Import

```bash
npm run import-twitter -- --user=elonmusk --min-likes=1000 --interval=45
npm run import-twitter -- --user=naval --dry-run
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/posts` | List posts |
| POST | `/api/posts` | Create post |
| PUT | `/api/posts/:id` | Update post |
| DELETE | `/api/posts/:id` | Delete post |
| POST | `/api/posts/:id/publish` | Publish immediately |
| GET | `/api/platforms` | List platforms |
| POST | `/api/platforms` | Add platform |
| POST | `/api/platforms/:id/test` | Test connection |
| GET | `/api/queue/slots` | List queue slots |
| POST | `/api/queue/add` | Add post to queue |
| GET | `/api/recurring` | List recurring rules |
| POST | `/api/media/upload` | Upload media |
| GET | `/api/activity` | Activity log |
| GET | `/api/stats` | Post statistics |

## Architecture

```
src/
  index.js              Main entry point
  config.js             Environment config
  db/sqlite.js          Database layer (SQLite + WAL)
  platforms/             Platform adapters (farcaster, twitter, ...)
  scheduler/             Scheduling engine, queue, recurring rules
  server/                HTTP server, router, API routes
  media/                 File upload and validation
  tools/                 Twitter import tool
  cli/                   Command-line interface
frontend/               React + Vite dashboard
```
