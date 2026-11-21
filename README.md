# cohort-10-mern-20354-muhammad
Cohort 10 — MERN (NodeJS+ReactJS) assignment for Muhammad Anas Amir

## Project description

A professional notes management application: a React (Vite) single-page app, an
Express REST API, and PostgreSQL. Users register, log in, and create, read,
update, delete, search and filter their own rich-text notes.

The full approved design lives in [`docs/architecture.md`](docs/architecture.md).

> **Status:** only tooling is set up so far (Phase 02: repository and tooling
> baseline). There is no application code yet — no Express server, no database
> schema, no API, no UI beyond a placeholder heading. Features arrive in later
> phases of the roadmap defined in `docs/architecture.md`.

## Prerequisites

- **Node.js 22 LTS or newer** (see `.nvmrc`; developed on Node 24)
- **npm** (ships with Node)
- **Docker Desktop** (for local PostgreSQL 16)
- Git

## Setup

> Windows note: this path contains a space (`D:\Notes App`). Quote paths in
> every command you type.

```bash
# 1. Clone (quote the path because of the space)
git clone https://github.com/MrAnas07/cohort-10-mern-20354-muhammad.git "Notes App"
cd "Notes App"

# 2. Create local env files from the committed examples (placeholders only)
copy backend\.env.example backend\.env        # Windows
copy frontend\.env.example frontend\.env      # Windows
# macOS/Linux: cp backend/.env.example backend/.env
#              cp frontend/.env.example frontend/.env

# 3. Start PostgreSQL (creates the notes_dev and notes_test databases)
docker compose up -d

# 4. Install dependencies (POSIX paths — works on macOS/Linux and in
#    Git Bash / WSL on Windows)
cd backend && npm install
cd ../frontend && npm install
cd .. # back to the repository root

# 5. Create the schema and run the backend (from the repository root)
cd backend
npm run migrate # apply all Knex migrations (npm run migrate:status to inspect)
npm run seed # optional: development sample data
node src/server.js # API server on http://localhost:4000 (blocks; Ctrl+C stops it)

# In a second terminal, from the repository root:
cd backend && npm test # backend test suite

# 6. Run the frontend (in another terminal, from the repository root)
cd frontend
npm run dev # frontend dev server (Vite)
```

## Scripts

**Backend (`backend/`)**

| Script | Purpose |
| --- | --- |
| `npm test` | Run Mocha unit/integration tests |
| `npm run test:coverage` | Run tests with c8 coverage (`lcov` + `text` into `coverage/`) |
| `npm run migrate` | Apply pending Knex migrations (alias of `migrate:latest`) |
| `npm run migrate:status` | List applied and pending migrations |
| `npm run migrate:rollback` | Roll back the last migration batch |
| `npm run migrate:test` | Apply migrations to `TEST_DATABASE_URL` |
| `npm run seed` | Load development-only sample data |
| `npm run lint` | ESLint check |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run format` | Prettier write |
| `npm run format:check` | Prettier check |

**Frontend (`frontend/`)**

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview the production build |
| `npm test` | Run Jest tests |
| `npm run test:coverage` | Jest with `lcov` coverage into `coverage/` |
| `npm run lint` | ESLint check |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run format` | Prettier write |
| `npm run format:check` | Prettier check |

**Root**

| Command | Purpose |
| --- | --- |
| `docker compose up -d` | Start PostgreSQL 16 with `notes_dev` and `notes_test` |
| `docker compose down` | Stop PostgreSQL (data kept in the `notes_pgdata` volume) |

## Database

PostgreSQL 16 runs locally through Docker (step 3 above). The schema lives in
`backend/db/migrations/` (Knex) and is reproducible from zero. Connection
settings come from `backend/.env` (`DATABASE_URL`, `TEST_DATABASE_URL`); they
are validated at startup, so the app fails fast when they are missing or
malformed. Run these from the `backend/` folder:

```bash
npm run migrate         # apply pending migrations
npm run migrate:status  # list applied and pending migrations
npm run migrate:rollback # roll back the last batch
npm run migrate:test    # migrate TEST_DATABASE_URL (notes_test)
npm run seed            # optional: development-only sample data
```

The `/api/v1/health` endpoint reports database connectivity
(`data.database: "up" | "down"`) without failing the endpoint when the
database is unreachable.

## Folder overview

```
.
├── backend/            Node.js + Express API (CommonJS) — tooling only so far
├── frontend/           React + Vite app (ES modules) — tooling only so far
├── docker/postgres/    Init script that creates notes_dev and notes_test
├── docs/               architecture.md (approved design)
├── docker-compose.yml  Local PostgreSQL 16
├── README.md
├── .editorconfig
├── .gitignore
└── .nvmrc              Node 22
```

## Status

Tooling baseline only (Phase 02):

- ✅ Monorepo structure, lint/format/test tooling, PostgreSQL compose file
- ⏳ Application features (auth, notes CRUD, editor) — not started; see the
  roadmap in `docs/architecture.md`

## Known notes

- `npm audit` reports findings only in dev tooling dependencies (both
  packages currently have zero runtime dependencies).
- Docker verification is pending: `docker-compose.yml` exists but has not
  been run on this machine (Docker is not installed), so the PostgreSQL setup
  is unverified.
- For the same reason the Phase 04 migrations have **not yet been run against
  a live database**: they are covered by unit tests (files, ordering, `up`/
  `down` exports) until Docker or any PostgreSQL 16 is available — then
  `docker compose up -d && npm run migrate` verifies them end to end.
