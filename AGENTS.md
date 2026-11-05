# AGENTS.md

- Read [PROJECT_RULES.md](../project-final-197-FE/docs/PROJECT_RULES.md) for shared frontend/backend business rules before changing code.
- Use pnpm exclusively (pnpm.cmd in PowerShell). Run pnpm.cmd typecheck and pnpm.cmd test for backend changes.
- Keep project Markdown documentation under this repository's `docs/`; retain every `AGENTS.md` in its original location and update relative links when moving documents.

## 1. Project Overview

- Build a RESTful API using Node.js, Express.js, TypeScript, MongoDB and Mongoose.
- Follow a modular, maintainable architecture.

## 2. Coding Rules

- Use TypeScript with strict type checking.
- Prefer async/await for asynchronous operations.
- Use meaningful variable, function and file names.
- Avoid `any` unless there is a justified reason.
- Do not duplicate business logic across modules.

## 3. Architecture

- Keep routes, controllers, services and models separated.
- Routes define HTTP endpoints.
- Controllers handle HTTP requests and responses.
- Services contain business logic.
- Models define MongoDB schemas using Mongoose.
- Every top-level Mongoose model must explicitly declare its collection name. Use lowercase snake_case: separate words with `_` (for example `product_reviews`, `image_cleanup_jobs`); single-word names such as `users` remain valid. Do not rely on Mongoose's automatic lowercasing/pluralization. Update native collection references, aggregation lookups, seeds and maintenance scripts when renaming; preserve documents/indexes and never overwrite an existing destination collection.
- Middlewares handle authentication, authorization and request validation.

## 4. API Conventions

- Use appropriate HTTP methods and status codes.
- Validate request parameters, query strings and request bodies.
- Return consistent JSON responses.
- Handle errors through centralized error middleware.
- Never expose passwords, tokens or internal stack traces in API responses.

## 5. Security

- Never hardcode secrets or database credentials.
- Read configuration from environment variables.
- Do not commit `.env` files.
- Hash passwords before storing them.
- Verify authentication and authorization on protected endpoints.
- Validate and sanitize untrusted input.

## 6. Testing and Verification

- Inspect existing code before making changes.
- Reuse existing dependencies and conventions where possible.
- Run relevant tests and type checks after changes.
- Report which commands were run and whether they passed.
- Never claim tests passed if they were not executed.

## 7. Agent Workflow

- Explain the implementation plan before complex changes.
- Keep changes focused on the requested task.
- Do not delete files or change public APIs without justification.
- Ask for approval before destructive operations or changes affecting production data.
- Summarize changed files and verification results after each task.
