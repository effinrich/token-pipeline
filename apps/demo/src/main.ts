import { token } from '@tokens/core';

/**
 * Product code only ever sees the typed API. There is no hex code in this
 * file, and there is no token string that the compiler would not check.
 */
const card = {
  background: token('color/bg/surface'),
  color: token('color/text/default'),
  border: token('color/border/default'),
  padding: token('space/gutter'),
  radius: token('radius/md'),
};

console.log('Style object built from the typed token API:');
for (const [property, value] of Object.entries(card)) {
  console.log(`  ${property.padEnd(11)} ${value}`);
}

console.log('');
console.log('Every value is a var() reference. The value itself lives in tokens.css.');
console.log('Light theme comes from :root; dark theme from [data-theme="dark"].');
console.log('Set <html data-theme="dark"> and every line above changes value, not code.');
