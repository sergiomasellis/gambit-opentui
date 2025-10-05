# Repository Guidelines

## Project Structure & Module Organization

This repository contains a React-based application built with Bun and TypeScript. The project structure is organized as follows:

- **src/**: Main source code directory
  - **lib/**: Utility libraries and core functionality
  - **types/**: TypeScript type definitions
  - **ui/**: React components and theming
  - **tools/**: Tool implementations and tests
- **node_modules/**: Dependencies (gitignored)
- **.gambit/**: Gambit CLI configuration and commands

## Build, Test, and Development Commands

Key development commands:
- `bun install` - Install project dependencies
- `bun run src/index.tsx` - Run the development server
- `bun test` - Run test suite (if tests exist)
- `bun build` - Build production artifacts

## Coding Style & Naming Conventions

- **Indentation**: 2 spaces for all files
- **Naming**: camelCase for variables/functions, PascalCase for classes/components
- **File naming**: kebab-case for filenames
- **TypeScript**: Strict mode enabled with comprehensive type checking
- **JSX**: React JSX with @opentui/react import source

## Testing Guidelines

**Testing Framework**: Bun's built-in test runner
**Test Location**: Co-located with source files using `.test.ts` suffix
**Test Structure**: Follow standard testing patterns with Jest-like API

Example test file: `src/lib/projectDocs.test.ts`

## Commit & Pull Request Guidelines

**Commit Messages**:
- Use descriptive commit messages that explain the change
- Reference related issues when applicable
- Follow conventional commit patterns: `type(scope): description`

**Pull Requests**:
- Include clear descriptions of changes made
- Reference any related issues or tickets
- Ensure code follows established patterns and conventions
- Include test coverage for new functionality

## Development Environment

- **Runtime**: Bun v1.2.20+
- **Package Manager**: Bun
- **Language**: TypeScript with strict mode
- **UI Framework**: React with @opentui/react components
- **Build Tool**: Bun built-in bundler

## Configuration Files

- **package.json**: Project dependencies and scripts
- **tsconfig.json**: TypeScript configuration with strict settings
- **.gitignore**: Git ignore patterns for dependencies and build artifacts
- **.env**: Environment variables (gitignored)

## Security & Best Practices

- Environment variables are managed through `.env` files (gitignored)
- Dependencies are locked with `bun.lock`
- TypeScript strict mode ensures type safety
- Regular dependency updates recommended
