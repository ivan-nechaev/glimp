import type { ExtensionContext } from 'vscode';
import { GlimpExtension } from './glimpExtension';

export function activate(context: ExtensionContext): void {
  new GlimpExtension(context).activate();
}
