# AGENTS.md - Developer Guide for T-800

This file provides guidance for agentic coding agents operating in this repository.

## Project Overview

T-800 is a web-based, self-hosted server management platform with SSH terminal, RDP/VNC/Telnet (Guacamole), SSH tunneling, SFTP file management, Docker container control, and server monitoring.

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/Radix UI
- **Backend**: Express 5 (Node.js), TypeScript, SQLite + Drizzle ORM
- **Desktop**: Electron 38
- **Terminal**: xterm.js; **Code editors**: CodeMirror 6, Monaco Editor

## Build Commands

```bash
# Development
npm run dev              # Frontend dev server (port 5173)
npm run dev:backend      # Compile + run backend

# Full build (frontend + backend)
npm run build

# Code quality
npm run lint             # ESLint
npm run lint:fix         # ESLint with auto-fix
npm run format           # Prettier write
npm run format:check     # Prettier check only
npm run type-check       # tsc --noEmit

# Electron builds
npm run build:linux-appimage
npm run build:win-installer
npm run build:mac
```

## Code Style Guidelines

### Formatting (Prettier)

- **Double quotes** for all strings
- **2-space indent**
- **Trailing commas** (all)
- **Print width**: 80 characters
- **Line endings**: LF

### ESLint Rules

- `@typescript-eslint/no-unused-vars`: warn
- `@typescript-eslint/no-explicit-any`: warn
- `@typescript-eslint/no-unused-expressions`: warn
- `no-empty`: warn
- `react-refresh/only-export-components`: warn

### TypeScript

- Use `import type` for type-only imports
- Path alias: `@/*` maps to `./src/*`
- Avoid `any`; use `unknown` or proper types when possible

### Import Conventions

- Group imports: external libs → internal modules → styles
- Use absolute paths with `@/` for internal imports
- Type imports: `import type { Foo } from "..."`
- Default imports for React components: `import Component from "..."`

### React/Component Patterns

- Use functional components with FC typing for complex components
- Use `useState<T>`, `useEffect`, `useRef` hooks
- Prepend hooks with `use` (useXxx)
- Use sonner for toasts/notifications

### Error Handling

- Use try/catch with async/await for async operations
- Log errors using the appropriate logger (authLogger, etc.)
- Return proper HTTP status codes in API routes
- Use zod for input validation in API routes

### Naming Conventions

- **Files**: kebab-case (terminal-manager.ts)
- **Components**: PascalCase (TerminalApp.tsx)
- **Hooks**: camelCase with use prefix (useTerminal.ts)
- **Constants**: UPPER_SNAKE_CASE
- **Interfaces**: PascalCase, prefix with I or describe entity (User, HostConfig)

### Backend Patterns

- Express routes in `src/backend/database/routes/`
- Database queries via Drizzle ORM
- Authentication via JWT in headers
- Use `db` from `../db/index.js` for queries
- Encryption at rest via `DataCrypto` utility

### Frontend Patterns

- State management via React Context API + component state
- API calls via `src/lib/main-axios.ts`
- UI components in `src/components/` (shadcn-based)
- Feature modules in `src/ui/desktop/apps/features/`

## Git & Commit Rules

- **Pre-commit hook**: lint-staged runs Prettier on staged files
- **Commit messages**: conventional commits enforced via commitlint
- Format: `type(scope): description` (e.g., `feat(terminal): add SSH connection retry`)
- Types: feat, fix, docs, style, refactor, test, chore

## Key Files & Directories

```
src/                          # Frontend source
  main.tsx                    # Entry point
  ui/desktop/                 # Desktop layout & features
  ui/mobile/                  # Mobile layout
  components/                 # Shared UI components
  hooks/                      # Custom React hooks
  lib/main-axios.ts           # API client
  types/                      # TypeScript types

src/backend/                  # Backend source
  starter.ts                  # Entry point
  database/db/                # Drizzle schema & queries
  database/routes/            # Express routes
  ssh/                        # SSH services
  guacamole/                  # RDP/VNC integration
  utils/                      # Auth, crypto, logging

electron/                     # Electron main process
```

## Environment Variables

- `DATA_DIR` - data storage (default: `./db/data`)
- `PORT` - HTTP port (default: 4090)
- `SSL_ENABLED` - enable HTTPS
- `ENABLE_GUACAMOLE` - enable RDP/VNC (default: true)
- `VITE_BASE_PATH` - frontend base URL path

## Common Development Tasks

```bash
# Run backend only
npm run dev:backend

# Build for production
npm run build

# Start Electron dev mode
npm run electron:dev

# Rebuild native modules (better-sqlite3)
npm run electron:rebuild
```

## Database

- SQLite with Drizzle ORM
- Schema in `src/backend/database/db/schema.ts`
- Migrations via Drizzle kit (if enabled)
- Data encryption at rest for sensitive fields
