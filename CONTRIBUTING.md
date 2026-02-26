# Contributing to GigaFlair SIP2 Bridge

Thank you for your interest in contributing! This guide covers everything you need to get started.

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [Development Setup](#development-setup)
4. [Making a Contribution](#making-a-contribution)
5. [Coding Standards](#coding-standards)
6. [Testing](#testing)
7. [Commit Messages](#commit-messages)
8. [Submitting a Pull Request](#submitting-a-pull-request)

---

## Code of Conduct

This project follows our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

---

## Getting Started

- **Bug reports**: Search [existing issues](https://github.com/GigaFlair-LLC/gigaflair-sip2-bridge/issues) before opening a new one. Use the **Bug Report** template.
- **Feature requests**: Open a [feature request](https://github.com/GigaFlair-LLC/gigaflair-sip2-bridge/issues/new?template=feature_request.md) and describe the use case.
- **Security vulnerabilities**: Do **not** open a public issue. Follow the [Security Policy](SECURITY.md) instead.

---

## Development Setup

### Prerequisites

- **Node.js** 20.x or 22.x LTS
- **npm** 9+

### Install and Run

```bash
git clone https://github.com/GigaFlair-LLC/gigaflair-sip2-bridge.git
cd gigaflair-sip2-bridge
npm install

# Copy and configure your local environment
cp .env.example .env
# Edit .env with your test ILS details

# Start with hot-reload
npm run dev
```

### Run Tests

```bash
# Full suite
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Mock ILS Server

A built-in SIP2 mock server is available for local testing without a real ILS:

```bash
npm run mock:lms
```

---

## Making a Contribution

1. [Fork the repository](https://github.com/GigaFlair-LLC/gigaflair-sip2-bridge/fork) and create a branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   # or
   git checkout -b fix/the-bug
   ```
2. Write your code and tests.
3. Ensure `npm test` and `npm run typecheck` both pass.
4. Open a pull request against `main`.

---

## Coding Standards

- **Language**: TypeScript (strict mode). All new code must type-check cleanly (`npm run typecheck`).
- **Linting**: Run `npm run lint` before opening a PR. Fix all warnings.
- **Formatting**: Follow the existing code style — Prettier-compatible, 4-space indent, single quotes.
- **No secrets in code**: Never hardcode credentials, API keys, or IP addresses. Use environment variables.
- **PII safety**: Never add logging that could expose patron barcodes, names, or passwords. See [`SECURITY.md`](SECURITY.md).

---

## Testing

- All new features require corresponding tests in the `tests/` directory.
- All bug fixes should include a regression test.
- Tests use [Vitest](https://vitest.dev/). Match the style of existing test files.
- The mock ILS (`tests/mock-lms.ts`) should be used for integration tests — do not rely on a real ILS.

---

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add renewal support to patron route
fix: prevent race condition in connection reinitialize
docs: update installation guide for Docker
test: add regression test for checksum edge case
chore: update dependencies
```

---

## Submitting a Pull Request

1. Ensure your branch is up to date with `main`.
2. Fill in the PR template completely.
3. Link to any related issues (`Closes #123`).
4. A maintainer will review your PR within a few business days.
5. Address review feedback promptly — stale PRs may be closed after 30 days of no activity.

Thank you for helping improve the GigaFlair SIP2 Bridge!
