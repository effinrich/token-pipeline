/**
 * @tokens/export is a command-line tool, not a library with a public API.
 *
 * The entry point is src/write-artifact.ts, which the `write` target runs:
 *
 *   pnpm --filter @tokens/export write                  # reads the payload from stdin
 *   pnpm --filter @tokens/export write --file out.json  # reads the payload from a file
 *   pnpm --filter @tokens/export write --out other.json # writes elsewhere
 *
 * This module exists so the package has a valid entry point for the
 * TypeScript build. It deliberately has no side effects: importing it must
 * never write a file.
 */
export {};
