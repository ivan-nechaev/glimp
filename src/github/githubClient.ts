import { Octokit } from 'octokit';
import type { Repository } from '../repository';
import { GitHubError } from './githubError';
import type { GitCommit, GitTree, RepositoryInfo } from './types';

export class GitHubClient {
  private octokit: Octokit | undefined;
  private token: string | undefined;

  constructor(private readonly getToken: () => Promise<string | undefined>) {}

  async getRepository(repository: Repository): Promise<RepositoryInfo> {
    return this.request(async (client) => {
      const { data } = await client.rest.repos.get(this.parameters(repository));
      return data;
    });
  }

  async getCommit(repository: Repository): Promise<GitCommit> {
    return this.request(async (client) => {
      const { data } = await client.rest.repos.listCommits({
        ...this.parameters(repository),
        sha: repository.ref,
        per_page: 1,
      });
      const commit = data[0];

      if (!commit) {
        throw new GitHubError(409, 'This repository is empty.');
      }

      return commit;
    });
  }

  async getTree(repository: Repository, sha: string): Promise<GitTree> {
    return this.request(async (client) => {
      const { data } = await client.rest.git.getTree({
        ...this.parameters(repository),
        tree_sha: sha,
      });

      if (data.truncated) {
        throw new Error('GitHub returned an incomplete directory.');
      }

      return data;
    });
  }

  async getBlob(repository: Repository, sha: string): Promise<Uint8Array> {
    return this.request(async (client) => {
      const { data } = await client.rest.git.getBlob({
        ...this.parameters(repository),
        file_sha: sha,
      });

      return Uint8Array.from(atob(data.content), (character) =>
        character.charCodeAt(0),
      );
    });
  }

  private parameters(repository: Repository): { owner: string; repo: string } {
    return { owner: repository.owner, repo: repository.name };
  }

  private async getClient(): Promise<Octokit> {
    const token = await this.getToken();

    if (!this.octokit || this.token !== token) {
      this.token = token;
      this.octokit = new Octokit({
        auth: token,
        userAgent: 'Glimp',
        retry: { enabled: false },
        throttle: { enabled: false },
      });
      this.octokit.hook.before('request', (options) => {
        options.request = {
          ...options.request,
          signal: AbortSignal.timeout(15_000),
        };
      });
    }

    return this.octokit;
  }

  private async request<T>(
    action: (client: Octokit) => Promise<T>,
  ): Promise<T> {
    try {
      return await action(await this.getClient());
    } catch (error) {
      throw GitHubError.from(error);
    }
  }
}
