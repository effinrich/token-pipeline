export interface TokensGeneratorSchema {
  /** Path to the committed token artifact, relative to the workspace root. */
  artifact: string;
  /** Directory the generated files are written to, relative to the workspace root. */
  outDir: string;
  /** Fail instead of writing when the committed files are out of date. */
  check: boolean;
}
