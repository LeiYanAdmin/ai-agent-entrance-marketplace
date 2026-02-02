/**
 * Git operations wrapper for L2 repository sync
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { getL2RepoPath } from '../../shared/config.js';
import { logger } from '../../utils/logger.js';

// 简单的文件锁实现，防止并发 git 操作
const LOCK_FILE = '.ai-agent-entrance.lock';
const LOCK_TIMEOUT_MS = 10000; // 10秒锁超时
const RETRY_DELAY_MS = 100;    // 重试间隔
const MAX_RETRIES = 50;        // 最大重试次数

export class GitOperations {
  private repoPath: string;

  constructor(repoPath?: string) {
    this.repoPath = repoPath || getL2RepoPath();
  }

  getRepoPath(): string {
    return this.repoPath;
  }

  // ============================================================================
  // 锁机制 - 防止 Git 并发操作冲突
  // ============================================================================

  /**
   * 获取操作锁
   */
  private acquireLock(): boolean {
    const lockPath = join(this.repoPath, LOCK_FILE);

    // 检查是否有过期的锁
    if (existsSync(lockPath)) {
      try {
        const lockContent = readFileSync(lockPath, 'utf-8');
        const lockTime = parseInt(lockContent, 10);
        if (Date.now() - lockTime > LOCK_TIMEOUT_MS) {
          // 锁已过期，清理它
          unlinkSync(lockPath);
          logger.warn('GIT', 'Cleaned up stale lock file');
        } else {
          return false; // 锁还有效，无法获取
        }
      } catch {
        // 无法读取锁文件，尝试删除
        try { unlinkSync(lockPath); } catch { /* ignore */ }
      }
    }

    // 创建新锁
    try {
      writeFileSync(lockPath, String(Date.now()), { flag: 'wx' }); // wx = 独占创建
      return true;
    } catch {
      return false; // 另一个进程抢先创建了锁
    }
  }

  /**
   * 释放操作锁
   */
  private releaseLock(): void {
    const lockPath = join(this.repoPath, LOCK_FILE);
    try {
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
      }
    } catch {
      // 忽略释放锁的错误
    }
  }

  /**
   * 等待并获取锁（带重试）
   */
  private async waitForLock(): Promise<boolean> {
    for (let i = 0; i < MAX_RETRIES; i++) {
      if (this.acquireLock()) {
        return true;
      }
      // 等待后重试，使用指数退避
      const delay = RETRY_DELAY_MS * Math.min(Math.pow(1.5, i), 10);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    logger.error('GIT', `Failed to acquire lock after ${MAX_RETRIES} retries`);
    return false;
  }

  /**
   * 在锁保护下执行 Git 操作
   */
  private async withLock<T>(operation: () => T): Promise<T> {
    const acquired = await this.waitForLock();
    if (!acquired) {
      throw new Error('Could not acquire git operation lock');
    }
    try {
      return operation();
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Clone a remote repo or init a local one
   */
  cloneOrInit(remoteUrl?: string): void {
    if (existsSync(join(this.repoPath, '.git'))) {
      logger.info('GIT', `Repository already exists at ${this.repoPath}`);
      // Ensure remote is set if URL provided but repo was created locally
      if (remoteUrl) {
        this.setRemote(remoteUrl);
      }
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
      if (this.hasUpstream()) {
        this.execInRepo('git pull --rebase');
      } else {
        // First pull: fetch and merge with allow-unrelated-histories
        const branch = this.getCurrentBranch();
        try {
          this.execInRepo(`git fetch origin`);
          this.execInRepo(`git merge origin/${branch} --allow-unrelated-histories --no-edit`);
          this.execInRepo(`git branch --set-upstream-to=origin/${branch} ${branch}`);
        } catch {
          // Remote branch may not exist yet — that's OK
          logger.info('GIT', 'Remote branch not found, skipping pull');
        }
      }
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
      // Use -u origin on first push, plain push otherwise
      const hasUpstream = this.hasUpstream();
      if (hasUpstream) {
        this.execInRepo('git push');
      } else {
        const branch = this.getCurrentBranch();
        this.execInRepo(`git push -u origin ${branch}`);
      }
      return { success: true };
    } catch (error) {
      const msg = (error as Error).message;
      logger.error('GIT', 'Push failed', {}, error as Error);
      return { success: false, error: msg };
    }
  }

  /**
   * Check if current branch has an upstream tracking branch
   */
  private hasUpstream(): boolean {
    try {
      this.execInRepo('git rev-parse --abbrev-ref @{u}');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current branch name
   */
  private getCurrentBranch(): string {
    try {
      return this.execInRepo('git rev-parse --abbrev-ref HEAD').trim();
    } catch {
      return 'main';
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
   * Add a remote URL (带锁保护和重试)
   */
  setRemote(url: string): void {
    try {
      if (this.hasRemote()) {
        this.execInRepoWithRetry(`git remote set-url origin "${url}"`);
      } else {
        this.execInRepoWithRetry(`git remote add origin "${url}"`);
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

  /**
   * 在仓库中执行命令，带锁冲突重试
   */
  private execInRepoWithRetry(command: string, maxRetries = 5): string {
    const baseDelay = 200;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return this.execInRepo(command);
      } catch (error) {
        const errMsg = (error as Error).message;
        // 检查是否是锁冲突错误
        if (errMsg.includes('could not lock') || errMsg.includes('.lock') || errMsg.includes('index.lock')) {
          if (attempt < maxRetries - 1) {
            const delay = baseDelay * Math.pow(2, attempt);
            logger.warn('GIT', `Lock conflict, retrying in ${delay}ms`, { command: command.slice(0, 50), attempt });
            // 同步等待 - 使用 child_process.spawnSync 的 sleep 替代方案
            execSync(`sleep ${delay / 1000}`, { encoding: 'utf-8' });
            continue;
          }
        }
        throw error;
      }
    }
    throw new Error(`Failed after ${maxRetries} retries: ${command}`);
  }
}
