import { readFile, writeFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const schemaFile = path.join(directory, 'review-report.schema.json');
const templateFile = path.join(directory, 'review-report.template.html');
const marker = '__REVIEW_REPORT_DATA__';
const types = {
  null: value => value === null,
  object: value => value !== null && typeof value === 'object' && !Array.isArray(value),
  array: Array.isArray,
  string: value => typeof value === 'string',
  boolean: value => typeof value === 'boolean',
  integer: Number.isSafeInteger,
  number: value => typeof value === 'number' && Number.isFinite(value),
};

// Implements the explicitly documented subset used by the bundled schema.
// It is not a general JSON Schema 2020-12 implementation.
export function validateReport(data, schema) {
  const errors = [];
  function visit(value, rule, location) {
    if (rule.$ref) {
      const match = /^#\/\$defs\/([^/]+)$/.exec(rule.$ref);
      if (!match || !schema.$defs[match[1]]) throw new Error(`Schema reference unsupported: ${rule.$ref}`);
      return visit(value, schema.$defs[match[1]], location);
    }
    const fail = message => errors.push(`${location}: ${message}`);
    if (rule.type && ![rule.type].flat().some(type => types[type]?.(value))) { fail(`expected ${[rule.type].flat().join(' or ')}`); return; }
    if (rule.const !== undefined && value !== rule.const) fail(`must equal ${JSON.stringify(rule.const)}`);
    if (rule.enum && !rule.enum.includes(value)) fail(`must be one of ${rule.enum.join(', ')}`);
    if (typeof value === 'string') {
      // JSON Schema lengths count Unicode code points, not UTF-16 code units.
      const length = [...value].length;
      if (rule.minLength !== undefined && length < rule.minLength) fail(`minimum length ${rule.minLength}`);
      if (rule.maxLength !== undefined && length > rule.maxLength) fail(`maximum length ${rule.maxLength}`);
      if (rule.pattern && !new RegExp(rule.pattern, 'u').test(value)) fail(`does not match ${rule.pattern}`);
      if (rule.format === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))) fail('expected ISO date-time with timezone');
    }
    if (typeof value === 'number') {
      if (rule.minimum !== undefined && value < rule.minimum) fail(`minimum ${rule.minimum}`);
      if (rule.maximum !== undefined && value > rule.maximum) fail(`maximum ${rule.maximum}`);
    }
    if (Array.isArray(value)) {
      if (rule.minItems !== undefined && value.length < rule.minItems) fail(`minimum ${rule.minItems} items`);
      if (rule.maxItems !== undefined && value.length > rule.maxItems) fail(`maximum ${rule.maxItems} items`);
      if (rule.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) fail('duplicate array values');
      if (rule.items) value.forEach((item, index) => visit(item, rule.items, `${location}[${index}]`));
    } else if (types.object(value)) {
      for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) fail(`missing required property ${key}`);
      for (const key of Object.keys(value)) {
        if (Object.hasOwn(rule.properties ?? {}, key)) visit(value[key], rule.properties[key], `${location}.${key}`);
        else if (rule.additionalProperties === false) fail(`unknown property ${key}`);
      }
    }
  }
  visit(data, schema, '$');
  const used = new Set();
  for (const group of ['coverage', 'findings', 'featureMatrix', 'missingFeatures', 'actionPlan', 'manualTests', 'checks', 'topPriorities']) {
    if (!Array.isArray(data?.[group])) continue;
    for (const entry of data[group]) {
      if (typeof entry?.id !== 'string') continue;
      if (used.has(entry.id)) errors.push(`${group}: duplicate ID ${entry.id}`);
      used.add(entry.id);
    }
  }
  const findingIds = new Set(Array.isArray(data?.findings) ? data.findings.map(finding => finding?.id) : []);
  for (const item of Array.isArray(data?.topPriorities) ? data.topPriorities : []) {
    for (const id of Array.isArray(item?.findingIds) ? item.findingIds : []) if (!findingIds.has(id)) errors.push(`topPriorities: unknown finding ID ${id}`);
  }
  if (errors.length) throw new Error(`Report validation failed (${errors.length}):\n${errors.slice(0, 30).join('\n')}`);
  return data;
}

export function safeJson(data) {
  return JSON.stringify(data).replace(/[<>&\u2028\u2029]/g, char => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029' })[char]);
}

async function canonical(file) {
  try { return await realpath(file); } catch (error) { if (error.code === 'ENOENT') return path.resolve(file); throw error; }
}

export async function renderReport(args = process.argv.slice(2)) {
  const options = new Map();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!['--data', '--out', '--force'].includes(flag) || options.has(flag)) throw new Error(`Unknown or duplicate argument: ${flag}`);
    if (flag === '--force') options.set(flag, true);
    else {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      options.set(flag, path.resolve(value));
    }
  }
  const input = options.get('--data'), output = options.get('--out');
  if (!input || !output) throw new Error('Usage: pnpm exec node render-review-report.mjs --data report.json --out report.html [--force]');
  if (path.extname(input).toLowerCase() !== '.json' || path.extname(output).toLowerCase() !== '.html') throw new Error('Input must be .json and output must be .html');
  const normalize = file => process.platform === 'win32' ? file.toLowerCase() : file;
  const resolvedOutput = normalize(await canonical(output));
  let outputInfo;
  try { outputInfo = await stat(output); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const protectedFile of [input, templateFile, schemaFile, fileURLToPath(import.meta.url)]) {
    if (resolvedOutput === normalize(await canonical(protectedFile))) throw new Error('Output must not overwrite input, template, schema or renderer');
    const protectedInfo = await stat(protectedFile);
    if (outputInfo && outputInfo.ino !== 0 && outputInfo.ino === protectedInfo.ino && outputInfo.dev === protectedInfo.dev) throw new Error('Output must not overwrite a hard link to input, template, schema or renderer');
  }
  const [json, template, schemaJson] = await Promise.all([readFile(input, 'utf8'), readFile(templateFile, 'utf8'), readFile(schemaFile, 'utf8')]);
  let data, schema;
  try { data = JSON.parse(json); schema = JSON.parse(schemaJson); } catch { throw new Error('Invalid JSON in input or schema'); }
  validateReport(data, schema);
  if (!template.includes(`name="review-template-version" content="${data.templateVersion}"`)) throw new Error('Template version does not match report data');
  if (template.split(marker).length !== 2) throw new Error('Template must contain exactly one data placeholder');
  const html = template.replace(marker, () => safeJson(data));
  try { await writeFile(output, html, { encoding: 'utf8', flag: options.has('--force') ? 'w' : 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Output already exists. Choose -02/-03 or use --force explicitly.'); throw error; }
  console.log(`Rendered ${path.basename(output)}: ${data.findings.length} findings; template ${data.templateVersion}`);
  return { input, output, findings: data.findings.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  renderReport().catch(error => { console.error(error.message); process.exitCode = 1; });
}
