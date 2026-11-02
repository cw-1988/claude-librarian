#!/usr/bin/env node
// Docs check: broken links, hub and file sizes, orphans and MEMORY.md hubs. See README.md.
// Manual run (from the project root):  node path/to/docs-check.mjs [project dir]
// As the Stop hook (--hook): reads the hook's JSON on stdin and feeds problems back to Claude once per stop.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const defaults = {
  roots: ['.'],                    // folders searched for .md files
  files: [],                       // single files added on top
  exclude: ['(^|/)(node_modules|\\.git|\\.claude|vendor|dist|build|Library)(/|$)'],   // regexes on the relative path
  entryPoints: '^(README|CLAUDE|AGENTS|MEMORY)\\.md$',   // files that need no link to them
  notOrphan: [],                   // regexes on the relative path of files that need no link either
  upfront: '^(CLAUDE|AGENTS|MEMORY)\\.md$',              // files loaded at session start: kept small
  hubLinkLines: 15,                // link lines (list items or table rows with a local link) before a hub must split
  topicChars: 25000,               // characters before a topic file must split by subtopic
  upfrontChars: 5000,              // characters for each upfront file
  memory: true,                    // also check the project's Claude memory folder
  checks: [],                      // extra check modules, relative to the project: export default (ctx) => problems[]
  ignore: [],                      // regexes on problem lines the user accepted: never reported
};

function loadConfig(projectDir) {
  const file = join(projectDir, '.claude', 'docs-check.json');
  if (!existsSync(file)) return { ...defaults };
  return { ...defaults, ...JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) };
}

// Claude Code keeps a project's memory in <config>/projects/<path with every non-alphanumeric as ->/memory.
function memoryDir(projectDir, hookInput) {
  if (hookInput?.transcript_path) return join(dirname(hookInput.transcript_path), 'memory');
  const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  return join(configDir, 'projects', projectDir.replace(/[^a-zA-Z0-9]/g, '-'), 'memory');
}

function walk(dir, projectDir, exclude, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(projectDir, full).split(sep).join('/');
    if (exclude.some((re) => re.test(entry.isDirectory() ? rel + '/' : rel))) continue;
    if (entry.isDirectory()) walk(full, projectDir, exclude, out);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(full);
  }
  return out;
}

const read = (p) => readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const key = (p) => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p);
const slug = (h) => h.trim().toLowerCase().replace(/[^\p{L}\p{Nd} _-]/gu, '').replace(/ /g, '-');

export function check(projectDir, { hookInput } = {}) {
  projectDir = resolve(projectDir);
  const config = loadConfig(projectDir);
  const exclude = config.exclude.map((s) => new RegExp(s));
  const memory = memoryDir(projectDir, hookInput);

  const files = new Set();
  for (const root of config.roots) {
    const dir = resolve(projectDir, root);
    if (existsSync(dir)) walk(dir, projectDir, exclude, []).forEach((f) => files.add(f));
  }
  for (const f of config.files) if (existsSync(resolve(projectDir, f))) files.add(resolve(projectDir, f));
  const memFiles = config.memory && existsSync(memory)
    ? readdirSync(memory).filter((n) => n.endsWith('.md')).map((n) => join(memory, n))
    : [];
  const all = [...files, ...memFiles];

  const problems = [];
  const rel = (p) => p.startsWith(memory) ? 'memory/' + relative(memory, p).split(sep).join('/') : relative(projectDir, p).split(sep).join('/');
  const headCache = new Map();
  const heads = (p) => {
    if (!headCache.has(p)) headCache.set(p, read(p).split('\n').filter((l) => /^#+ /.test(l)).map((l) => slug(l.replace(/^#+ /, ''))));
    return headCache.get(p);
  };

  // Links, anchors and wiki links; remember every file something links to.
  const linked = new Set();
  for (const file of all) {
    const text = read(file).replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');   // code isn't links
    const links = [...text.matchAll(/\]\(<([^>]+)>\)/g), ...text.matchAll(/\]\(([^)<\s]+)\)/g)].map((m) => m[1]);
    for (const l of links) {
      if (/^([a-z][a-z0-9+.-]*:|#local_|#terminal)/i.test(l)) continue;   // URLs, drive paths, app links
      const [rawPath, anchor] = l.split(/#(.*)/s);
      const path = decodeURIComponent(rawPath);
      const target = path ? resolve(dirname(file), path) : file;
      if (!existsSync(target)) { problems.push(`Broken link: ${rel(file)} -> ${l}`); continue; }
      linked.add(key(target));
      if (anchor && target.toLowerCase().endsWith('.md') && !heads(target).includes(anchor)) {
        problems.push(`Broken anchor: ${rel(file)} -> ${l}`);
      }
    }
    for (const m of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
      const target = join(dirname(file), `${m[1]}.md`);
      if (existsSync(target)) linked.add(key(target));
      else problems.push(`Broken wiki link: ${rel(file)} -> [[${m[1]}]]`);
    }
  }

  // Sizes: hubs past the link-line limit, topic files past the size limit, upfront files past theirs.
  const upfront = new RegExp(config.upfront);
  for (const file of all) {
    const text = read(file).replace(/\n$/, '');
    const linkLines = text.split('\n').filter((l) => /^\s*([-*+]|\d+\.|\|)\s.*(\]\((?!https?:)|\[\[)/.test(l)).length;
    if (linkLines > config.hubLinkLines) {
      problems.push(`Hub too big: ${rel(file)} has ${linkLines} link lines (limit ${config.hubLinkLines}): split it into sub-hubs by group`);
    }
    if (upfront.test(basename(file))) {
      if (text.length > config.upfrontChars) problems.push(`Upfront file too big: ${rel(file)} is ${text.length} chars (limit ${config.upfrontChars}): move how-tos into topic files`);
    } else if (text.length > config.topicChars) {
      problems.push(`Topic file too big: ${rel(file)} is ${text.length} chars (limit ${config.topicChars}): split it by subtopic`);
    }
  }

  // Orphans: a doc nothing links to can't be found from its hub.
  const entryPoints = new RegExp(config.entryPoints);
  const notOrphan = config.notOrphan.map((s) => new RegExp(s));
  for (const file of all) {
    if (entryPoints.test(basename(file)) || notOrphan.some((re) => re.test(rel(file)))) continue;
    if (!linked.has(key(file))) problems.push(`Not linked from any hub: ${rel(file)}`);
  }

  // MEMORY.md lists hubs only: every line links a file that itself links several memories.
  const memIndex = join(memory, 'MEMORY.md');
  if (config.memory && existsSync(memIndex)) {
    for (const line of read(memIndex).split('\n')) {
      if (!/^\s*-\s/.test(line)) continue;
      const m = line.match(/\]\(([^)]+\.md)\)/);
      if (!m) { problems.push(`MEMORY.md line without a hub link: ${line}`); continue; }
      const hub = join(memory, decodeURIComponent(m[1]));
      if (existsSync(hub) && (read(hub).match(/\[\[/g) ?? []).length < 3) {
        problems.push(`MEMORY.md links a memory, not a hub: ${m[1]} (put it into its hub memory)`);
      }
    }
  }

  return { config, problems, ctx: { projectDir, memoryDir: memory, files: [...files], memFiles, read } };
}

async function main() {
  const args = process.argv.slice(2);
  const hook = args.includes('--hook');
  let hookInput = null;
  if (hook) {
    const raw = readFileSync(0, 'utf8').replace(/^﻿/, '');
    if (raw.trim()) hookInput = JSON.parse(raw);
  }
  const projectDir = args.find((a) => !a.startsWith('--')) ?? process.env.CLAUDE_PROJECT_DIR ?? hookInput?.cwd ?? process.cwd();
  const { config, problems: found, ctx } = check(projectDir, { hookInput });
  for (const mod of config.checks) {
    const extra = await import(pathToFileURL(resolve(ctx.projectDir, mod)).href);
    found.push(...(await extra.default(ctx)));
  }
  // Accepted problems drop out here, so one the user chose to keep can't block every turn.
  const ignore = config.ignore.map((s) => new RegExp(s));
  const problems = found.filter((p) => !ignore.some((re) => re.test(p)));

  if (!hook) {
    problems.forEach((p) => console.log(p));
    console.log(`problems: ${problems.length}` + (found.length > problems.length ? ` (${found.length - problems.length} ignored)` : ''));
    return;
  }
  if (problems.length === 0) return;
  let shown = problems.slice(0, 25).join('\n');
  if (problems.length > 25) shown += `\n... and ${problems.length - 25} more (run docs-check.mjs by hand for all)`;
  const out = hookInput?.stop_hook_active
    ? { systemMessage: `Docs check still finds ${problems.length} problem(s):\n${shown}` }
    : { decision: 'block', reason: `Docs check found ${problems.length} problem(s). Fix them before finishing (rules: the docs rules in CLAUDE.md). If one can't or shouldn't be fixed, ask the user, and on their yes add a regex for it to "ignore" in .claude/docs-check.json:\n${shown}` };
  console.log(JSON.stringify(out));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    // A broken check must never trap a session: report and let the stop through.
    console.error(`docs-check: ${e.message}`);
    process.exit(0);
  });
}
