---
name: primatrix-wiki
description: Read, create, or edit articles in the primatrix/wiki VitePress site. Use when the user wants to write documentation, look up wiki content, add reference articles, update existing pages, or submit wiki PRs. Trigger on mentions of "wiki", "文档", "写一篇", "查一下wiki", or any primatrix/wiki related task.
---

# Primatrix Wiki

Internal wiki at `primatrix/wiki`, a VitePress site deployed on Cloudflare Pages.

**Repo**: `/Users/ramezes/job/wiki` — all operations run from this directory.

## Before Acting

Discover the wiki's current structure and available sections:

```bash
# Sections and projects
ls docs/projects/ docs/
# Sidebar navigation structure
cat docs/.vitepress/config.ts
# Existing articles in a section
find docs/<section>/ -name "*.md"
```

## Decision Flow

1. **User wants to find or read content?**
   - Search: `grep -r "keyword" docs/ --include="*.md" -l`
   - Read the matched article(s) and summarize for the user

2. **User wants to create a new article?**
   - Ask or infer: which section/project does it belong to?
   - Read 1-2 existing articles in that section to match the local style
   - Follow the **New Article Workflow** below

3. **User wants to edit an existing article?**
   - Locate the file, read it, make changes
   - Run lint: `npx markdownlint-cli2 docs/path/to/article.md`
   - Commit and push (or PR via `beaver-pr`)

## New Article Workflow

1. **Branch**: `git checkout -b docs/<descriptive-slug>`
2. **Write**: Create `.md` in the appropriate `docs/` subdirectory
3. **Sidebar**: Add entry to `docs/.vitepress/config.ts` — every new page needs one, or it won't appear in navigation. See `references/conventions.md` for link format.
4. **Lint**: `npx markdownlint-cli2 docs/path/to/article.md` — see `references/conventions.md` for rules
5. **Commit**: Stage article + config.ts, commit with `docs: ...` prefix
6. **PR**: Use `beaver-pr` skill, or push and `gh pr create`

## Writing Guidelines

- **Language**: All content in Chinese (中文)
- **Frontmatter**: Minimal — typically just `title`
- **File naming**: `kebab-case.md`; use `YYYY-MM-DD-slug.md` for dated articles, `NNNN-slug.md` for RFCs
- **Style**: Match existing articles in the same section — read one first. No fixed template; adapt structure to the content.
- **Code blocks**: Always specify a language tag (use `text` for diagrams/pseudocode)

For detailed lint rules and sidebar config patterns, read `references/conventions.md`.
