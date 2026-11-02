// Artifact-only tests. No application mutation, network requests or database use.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, realpath, stat, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { renderReport, validateReport } from './render-review-report.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const input = path.resolve(option('--data') ?? path.join(directory, 'review-report.example.json'));
const schema = JSON.parse(await readFile(path.join(directory, 'review-report.schema.json'), 'utf8'));
const data = JSON.parse(await readFile(input, 'utf8'));
validateReport(data, schema);
const inputBefore = await readFile(input, 'utf8');
const templateBefore = await readFile(path.join(directory, 'review-report.template.html'), 'utf8');
let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions++; };
const invalid = mutate => { const candidate = structuredClone(data); mutate(candidate); assert.throws(() => validateReport(candidate, schema)); assertions++; };
invalid(value => delete value.reportMeta.scope);
invalid(value => { value.overview.unexpected = true; });
invalid(value => { value.templateVersion = '999.0.0'; });
invalid(value => { value.reportMeta.reviewedAt = 'unknown'; });
if (data.findings.length) {
  invalid(value => { value.findings[0].severity = 'Critical'; });
  invalid(value => { value.findings[0].verificationStatus = 'maybe'; });
  invalid(value => { value.findings.push(structuredClone(value.findings[0])); });
  invalid(value => { value.findings[0].evidence[0].line = -1; });
}
invalid(value => { value.topPriorities[0].findingIds = ['UNKNOWN-ID']; });
const temporary = await mkdtemp(path.join(tmpdir(), 'review-kit-'));
let domResult = 'not available';
try {
  const output = path.join(temporary, 'report.html');
  await renderReport(['--data', input, '--out', output]);
  await assert.rejects(renderReport(['--data', input, '--out', output]), /already exists/); assertions++;
  await renderReport(['--data', input, '--out', output, '--force']);
  await assert.rejects(renderReport(['--data', input, '--out', input, '--force'])); assertions++;
  await assert.rejects(renderReport(['--data', input, '--out', path.join(directory, 'review-report.template.html'), '--force']), /must not overwrite/); assertions++;
  const protectedInput = path.join(temporary, 'protected-input.json'), hardLink = path.join(temporary, 'protected-alias.html');
  await writeFile(protectedInput, inputBefore);
  await link(protectedInput, hardLink);
  await assert.rejects(renderReport(['--data', protectedInput, '--out', hardLink, '--force']), /must not overwrite/); assertions++;
  check(await readFile(protectedInput, 'utf8') === inputBefore, 'Hard-linked input preserved');
  const html = await readFile(output, 'utf8');
  check(!html.includes('__REVIEW_REPORT_DATA__'), 'No unresolved template marker');
  check(!/<script\b[^>]*\bsrc\s*=|<link\b[^>]*\bhref\s*=/i.test(html), 'No CDN or external resources');
  const embedded = JSON.parse(/<script type="application\/json" id="review-data">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.deepEqual(embedded, data); assertions++;
  const malicious = '</script><script>globalThis.__reviewInjected=1</script><img src=x onerror="globalThis.__reviewInjected=2"> & < > \u2028\u2029';
  const fixture = structuredClone(data);
  const base = data.findings[0] ?? {
    id: 'TEST', title: 'Test', severity: 'P2', verificationStatus: 'risk', module: 'Test', layer: 'FE', evidence: [], preconditions: [], reproductionSteps: [], expectedBehavior: 'Expected', actualBehavior: 'Actual', impact: 'Impact', recommendation: 'Recommendation', verificationMethod: 'Fixture',
  };
  fixture.findings = [
    { ...structuredClone(base), id: 'TEST_A', title: 'Đơn hàng đặc biệt ' + malicious, module: 'Orders', severity: 'P1', verificationStatus: 'confirmed', evidence: [{ file: 'src/order-special.ts', line: 123, symbol: null, description: malicious }] },
    { ...structuredClone(base), id: 'TEST_B', title: 'Rủi ro đơn hàng', module: 'Orders', severity: 'P2', verificationStatus: 'risk' },
    { ...structuredClone(base), id: 'TEST_C', title: 'Sản phẩm ' + 'dài '.repeat(1000), module: 'Products', severity: 'P2', verificationStatus: 'confirmed' },
  ];
  fixture.topPriorities.forEach(item => { item.findingIds = []; });
  const fixtureFile = path.join(temporary, 'fixture.json'), fixtureOutput = path.join(temporary, 'fixture.html');
  await writeFile(fixtureFile, JSON.stringify(fixture));
  await renderReport(['--data', fixtureFile, '--out', fixtureOutput]);
  const fixtureHtml = await readFile(fixtureOutput, 'utf8');
  check(!fixtureHtml.includes(malicious), 'Closing script string must be escaped in raw HTML');
  const empty = structuredClone(fixture);
  for (const key of ['findings', 'coverage', 'featureMatrix', 'missingFeatures', 'actionPlan', 'manualTests', 'checks']) empty[key] = [];
  const emptyFile = path.join(temporary, 'empty.json'), emptyOutput = path.join(temporary, 'empty.html');
  await writeFile(emptyFile, JSON.stringify(empty));
  await renderReport(['--data', emptyFile, '--out', emptyOutput]);

  // Reuse jsdom already installed in the sibling FE. The production renderer has no dependencies.
  let JSDOM, VirtualConsole;
  try {
    const manifest = path.resolve(option('--dom-package') ?? path.join(directory, '../../../project-final-197-FE/package.json'));
    ({ JSDOM, VirtualConsole } = createRequire(manifest)('jsdom'));
  } catch { console.log('DOM tests skipped: jsdom not installed at --dom-package. Node validation/render tests still ran.'); }
  if (JSDOM) {
    const errors = [], windows = [];
    const open = contents => { const console = new VirtualConsole(); console.on('jsdomError', error => errors.push(error.message)); const dom = new JSDOM(contents, { runScripts: 'dangerously', virtualConsole: console, beforeParse(window) { window.print = () => { window.__printed = true; }; } }); windows.push(dom.window); return dom.window; };
    try {
      const current = open(html);
      check(current.reviewReport.total === data.findings.length, 'Actual report count');
      for (const severity of ['P0', 'P1', 'P2', 'P3']) check(current.reviewReport.counts[severity] === data.findings.filter(item => item.severity === severity).length, 'Severity statistics match data');
      for (const status of ['confirmed', 'risk', 'not_found', 'improvement']) check(current.reviewReport.counts[status] === data.findings.filter(item => item.verificationStatus === status).length, 'Verification statistics match data');
      for (const category of ['P0', 'P1', 'P2', 'P3', 'confirmed', 'risk', 'not_found', 'improvement']) check(Number(current.document.querySelector(`[data-stat="${category}"] b`).textContent) === current.reviewReport.counts[category], 'Visible statistic cards match counts');
      const window = open(fixtureHtml), document = window.document;
      check(window.__reviewInjected === undefined && document.querySelectorAll('img').length === 0, 'No script/HTML injection');
      check(document.body.textContent.includes(malicious), 'Special content is rendered as text');
      const set = (id, value) => { const node = document.getElementById(id); node.value = value; node.dispatchEvent(new window.Event(id === 'search' ? 'input' : 'change', { bubbles: true })); };
      const visible = () => [...document.querySelectorAll('#finding-list details')].filter(node => !node.hidden);
      set('search', 'order-special.ts'); check(visible().length === 1, 'Search evidence path');
      set('search', 'TEST_A'); check(visible().length === 1, 'Search ID');
      set('search', 'don hang'); check(visible().length === 2, 'Vietnamese search accents');
      set('severity', 'P2'); set('verification', 'risk'); set('module', 'Orders'); check(visible().length === 1 && visible()[0].id === 'finding-TEST_B', 'Combined filters are AND');
      set('module', 'Products'); check(visible().length === 0 && !document.getElementById('no-results').hidden, 'Empty filter results');
      document.getElementById('clear-filters').click(); check(visible().length === 3, 'Clear filters restores all');
      check(['search', 'severity', 'verification', 'module'].every(id => document.getElementById(id).value === ''), 'Reset clears every filter');
      document.getElementById('expand-all').click(); check(visible().every(node => node.open), 'Expand visible findings');
      document.getElementById('collapse-all').click(); check(visible().every(node => !node.open), 'Collapse visible findings');
      set('module', 'Products');
      window.dispatchEvent(new window.Event('beforeprint')); check([...document.querySelectorAll('details')].every(node => node.open), 'Print opens all details');
      window.dispatchEvent(new window.Event('afterprint')); check(visible().length === 1 && visible().every(node => !node.open), 'Restore screen state after print');
      document.getElementById('print').click(); check(window.__printed === true, 'Print button');
      check(window.reviewReport.counts.P1 === 1 && window.reviewReport.counts.P2 === 2 && window.reviewReport.counts.confirmed === 2, 'Statistics for mixed fixture');
      const emptyWindow = open(await readFile(emptyOutput, 'utf8'));
      check(emptyWindow.reviewReport.total === 0 && !emptyWindow.document.getElementById('no-results').hidden, 'Empty findings report');
      check(errors.length === 0, 'No DOM script errors: ' + errors.join('; '));
      domResult = 'passed: search/filter/reset/details/stats/print events/XSS/long and empty data (no visual layout verification)';
    } finally { windows.forEach(window => window.close()); }
  }
  check(inputBefore === await readFile(input, 'utf8'), 'Input preserved');
  check(templateBefore === await readFile(path.join(directory, 'review-report.template.html'), 'utf8'), 'Template preserved');
  check((await stat(output)).size > 0, 'Output created');
  console.log(JSON.stringify({ passed: true, assertions, dom: domResult, visualBrowser: 'not run' }, null, 2));
} finally {
  // Remove only this script's fresh temporary directory, after checking its resolved location.
  const resolved = await realpath(temporary), allowedParent = await realpath(tmpdir());
  if (path.dirname(resolved).toLowerCase() !== allowedParent.toLowerCase() || !path.basename(resolved).startsWith('review-kit-')) throw new Error('Temporary cleanup path is outside expected directory');
  await rm(resolved, { recursive: true });
}
