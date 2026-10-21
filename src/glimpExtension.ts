import {
  commands,
  ProgressLocation,
  window,
  workspace,
  type ExtensionContext,
  type Uri,
  type WorkspaceFolder,
} from 'vscode';
import { GitHubFileSystem } from './filesystem/githubFileSystem';
import { GitHubClient } from './github/githubClient';
import { Repository } from './repository';

export class GlimpExtension {
  private readonly client = new GitHubClient(async () => undefined);
  private readonly fileSystem = new GitHubFileSystem(this.client);

  constructor(private readonly context: ExtensionContext) {}
  activate(): void {
    this.context.subscriptions.push(
      this.fileSystem,

      workspace.registerFileSystemProvider(Repository.scheme, this.fileSystem, {
        isCaseSensitive: true,
        isReadonly: true,
      }),

      workspace.onDidChangeWorkspaceFolders((event) => {
        for (const folder of event.removed) this.fileSystem.release(folder.uri);
      }),
    );
    this.register('glimp.openRepository', () => this.openRepository());
    this.register('glimp.switchBranch', (uri) => this.switchBranch(uri));
    this.register('glimp.refresh', (uri) => this.refresh(uri));
  }

  private register(
    command: string,
    action: (uri?: Uri) => Promise<void>,
  ): void {
    this.context.subscriptions.push(
      commands.registerCommand(command, async (uri?: Uri) => {
        try {
          await action(uri);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Request failed.';
          void window.showErrorMessage(`Glimp: ${message}`);
        }
      }),
    );
  }

  private async openRepository(): Promise<void> {
    const input = await window.showInputBox({
      title: 'Glimp: Open Repository',
      prompt: 'Enter owner/repo or a GitHub repository URL',
      placeHolder: 'microsoft/vscode',
      ignoreFocusOut: true,
      validateInput: (value) => {
        try {
          Repository.parse(value);
          return undefined;
        } catch (error) {
          return error instanceof Error ? error.message : 'Invalid repository.';
        }
      },
    });

    if (!input) {
      return;
    }

    const repository = await this.progress('Opening repository', async () => {
      const address = Repository.parse(input);
      const info = await this.client.getRepository(address);
      const resolved = address.withRef(info.default_branch);
      await this.fileSystem.stat(resolved.uri);
      return resolved;
    });

    this.openFolder(repository);
  }

  private async switchBranch(uri?: Uri): Promise<void> {
    const folder = await this.selectFolder(uri);

    if (!folder) {
      return;
    }

    const repository = Repository.fromUri(folder.uri);
    const branches = await this.progress('Loading branches', () =>
      this.client.getBranches(repository),
    );
    const selected = await window.showQuickPick(
      branches.map((branch) => ({
        label: branch.name,
        description: branch.name === repository.ref ? 'Current branch' : '',
      })),
      {
        title: `Glimp: ${repository.fullName}`,
        placeHolder: 'Select a branch',
      },
    );

    if (!selected || selected.label === repository.ref) {
      return;
    }

    const next = repository.withRef(selected.label);
    await this.progress('Opening branch', () => this.fileSystem.stat(next.uri));
    this.openFolder(next, folder);
  }

  private async refresh(uri?: Uri): Promise<void> {
    const folder = await this.selectFolder(uri);

    if (folder) {
      await this.progress('Refreshing repository', async () => {
        this.fileSystem.refresh(folder.uri);
        await this.fileSystem.stat(folder.uri);
      });
    }
  }

  private openFolder(repository: Repository, replace?: WorkspaceFolder): void {
    const existing = this.folders.find((folder) => {
      const current = Repository.fromUri(folder.uri);

      return (
        current.fullName.toLowerCase() === repository.fullName.toLowerCase() &&
        current.ref === repository.ref
      );
    });

    if (existing) {
      void commands.executeCommand('revealInExplorer', existing.uri);
      return;
    }

    const index = replace?.index ?? workspace.workspaceFolders?.length ?? 0;
    const updated = workspace.updateWorkspaceFolders(index, replace ? 1 : 0, {
      uri: repository.uri,
      name: repository.label,
    });

    if (!updated) {
      throw new Error('Could not update the workspace. Try again.');
    }
  }

  private async selectFolder(uri?: Uri): Promise<WorkspaceFolder | undefined> {
    const target = uri ?? window.activeTextEditor?.document.uri;
    const current = target ? workspace.getWorkspaceFolder(target) : undefined;

    if (current?.uri.scheme === Repository.scheme) {
      return current;
    }

    if (this.folders.length <= 1) {
      if (this.folders.length === 0) {
        void window.showInformationMessage(
          'Open a repository with Glimp first.',
        );
      }

      return this.folders[0];
    }

    const selected = await window.showQuickPick(
      this.folders.map((folder) => ({ label: folder.name, folder })),
      { title: 'Glimp: Select Repository' },
    );

    return selected?.folder;
  }

  private get folders(): readonly WorkspaceFolder[] {
    return (workspace.workspaceFolders ?? []).filter(
      (folder) => folder.uri.scheme === Repository.scheme,
    );
  }

  private progress<T>(title: string, task: () => Promise<T>): Thenable<T> {
    return window.withProgress(
      { location: ProgressLocation.Notification, title: `Glimp: ${title}` },
      task,
    );
  }
}
