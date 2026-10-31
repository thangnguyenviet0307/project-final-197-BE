// Resolve actual installed TypeScript declarations instead of guessing from names.
// Read-only: no emit, database imports, environment files or package changes.
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(process.argv[2] ?? '.');
const require = createRequire(path.join(root, 'package.json'));
let ts = require('typescript');
// TypeScript 7's native distribution does not expose the legacy compiler API.
// Reuse the sibling frontend's installed JS compiler for this read-only analysis.
if (!ts.createProgram) ts = createRequire(path.resolve(root, '../project-final-197-FE/package.json'))('typescript');
const configs = process.argv.slice(3);
if (!configs.length) configs.push('tsconfig.json');
const findings = new Map();
const checkedFiles = new Set();
for (const name of configs) {
  const configPath = path.resolve(root, name);
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
  if (parsed.errors.length) throw new Error(parsed.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
  const scripts = ts.sys.readDirectory(root, ['.mjs', '.cjs', '.js'], ['node_modules', 'dist', '.git', '.local-backups', 'docs'], ['scripts/**/*', 'tests/**/*', '*.config.*']);
  const program = ts.createProgram([...new Set([...parsed.fileNames, ...scripts])], { ...parsed.options, allowJs: true, noEmit: true });
  const checker = program.getTypeChecker();
  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile || source.fileName.includes('/node_modules/') || source.fileName.includes('\\node_modules\\')) continue;
    const relative = path.relative(root, source.fileName).replaceAll('\\', '/');
    if (relative.startsWith('../')) continue;
    checkedFiles.add(relative);
    function record(node, tags, symbol) {
      const deprecated = tags.find(tag => tag.name === 'deprecated');
      if (!deprecated) return;
      const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
      const hint = typeof deprecated.text === 'string' ? deprecated.text : (deprecated.text ?? []).map(part => part.text).join('');
      const entry = { file: relative, line: line + 1, column: character + 1, symbol, hint };
      findings.set(`${relative}:${entry.line}:${entry.column}:${symbol}`, entry);
    }
    function visit(node) {
      if (ts.isPropertyAssignment(node) && ts.isObjectLiteralExpression(node.parent)) {
        const contextual = checker.getContextualType(node.parent);
        const property = contextual && checker.getPropertyOfType(contextual, node.name.getText(source).replace(/^['"]|['"]$/g, ''));
        if (property) record(node.name, property.getJsDocTags(checker), node.name.getText(source));
      }
      if (ts.isIdentifier(node)) {
        // Overload symbols merge JSDoc from every overload (including obsolete
        // HTML tag names). Calls must be assessed using their resolved signature.
        const expression = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node ? node.parent : node;
        const isCalled = (ts.isCallExpression(expression.parent) || ts.isNewExpression(expression.parent)) && expression.parent.expression === expression;
        let symbol = checker.getSymbolAtLocation(node);
        if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
        const allDeclarationsDeprecated = symbol?.declarations?.length && symbol.declarations.every(declaration =>
          ts.getJSDocTags(declaration).some(tag => tag.tagName.text === 'deprecated'));
        if (symbol && (!isCalled || allDeclarationsDeprecated)) record(node, symbol.getJsDocTags(checker), node.text);
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const signature = checker.getResolvedSignature(node);
        if (signature) record(node, signature.getJsDocTags(), node.expression.getText(source));
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
console.log(JSON.stringify({ root, typescript: ts.version, filesChecked: checkedFiles.size, findings: [...findings.values()] }, null, 2));
if (findings.size) process.exitCode = 1;
