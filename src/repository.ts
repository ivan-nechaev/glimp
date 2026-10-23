import { Uri } from 'vscode';

export class Repository {
  static readonly scheme = 'glimp';

  constructor(
    readonly owner: string,
    readonly name: string,
    readonly ref = '',
  ) {
    if (
      !/^[a-z\d-]+$/i.test(owner) ||
      !/^[a-z\d._-]+$/i.test(name) ||
      name === '.' ||
      name === '..'
    ) {
      throw new Error('Enter owner/repo or a GitHub repository URL.');
    }
  }

  get fullName(): string {
    return `${this.owner}/${this.name}`;
  }

  get label(): string {
    return `${this.fullName} @ ${this.ref}`;
  }

  get uri(): Uri {
    return Uri.from({
      scheme: Repository.scheme,
      authority: 'github',
      path: `/${this.owner}/${this.name}`,
      query: new URLSearchParams({ ref: this.ref }).toString(),
    });
  }

  withRef(ref: string): Repository {
    if (!ref.trim()) {
      throw new Error('A branch or commit is required.');
    }

    return new Repository(this.owner, this.name, ref);
  }

  fileUri(path: string): Uri {
    return this.uri.with({ path: `${this.uri.path}/${path}` });
  }

  browserUri(path = '', directory = true): Uri {
    const route = directory ? 'tree' : 'blob';
    const ref = encodeURIComponent(this.ref);
    const suffix = path
      ? `/${path.split('/').map(encodeURIComponent).join('/')}`
      : '';

    return Uri.parse(
      `https://github.com/${this.fullName}/${route}/${ref}${suffix}`,
    );
  }

  static parse(input: string): Repository {
    let value = input.trim();

    if (value.startsWith('https://')) {
      const url = new URL(value);

      if (
        url.hostname !== 'github.com' ||
        url.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        throw new Error('Use a repository URL from https://github.com.');
      }

      value = url.pathname.slice(1);
    } else if (value.startsWith('git@github.com:')) {
      value = value.slice('git@github.com:'.length);
    }

    const parts = value
      .replace(/\/$/, '')
      .replace(/\.git$/, '')
      .split('/');
    const [owner, name] = parts;

    if (parts.length !== 2 || !owner || !name) {
      throw new Error('Enter owner/repo or a GitHub repository URL.');
    }

    return new Repository(owner, name);
  }

  static fromUri(uri: Uri): Repository {
    const [, owner, name] = uri.path.split('/');
    const ref = new URLSearchParams(uri.query).get('ref');

    if (
      uri.scheme !== Repository.scheme ||
      uri.authority !== 'github' ||
      !owner ||
      !name ||
      !ref ||
      uri.path.split('/').some((part) => part === '.' || part === '..')
    ) {
      throw new Error('Invalid Glimp repository URI.');
    }

    return new Repository(owner, name, ref);
  }

  static pathFromUri(uri: Uri): string {
    return uri.path.split('/').slice(3).join('/').replace(/\/$/, '');
  }
}
