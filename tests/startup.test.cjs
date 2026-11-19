const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'call of fruty.html'), 'utf8');

test('first launch uses a non-MSAA quality with matching settings controls', () => {
  const quality = html.match(/const QUAL=\[[\s\S]*?\];/);
  const settings = html.match(/const S=\{[^\n]+\};/);
  const initial = html.match(/let q=QUAL\[\d+\],dynScale=1;/);
  assert.ok(quality && settings && initial, 'Renderer startup declarations must be available');
  const runtime = vm.runInNewContext(`${quality[0]}\n${settings[0]}\n${initial[0]}\n({quality:S.qual,msaa:q.msaa,consistent:q===QUAL[S.qual]})`);
  assert.equal(runtime.msaa, 0, 'Initial MSAA produces a black scene on supported legacy GPUs');
  assert.equal(runtime.consistent, true);
  const select = html.match(/<select id="sQual">([\s\S]*?)<\/select>/)[1];
  const selected = select.match(/<option value="(\d+)" selected>/);
  assert.equal(Number(selected[1]), runtime.quality);
});

test('public entry resolves to the game at nested project paths', () => {
  const entry = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const redirect = entry.match(/content="0;url=([^"]+)"/);
  assert.ok(redirect);
  const base = new URL('https://example.invalid/projects/call-of-fruty/');
  const target = new URL(redirect[1], base);
  assert.equal(target.origin, base.origin);
  assert.equal(target.pathname, '/projects/call-of-fruty/call%20of%20fruty.html');
  assert.ok(fs.existsSync(path.join(root, decodeURIComponent(redirect[1]))));
});
