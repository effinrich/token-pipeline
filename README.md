# token-pipeline

A small pnpm + Nx workspace where design tokens flow from Figma variables to
CSS custom properties and a typed TypeScript API.

The pipeline has one rule: **no build step talks to Figma.** A local export
step produces a committed JSON artifact, and every generator reads only that
artifact.

```
Figma desktop (Plugin API)
  -> tokens/tokens.json          committed, reviewable
     -> libs/tokens/src/tokens.css           generated
     -> libs/tokens/src/tokens.generated.ts  generated
        -> apps/demo  imports @tokens/core
```

## Requirements

| Tool                | Version  |
| ------------------- | -------- |
| Node                | 24.22.1  |
| pnpm                | 10.16.1  |
| Nx                  | 23.2.1   |
| @nx/js              | 23.2.1   |
| @nx/devkit          | 23.2.1   |
| @nx/eslint          | 23.2.1   |
| @nx/plugin          | 23.2.1   |
| @swc/core           | 1.16.20  |
| @swc-node/register  | 1.12.1   |
| ts-node             | 10.9.2   |
| TypeScript          | 6.0.3    |
| tsx                 | 4.23.15  |
| eslint              | 9.39.5   |
| @types/node         | 22.20.5  |

pnpm 10 blocks dependency build scripts by default. `nx`, `esbuild`,
`@swc/core`, `@parcel/watcher` and `unrs-resolver` need theirs, so all five
are listed in `pnpm.onlyBuiltDependencies` in the root `package.json` and in
`pnpm-workspace.yaml`. That is why a plain `pnpm install` is enough - no
interactive `pnpm approve-builds` step.

## How the workspace is scaffolded

Every project was created by an Nx generator, not by hand:

```bash
nx g @nx/workspace:preset                            # workspace root: nx.json, tsconfig.base.json
nx g @nx/js:library --name=tokens --directory=libs/tokens --importPath=@tokens/core
nx g @nx/js:library --name=token-export --directory=tools/token-export --importPath=@tokens/export
nx g @nx/node:application --name=demo --directory=apps/demo
nx g @nx/plugin:plugin --name=tokens-plugin --directory=tools/tokens-plugin --importPath=@tokens/plugin
nx g @nx/plugin:generator tools/tokens-plugin/src/generators/tokens --name=tokens
```

Two of those names are easy to get wrong, and both fail loudly rather than
quietly:

- `nx preset` is **not** a command in Nx 23. It falls through to the target
  runner and dies with "Both project and target have to be specified". The
  generator is `nx g @nx/workspace:preset`; `create-nx-workspace` is the CLI
  wrapper that drives it.
- `@nx/js:application` **does not exist**. `@nx/js` ships library, node,
  init, convert-to-swc and a few more. The application generator is
  `@nx/node:application`.

The consequences are visible in the resolved configuration:

- `typecheck` is **inferred** by the `@nx/js/typescript` plugin from each
  project's tsconfig. It is not hand-declared as `nx:run-commands`. The
  inferred command is `tsc --build tsconfig.json --emitDeclarationOnly`.
- `lint` is **inferred** by the `@nx/eslint/plugin`.
- Project configuration lives in each project's `package.json` under `nx`, not
  in a separate `project.json`.
- `tsconfig.base.json` carries the `@tokens/core` path alias.

The token plugin is **not** listed in the `plugins` array of `nx.json`. It is
discovered as a local workspace plugin, because its `package.json` declares
`"generators": "./generators.json"`. `nx list` shows it under "Local workspace
plugins", and `nx g @tokens/plugin:tokens` resolves it. Listing it in
`nx.json` as well would register the same plugin twice.

## The generator

Generating the CSS and the TypeScript is an Nx generator, not a script. It
lives in `tools/tokens-plugin` and runs through `nx g`:

```bash
nx g @tokens/plugin:tokens             # write the generated files
nx g @tokens/plugin:tokens --dry-run   # preview the changes
nx g @tokens/plugin:tokens --check     # fail if the committed files are stale
```

The generator uses the Nx DevKit `Tree`, so it never touches the filesystem
directly. It reads the artifact and the committed files through the tree, and
writes the two generated files through the tree. That is what gives it
`--dry-run` for free, and it is why the plugin does not need to know how the
workspace is laid out on disk.

`--check` is the drift guard. It regenerates from the artifact in memory and
compares the result against what is committed. If they differ, it fails and
names the files:

```
[token-generator] the generated token files are out of date:
  libs/tokens/src/tokens.css
Run: nx g @tokens/plugin:tokens
```

It also checks that the artifact is internally consistent - an aliased token
must carry the value of the token it points at - and says exactly which token
and mode disagree.

The byte comparison subsumes eight of the original nine checks. The ninth,
alias consistency, is an invariant about the *artifact* rather than about the
generated files, so it still runs explicitly: regenerating from a
self-inconsistent artifact would reproduce the inconsistency and the byte
comparison would happily pass.

## Run it

```bash
pnpm install
pnpm nx run tokens:generate   # nx g @tokens/plugin:tokens
pnpm nx run tokens:check      # nx g @tokens/plugin:tokens --check
pnpm nx run tokens:typecheck  # tsc --build; the @ts-expect-error test runs here
pnpm nx build demo            # the app really builds, and the build type-checks
pnpm nx run demo:start        # product code using the typed API
```

`pnpm nx run-many --target=typecheck --all` typechecks every project.
`pnpm nx run-many --target=lint --all` lints every project.

The demo app's `typecheck` depends on `tokens:check`, so if the committed
generated files have drifted from the artifact, the drift guard fails first
and nothing downstream ever typechecks against a stale token file.

### Why the demo build needs two options

`demo:build` is `@nx/esbuild:esbuild`, and the esbuild executor type-checks
the app before bundling. That check is not the same check `demo:typecheck`
runs, and the difference is the whole reason the build needs configuring.

- `demo:typecheck` runs `tsc --build tsconfig.json`. The solution builder
  walks the project-reference graph and **redirects** an import of a
  referenced project's module to that project's output.
- The esbuild executor does not use the solution builder. It calls
  `ts.createProgram(config.fileNames, compilerOptions)` with **no project
  references**, so there is no redirect. `@tokens/core` resolves through
  `paths` to `libs/tokens/src/index.ts` - the source - and the app, being a
  composite project, may not include a file that belongs to another
  composite project. TypeScript rejects it with `TS6307`.

The build target therefore sets `"declaration": false`. That puts the
executor in `noEmit` mode, where `composite` is forced off and `TS6307`
cannot arise. `declaration: false` on its own is not enough: the base
tsconfig sets `declarationMap` and `emitDeclarationOnly`, both of which
survive the executor's option override and then fail with `TS5069`. The
demo's `tsconfig.app.json` clears those two keys.

`skipTypeCheck: true` is *not* used. It would work, but it also switches the
build's type check off entirely, and then a bad token name in the app would
fail `demo:typecheck` while `demo:build` happily bundled the broken code.
With the options above the build keeps its teeth.

## `nx affected`

The repository has `main` as its base branch, so Nx can answer "what changed?".
The committed artifact at `tokens/tokens.json` lives outside every project
root, so it would belong to no project. The `generate` and `check` targets
therefore declare it as an input:

```json
"inputs": ["{workspaceRoot}/tokens/tokens.json", ...]
```

An input that starts with `{workspaceRoot}/` makes a changed artifact touch the
`tokens` project directly. `demo` then comes along because it depends on
`tokens`. To see it:

```bash
git checkout feature/token-change
pnpm nx show projects --affected --base=main   # -> tokens, demo
pnpm nx affected -t typecheck --base=main
```

The same mechanism is why a change to a file that no project owns, such as
this README, produces an empty affected set.

## Export from Figma

1. In Figma desktop: `Plugins > Development > Import plugin from manifest...`
   and pick `tools/token-export/figma-plugin/manifest.json`.
2. Run the plugin and press **Export variables**. The JSON appears in the
   plugin panel; press **Copy JSON** to put it on the clipboard.
3. Write it to the artifact:

```bash
pnpm --filter @tokens/export write                  # reads stdin
pnpm --filter @tokens/export write --file out.json  # reads a file
```

On Windows PowerShell, from the clipboard:

```powershell
Get-Clipboard -Raw | pnpm --filter @tokens/export write
```

`--file` and `--out` are resolved against the working directory of the script,
which pnpm sets to the package directory `tools/token-export`. Use a path
relative to that directory, or an absolute one.

4. Commit `tokens/tokens.json` and the regenerated files. A token change is a
   diff in a pull request.

## Variable setup in Figma

Every variable needs a **code syntax for Web**, set in the variable's settings
in Figma. That string is the only source of the CSS custom property name, so
the generator never derives one from the variable name.

Three forms are accepted, and they all mean the same thing:

| Figma code syntax         | CSS custom property  |
| ------------------------- | -------------------- |
| `color-bg-default`        | `--color-bg-default` |
| `--color-bg-default`      | `--color-bg-default` |
| `var(--color-bg-default)` | `--color-bg-default` |

A variable with no code syntax fails the build with an explicit message.

## Layout

```
tokens/tokens.json                 the committed artifact (the contract)
tools/token-export/
  figma-plugin/manifest.json       the plugin manifest
  figma-plugin/code.js             reads variables, resolves aliases
  figma-plugin/ui.html             hands the payload back as text
  src/write-artifact.ts            validates the payload, writes the artifact
tools/tokens-plugin/
  generators.json                  the generator entry point
  src/index.ts                     the plugin entry point
  src/generators/tokens/
    tokens.ts                      the generator (Nx DevKit Tree)
    schema.json                    the generator options
    schema.d.ts                    the typed shape of those options
  src/lib/
    artifact.ts                    parses and validates the artifact
    css-var.ts                     resolves a Figma code syntax to a CSS name
    render.ts                      artifact -> CSS + TypeScript
libs/tokens/
  src/index.ts                     the typed API (hand written)
  src/tokens.generated.ts          generated
  src/tokens.css                   generated
  src/type-contract.test.ts        the compile-time contract test
apps/demo/                         product code that consumes the API
```

The dependency direction matters more than the tooling. `apps/demo` depends on
`@tokens/core`. `@tokens/core` depends on nothing. The generator reads
`tokens/tokens.json` and writes into `libs/tokens/src`. Nothing in the
workspace imports a Figma SDK, and `@tokens/core` does not depend on
`@nx/devkit`, so the DevKit never reaches product code.

`@nx/eslint` enforces that direction rather than merely recording it: the
`type:lib` and `scope:tokens` tags in each project's `package.json` feed the
`@nx/enforce-module-boundaries` rule in the root `eslint.config.mjs`.

## Line endings

`libs/tokens/src/tokens.css` and `libs/tokens/src/tokens.generated.ts` are
compared byte-for-byte by the drift guard, and the generator emits LF only.
With a global `core.autocrlf=true`, a fresh clone would check those files out
with CRLF and the drift guard would fail on a clean tree. `.gitattributes`
pins them to LF so the check is meaningful in CI and on a fresh clone.
