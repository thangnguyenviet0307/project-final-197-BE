import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { plainText } from '../dist/utils/shared/plain-text.js';

test('retrieval text handles markup, quotes, comments and script/style bodies conservatively', () => {
  assert.equal(plainText('<p>Xin&nbsp;chào</p>\n<b>bạn</b>'), 'Xin chào bạn');
  assert.equal(
    plainText(
      'İ<Script title=">">secret</SCRIPT><style>hidden</style> visible'
    ),
    'İ visible'
  );
  assert.equal(
    plainText('before <!-- hidden <b>text</b> --> after'),
    'before after'
  );
  assert.equal(
    plainText('before <script>secret </scripture> still secret</script> after'),
    'before after'
  );
  assert.equal(plainText('before <script>unclosed secret'), 'before');
  assert.equal(plainText('before <!-- unclosed comment'), 'before');
  assert.equal(plainText('before <a title="unclosed>secret'), 'before');
  assert.equal(plainText(''), '');
});

test('million-character malformed HTML cannot monopolize the retrieval process', () => {
  // A subprocess deadline can interrupt synchronous work; a test timer cannot.
  const moduleUrl = new URL(
    '../dist/utils/shared/plain-text.js',
    import.meta.url
  ).href;
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import { plainText } from ${JSON.stringify(moduleUrl)};
    for (const text of [
      '<'.repeat(1_000_000),
      '<script>'.repeat(125_000),
      '<script '.repeat(125_000),
      '<!--'.repeat(250_000),
      '<script>' + '</scripture>'.repeat(80_000),
    ]) assert.equal(plainText(text), '');
    assert.equal(plainText('<p>' + 'a'.repeat(1_000_000) + '</p>').length, 1_000_000);
  `,
    ],
    { timeout: 5000, encoding: 'utf8', windowsHide: true }
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
