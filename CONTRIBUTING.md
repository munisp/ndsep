# Contributing to NDSEP

Thank you for your interest in contributing to the National Data Sovereignty Enforcement Platform.

## Development Setup

1. Follow the [Quick Start](README.md#quick-start) guide
2. Ensure all prerequisites are installed
3. Run `pnpm install` and `pnpm dev` to verify your setup

## Code Standards

### TypeScript
- **Strict mode** is enforced (`"strict": true` in tsconfig.json)
- Do not use `any` — define proper interfaces/types
- Do not use `@ts-ignore` or `@ts-expect-error`
- Do not use `eval()` or `Function()` constructor
- All tRPC procedures must have Zod input schemas
- All errors must be caught and logged via the structured logger (pino), never `console.log`

### Naming Conventions
- **Files**: `camelCase.ts` for server, `PascalCase.tsx` for React components
- **Variables/functions**: `camelCase`
- **Types/interfaces**: `PascalCase`
- **Database tables**: `snake_case` (Drizzle schema)
- **Environment variables**: `UPPER_SNAKE_CASE`

### Security Requirements
- Never hardcode secrets, API keys, or credentials
- All PII fields must use field-level encryption (see `server/kms.ts`)
- All user input must be validated with Zod schemas before processing
- Use parameterized queries exclusively — no string interpolation in SQL
- CSRF tokens required on all state-changing operations
- Test with `security/automated-security-tests.ts` before submitting security-related PRs

### Frontend
- Use Radix UI primitives for accessible components
- Include ARIA attributes on interactive elements
- Support dark mode via `dark:` Tailwind classes
- Use `React.lazy()` for page-level code splitting
- Handle loading and error states for all async operations

### Database
- All schema changes go through Drizzle ORM (`drizzle/schema.ts`)
- Create a migration file in `migrations/` for every schema change
- Add foreign key constraints for referential integrity
- Include audit trail entries for data modifications

## Pull Request Process

1. Create a feature branch from `main`: `git checkout -b feature/description`
2. Make your changes following the code standards above
3. Ensure TypeScript compiles clean: `npx tsc --noEmit`
4. Run tests: `pnpm test`
5. Run security tests if applicable: `npx tsx security/automated-security-tests.ts`
6. Submit a PR with a clear description of changes and motivation

### PR Requirements
- TypeScript must compile with zero errors
- All existing tests must pass
- New features should include tests
- Security-sensitive changes require review from the security team
- Database schema changes require migration files

## Architecture Decisions

Major architectural decisions are documented in:
- `CHANGELOG*.md` — Phase-by-phase implementation history
- `security/DPIA-NDSEP-Platform.md` — Data protection impact assessment
- `openapi.yaml` — API contract documentation

## Reporting Issues

- **Security vulnerabilities**: Email security@ndsep.gov.ng (do not open public issues)
- **Bugs**: Open a GitHub issue with reproduction steps
- **Feature requests**: Open a GitHub issue with use case description

## License

By contributing, you agree that your contributions will be licensed under the project's proprietary license.
