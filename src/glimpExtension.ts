import {
  authentication,
  commands,
  env,
  FileType,
  ProgressLocation,
  StatusBarAlignment,
  window,
  workspace,
  type ExtensionContext,
  type Uri,
  type WorkspaceFolder,
} from 'vscode';
import { GitHubFileSystem } from './filesystem/githubFileSystem';
import { GitHubAuthentication } from './github/githubAuthentication';
import { GitHubClient } from './github/githubClient';
import { Repository } from './repository';
import { GlimpSettings } from './settings';

export class GlimpExtension {
  private readonly settings = new GlimpSettings();
  private readonly authentication = new GitHubAuthentication();
  private readonly client = new GitHubClient(
    () => this.authentication.getToken(),
    this.settings,
  );
  private readonly fileSystem = new GitHubFileSystem(
    this.client,
    this.settings,
  );
  private readonly status = window.createStatusBarItem(
    'glimp.branch',
    StatusBarAlignment.Left,
    100,
  );

  constructor(private readonly context: ExtensionContext) {}

  activate(): void {
    this.context.subscriptions.push(
      this.fileSystem,
      this.status,
      workspace.registerFileSystemProvider(Repository.scheme, this.fileSystem, {
        isCaseSensitive: true,
        isReadonly: true,
      }),
      window.onDidChangeActiveTextEditor(() => this.updateStatus()),
      workspace.onDidChangeWorkspaceFolders((event) => {
        for (const folder of event.removed) {
          this.fileSystem.release(folder.uri);
        }

        this.updateStatus();
      }),
      workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('glimp.cacheSize')) {
          this.fileSystem.resizeCaches();
        }
      }),
      authentication.onDidChangeSessions((event) => {
        if (event.provider.id === 'github') {
          this.fileSystem.refresh();
        }
      }),
    );

    this.register('glimp.openRepository', () => this.openRepository());
    this.register('glimp.switchBranch', (uri) => this.switchBranch(uri));
    this.register('glimp.refresh', (uri) => this.refresh(uri));
    this.register('glimp.signIn', () => this.signIn());
    this.register('glimp.openOnGitHub', (uri) => this.openOnGitHub(uri));
    this.register('glimp.openSettings', () => this.openSettings());
    this.status.command = 'glimp.switchBranch';
    this.updateStatus();
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
      const resolved = address.withRef(
        this.settings.defaultBranch || info.default_branch,
      );
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

  private async signIn(): Promise<void> {
    await this.authentication.signIn();
    this.fileSystem.refresh();
  }

  private async openSettings(): Promise<void> {
    await commands.executeCommand(
      'workbench.action.openSettings',
      `@ext:${this.context.extension.id}`,
    );
  }

  private async openOnGitHub(uri?: Uri): Promise<void> {
    let target = uri ?? window.activeTextEditor?.document.uri;

    if (target?.scheme !== Repository.scheme) {
      target = (await this.selectFolder())?.uri;
    }

    if (!target) {
      return;
    }

    const repository = Repository.fromUri(target);
    const path = Repository.pathFromUri(target);
    const stat = await this.fileSystem.stat(target);
    const directory = stat.type === FileType.Directory;
    await env.openExternal(repository.browserUri(path, directory));
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

  private updateStatus(): void {
    if (this.folders.length === 0) {
      this.status.hide();
      return;
    }

    const editor = window.activeTextEditor;
    const active = editor
      ? workspace.getWorkspaceFolder(editor.document.uri)
      : undefined;
    const folder =
      active?.uri.scheme === Repository.scheme
        ? active
        : this.folders.length === 1
          ? this.folders[0]
          : undefined;

    if (folder) {
      const repository = Repository.fromUri(folder.uri);
      this.status.text = `$(git-branch) ${repository.ref}`;
      this.status.tooltip = `Glimp: ${repository.fullName}\nSwitch branch`;
    } else {
      this.status.text = '$(repo) Glimp';
      this.status.tooltip = 'Select a repository and switch branch';
    }

    this.status.show();
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
