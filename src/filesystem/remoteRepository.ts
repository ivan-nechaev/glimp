import {
  FilePermission,
  FileSystemError,
  FileType,
  type FileStat,
} from 'vscode';
import type { GitHubClient } from '../github/githubClient';
import type { GitCommit, GitTree, GitTreeEntry } from '../github/types';
import type { Repository } from '../repository';
import type { GlimpSettings } from '../settings';
import { FileCache } from './fileCache';

export class RemoteRepository {
  readonly paths = new Set(['']);

  private snapshot: Promise<GitCommit> | undefined;
  private readonly trees = new Map<string, Promise<GitTree>>();
  private readonly pendingFiles = new Map<string, Promise<Uint8Array>>();
  private readonly files: FileCache;

  constructor(
    readonly repository: Repository,
    private readonly client: GitHubClient,
    private readonly settings: GlimpSettings,
  ) {
    this.files = new FileCache(settings.cacheSize);
  }

  resizeCache(limit: number): void {
    this.files.resize(limit);
  }

  async stat(path: string): Promise<FileStat> {
    this.paths.add(path);

    const snapshot = await this.getSnapshot();
    const date =
      snapshot.commit.committer?.date ?? snapshot.commit.author?.date;
    const mtime = Date.parse(date ?? '') || 0;
    const entry = path ? await this.getEntry(path) : undefined;

    return {
      type:
        entry?.type === 'tree' || !entry ? FileType.Directory : FileType.File,
      ctime: 0,
      mtime,
      size:
        entry?.type === 'commit'
          ? this.submoduleContent(entry).byteLength
          : (entry?.size ?? 0),
      permissions: FilePermission.Readonly,
    };
  }

  async readDirectory(path: string): Promise<[string, FileType][]> {
    this.paths.add(path);

    const tree = await this.getDirectory(path);

    return tree.tree.map((entry) => {
      this.paths.add(path ? `${path}/${entry.path}` : entry.path);

      return [
        entry.path,
        entry.type === 'tree' ? FileType.Directory : FileType.File,
      ];
    });
  }

  async readFile(path: string): Promise<Uint8Array> {
    this.paths.add(path);

    if (!path) {
      throw FileSystemError.FileIsADirectory(this.repository.uri);
    }

    const entry = await this.getEntry(path);

    if (entry.type === 'tree') {
      throw FileSystemError.FileIsADirectory(this.repository.fileUri(path));
    }

    if (entry.type === 'commit') {
      return this.submoduleContent(entry);
    }

    const limit = this.settings.maxFileSize;
    const message = `File exceeds the ${limit / 1024 / 1024} MiB size limit.`;

    if ((entry.size ?? 0) > limit) {
      throw FileSystemError.Unavailable(message);
    }

    const cached = this.files.get(entry.sha);
    const content = cached ?? (await this.getBlob(entry.sha));

    if (content.byteLength > limit) {
      throw FileSystemError.Unavailable(message);
    }

    if (!cached) {
      this.files.set(entry.sha, content);
    }

    return content.slice();
  }

  private getBlob(sha: string): Promise<Uint8Array> {
    let pending = this.pendingFiles.get(sha);

    if (!pending) {
      pending = this.client
        .getBlob(this.repository, sha)
        .finally(() => this.pendingFiles.delete(sha));

      this.pendingFiles.set(sha, pending);
    }

    return pending;
  }

  private getSnapshot(): Promise<GitCommit> {
    this.snapshot ??= this.client
      .getCommit(this.repository)
      .catch((error: unknown) => {
        this.snapshot = undefined;
        throw error;
      });

    return this.snapshot;
  }

  private async getEntry(path: string): Promise<GitTreeEntry> {
    const separator = path.lastIndexOf('/');
    const parent = separator < 0 ? '' : path.slice(0, separator);
    const name = path.slice(separator + 1);
    const tree = await this.getDirectory(parent);
    const entry = tree.tree.find((item) => item.path === name);

    if (!entry) {
      throw FileSystemError.FileNotFound(this.repository.fileUri(path));
    }

    return entry;
  }

  private async getDirectory(path: string): Promise<GitTree> {
    const snapshot = await this.getSnapshot();
    let sha = snapshot.commit.tree.sha;

    if (path) {
      const entry = await this.getEntry(path);

      if (entry.type !== 'tree') {
        throw FileSystemError.FileNotADirectory(this.repository.fileUri(path));
      }

      sha = entry.sha;
    }

    let tree = this.trees.get(sha);

    if (!tree) {
      tree = this.client
        .getTree(this.repository, sha)
        .catch((error: unknown) => {
          this.trees.delete(sha);
          throw error;
        });
      this.trees.set(sha, tree);
    }

    return tree;
  }

  private submoduleContent(entry: GitTreeEntry): Uint8Array {
    return new TextEncoder().encode(`Submodule commit: ${entry.sha}\n`);
  }
}
