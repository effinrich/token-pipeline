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
 *   Variable.name, .resolvedType, .valuesByMode, .codeSyntax, .variableCollectionId
 *   VariableCollection.id, .name, .modes, .defaultModeId
 *
 * The manifest sets "documentAccess": "dynamic-page", the only value Figma
 * documents for that field. The synchronous variable APIs throw under it, so
 * the async pair above is the replacement. The plugin reads no page content,
 * so it never needs figma.loadAllPagesAsync().
 */

const PLUGIN_VERSION = '0.1.0';

function toHex(channel) {
  const clamped = Math.max(0, Math.min(1, channel));
  return Math.round(clamped * 255).toString(16).padStart(2, '0');
}

function colorToHex(rgba) {
  const base = '#' + toHex(rgba.r) + toHex(rgba.g) + toHex(rgba.b);
  if (rgba.a === undefined || rgba.a >= 1) return base;
  return base + toHex(rgba.a);
}

/** Figma stores colours as RGBA objects and numbers as unitless floats. */
function formatValue(raw) {
  if (typeof raw === 'number') return raw + 'px';
  if (raw !== null && typeof raw === 'object' && typeof raw.r === 'number') return colorToHex(raw);
  return String(raw);
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
      type: variable.resolvedType,
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
    artifactVersion: 1,
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
