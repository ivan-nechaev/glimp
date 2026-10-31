import { workspace, type WorkspaceConfiguration } from 'vscode';

export class GlimpSettings {
  get defaultBranch(): string {
    const value = this.configuration.get<unknown>('defaultBranch');
    return typeof value === 'string' ? value.trim() : '';
  }

  get maxFileSize(): number {
    return this.number('maxFileSize', 10, 1, 100) * 1024 * 1024;
  }

  get cacheSize(): number {
    return this.number('cacheSize', 32, 0, 256) * 1024 * 1024;
  }

  get requestTimeout(): number {
    return this.number('requestTimeout', 15, 1, 120) * 1000;
  }

  private get configuration(): WorkspaceConfiguration {
    return workspace.getConfiguration('glimp');
  }

  private number(
    key: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number {
    const value = this.configuration.get<unknown>(key);

    return typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= minimum &&
      value <= maximum
      ? value
      : fallback;
  }
}
