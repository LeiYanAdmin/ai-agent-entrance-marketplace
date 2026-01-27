---
name: sync
description: 同步知识库 (L1 SQLite ↔ L2 Git)。Sync knowledge between L1 cache and L2 repository.
---

# /sync Command

Synchronize the knowledge base between L1 (SQLite local cache) and L2 (Git repository).

## Usage

```
/sync [pull|push|both]
```

## Arguments

- **pull** — Pull latest changes from L2 Git repo into L1 SQLite
- **push** — Push unpromoted L1 assets to L2 Git repo
- **both** (default) — Pull first, then push

## Behavior

1. **Pull**: Fetches latest commits from remote, parses changed markdown files, upserts into SQLite knowledge_assets table
2. **Push**: Serializes unpromoted SQLite assets to markdown with YAML frontmatter, writes to L2 repo, commits and pushes
3. **Both**: Executes pull then push sequentially

## Instructions for Claude

When the user runs `/sync`, use the `sync_knowledge` MCP tool:

```json
{
  "direction": "<pull|push|both>"
}
```

If no argument is provided, default to `"both"`.

After sync completes, report:
- Number of assets pulled/pushed
- Any errors encountered
- Current knowledge base stats

## Configuration

The L2 repository URL can be set via:
```json
{
  "tool": "write_config",
  "arguments": { "key": "L2_REPO_URL", "value": "https://github.com/org/compound-knowledge.git" }
}
```

Enable auto-sync on session start:
```json
{
  "tool": "write_config",
  "arguments": { "key": "AUTO_SYNC_ON_SESSION_START", "value": "true" }
}
```
