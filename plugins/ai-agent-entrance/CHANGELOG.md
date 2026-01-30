# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] - 2026-01-30

### Added

- **Three-Layer Retrieval Architecture** (Based on [Vercel agents.md research](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals))
  - **L0 (Passive Index Scan)**: Compressed knowledge index injected via SessionStart hook
    - AGENTS-INDEX.md (~2.7KB for 10 assets)
    - Pipe-delimited format: `name|type|product_line|title|tags|promoted`
    - Always visible to Agent, eliminates "decision friction"

  - **L1 (Active Cross-Validation)**: Enhanced search_knowledge() MCP tool
    - Returns `score` field: Normalized relevance score (0-1, higher is better)
    - Returns `snippet` field: Context around matching keywords (±50 chars)
    - Used when L0 returns 3+ candidates for intelligent ranking

  - **L2 (Active Detail Retrieval)**: get_asset() for full markdown content
    - Prioritized by L1 score or L0 exact match
    - On-demand loading to save tokens

- **AGENTS-INDEX.md Generator** (`AgentsMdGenerator`)
  - Automatic index generation after sync/sink operations
  - Includes three-layer retrieval strategy documentation
  - Includes usage examples and asset type descriptions

- **RETRIEVAL-FIRST POLICY**
  - Strong instructions injected via SessionStart hook
  - Instructs Agent to check knowledge index FIRST before relying on pre-trained knowledge
  - Promotes retrieval-led reasoning over pre-training-led reasoning

### Changed

- **SessionStart Hook Enhanced**
  - Now injects 5 layers of context:
    1. RETRIEVAL-FIRST POLICY (critical instructions)
    2. AGENTS-INDEX.md (compressed knowledge index)
    3. Agent Router Skill (workflow recommendation)
    4. Pending Knowledge (reminder from previous session)
    5. Installed Tools (available development tools)

- **search_knowledge() Enhanced**
  - Now returns `score` (0-1 relevance) and `snippet` (context preview)
  - Enables L1 cross-validation when multiple candidates exist

### Performance

- **Knowledge Retrieval Success Rate**: 56% → 90%+ (based on Vercel research)
- **First Response Token Cost**: Variable (0-50KB) → Fixed (~2.7KB index)
- **Decision Friction**: Eliminated (index always visible)

### Technical Details

- AgentsMdGenerator service for index generation
- DatabaseStore.getAllKnowledgeAssets() method
- SearchService.normalizeRank() for FTS5 rank to score conversion
- SearchService.extractSnippet() for context extraction
- Updated to follow Vercel agents.md best practices

### Commits

- `a43c150`: feat: implement AGENTS-INDEX.md generation (Phase 1)
- `49a2a74`: feat: enhance SessionStart hook with AGENTS-INDEX.md injection (Phase 2)
- `5022bec`: feat: enhance search_knowledge with score and snippet (Phase 3)

## [2.1.0] - 2026-01-28

### Added

- **L1 ↔ L2 Knowledge Sync Architecture**
  - SQLite (L1) ↔ Git Repository (L2) bidirectional sync
  - Automatic markdown generation with YAML frontmatter
  - Conflict resolution (remote-wins strategy)

- **MCP Server** (10 tools)
  - search_knowledge, get_asset, list_assets
  - sync_knowledge, sink_knowledge
  - read_config, write_config, git_commit_push
  - filter_sensitive, get_knowledge_stats

- **Sensitive Information Filter**
  - 13 detection patterns (API keys, passwords, tokens, etc.)
  - Automatic sanitization before sinking

- **Dashboard UI**
  - Web interface at http://localhost:37778
  - Knowledge stats, asset management, sync panel

### Commits

- `8ca2ac3`: feat: v2.1.0 — L1↔L2 sync engine, MCP server, sensitive filter, dashboard UI
- `de9c3fd`: fix: bundle @modelcontextprotocol/sdk into MCP server CJS
- `3e7640f`: fix: move MCP config from plugin.json to .mcp.json
- `f839e7b`: docs: update README for v2.1.0 release
- `c9a30c7`: fix: set executable permissions on CJS scripts after build
- `da40b7b`: fix: handle git remote setup for existing repos in sync engine
- `f3983a8`: fix: refresh git remote URL from config before sync operations

## [1.0.0] - 2024-01-23

### Added

- Initial release of ai-agent-entrance plugin
- **Smart Routing (agent-router)**
  - Automatic keyword detection from user input
  - Product line identification (exchange/custody/infra)
  - Task type recognition (new project/optimization/refactor/bugfix)
  - Workflow recommendation based on task type
  - Auto-installation of recommended tools (BMAD, OpenSpec, Superpowers, SpecKit)
  - Superpowers priority rule when installed

- **Knowledge Sinking (knowledge-sink)**
  - Manual sinking via `/knowledge` command
  - Automatic pending knowledge detection on SessionStart
  - Dual-layer architecture (project-level + global-level)
  - Support for pitfall, ADR, glossary, and best-practice types
  - Knowledge promotion from project to global level

- **Commands**
  - `/gateway` - View routing analysis and recommendations
  - `/knowledge` - Manual knowledge sinking trigger

- **Configuration**
  - `biz-keywords.yaml` - Customizable business keywords
  - `workflow-routes.yaml` - Customizable routing rules

- **Templates**
  - Pitfall record template
  - Architecture Decision Record (ADR) template
  - Glossary term template
  - Best practice template

- **Hooks**
  - SessionStart hook for automatic skill injection
  - Pending knowledge reminder on new session

### Technical Details

- Inspired by [Superpowers](https://github.com/obra/superpowers) hook mechanism
- Inspired by [Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin) knowledge sinking pattern
