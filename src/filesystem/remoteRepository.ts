import {
  FilePermission,
  FileSystemError,
  FileType,
  type FileStat,
} from 'vscode';
import type { GitHubClient } from '../github/githubClient';
import type { GitCommit, GitTree, GitTreeEntry } from '../github/types';
import type { Repository } from '../repository';
import { FileCache } from './fileCache';

export class RemoteRepository {
  static readonly maxFileSize = 10 * 1024 * 1024;

  readonly paths = new Set(['']);

  private snapshot: Promise<GitCommit> | undefined;
  private readonly trees = new Map<string, Promise<GitTree>>();
  private readonly pendingFiles = new Map<string, Promise<Uint8Array>>();
  private readonly files = new FileCache();

  constructor(
    readonly repository: Repository,
    private readonly client: GitHubClient,
  ) {}

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

    if ((entry.size ?? 0) > RemoteRepository.maxFileSize) {
      throw FileSystemError.Unavailable(
        'Files larger than 10 MiB are not supported.',
      );
    }

    const cached = this.files.get(entry.sha);

    if (cached) {
      return cached.slice();
    }

    let pending = this.pendingFiles.get(entry.sha);

    if (!pending) {
      pending = this.client
        .getBlob(this.repository, entry.sha)
        .then((content) => {
          if (content.byteLength > RemoteRepository.maxFileSize) {
            throw FileSystemError.Unavailable(
              'Files larger than 10 MiB are not supported.',
            );
          }

          this.files.set(entry.sha, content);
          return content;
        })
        .finally(() => this.pendingFiles.delete(entry.sha));

      this.pendingFiles.set(entry.sha, pending);
    }

    return (await pending).slice();
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
