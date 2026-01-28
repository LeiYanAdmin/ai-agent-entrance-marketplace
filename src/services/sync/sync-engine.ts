/**
 * Sync Engine - Orchestrates L1 (SQLite) ↔ L2 (Git) synchronization
 */

import { GitOperations } from './git-operations.js';
import { MarkdownParser } from './markdown-parser.js';
import { IndexGenerator } from './index-generator.js';
import { DatabaseStore } from '../database/store.js';
import { logger } from '../../utils/logger.js';
import type {
  KnowledgeAssetInput,
  SyncDirection,
  SyncLogRow,
  L2Index,
} from '../../shared/types.js';

export class SyncEngine {
  private git: GitOperations;
  private store: DatabaseStore;
  private initialized: boolean = false;

  constructor(store: DatabaseStore, repoPath?: string) {
    this.git = new GitOperations(repoPath);
    this.store = store;
  }

  getGit(): GitOperations {
    return this.git;
  }

  /**
   * Update the git remote URL (called when L2_REPO_URL config changes)
   */
  updateRemote(url: string): void {
    if (url) {
      this.git.setRemote(url);
    }
  }

  /**
   * Initialize the L2 repository (clone or create)
   */
  async initialize(remoteUrl?: string): Promise<void> {
    if (this.initialized) return;

    try {
      // If remote URL provided, set it
      if (remoteUrl) {
        this.git.cloneOrInit(remoteUrl);
      } else {
        this.git.cloneOrInit();
      }

      // Do initial pull if remote exists
      if (this.git.hasRemote()) {
        await this.pullFromL2();
      }

      this.initialized = true;
      logger.info('SYNC', 'Sync engine initialized');
    } catch (error) {
      logger.error('SYNC', 'Initialization failed', {}, error as Error);
      throw error;
    }
  }

  /**
   * Pull changes from L2 (Git) → L1 (SQLite)
   */
  async pullFromL2(): Promise<SyncLogRow> {
    logger.info('SYNC', 'Pulling from L2...');

    // Get last successful pull commit
    const lastSync = this.store.getLastSuccessfulSync('pull');
    const lastSha = lastSync?.git_commit_sha || '';

    // Git pull
    const pullResult = this.git.pull();
    if (!pullResult.success) {
      return this.store.createSyncLog({
        direction: 'pull',
        status: 'failed',
        message: pullResult.error || 'Pull failed',
      });
    }

    const currentSha = pullResult.commitSha || '';

    // If no changes since last sync
    if (lastSha && lastSha === currentSha) {
      return this.store.createSyncLog({
        direction: 'pull',
        git_commit_sha: currentSha,
        status: 'skipped',
        message: 'No changes since last sync',
      });
    }

    // Get changed files
    let changedFiles: string[];
    if (lastSha) {
      changedFiles = this.git.getChangedFilesSinceCommit(lastSha)
        .filter(f => f.startsWith('knowledge/') && f.endsWith('.md'));
    } else {
      // First sync: import all markdown files
      changedFiles = this.git.listMarkdownFiles('knowledge');
    }

    // Parse and upsert each changed file
    let imported = 0;
    for (const filePath of changedFiles) {
      const content = this.git.readFile(filePath);
      if (!content) continue;

      const assetInput = MarkdownParser.toAssetInput(filePath, content);
      if (!assetInput) continue;

      this.store.upsertKnowledgeAsset(assetInput);
      imported++;
    }

    logger.info('SYNC', `Pulled ${imported} assets from L2`);

    return this.store.createSyncLog({
      direction: 'pull',
      git_commit_sha: currentSha,
      status: 'success',
      message: `Imported ${imported} assets from ${changedFiles.length} changed files`,
    });
  }

  /**
   * Push a single asset from L1 (SQLite) → L2 (Git)
   */
  async pushAssetToL2(asset: KnowledgeAssetInput): Promise<SyncLogRow> {
    logger.info('SYNC', `Pushing asset "${asset.name}" to L2...`);

    try {
      // Determine L2 path
      const l2Path = asset.l2_path || MarkdownParser.getL2Path(asset);

      // Serialize to markdown
      const content = MarkdownParser.fromAssetInput(asset);

      // Write to L2 repo
      this.git.writeFile(l2Path, content);

      // Update index
      const index = IndexGenerator.generate(this.git);
      IndexGenerator.writeIndex(this.git, index);

      // Commit
      const commitResult = this.git.addAndCommit(
        `knowledge: add ${asset.type}/${asset.name}`,
        [l2Path, 'knowledge/_index.json']
      );

      if (!commitResult.success) {
        return this.store.createSyncLog({
          direction: 'push',
          file_path: l2Path,
          status: 'failed',
          message: commitResult.error || 'Commit failed',
        });
      }

      // Mark as promoted in L1
      const existing = this.store.getKnowledgeAssetByName(asset.name, asset.product_line);
      if (existing) {
        this.store.markAssetPromoted(existing.id, l2Path);
      }

      return this.store.createSyncLog({
        direction: 'push',
        file_path: l2Path,
        git_commit_sha: commitResult.commitSha,
        status: 'success',
        message: `Pushed ${asset.name} to ${l2Path}`,
      });
    } catch (error) {
      logger.error('SYNC', `Push failed for ${asset.name}`, {}, error as Error);
      return this.store.createSyncLog({
        direction: 'push',
        status: 'failed',
        message: (error as Error).message,
      });
    }
  }

  /**
   * Push all unpromoted assets to L2
   */
  async pushAllUnpromoted(): Promise<SyncLogRow> {
    const unpromoted = this.store.getUnpromotedAssets();
    if (unpromoted.length === 0) {
      return this.store.createSyncLog({
        direction: 'push',
        status: 'skipped',
        message: 'No unpromoted assets to push',
      });
    }

    logger.info('SYNC', `Pushing ${unpromoted.length} unpromoted assets...`);

    let pushed = 0;
    const files: string[] = [];

    for (const asset of unpromoted) {
      const l2Path = asset.l2_path || MarkdownParser.getL2Path({
        type: asset.type,
        name: asset.name,
        product_line: asset.product_line,
        title: asset.title,
        content: asset.content,
        tags: asset.tags ? JSON.parse(asset.tags) : [],
        source_project: asset.source_project || undefined,
      });

      const content = MarkdownParser.fromAssetInput({
        type: asset.type,
        name: asset.name,
        product_line: asset.product_line,
        title: asset.title,
        content: asset.content,
        tags: asset.tags ? JSON.parse(asset.tags) : [],
        source_project: asset.source_project || undefined,
      });

      this.git.writeFile(l2Path, content);
      this.store.markAssetPromoted(asset.id, l2Path);
      files.push(l2Path);
      pushed++;
    }

    // Regenerate index
    const index = IndexGenerator.generate(this.git);
    IndexGenerator.writeIndex(this.git, index);
    files.push('knowledge/_index.json');

    // Single commit for all pushed assets
    const commitResult = this.git.addAndCommit(
      `knowledge: batch push ${pushed} assets`,
      files
    );

    return this.store.createSyncLog({
      direction: 'push',
      git_commit_sha: commitResult.commitSha,
      status: commitResult.success ? 'success' : 'failed',
      message: commitResult.success
        ? `Pushed ${pushed} assets to L2`
        : commitResult.error || 'Batch push failed',
    });
  }

  /**
   * Full sync: pull then push
   */
  async sync(direction: SyncDirection = 'both'): Promise<{ pull?: SyncLogRow; push?: SyncLogRow }> {
    const result: { pull?: SyncLogRow; push?: SyncLogRow } = {};

    if (direction === 'pull' || direction === 'both') {
      result.pull = await this.pullFromL2();
    }

    if (direction === 'push' || direction === 'both') {
      result.push = await this.pushAllUnpromoted();
    }

    // Push to remote if we made changes
    if (direction !== 'pull' && this.git.hasRemote()) {
      const pushResult = this.git.push();
      if (!pushResult.success) {
        logger.warn('SYNC', `Remote push failed: ${pushResult.error}`);
      }
    }

    return result;
  }

  /**
   * Git commit and push (manual trigger)
   */
  async commitAndPush(message?: string): Promise<{ success: boolean; commitSha?: string; error?: string }> {
    const commitResult = this.git.addAndCommit(message || 'knowledge: manual sync');
    if (!commitResult.success) {
      return commitResult;
    }

    if (this.git.hasRemote()) {
      const pushResult = this.git.push();
      if (!pushResult.success) {
        return { success: false, commitSha: commitResult.commitSha, error: pushResult.error };
      }
    }

    return commitResult;
  }

  /**
   * Get knowledge summary for context injection
   */
  getKnowledgeSummary(): string {
    const index = IndexGenerator.readIndex(this.git);
    if (!index || index.total === 0) {
      return '知识库为空';
    }
    return IndexGenerator.formatSummary(index);
  }
}
