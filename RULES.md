# Docs rules

- Docs and Claude memory: every topic with its own identity (a feature, system, tool, character, decision, lesson,
  or a sizable idea, a maybe included) gets its own file. General files (READMEs, indexes, overviews, MEMORY.md) stay
  as slim as possible: at most one or two lines per linked file, saying what it is, plus the link. The detail lives
  only in the topic's own file, never repeated in the general one. When moving a topic, fix every link to its old
  anchor.
- The same holds for rules, instructions, memory and logs (CLAUDE.md, AGENTS.md, memory hubs): keep what is loaded
  upfront minimal. Files read every session hold the essentials and hub lines; how-tos, history and entries live in
  topic files read on demand. A new memory goes into its hub memory, MEMORY.md lists only hubs.
- Hubs get split too: when one passes about 12–15 link lines, or its entries fall into clear groups a task would want
  apart, move each group into a sub-hub file (same one-line-per-file form) and leave one line per sub-hub in the
  parent. Keep the tree shallow (parent → sub-hub → topic), and keep any numbers or names code or docs look up
  findable from the parent line.
- The docs check runs as the Stop hook and checks these rules. Fix what it reports before finishing, including
  problems your change didn't cause.
