/**
 * Bundles the app into one self-contained HTML file for publishing as a
 * Claude artifact.
 *
 * Artifacts are a single document with no build step, and the CSP blocks
 * scripts and stylesheets from most hosts — so everything (React, recharts,
 * the icons, the app, the compiled Tailwind) is inlined. The published file
 * carries no <!doctype>, <html>, <head> or <body>: the artifact host wraps it.
 *
 *   npm run build:artifact   ->   artifact/vinapp.html
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const outDir = path.join(root, 'artifact');
const outFile = path.join(outDir, 'vinapp.html');

if (!fs.existsSync(dist)) {
  console.error('No dist/ — run `npm run build` first.');
  process.exit(1);
}

const assets = fs.readdirSync(path.join(dist, 'assets'));
const read = (name) => fs.readFileSync(path.join(dist, 'assets', name), 'utf8');
const js = assets.filter((f) => f.endsWith('.js')).map(read).join('\n');
const css = assets.filter((f) => f.endsWith('.css')).map(read).join('\n');

if (!js) {
  console.error('No JS asset found in dist/assets.');
  process.exit(1);
}

// A closing tag inside a string literal would end the inline element early.
const safeJs = js.replace(/<\/script/gi, '<\\/script');
const safeCss = css.replace(/<\/style/gi, '<\\/style');

const html = `<title>Vinapp Card Inventory</title>
<style>
${safeCss}
</style>
<div id="root"></div>
<script type="module">
${safeJs}
</script>
`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, html);
console.log(`artifact/vinapp.html  ${(Buffer.byteLength(html) / 1024).toFixed(0)} kB`);
