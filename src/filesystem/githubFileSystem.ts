import {
  Disposable,
  EventEmitter,
  FileSystemError,
  type FileChangeEvent,
  type FileStat,
  type FileSystemProvider,
  type FileType,
  type Uri,
} from 'vscode';
import type { GitHubClient } from '../github/githubClient';
import { GitHubError } from '../github/githubError';
import { Repository } from '../repository';
import { RemoteRepository } from './remoteRepository';

export class GitHubFileSystem implements FileSystemProvider {
  private readonly changes = new EventEmitter<FileChangeEvent[]>();
  private readonly repositories = new Map<string, RemoteRepository>();

  readonly onDidChangeFile = this.changes.event;

  constructor(private readonly client: GitHubClient) {}

  stat(uri: Uri): Promise<FileStat> {
    return this.access(uri, (remote, path) => remote.stat(path));
  }

  readDirectory(uri: Uri): Promise<[string, FileType][]> {
    return this.access(uri, (remote, path) => remote.readDirectory(path));
  }

  readFile(uri: Uri): Promise<Uint8Array> {
    return this.access(uri, (remote, path) => remote.readFile(path));
  }

  watch(): Disposable {
    return new Disposable(() => {});
  }

  createDirectory(): never {
    throw FileSystemError.NoPermissions('Glimp repositories are read-only.');
  }

  writeFile(): never {
    throw FileSystemError.NoPermissions('Glimp repositories are read-only.');
  }

  delete(): never {
    throw FileSystemError.NoPermissions('Glimp repositories are read-only.');
  }

  rename(): never {
    throw FileSystemError.NoPermissions('Glimp repositories are read-only.');
  }

  release(uri: Uri): void {
    this.repositories.delete(uri.toString());
  }

  dispose(): void {
    this.repositories.clear();
    this.changes.dispose();
  }

  private async access<T>(
    uri: Uri,
    action: (remote: RemoteRepository, path: string) => Promise<T>,
  ): Promise<T> {
    try {
      const repository = Repository.fromUri(uri);
      const key = repository.uri.toString();
      let remote = this.repositories.get(key);

      if (!remote) {
        remote = new RemoteRepository(repository, this.client);
        this.repositories.set(key, remote);
      }

      return await action(remote, Repository.pathFromUri(uri));
    } catch (error) {
      if (error instanceof FileSystemError) {
        throw error;
      }

      const message =
        error instanceof Error ? error.message : 'GitHub request failed.';

      if (error instanceof GitHubError && error.status === 404) {
        throw FileSystemError.FileNotFound(message);
      }

      throw FileSystemError.Unavailable(message);
    }
  }
}
