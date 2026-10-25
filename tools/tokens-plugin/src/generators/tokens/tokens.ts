/**
 * The token generator.
 *
 * It reads the committed artifact and writes two files: the CSS custom
 * properties and the TypeScript token contract. It is an Nx generator, so it
 * runs through `nx g` and gets Nx's tree semantics:
 *
 *   nx g @tokens/plugin:tokens             write the generated files
 *   nx g @tokens/plugin:tokens --dry-run   preview the changes
 *   nx g @tokens/plugin:tokens --check     fail if the committed files are stale
 *
 * Nothing here talks to Figma. The artifact is the only input, which is what
 * keeps the build hermetic and makes every token change a reviewable diff.
 */
import { joinPathFragments, type Tree } from '@nx/devkit';

import { assertAliasesMatchTargets, assertCssAnchorsAreUnique, parseArtifact } from '../../lib/artifact';
import { buildCss, buildTypeScript, resolveThemes } from '../../lib/render';
import type { TokensGeneratorSchema } from './schema';

const CSS_FILE = 'tokens.css';
const TYPES_FILE = 'tokens.generated.ts';

export async function tokensGenerator(tree: Tree, options: TokensGeneratorSchema): Promise<void> {
  const raw = tree.read(options.artifact);
  if (raw === null) {
    throw new Error(
      `[token-generator] cannot read ${options.artifact}. ` +
        'Run the export step first: pnpm --filter @tokens/export write',
    );
  }

  const artifact = parseArtifact(raw.toString('utf8'));
  const { defaultMode, themeModes } = resolveThemes(artifact);
  const css = buildCss(artifact, defaultMode, themeModes);
  const types = buildTypeScript(artifact, defaultMode, themeModes);

  const cssPath = joinPathFragments(options.outDir, CSS_FILE);
  const typesPath = joinPathFragments(options.outDir, TYPES_FILE);

  if (options.check) {
    // The artifact has to be internally consistent before it can be trusted.
    // Both of these are faults in the artifact itself, not in the gap between
    // the artifact and the output, so the byte comparison below cannot see
    // them.
    assertAliasesMatchTargets(artifact);
    assertCssAnchorsAreUnique(artifact);

    // Then the committed files have to match what the artifact would produce.
    // Regenerating and comparing catches every form of drift at once, which is
    // why this replaces a hand-written list of checks.
    const stale: string[] = [];
    const files: ReadonlyArray<readonly [string, string]> = [
      [cssPath, css],
      [typesPath, types],
    ];

    for (const [path, next] of files) {
      const current = tree.read(path);
      if (current === null || current.toString('utf8') !== next) {
        stale.push(path);
      }
    }

    if (stale.length > 0) {
      throw new Error(
        `[token-generator] the generated token files are out of date:\n  ${stale.join('\n  ')}\n` +
          'Run: nx g @tokens/plugin:tokens',
      );
    }
    return;
  }

  tree.write(cssPath, css);
  tree.write(typesPath, types);
}

export default tokensGenerator;
