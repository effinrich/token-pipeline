/**
 * Token Export - Figma Plugin API main thread.
 *
 * Reads the variable collections and variables of the open file and hands a
 * JSON payload back to the plugin UI. The payload is written to
 * tokens/tokens.json by tools/token-export.
 *
 * Plugin API surface used here (see the Figma Plugin API reference):
 *   figma.variables.getLocalVariableCollectionsAsync()
 *   figma.variables.getLocalVariablesAsync()
 *   Variable.name, .resolvedType, .valuesByMode, .codeSyntax, .variableCollectionId, .scopes
 *   VariableCollection.id, .name, .modes, .defaultModeId
 *
 * The manifest sets "documentAccess": "dynamic-page", the only value Figma
 * documents for that field. The synchronous variable APIs throw under it, so
 * the async pair above is the replacement. The plugin reads no page content,
 * so it never needs figma.loadAllPagesAsync().
 *
 * Artifact version 2. Version 1 carried Figma's own variable types, so a
 * number was a FLOAT and the pipeline had no way to tell a length from a
 * unitless number - the unit had to be written into the artifact by hand.
 * Version 2 carries the pipeline's types instead: a number scoped to a pixel
 * field is a LENGTH, and a number scoped to an unitless field is a FLOAT.
 */

const PLUGIN_VERSION = '0.2.0';

/**
 * A channel that is not a number means the value was never really set.
 *
 * The plugin does not invent a hex out of it. A "#NaNNaNNaN" would look like a
 * color to everything that reads the artifact, and the consumer's type check
 * would be the only thing between it and the CSS. The value is exported as
 * null instead: honest, and the consumer rejects it by name.
 */
function toHex(channel) {
  if (typeof channel !== 'number' || !Number.isFinite(channel)) return null;
  const clamped = Math.max(0, Math.min(1, channel));
  return Math.round(clamped * 255).toString(16).padStart(2, '0');
}

function colorToHex(rgba) {
  const r = toHex(rgba.r);
  const g = toHex(rgba.g);
  const b = toHex(rgba.b);
  if (r === null || g === null || b === null) return null;

  const base = '#' + r + g + b;
  if (rgba.a === undefined) return base;

  const a = toHex(rgba.a);
  if (a === null) return null;
  if (rgba.a >= 1) return base;
  return base + a;
}

/**
 * Figma stores colors as RGBA objects and numbers as unitless floats.
 *
 * A value that cannot be formatted faithfully becomes null rather than a
 * broken string. The artifact says "there is no value here", and the consumer
 * refuses the token by name instead of carrying NaN into the CSS.
 */
function formatValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : null;
  if (typeof raw === 'object') return colorToHex(raw);
  return String(raw);
}

/**
 * Figma has no length type. A number variable is an untyped number, and what
 * it means depends on the field it is used in: 16 is sixteen pixels in a gap
 * and 1.5 is a multiplier in a line height.
 *
 * Figma records the designer's decision in the variable's scopes - the fields
 * the variable is allowed in. That is the only place the unit is declared, so
 * that is where we read it from. A scope where Figma accepts more than one
 * unit is refused rather than guessed at, and so is a number with no scope.
 */
const PX_SCOPES = new Set([
  'CORNER_RADIUS',
  'WIDTH_HEIGHT',
  'GAP',
  'FONT_SIZE',
  'PARAGRAPH_SPACING',
  'PARAGRAPH_INDENT',
  'STROKE_FLOAT',
  'EFFECT_FLOAT',
]);

const UNITLESS_SCOPES = new Set(['OPACITY', 'FONT_WEIGHT']);

function numberType(variable) {
  const scopes = variable.scopes || [];
  const name = variable.name;

  if (scopes.length === 0) {
    throw new Error(
      'Variable "' +
        name +
        '" is a number with no scope. Figma stores numbers unitless, so the scope is what says whether it is a length. Set the scope in Figma.'
    );
  }
  if (scopes.every((scope) => PX_SCOPES.has(scope))) {
    return 'LENGTH';
  }
  if (scopes.every((scope) => UNITLESS_SCOPES.has(scope))) {
    return 'FLOAT';
  }
  throw new Error(
    'Variable "' +
      name +
      '" is scoped to "' +
      scopes.join('", "') +
      '". Figma stores numbers unitless and that scope does not say which unit it is, so the export refuses to guess. Scope it to a pixel field such as GAP or CORNER_RADIUS, or make it a text variable.'
  );
}

function isAlias(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    value.type === 'VARIABLE_ALIAS' &&
    typeof value.id === 'string'
  );
}

/**
 * Variable.valuesByMode does not resolve aliases - it hands back the alias
 * object. So we follow the alias ourselves.
 *
 * Aliases are resolved by MODE NAME, not by mode id, because the target may
 * live in another collection whose mode ids are different.
 */
function resolveModeValue(variable, modeName, context, seen) {
  const collection = context.collectionsById.get(variable.variableCollectionId);
  const mode = collection.modes.find((candidate) => candidate.name === modeName);

  if (!mode) {
    throw new Error('Variable "' + variable.name + '" has no mode named "' + modeName + '"');
  }

  const raw = variable.valuesByMode[mode.modeId];
  if (raw === undefined) {
    return { value: undefined, aliasName: undefined };
  }

  if (!isAlias(raw)) {
    return { value: raw, aliasName: undefined };
  }

  const target = context.variablesById.get(raw.id);
  if (!target) {
    throw new Error('Alias target ' + raw.id + ' of "' + variable.name + '" was not found');
  }
  if (seen.has(target.id)) {
    throw new Error('Alias cycle detected at "' + target.name + '"');
  }

  seen.add(target.id);
  const resolved = resolveModeValue(target, modeName, context, seen);
  return { value: resolved.value, aliasName: target.name };
}

async function buildArtifact() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const variables = await figma.variables.getLocalVariablesAsync();

  const context = {
    collectionsById: new Map(collections.map((collection) => [collection.id, collection])),
    variablesById: new Map(variables.map((variable) => [variable.id, variable])),
  };

  // Sort by collection order, then by name, so a re-export produces the same
  // token order. The artifact still differs by its exportedAt timestamp, so
  // the diff is one line rather than empty.
  const collectionOrder = new Map(collections.map((collection, index) => [collection.id, index]));
  const sorted = variables.slice().sort((a, b) => {
    const collectionA = collectionOrder.get(a.variableCollectionId) ?? 0;
    const collectionB = collectionOrder.get(b.variableCollectionId) ?? 0;
    if (collectionA !== collectionB) return collectionA - collectionB;
    return a.name.localeCompare(b.name);
  });

  const tokens = sorted.map((variable) => {
    const collection = context.collectionsById.get(variable.variableCollectionId);
    const values = {};
    const alias = {};
    let hasAlias = false;

    for (const mode of collection.modes) {
      const resolved = resolveModeValue(variable, mode.name, context, new Set([variable.id]));
      if (resolved.value === undefined) continue;

      values[mode.name] = formatValue(resolved.value);
      if (resolved.aliasName) {
        alias[mode.name] = resolved.aliasName;
        hasAlias = true;
      }
    }

    const token = {
      name: variable.name,
      type: variable.resolvedType === 'FLOAT' ? numberType(variable) : variable.resolvedType,
      codeSyntax: variable.codeSyntax || {},
      collectionId: collection.id,
      values: values,
    };

    if (hasAlias) {
      token.alias = alias;
    }
    return token;
  });

  return {
    artifactVersion: 2,
    exportedAt: new Date().toISOString(),
    source: {
      fileName: figma.root && figma.root.name ? figma.root.name : 'unknown',
      fileKey: typeof figma.fileKey === 'string' ? figma.fileKey : null,
      pluginVersion: PLUGIN_VERSION,
    },
    collections: collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      defaultModeId: collection.defaultModeId,
      modes: collection.modes.map((mode) => ({ id: mode.modeId, name: mode.name })),
    })),
    tokens: tokens,
  };
}

figma.showUI(__html__, { width: 440, height: 380 });

figma.ui.onmessage = async (message) => {
  if (message.type !== 'export') return;

  try {
    const artifact = await buildArtifact();
    const json = JSON.stringify(artifact, null, 2);
    const summary =
      artifact.tokens.length +
      ' tokens from ' +
      artifact.collections.length +
      ' collection(s). Copy the JSON, then run: pnpm --filter @tokens/export write --file <path>';

    figma.ui.postMessage({ type: 'payload', json: json, summary: summary });
    figma.notify(summary);
  } catch (error) {
    const text = error && error.message ? error.message : String(error);
    figma.ui.postMessage({ type: 'error', message: text });
    figma.notify('Token Export failed: ' + text, { error: true });
  }
};
