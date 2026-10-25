/**
 * The typed token API.
 *
 * Product code imports this module, never a CSS file and never a raw token
 * string. `token()` only accepts names that exist in the committed artifact,
 * so a renamed or removed token is a compile error instead of a blank box.
 */
import { TOKEN_CSS_VARS, type TokenName } from './tokens.generated';

export { TOKEN_CSS_VARS, TOKEN_NAMES, THEME_SLUGS, DEFAULT_THEME_SLUG } from './tokens.generated';
export type { TokenName, ThemeSlug } from './tokens.generated';

/**
 * The CSS custom property behind a token, with its exact literal type.
 *
 * `tokenVar('color/bg/default')` has the type `'--color-bg-default'`, so the
 * compiler knows which property you are about to read.
 */
export function tokenVar<K extends TokenName>(name: K): (typeof TOKEN_CSS_VARS)[K] {
  return TOKEN_CSS_VARS[name];
}

/**
 * A `var()` reference for a token, ready to drop into a style object.
 *
 * The parameter type is the contract. `token('color/bg/nope')` does not
 * compile, and neither does `token('color/Bg/Default')`.
 */
export function token<K extends TokenName>(name: K): string {
  return `var(${TOKEN_CSS_VARS[name]})`;
}
