---
name: primatrix-wiki
description: Read, create, or edit articles in the primatrix/wiki VitePress site. Use when the user wants to write documentation, look up wiki content, add reference articles, update existing pages, or submit wiki PRs. Trigger on mentions of "wiki", "文档", "写一篇", "查一下wiki", or any primatrix/wiki related task.
---

# Primatrix Wiki

Internal wiki powered by VitePress. GitHub repo: `primatrix/wiki`.

> The deployed site (`wiki.infiscale-infra.org`) is behind Cloudflare Access — not accessible via WebFetch. Use GitHub API or local clone for all operations.

## Before Acting

Determine which mode to use:

- **Read-only** (lookup, search) → GitHub API works without a local clone.
- **Write** (create/edit articles, submit PRs) → Need a local clone. Check if the current directory is the wiki repo (`git remote -v | grep primatrix/wiki`). If not, clone it: `gh repo clone primatrix/wiki`.

For write operations, discover the wiki structure first:

```bash
ls docs/projects/ docs/                   # available sections
cat docs/.vitepress/config.ts             # sidebar navigation
```

## Decision Flow

1. **Find or read content?**
   - List files: `gh api repos/primatrix/wiki/contents/docs/<section> --jq '.[].name'`
   - Read a file: `gh api repos/primatrix/wiki/contents/docs/<path> --jq '.content' | base64 -d`
   - Search (needs local clone): Grep/Glob in the `docs/` directory

2. **Create a new article?**
   - Ask or infer: which section/project does it belong to?
   - Read 1-2 existing articles in that section to match the local style
   - Follow the **New Article Workflow** below

3. **Edit an existing article?**
   - Locate the file, read it, make changes
   - Lint: `npx markdownlint-cli2 docs/path/to/article.md`
   - Commit and PR via `beaver-pr`

## New Article Workflow

1. **Branch**: `git checkout -b docs/<descriptive-slug>`
2. **Write**: Create `.md` in the appropriate `docs/` subdirectory
3. **Sidebar**: Add entry to `docs/.vitepress/config.ts` — every new page needs one, or it won't appear in navigation. See `references/conventions.md` for format.
4. **Lint**: `npx markdownlint-cli2 docs/path/to/article.md` — see `references/conventions.md` for rules
5. **Commit**: Stage article + config.ts, commit with `docs: ...` prefix
6. **PR**: Use `beaver-pr` skill, or push and `gh pr create`

Before writing, read `references/conventions.md` for content and formatting rules.
