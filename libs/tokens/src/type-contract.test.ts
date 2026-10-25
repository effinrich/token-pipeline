/**
 * The type-level guarantee, expressed as a compile-time test.
 *
 * There is no test runner here. `tsc --noEmit` is the test runner: every
 * @ts-expect-error below asserts that the following line does NOT compile.
 * If the token contract ever loosened, tsc would report an unused
 * '@ts-expect-error' directive and the build would fail.
 */
import { token, tokenVar, type TokenName } from './index';

/** A token that exists compiles, and returns the expected custom property. */
export const backgroundVar: '--color-bg-default' = tokenVar('color/bg/default');
export const backgroundRef: string = token('color/bg/default');

/** An unknown token name must not compile. */
// @ts-expect-error 'color/bg/nope' is not in tokens.json, so this call must not compile.
export const unknownToken: string = token('color/bg/nope');

/** Token names are case-sensitive, so a plausible typo must not compile. */
// @ts-expect-error 'color/Bg/Default' differs from 'color/bg/default' only in case.
export const wrongCase: string = token('color/Bg/Default');

/** The token name union itself rejects values that are not tokens. */
// @ts-expect-error 'color/bg/nope' is not assignable to TokenName.
export const notATokenName: TokenName = 'color/bg/nope';

/** A plain string is not a token name either - names are not widened. */
declare const someString: string;
// @ts-expect-error string is not assignable to TokenName.
export const widenedName: TokenName = someString;
