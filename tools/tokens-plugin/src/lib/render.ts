/**
 * Turns the committed artifact into:
 *   - libs/tokens/src/tokens.css          CSS custom properties, one block per Figma mode
 *   - libs/tokens/src/tokens.generated.ts  the token-name contract
 *
 * Nothing in this file talks to Figma. The artifact is the only input, which is
 * what makes the build hermetic and every token change reviewable in a diff.
 *
 * The output is deterministic on purpose. No formatter runs over it, so the
 * committed files change only when the artifact changes. A prettier upgrade
 * must never show up in a token diff.
 */
import { resolveCssVarName } from './css-var';
import type { Artifact, ArtifactToken, TokenType } from './artifact';

function fail(message: string): never {
  throw new Error(`[token-generator] ${message}`);
}

/**
 * The CSS custom property name comes from the variable's WEB code syntax and
 * nowhere else. We never derive it from the Figma variable name, because a
 * derived name is a second convention that can drift away from the first.
 */
function cssVarName(token: ArtifactToken): string {
  const resolved = resolveCssVarName(token.codeSyntax['WEB']);
  if (!resolved.ok) {
    fail(`token "${token.name}" ${resolved.problem}`);
  }
  return resolved.name;
}

/**
 * The artifact's types are the pipeline's, not Figma's.
 *
 * Figma has no length type: a number variable is an untyped number, and what
 * it means depends on the field it is used in. The plugin reads that from the
 * variable's scope, so by the time an artifact reaches this file the unit is
 * already decided:
 *
 *   LENGTH   a pixel length - the value is a bare number and the unit is added
 *            here, so the artifact never carries a hand-written "16px".
 *   FLOAT    a number with no unit - opacity, font weight, a multiplier. The
 *            value is passed through exactly as Figma stored it.
 *
 * A LENGTH written with its unit already in the value is a mistake, and the
 * pattern below rejects it: "16px" is not a LENGTH, it is a LENGTH twice.
 */
const VALUE_PATTERNS: Record<TokenType, RegExp> = {
  COLOR: /^#[0-9a-f]{3,8}$/i,
  LENGTH: /^-?\d*\.?\d+$/,
  FLOAT: /^-?\d*\.?\d+$/,
  STRING: /^.*$/s,
  BOOLEAN: /^(true|false)$/,
};

function checkValue(token: ArtifactToken, modeName: string, value: string): void {
  const pattern = VALUE_PATTERNS[token.type];
  if (!pattern) {
    fail(`token "${token.name}" has unknown type "${token.type}"`);
  }
  if (!pattern.test(value)) {
    fail(`token "${token.name}" has value "${value}" for mode "${modeName}", which is not a valid ${token.type}`);
  }
}

/**
 * v1 supports one theme axis. Every collection must expose the same mode names
 * in the same order, and they must agree on which mode is the default.
 *
 * A second axis (compact/comfortable on top of light/dark) would need a
 * compound selector matrix - one custom property per axis combination - which
 * is a different data model. We rejected that for v1 rather than half-build it.
 */
export function resolveThemes(artifact: Artifact): { defaultMode: string; themeModes: string[] } {
  const reference = artifact.collections[0];
  if (!reference) {
    fail('artifact has no collections');
  }
  const referenceNames = reference.modes.map((mode) => mode.name);

  for (const collection of artifact.collections) {
    const names = collection.modes.map((mode) => mode.name);
    const sameLength = names.length === referenceNames.length;
    const sameOrder = names.every((name, index) => name === referenceNames[index]);
    if (!sameLength || !sameOrder) {
      fail(
        `collections "${reference.name}" [${referenceNames.join(', ')}] and "${collection.name}" [${names.join(', ')}] ` +
          `declare different modes. This pipeline supports a single theme axis: every collection must declare the same mode names in the same order.`,
      );
    }
  }

  const defaultMode = reference.modes.find((mode) => mode.id === reference.defaultModeId);
  if (!defaultMode) {
    fail(`collection "${reference.name}" has defaultModeId "${reference.defaultModeId}", which is not one of its modes`);
  }

  for (const collection of artifact.collections) {
    const mode = collection.modes.find((candidate) => candidate.id === collection.defaultModeId);
    if (!mode) {
      fail(`collection "${collection.name}" has defaultModeId "${collection.defaultModeId}", which is not one of its modes`);
    }
    if (mode.name !== defaultMode.name) {
      fail(
        `collection "${collection.name}" defaults to mode "${mode.name}" but collection "${reference.name}" defaults to "${defaultMode.name}". ` +
          `All collections must agree on the default mode so :root has one unambiguous value per token.`,
      );
    }
  }

  return {
    defaultMode: defaultMode.name,
    themeModes: referenceNames.filter((name) => name !== defaultMode.name),
  };
}

/** Figma mode name -> value for the `data-theme` attribute. */
export function themeSlug(modeName: string): string {
  const slug = modeName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug === '') {
    fail(`mode "${modeName}" does not produce a usable data-theme value`);
  }
  return slug;
}

function valueFor(token: ArtifactToken, modeName: string): string {
  const value = token.values[modeName];
  if (value === undefined) {
    fail(`token "${token.name}" has no value for mode "${modeName}"`);
  }
  checkValue(token, modeName, value);
  // The unit belongs to the type, not to the value. Figma stored a bare
  // number and the scope said this token is a pixel length.
  return token.type === 'LENGTH' ? `${value}px` : value;
}

function renderBlock(selector: string, declarations: string[]): string {
  const body = declarations.map((declaration) => `  ${declaration}`).join('\n');
  return `${selector} {\n${body}\n}`;
}

export function buildCss(artifact: Artifact, defaultMode: string, themeModes: string[]): string {
  const blocks: string[] = [];

  const defaultDeclarations = artifact.tokens.map((token) => `${cssVarName(token)}: ${valueFor(token, defaultMode)};`);
  blocks.push(`/* Figma mode "${defaultMode}" - the collection default. */`);
  blocks.push(renderBlock(':root', defaultDeclarations));

  for (const modeName of themeModes) {
    const declarations = artifact.tokens.map((token) => `${cssVarName(token)}: ${valueFor(token, modeName)};`);
    blocks.push(`/* Figma mode "${modeName}" */`);
    blocks.push(renderBlock(`[data-theme="${themeSlug(modeName)}"]`, declarations));
  }

  const header = [
    '/* AUTO-GENERATED by nx g @tokens/plugin:tokens - do not edit by hand.',
    ' *',
    ` * Source of truth: tokens/tokens.json (artifactVersion ${artifact.artifactVersion}, exported ${artifact.exportedAt})`,
    ' * Regenerate with: nx g @tokens/plugin:tokens',
    ' */',
    '',
  ].join('\n');

  return `${header}\n${blocks.join('\n\n')}\n`;
}

export function buildTypeScript(artifact: Artifact, defaultMode: string, themeModes: string[]): string {
  const mapEntries = artifact.tokens
    .map((token) => `  ${JSON.stringify(token.name)}: ${JSON.stringify(cssVarName(token))},`)
    .join('\n');

  const nameEntries = artifact.tokens.map((token) => `  ${JSON.stringify(token.name)},`).join('\n');

  const themeEntries = [defaultMode, ...themeModes]
    .map((modeName) => `  ${JSON.stringify(modeName)}: ${JSON.stringify(themeSlug(modeName))},`)
    .join('\n');

  return `/* AUTO-GENERATED by nx g @tokens/plugin:tokens - do not edit by hand.
 *
 * Source of truth: tokens/tokens.json (artifactVersion ${artifact.artifactVersion}, exported ${artifact.exportedAt})
 * Regenerate with: nx g @tokens/plugin:tokens
 */

/** Every token name, mapped to the CSS custom property it resolves to. */
export const TOKEN_CSS_VARS = {
${mapEntries}
} as const;

/** The token contract: a token name is a value of this union, nothing else. */
export type TokenName = keyof typeof TOKEN_CSS_VARS;

/** The same names as a tuple, for iteration and runtime checks. */
export const TOKEN_NAMES = [
${nameEntries}
] as const;

/** Figma mode name -> the value to put in the data-theme attribute. */
export const THEME_SLUGS = {
${themeEntries}
} as const;

export type ThemeSlug = (typeof THEME_SLUGS)[keyof typeof THEME_SLUGS];

export const DEFAULT_THEME_SLUG = ${JSON.stringify(themeSlug(defaultMode))};

/**
 * Compile-time proof that TOKEN_NAMES and TOKEN_CSS_VARS describe the same
 * set of tokens. If they ever drifted, Assert would reject the false and tsc
 * would fail - no test framework, no comment, just a type error.
 */
type Assert<T extends true> = T;
type SameUnion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const _namesMatchTokenMap: Assert<SameUnion<TokenName, (typeof TOKEN_NAMES)[number]>> = true;

/**
 * Compile-time proof that every value really is a CSS custom property name.
 */
const _allValuesAreCustomProperties: Assert<
  (typeof TOKEN_CSS_VARS)[keyof typeof TOKEN_CSS_VARS] extends \`--\${string}\` ? true : false
> = true;
`;
}
