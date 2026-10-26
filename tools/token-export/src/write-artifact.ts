/**
 * Writes the exported payload to the committed artifact.
 *
 * The Figma plugin cannot touch the filesystem, so it hands the payload over
 * as text. This script is the other half of that hand-off: it validates the
 * payload and writes tokens/tokens.json.
 *
 *   pnpm --filter @tokens/export write                  # reads stdin
 *   pnpm --filter @tokens/export write --file out.json  # reads a file
 *   pnpm --filter @tokens/export write --out other.json # writes elsewhere
 *
 * Relative paths resolve from this package's directory, because pnpm runs a
 * filtered script with the working directory set to the package.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(HERE, '../../..');
const DEFAULT_OUTPUT_PATH = resolve(WORKSPACE_ROOT, 'tokens', 'tokens.json');

interface CliOptions {
  inputFile: string | null;
  outputPath: string;
}

function fail(message: string): never {
  console.error(`[token-export] ${message}`);
  process.exit(1);
}

function printUsage(): void {
  console.log(
    [
      '[token-export] Usage:',
      '  pnpm --filter @tokens/export write                     read the payload from stdin',
      '  pnpm --filter @tokens/export write --file payload.json  read the payload from a file',
      '  pnpm --filter @tokens/export write --out path.json      write somewhere else',
      '',
      '  The payload can also be piped straight in:',
      '    Get-Clipboard -Raw | pnpm --filter @tokens/export write',
    ].join('\n'),
  );
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { inputFile: null, outputPath: DEFAULT_OUTPUT_PATH };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--help' || argument === '-h') {
      printUsage();
      process.exit(0);
    }

    if (argument === '--file' || argument === '--out') {
      const value = argv[index + 1];
      if (!value) {
        fail(`${argument} needs a path`);
      }
      index += 1;
      if (argument === '--file') {
        options.inputFile = value;
      } else {
        options.outputPath = resolve(process.cwd(), value);
      }
      continue;
    }

    fail(`unknown argument "${argument}"`);
  }

  return options;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function assertArtifact(value: unknown): asserts value is { collections: unknown[]; tokens: unknown[] } {
  if (typeof value !== 'object' || value === null) {
    fail('the payload is not a JSON object');
  }
  const artifact = value as { artifactVersion?: unknown; collections?: unknown; tokens?: unknown };

  if (artifact.artifactVersion !== 1) {
    fail(`unsupported artifactVersion ${String(artifact.artifactVersion)} (expected 1)`);
  }
  if (!Array.isArray(artifact.collections) || artifact.collections.length === 0) {
    fail('the payload has no collections');
  }
  if (!Array.isArray(artifact.tokens) || artifact.tokens.length === 0) {
    fail('the payload has no tokens');
  }
}

function readInputFile(path: string): string {
  const absolute = resolve(process.cwd(), path);
  try {
    return readFileSync(absolute, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      fail(`no such file: ${absolute}`);
    }
    fail(`could not read ${absolute}: ${(error as Error).message}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  let raw: string;
  if (options.inputFile) {
    raw = readInputFile(options.inputFile);
  } else if (process.stdin.isTTY) {
    fail(
      'no payload on stdin. Pipe the JSON in (for example Get-Clipboard -Raw | pnpm --filter @tokens/export write) or pass --file <path>.',
    );
  } else {
    raw = await readStdin();
  }

  if (raw.trim() === '') {
    fail('no payload on stdin. Run the Figma plugin first, or pass --file <path>.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`the payload is not valid JSON: ${(error as Error).message}`);
  }
  assertArtifact(parsed);

  mkdirSync(dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');

  const artifact = parsed as { collections: { name: string }[]; tokens: unknown[] };
  console.log(`[token-export] wrote ${artifact.tokens.length} tokens from ${artifact.collections.length} collection(s)`);
  console.log(`[token-export] wrote ${options.outputPath}`);
  console.log('[token-export] next: pnpm nx run tokens:generate');
}

await main();
