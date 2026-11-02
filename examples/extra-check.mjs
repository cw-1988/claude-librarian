// Example extra check: every file under docs/decisions/ starts with a date line. List it under `checks` in
// .claude/docs-check.json.
import { relative, sep } from 'node:path';

export default function decisionDates({ projectDir, files, read }) {
  const problems = [];
  for (const file of files) {
    const rel = relative(projectDir, file).split(sep).join('/');
    if (!rel.startsWith('docs/decisions/')) continue;
    if (!/^Date: \d{4}-\d{2}-\d{2}/m.test(read(file))) problems.push(`Decision without a date: ${rel}`);
  }
  return problems;
}
