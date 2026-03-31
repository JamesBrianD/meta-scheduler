# Wiki Conventions

## Sidebar Config (`docs/.vitepress/config.ts`)

Every new page must have a sidebar entry. Find the matching section key and add an item:

```typescript
{ text: '文章标题', link: '/section/path/article-slug' }
```

- Links omit `docs/` prefix and `.md` extension
- Place at the appropriate nesting level in the existing structure
- Use `collapsed: false` for sub-groups that should be expanded by default
- Exception: `docs/summaries/` articles do not need sidebar entries

## Markdownlint

Lint tool: `markdownlint-cli2`. Config: `.markdownlint.yaml`. Pre-commit hook runs automatically on staged `docs/**/*.md`.

**Disabled rules** (don't worry about these):

| Rule | What it checks |
|------|---------------|
| MD013 | Line length |
| MD033 | Inline HTML |
| MD025 | Single H1 per file |
| MD026 | Trailing punctuation in headings |
| MD060 | Table column alignment |

**Rules you must follow**:

| Rule | Requirement |
|------|------------|
| MD040 | Fenced code blocks must have a language tag (`text` for diagrams) |
| MD032 | Blank lines before and after lists |
| MD029 | Ordered lists use `1.` prefix (reset numbering per section) |

## Git Conventions

- Branch naming: `docs/<descriptive-slug>`
- Commit message prefix: `docs: `
- PR reviews: CodeRabbit and Gemini auto-review. Fetch comments via:

```bash
gh api repos/primatrix/wiki/pulls/<PR_NUMBER>/comments
gh pr view <PR_NUMBER> --json comments
```

## Quick Reference

| Item | Value |
|------|-------|
| Repo | `primatrix/wiki` |
| Framework | VitePress |
| Sidebar config | `docs/.vitepress/config.ts` |
| Lint config | `.markdownlint.yaml` |
| Git hooks | Husky + lint-staged (pre-commit) |
| Deploy | Cloudflare Pages (auto on push) |
| Content language | Chinese (中文) |
