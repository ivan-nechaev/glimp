import { authentication } from 'vscode';

export class GitHubAuthentication {
  async getToken(): Promise<string | undefined> {
    const session = await authentication.getSession('github', ['repo'], {
      silent: true,
    });

    return session?.accessToken;
  }

  async signIn(): Promise<void> {
    await authentication.getSession('github', ['repo'], {
      createIfNone: true,
    });
  }
}
