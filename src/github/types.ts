import type { Octokit } from 'octokit';

type Api = Octokit['rest'];

export type RepositoryInfo = Awaited<ReturnType<Api['repos']['get']>>['data'];

export type GitCommit = Awaited<
  ReturnType<Api['repos']['listCommits']>
>['data'][number];

export type GitTree = Awaited<ReturnType<Api['git']['getTree']>>['data'];

export type GitTreeEntry = GitTree['tree'][number];
