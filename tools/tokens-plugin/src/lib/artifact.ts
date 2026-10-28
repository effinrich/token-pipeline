/**
 * The committed artifact: the contract between Figma and the code.
 *
 * The artifact is written by the Figma export step and is the only input the
 * generator ever reads. Nothing in this file, and nothing in this package,
 * talks to Figma.
 */
import { resolveCssVarName } from './css-var';

export type TokenType = 'COLOR' | 'LENGTH' | 'FLOAT' | 'STRING' | 'BOOLEAN';

export interface ArtifactMode {
  id: string;
  name: string;
}

export interface ArtifactCollection {
  id: string;
  name: string;
  defaultModeId: string;
  modes: ArtifactMode[];
}

export interface ArtifactToken {
  name: string;
  type: TokenType;
  codeSyntax: Record<string, string | undefined>;
  collectionId: string;
  values: Record<string, string>;
  alias?: Record<string, string>;
}

export interface Artifact {
  artifactVersion: number;
  exportedAt: string;
  source: { fileName: string; fileKey: string | null; pluginVersion: string };
  collections: ArtifactCollection[];
  tokens: ArtifactToken[];
}

function fail(message: string): never {
  throw new Error(`[token-generator] ${message}`);
}

/**
 * Parses the artifact and rejects anything the generator cannot honour.
 *
 * The failures are loud and specific on purpose. A token with no code syntax
 * is a mistake a designer can fix in Figma, and the message should say so
 * rather than fail with a stack trace.
 */
export function parseArtifact(raw: string): Artifact {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`the artifact is not valid JSON: ${(error as Error).message}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    fail('the artifact is not a JSON object');
  }

  const artifact = parsed as Partial<Artifact>;

  if (artifact.artifactVersion !== 2) {
    fail(`unsupported artifactVersion ${String(artifact.artifactVersion)} (this generator understands version 2)`);
  }
  if (!Array.isArray(artifact.collections) || artifact.collections.length === 0) {
    fail('the artifact has no collections');
  }
  if (!Array.isArray(artifact.tokens) || artifact.tokens.length === 0) {
    fail('the artifact has no tokens');
  }

  return artifact as Artifact;
}

/**
 * Checks that an aliased token carries the value of the token it points at.
 *
 * The Figma plugin resolves aliases before it writes the artifact, so a
 * mismatch here means the artifact was edited by hand and the two halves no
 * longer agree. Regenerating would paper over it, so the check refuses.
 */
export function assertAliasesMatchTargets(artifact: Artifact): void {
  const byName = new Map(artifact.tokens.map((token) => [token.name, token]));

  for (const token of artifact.tokens) {
    if (!token.alias) continue;

    for (const [modeName, targetName] of Object.entries(token.alias)) {
      const target = byName.get(targetName);
      if (!target) {
        fail(`token "${token.name}" aliases "${targetName}", which is not in the artifact`);
      }

      const expected = target.values[modeName];
      if (expected === undefined) {
        fail(`token "${targetName}" has no value for mode "${modeName}"`);
      }

      const actual = token.values[modeName];
      if (actual !== expected) {
        fail(`token "${token.name}" in mode "${modeName}" is ${actual}, but "${targetName}" is ${expected}`);
      }
    }
  }
}

/**
 * Checks that every token has a distinct name.
 *
 * Figma allows two variables to share a name when they live in different
 * collections - that is how a second brand or theme is modelled. This
 * generator reads every local variable and has no way to tell two of them
 * apart, so the artifact has to be unambiguous.
 *
 * Left alone, this would surface as a duplicate key in the generated
 * TypeScript and a duplicated declaration in the generated CSS, which is a
 * long way from the mistake. And like the alias check, the byte comparison
 * cannot see it: regenerating reproduces the clash faithfully.
 */
export function assertTokenNamesAreUnique(artifact: Artifact): void {
  const collectionNameById = new Map(artifact.collections.map((collection) => [collection.id, collection.name]));
  const seen = new Map<string, string>();

  for (const token of artifact.tokens) {
    const previousCollection = seen.get(token.name);
    if (previousCollection !== undefined) {
      fail(
        `token "${token.name}" is defined in more than one collection ("${previousCollection}", ` +
          `"${collectionNameById.get(token.collectionId) ?? token.collectionId}"). ` +
          'This generator reads every local variable and cannot tell them apart, so each token needs a unique name.'
      );
    }

    seen.set(token.name, collectionNameById.get(token.collectionId) ?? token.collectionId);
  }
}

/**
 * Checks that no two tokens claim the same CSS custom property.
 *
 * The CSS anchor comes from the Figma code syntax, and Figma lets two
 * variables carry the same one. The generator would then emit that custom
 * property twice in every block, and the later declaration would win
 * silently - so asking for one token would hand back the other's value.
 *
 * Like the alias check, this is a fault in the artifact rather than in the gap
 * between the artifact and the output: regenerating reproduces it faithfully,
 * so the byte comparison passes. It has to be checked on its own.
 */
export function assertCssAnchorsAreUnique(artifact: Artifact): void {
  const tokenByAnchor = new Map<string, string>();

  for (const token of artifact.tokens) {
    const resolved = resolveCssVarName(token.codeSyntax['WEB']);
    // A missing or malformed code syntax has its own, more specific message.
    if (!resolved.ok) continue;

    const existing = tokenByAnchor.get(resolved.name);
    if (existing !== undefined) {
      fail(
        `token "${token.name}" uses the CSS custom property "${resolved.name}", which token "${existing}" already uses. ` +
          'Every token needs its own code syntax in Figma.'
      );
    }

    tokenByAnchor.set(resolved.name, token.name);
  }
}
