import { RequestError } from 'octokit';

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GitHubError';
  }

  static from(error: unknown): Error {
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? error.cause
        : error;

    if (cause instanceof Error && cause.name === 'TimeoutError') {
      return new GitHubError(0, 'GitHub request timed out. Try again.');
    }

    if (!(error instanceof RequestError)) {
      return error instanceof Error
        ? error
        : new Error('GitHub request failed.');
    }

    const { status, response } = error;

    if (!response) {
      return new GitHubError(
        status,
        'Could not reach GitHub. Check your connection.',
      );
    }

    const { headers } = response;

    if (
      status === 429 ||
      (status === 403 &&
        (headers['x-ratelimit-remaining'] === '0' || headers['retry-after']))
    ) {
      return new GitHubError(
        status,
        'GitHub rate limit reached. Sign in or try again later.',
      );
    }

    const messages: Record<number, string> = {
      401: 'GitHub sign-in expired. Run Glimp: Sign In to GitHub.',
      403: 'GitHub denied access. Check your repository permissions.',
      404: 'Repository or branch not found. For private repositories, sign in to GitHub.',
      409: 'This repository is empty.',
    };

    return new GitHubError(
      status,
      messages[status] ?? `GitHub request failed (${status}). Try again later.`,
    );
  }
}
