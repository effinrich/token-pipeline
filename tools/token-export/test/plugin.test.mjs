/**
 * The export plugin's own logic, exercised without Figma.
 *
 * The plugin runs inside the Figma desktop app, where its only inputs are the
 * two variable APIs. Everything it does with what they return - resolving an
 * alias by hand, ordering the tokens so a re-export is a one-line diff,
 * refusing an alias that points nowhere - is ordinary code, and ordinary code
 * can be run here.
 *
 * The two API calls are stubbed. That proves the plugin's behaviour, and it
 * does not prove that Figma calls the plugin the way the stub does. The
 * hand-off to the desktop app is verified by running the plugin there.
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const PLUGIN_SOURCE = new URL('../figma-plugin/code.js', import.meta.url);

const COLLECTION_ID = 'VariableCollectionId:1:1';

/** A Figma colour: channels between 0 and 1. */
function color(hex) {
  const value = hex.replace('#', '');
  const channel = (index) => Number.parseInt(value.slice(index, index + 2), 16) / 255;
  return { r: channel(0), g: channel(2), b: channel(4) };
}

const COLLECTION = {
  id: COLLECTION_ID,
  name: 'Core',
  defaultModeId: '1:0',
  modes: [
    { modeId: '1:0', name: 'Light' },
    { modeId: '1:1', name: 'Dark' },
  ],
};

/**
 * The design file the directive describes: eight variables, one of them an
 * alias, and one of them carrying the bare form of a code syntax.
 */
function designFile(overrides = {}) {
  const variables = [
    {
      id: 'v1',
      name: 'color/bg/default',
      resolvedType: 'COLOR',
      codeSyntax: { WEB: 'var(--color-bg-default)' },
      variableCollectionId: COLLECTION_ID,
      valuesByMode: { '1:0': color('#ffffff'), '1:1': color('#111111') },
    },
    {
      id: 'v2',
      name: 'color/bg/surface',
      resolvedType: 'COLOR',
      codeSyntax: { WEB: 'var(--color-bg-surface)' },
      variableCollectionId: COLLECTION_ID,
      valuesByMode: { '1:0': color('#f5f5f5'), '1:1': color('#1c1c1c') },
    },
    {
      id: 'v3',
      name: 'color/border/default',
      resolvedType: 'COLOR',
      codeSyntax: { WEB: 'var(--color-border-default)' },
      variableCollectionId: COLLECTION_ID,
      valuesByMode: { '1:0': color('#e5e5e5'), '1:1': color('#333333') },
    },
    {
      id: 'v4',
      name: 'color/palette/gray/900',
      resolvedType: 'COLOR',
      codeSyntax: { WEB: 'var(--color-palette-gray-900)' },
      variableCollectionId: COLLECTION_ID,
      valuesByMode: { '1:0': color('#111111'), '1:1': color('#f5f5f5') },
    },
    {
      id: 'v5',
      name: 'color/text/default',
      resolvedType: 'COLOR',
      codeSyntax: { WEB: 'var(--color-text-default)' },
      variableCollectionId: COLLECTION_ID,
      valuesByMode: {
        '1:0': { type: 'VARIABLE_ALIAS', id: 'v4' },
        '1:1': { type: 'VARIABLE_ALIAS', id: 'v4' },
      },
    },
    {
      id: 'v6',
      name: 'color/text/muted',
      resolvedType: 'COLOR',
      codeSyntax: { WEB: 'var(--color-text-muted)' },
      variableCollectionId: COLLECTION_ID,
      valuesByMode: { '1:0': color('#6b7280'), '1:1': color('#9ca3af') },
    },
    {
      id: 'v7',
      name: 'radius/md',
      resolvedType: 'FLOAT',
      scopes: ['CORNER_RADIUS'],
      codeSyntax: { WEB: 'var(--radius-md)' },
      variableCollectionId: COLLECTION_ID,
      valuesByMode: { '1:0': 8, '1:1': 8 },
    },
    {
      id: 'v8',
      name: 'space/gutter',
      resolvedType: 'FLOAT',
      scopes: ['GAP'],
      codeSyntax: { WEB: 'space-gutter' },
      variableCollectionId: COLLECTION_ID,
      valuesByMode: { '1:0': 16, '1:1': 16 },
    },
  ];

  const file = {
    name: 'Design System',
    key: null,
    collections: [COLLECTION],
    variables,
  };

  return { ...file, ...overrides };
}

/**
 * Load the plugin the way Figma loads it: as a script, with the API on the
 * global object.
 */
function loadPlugin(file) {
  const source = readFileSync(PLUGIN_SOURCE, 'utf8');
  const posted = [];

  const context = {
    figma: {
      root: { name: file.name },
      fileKey: file.key,
      variables: {
        getLocalVariableCollectionsAsync: async () => file.collections,
        getLocalVariablesAsync: async () => file.variables,
      },
      ui: {
        postMessage: (message) => posted.push(message),
        onmessage: null,
      },
      showUI: () => undefined,
      notify: () => undefined,
    },
    __html__: '',
    console,
  };

  runInNewContext(source, context, { filename: 'code.js' });
  return { posted, context };
}

/** Press "Export variables" and read what the plugin handed back. */
async function exportVariables(file) {
  const { posted, context } = loadPlugin(file);
  await context.figma.ui.onmessage({ type: 'export' });

  const payload = posted.find((message) => message.type === 'payload');
  const failure = posted.find((message) => message.type === 'error');

  return {
    artifact: payload ? JSON.parse(payload.json) : null,
    summary: payload ? payload.summary : null,
    error: failure ? failure.message : null,
  };
}

const tokenNamed = (artifact, name) => artifact.tokens.find((token) => token.name === name);

test('the payload carries the eight variables of the design file', async () => {
  const { artifact, error } = await exportVariables(designFile());
  assert.equal(error, null);
  assert.equal(artifact.artifactVersion, 2);
  assert.equal(artifact.tokens.length, 8);
  assert.equal(artifact.collections.length, 1);
});

test('a normal plugin records a null file key rather than a fake one', async () => {
  const { artifact } = await exportVariables(designFile());
  assert.equal(artifact.source.fileKey, null);
  assert.equal(artifact.source.fileName, 'Design System');
});

test('the tokens are ordered by collection and then by name', async () => {
  const { artifact } = await exportVariables(designFile());
  assert.deepEqual(
    artifact.tokens.map((token) => token.name),
    [
      'color/bg/default',
      'color/bg/surface',
      'color/border/default',
      'color/palette/gray/900',
      'color/text/default',
      'color/text/muted',
      'radius/md',
      'space/gutter',
    ],
  );
});

test('an alias is resolved and recorded against the token it points at', async () => {
  const { artifact } = await exportVariables(designFile());
  const aliased = tokenNamed(artifact, 'color/text/default');
  const target = tokenNamed(artifact, 'color/palette/gray/900');

  assert.deepEqual(aliased.values, target.values);
  assert.deepEqual(aliased.alias, { Light: 'color/palette/gray/900', Dark: 'color/palette/gray/900' });
});

test('a token that is not an alias carries no alias key at all', async () => {
  const { artifact } = await exportVariables(designFile());
  assert.equal('alias' in tokenNamed(artifact, 'color/bg/default'), false);
});

test('a number scoped to a pixel field is a LENGTH and carries a bare number', async () => {
  const { artifact } = await exportVariables(designFile());

  const radius = tokenNamed(artifact, 'radius/md');
  assert.equal(radius.type, 'LENGTH');
  assert.deepEqual(radius.values, { Light: '8', Dark: '8' });

  const gutter = tokenNamed(artifact, 'space/gutter');
  assert.equal(gutter.type, 'LENGTH');
  assert.deepEqual(gutter.values, { Light: '16', Dark: '16' });

  // The artifact never carries the unit: the type does.
  assert.equal(JSON.stringify(artifact).includes('8px'), false);
  assert.equal(JSON.stringify(artifact).includes('16px'), false);
});

test('a colour is written as hex', async () => {
  const { artifact } = await exportVariables(designFile());
  assert.deepEqual(tokenNamed(artifact, 'color/bg/default').values, {
    Light: '#ffffff',
    Dark: '#111111',
  });
});

test('a number scoped to an unitless field stays a FLOAT', async () => {
  const file = designFile();
  const gutter = file.variables.find((variable) => variable.id === 'v8');
  gutter.name = 'opacity/muted';
  gutter.scopes = ['OPACITY'];
  gutter.codeSyntax = { WEB: 'var(--opacity-muted)' };
  gutter.valuesByMode = { '1:0': 0.4, '1:1': 0.4 };

  const { artifact, error } = await exportVariables(file);
  assert.equal(error, null);
  assert.equal(tokenNamed(artifact, 'opacity/muted').type, 'FLOAT');
  assert.deepEqual(tokenNamed(artifact, 'opacity/muted').values, { Light: '0.4', Dark: '0.4' });
});

test('a number with no scope is refused rather than guessed at', async () => {
  const file = designFile();
  const gutter = file.variables.find((variable) => variable.id === 'v8');
  delete gutter.scopes;

  const { artifact, error } = await exportVariables(file);
  assert.equal(artifact, null);
  assert.match(error, /is a number with no scope/);
});

test('a number in a scope where Figma allows more than one unit is refused', async () => {
  const file = designFile();
  const gutter = file.variables.find((variable) => variable.id === 'v8');
  gutter.scopes = ['LINE_HEIGHT'];

  const { artifact, error } = await exportVariables(file);
  assert.equal(artifact, null);
  assert.match(error, /refuses to guess/);
});

test('the code syntax is copied through unchanged, in every form it can take', async () => {
  const { artifact } = await exportVariables(designFile());
  assert.deepEqual(tokenNamed(artifact, 'color/bg/default').codeSyntax, {
    WEB: 'var(--color-bg-default)',
  });
  assert.deepEqual(tokenNamed(artifact, 'space/gutter').codeSyntax, { WEB: 'space-gutter' });
});

test('two exports of unchanged content differ only in the timestamp', async () => {
  const first = await exportVariables(designFile());
  const second = await exportVariables(designFile());

  const without = (artifact) => {
    const copy = { ...artifact };
    delete copy.exportedAt;
    return copy;
  };

  assert.deepEqual(without(first.artifact), without(second.artifact));
});

test('the payload carries variables only, never components or slots', async () => {
  const { artifact } = await exportVariables(designFile());
  assert.deepEqual(Object.keys(artifact).sort(), [
    'artifactVersion',
    'collections',
    'exportedAt',
    'source',
    'tokens',
  ]);
});

test('an alias that points at nothing is refused by name', async () => {
  const file = designFile();
  file.variables.find((variable) => variable.id === 'v5').valuesByMode['1:0'] = {
    type: 'VARIABLE_ALIAS',
    id: 'gone',
  };

  const { error } = await exportVariables(file);
  assert.equal(error, 'Alias target gone of "color/text/default" was not found');
});

test('an alias cycle is refused by name', async () => {
  const file = designFile();
  file.variables.find((variable) => variable.id === 'v4').valuesByMode['1:0'] = {
    type: 'VARIABLE_ALIAS',
    id: 'v5',
  };

  const { error } = await exportVariables(file);
  // The cycle is named at the variable that closes it: the walk came back to
  // a variable it had already resolved.
  assert.equal(error, 'Alias cycle detected at "color/palette/gray/900"');
});

test('a mode the alias target does not have is refused by name', async () => {
  // The alias target lives in another collection, and that collection has no
  // "Dark" mode. Aliases are followed by mode NAME, so this is where the walk
  // stops.
  const file = designFile();
  const brand = {
    id: 'VariableCollectionId:2:2',
    name: 'Brand',
    defaultModeId: '2:0',
    modes: [{ modeId: '2:0', name: 'Light' }],
  };
  file.collections = [COLLECTION, brand];

  const target = file.variables.find((variable) => variable.id === 'v4');
  target.variableCollectionId = brand.id;
  target.valuesByMode = { '2:0': color('#111111') };

  const { error } = await exportVariables(file);
  assert.equal(error, 'Variable "color/palette/gray/900" has no mode named "Dark"');
});

test('a channel that is not a number is exported as no value, never as NaN', async () => {
  const file = designFile();
  file.variables.find((variable) => variable.id === 'v1').valuesByMode['1:0'] = {
    r: Number.NaN,
    g: 1,
    b: 1,
  };

  const { artifact, error } = await exportVariables(file);
  assert.equal(error, null);
  assert.equal(tokenNamed(artifact, 'color/bg/default').values.Light, null);
  assert.equal(JSON.stringify(artifact).includes('NaN'), false);
});
