/**
 * Git operations wrapper for L2 repository sync
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { getL2RepoPath } from '../../shared/config.js';
import { logger } from '../../utils/logger.js';

export class GitOperations {
  private repoPath: string;

  constructor(repoPath?: string) {
    this.repoPath = repoPath || getL2RepoPath();
  }

  getRepoPath(): string {
    return this.repoPath;
  }

  /**
   * Clone a remote repo or init a local one
   */
  cloneOrInit(remoteUrl?: string): void {
    if (existsSync(join(this.repoPath, '.git'))) {
      logger.info('GIT', `Repository already exists at ${this.repoPath}`);
      return;
    }

    mkdirSync(this.repoPath, { recursive: true });

    if (remoteUrl) {
      logger.info('GIT', `Cloning ${remoteUrl}...`);
      this.exec(`git clone "${remoteUrl}" "${this.repoPath}"`);
    } else {
      logger.info('GIT', `Initializing new repository at ${this.repoPath}`);
      this.execInRepo('git init');
      this.createDefaultStructure();
      this.execInRepo('git add -A');
      this.execInRepo('git commit -m "Initial knowledge repository structure"');
    }
  }

  /**
   * Pull latest changes from remote
   */
  pull(): { success: boolean; commitSha?: string; error?: string } {
    try {
      if (!this.hasRemote()) {
        return { success: true, commitSha: this.getLastCommitSha() };
      }
      this.execInRepo('git pull --rebase');
      return { success: true, commitSha: this.getLastCommitSha() };
    } catch (error) {
      const msg = (error as Error).message;
      logger.error('GIT', 'Pull failed', {}, error as Error);
      return { success: false, error: msg };
    }
  }

  /**
   * Get files changed since a given commit
   */
  getChangedFilesSinceCommit(commitSha: string): string[] {
    try {
      const output = this.execInRepo(`git diff --name-only ${commitSha} HEAD`);
      return output.split('\n').filter(f => f.trim().length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Stage, commit, and optionally push
   */
  addAndCommit(message: string, files?: string[]): { success: boolean; commitSha?: string; error?: string } {
    try {
      if (files && files.length > 0) {
        for (const file of files) {
          this.execInRepo(`git add "${file}"`);
        }
      } else {
        this.execInRepo('git add -A');
      }

      // Check if there are changes to commit
      const status = this.execInRepo('git status --porcelain');
      if (!status.trim()) {
        return { success: true, commitSha: this.getLastCommitSha() };
      }

      this.execInRepo(`git commit -m "${message.replace(/"/g, '\\"')}"`);
      return { success: true, commitSha: this.getLastCommitSha() };
    } catch (error) {
      const msg = (error as Error).message;
      logger.error('GIT', 'Commit failed', {}, error as Error);
      return { success: false, error: msg };
    }
  }

  /**
   * Push to remote
   */
  push(): { success: boolean; error?: string } {
    try {
      if (!this.hasRemote()) {
        return { success: false, error: 'No remote configured' };
      }
      this.execInRepo('git push');
      return { success: true };
    } catch (error) {
      const msg = (error as Error).message;
      logger.error('GIT', 'Push failed', {}, error as Error);
      return { success: false, error: msg };
    }
  }

  /**
   * Get the latest commit SHA
   */
  getLastCommitSha(): string {
    try {
      return this.execInRepo('git rev-parse HEAD').trim();
    } catch {
      return '';
    }
  }

  /**
   * Check if the repo has a remote configured
   */
  hasRemote(): boolean {
    try {
      const output = this.execInRepo('git remote');
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Add a remote URL
   */
  setRemote(url: string): void {
    try {
      if (this.hasRemote()) {
        this.execInRepo(`git remote set-url origin "${url}"`);
      } else {
        this.execInRepo(`git remote add origin "${url}"`);
      }
    } catch (error) {
      logger.error('GIT', 'Set remote failed', {}, error as Error);
    }
  }

  // ============================================================================
  // File I/O within L2 repo
  // ============================================================================

  readFile(relativePath: string): string | null {
    const fullPath = join(this.repoPath, relativePath);
    if (!existsSync(fullPath)) return null;
    return readFileSync(fullPath, 'utf-8');
  }

  writeFile(relativePath: string, content: string): void {
    const fullPath = join(this.repoPath, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
  }

  fileExists(relativePath: string): boolean {
    return existsSync(join(this.repoPath, relativePath));
  }

  /**
   * List all markdown files in the knowledge directory
   */
  listMarkdownFiles(dir: string = 'knowledge'): string[] {
    const fullDir = join(this.repoPath, dir);
    if (!existsSync(fullDir)) return [];

    const results: string[] = [];
    const walk = (currentDir: string, prefix: string) => {
      const entries = readdirSync(currentDir);
      for (const entry of entries) {
        const fullPath = join(currentDir, entry);
        const relativePath = prefix ? `${prefix}/${entry}` : entry;
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath, relativePath);
        } else if (entry.endsWith('.md')) {
          results.push(`${dir}/${relativePath}`);
        }
      }
    };
    walk(fullDir, '');
    return results;
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private createDefaultStructure(): void {
    const dirs = [
      'knowledge/exchange/core',
      'knowledge/exchange/spot',
      'knowledge/exchange/futures',
      'knowledge/exchange/liquidity',
      'knowledge/custody/mpc',
      'knowledge/custody/wallet',
      'knowledge/custody/security',
      'knowledge/custody/compliance',
      'knowledge/infra/devops',
      'knowledge/infra/monitoring',
      'knowledge/infra/deployment',
      'knowledge/general',
    ];

    for (const dir of dirs) {
      mkdirSync(join(this.repoPath, dir), { recursive: true });
      // Create .gitkeep to preserve directory structure
      const gitkeep = join(this.repoPath, dir, '.gitkeep');
      if (!existsSync(gitkeep)) {
        writeFileSync(gitkeep, '', 'utf-8');
      }
    }

    // Create root README
    const readme = `# Compound Knowledge Repository

This repository stores curated knowledge assets produced by AI-assisted development sessions.

## Structure

\`\`\`
knowledge/
├── exchange/        # Exchange product line
│   ├── core/        # Matching engine, order management
│   ├── spot/        # Spot trading
│   ├── futures/     # Derivatives, perpetual contracts
│   └── liquidity/   # Market making, aggregation
├── custody/         # Custody product line
│   ├── mpc/         # MPC wallets
│   ├── wallet/      # Wallet management
│   ├── security/    # Security practices
│   └── compliance/  # KYC/KYT/AML
├── infra/           # Infrastructure
│   ├── devops/      # CI/CD, tooling
│   ├── monitoring/  # Observability
│   └── deployment/  # Deployment strategies
└── general/         # Cross-cutting concerns
\`\`\`

## Asset Types

- **pitfall** — Gotchas and traps to avoid
- **adr** — Architecture Decision Records
- **glossary** — Term definitions
- **best-practice** — Proven approaches
- **pattern** — Design patterns
- **discovery** — Code/system discoveries
- **skill** — Reusable skills
- **reference** — Reference materials
`;
    writeFileSync(join(this.repoPath, 'README.md'), readme, 'utf-8');
  }

  private exec(command: string): string {
    return execSync(command, { encoding: 'utf-8', timeout: 30000 });
  }

  private execInRepo(command: string): string {
    return execSync(command, { cwd: this.repoPath, encoding: 'utf-8', timeout: 30000 });
  }
}
