# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
