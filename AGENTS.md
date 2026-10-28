<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

## The export plugin

- **The plugin has a test that runs without Figma.**
  `pnpm --filter @tokens/export test` loads `figma-plugin/code.js` the way
  Figma loads it - as a script, with the API on the global object - and drives
  it with a stub of the two variable APIs. Run it before claiming anything
  about how the plugin behaves. What it cannot prove is how Figma calls the
  plugin; that is verified by running the plugin in the desktop app.
- **A value the plugin cannot read is exported as `null`, never as a string
  that looks like a value.** A channel that is not a number means the value
  was never really set. A `#NaNNaNNaN` would pass as a colour to everything
  that reads the artifact, and the consumer's type check would be the only
  thing standing between it and the CSS.
- **A number's unit comes from the variable's scope**, never from its name and
  never from a hand-written value. Figma stores numbers unitless, so the scope
  is where the designer says what the number is for: a pixel field makes it a
  `LENGTH`, an unitless field leaves it a `FLOAT`, and a scope where Figma
  allows more than one unit is refused rather than guessed at.
