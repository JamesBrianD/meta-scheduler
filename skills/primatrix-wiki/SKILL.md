---
name: primatrix-wiki
description: Create or edit wiki articles in the primatrix/wiki VitePress site. Trigger when user wants to write documentation, add reference articles, update wiki pages, or submit wiki-related PRs.
---

# Edit Wiki

Create or edit articles in the internal wiki (primatrix/wiki), a VitePress static site hosted on Cloudflare Pages. Handles the full workflow: branch creation, article writing, sidebar config update, lint, commit, and PR submission.

## Prerequisites

- Working directory is `/Users/ramezes/job/wiki` (or can cd there)
- `gh auth status` must succeed
- Wiki repo remote: `https://github.com/primatrix/wiki.git`

## Wiki Site Structure

```text
docs/
├── .vitepress/config.ts    ← Sidebar navigation config (MUST update for new pages)
├── index.md                ← Home page (layout: home)
├── projects/
│   ├── sglang-jax/         ← sglang-jax project docs
│   │   ├── index.md
│   │   └── reference/      ← Reference/research articles
│   ├── performance-optimization/
│   └── ling-alignment/
├── rfc/                    ← RFC documents
├── best-practices/         ← Coding standards, reviews
├── onboarding/             ← New member guides
└── summaries/              ← Meeting summaries (no sidebar entry)
```

## Content Conventions

- **Language**: All content in **Chinese (中文)**
- **Frontmatter**: Minimal — just `title` field for standard articles

  ```yaml
  ---
  title: 文章标题
  ---
  ```

- **File naming**: kebab-case, e.g., `sglang-kv-cache-offload.md`
- **Date-prefixed**: Use `YYYY-MM-DD-slug.md` for dated articles
- **RFC format**: `NNNN-slug.md` with extended frontmatter (status, author, date, reviewers)

## Workflow

### 1. Create branch

```bash
git checkout -b docs/<descriptive-slug>
```

### 2. Research (if needed)

If the article requires codebase research, use Explore agents to gather information before writing. Parallelize where possible.

### 3. Write the article

Create the `.md` file in the appropriate `docs/` subdirectory.

**Article structure guidelines**:

- Start with an H1 matching the frontmatter title
- Use a blockquote `>` for the article summary/scope
- Use `---` horizontal rules to separate major sections
- Use Chinese section numbering: 一、二、三… for top-level sections
- Use tables for structured comparisons
- Use fenced code blocks with language tags (e.g., ` ```python `, ` ```text ` for diagrams)
- Add blank lines before and after lists (markdownlint MD032)

**Reference article pattern** (for research/analysis docs):

```markdown
---
title: 参考：Topic Name
---

# 参考：Full Title

> 一句话描述本文的来源、目的和受众。

---

## 一、总览
## 二、核心架构
## 三、详细分析
...
## N、参考文件索引
```

### 4. Update sidebar config

**CRITICAL**: Every new page MUST be added to `docs/.vitepress/config.ts` sidebar, otherwise it won't appear in navigation.

Open `docs/.vitepress/config.ts`, find the matching section key (e.g., `'/projects/sglang-jax/'`), and add an entry:

```typescript
{ text: '文章标题', link: '/projects/sglang-jax/reference/article-slug' }
```

Rules:

- Links **omit** the `.md` extension and the `docs/` prefix
- Place the entry at the appropriate nesting level
- Use `collapsed: false` for sub-groups that should be expanded by default

### 5. Lint

Run markdownlint before committing:

```bash
npx markdownlint-cli2 docs/path/to/article.md
```

The pre-commit hook also runs `markdownlint-cli2` on all staged `docs/**/*.md` files automatically.

**Key lint rules** (disabled rules you DON'T need to worry about):

- MD013 (line length): disabled
- MD033 (inline HTML): disabled
- MD025 (single H1): disabled
- MD026 (trailing punctuation): disabled
- MD060 (table alignment): disabled

**Rules you MUST follow**:

- MD040: Fenced code blocks MUST have a language specified (use `text` for diagrams/pseudocode)
- MD032: Lists MUST be surrounded by blank lines
- MD029: Ordered list items use `1.` prefix within each sub-section (not continuous numbering across sections)

### 6. Commit

Stage both the article and config.ts (if modified):

```bash
git add docs/path/to/article.md docs/.vitepress/config.ts
git commit -m "docs: brief description of the article"
```

### 7. Push and create PR

Use `beaver-pr` skill if available, or:

```bash
git push -u origin docs/<branch-name>
gh pr create --title "docs: PR title" --body "$(cat <<'EOF'
## Summary
- Bullet points describing the changes

## Files
- `docs/path/to/article.md` — Article description
EOF
)"
```

### 8. Address review comments

After PR creation, automated reviewers (CodeRabbit, Gemini) may leave comments. Fetch and address them:

```bash
# Fetch PR review comments
gh api repos/primatrix/wiki/pulls/<PR_NUMBER>/comments

# Fetch PR general comments
gh pr view <PR_NUMBER> --json comments
```

Fix issues, commit, and push. Common review feedback:

- Inconsistent terminology or defaults
- Chinese grammar/wording improvements
- Outdated API claims (verify against current docs)

## Quick Reference

| Item | Value |
|------|-------|
| Repo | `primatrix/wiki` |
| Framework | VitePress 1.6.4 |
| Sidebar config | `docs/.vitepress/config.ts` |
| Lint tool | `markdownlint-cli2` |
| Lint config | `.markdownlint.yaml` |
| Git hooks | Husky + lint-staged (pre-commit) |
| Deploy | Cloudflare Pages (auto on push) |
| Content language | Chinese (中文) |
| File naming | kebab-case, `.md` extension |
