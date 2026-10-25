/**
 * Resolving a Figma variable's CSS custom property name.
 *
 * The name always comes from the variable's WEB code syntax, never from the
 * Figma variable name. A name derived from the variable name would be a
 * second convention, and a second convention is the thing that drifts.
 *
 * Figma stores whatever the designer typed, and the format is not fixed.
 * Three forms are accepted, and all three name the same property:
 *
 *   color-bg-default        -> --color-bg-default    the `--` prefix is added
 *   --color-bg-default      -> --color-bg-default    nothing changes
 *   var(--color-bg-default) -> --color-bg-default    the `var()` wrapper is stripped
 *
 * The only thing added is the `--` prefix that CSS requires for a custom
 * property, and only when the designer left it off. The name itself is never
 * invented.
 */

export type CssVarResolution =
  | { ok: true; name: string }
  | { ok: false; problem: string };

/** A custom property name after the mandatory `--` prefix. */
const CUSTOM_PROPERTY_NAME = /^--[a-zA-Z0-9_-]+$/;

export function resolveCssVarName(raw: string | undefined): CssVarResolution {
  const trimmed = (raw ?? '').trim();

  if (trimmed === '') {
    return {
      ok: false,
      problem:
        'has no WEB code syntax. Set the variable code syntax for Web in Figma ' +
        '(for example var(--color-bg-default), or the bare name color-bg-default); ' +
        'the generator refuses to guess a CSS name.',
    };
  }

  const unwrapped =
    trimmed.startsWith('var(') && trimmed.endsWith(')') ? trimmed.slice(4, -1).trim() : trimmed;

  const candidate = unwrapped.startsWith('--') ? unwrapped : `--${unwrapped}`;

  if (!CUSTOM_PROPERTY_NAME.test(candidate)) {
    return {
      ok: false,
      problem:
        `has WEB code syntax "${raw}", which is not a usable CSS custom property name. ` +
        'Write it as --name or var(--name).',
    };
  }

  return { ok: true, name: candidate };
}
