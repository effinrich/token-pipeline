/**
 * The @tokens/plugin workspace plugin.
 *
 * It exposes one generator, `tokens`, which turns the committed artifact into
 * the CSS custom properties and the TypeScript token contract. See
 * generators.json for the schema and src/generators/tokens/tokens.ts for the
 * implementation.
 */
export { default as tokensGenerator } from './generators/tokens/tokens';
