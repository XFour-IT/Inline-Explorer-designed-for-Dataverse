import * as vscode from 'vscode';
import { DataverseClient } from './dataverseClient';
import { GuidDecorationManager } from './guidDecorationManager';
import { EnvironmentManager } from './environmentManager';

let client: DataverseClient | undefined;
let decorationManager: GuidDecorationManager | undefined;
let environmentManager: EnvironmentManager | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  client = new DataverseClient(context);
  decorationManager = new GuidDecorationManager(client);
  decorationManager.register(context);
  environmentManager = new EnvironmentManager(context, client, decorationManager);
  context.subscriptions.push(environmentManager.registerViewProvider());

  const loginCommand = vscode.commands.registerCommand('dataverse.login', async () => {
    await handleLoginCommand();
  });

  context.subscriptions.push(loginCommand);
}

export function deactivate(): void {
  // nothing to dispose explicitly
}

async function handleLoginCommand(): Promise<void> {
  if (!client || !environmentManager) {
    return;
  }

  const environments = environmentManager.getEnvironments();
  const items: Array<vscode.QuickPickItem & { id?: string; action?: 'add' | 'manage' }> = environments.map(
    (env) => ({ label: env.name, description: env.environmentUrl, id: env.id })
  );

  items.unshift({ label: '$(plus) Add new environment', action: 'add' });
  items.push({ label: '$(gear) Manage environments', action: 'manage' });

  const selection = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a Dataverse environment to connect to',
    ignoreFocusOut: true
  });

  if (!selection) {
    return;
  }

  if (selection.action === 'add') {
    const environment = await environmentManager.promptForEnvironment();
    if (environment) {
      await environmentManager.loginToEnvironment(environment.id);
    }
    return;
  }

  if (selection.action === 'manage') {
    await environmentManager.revealView();
    return;
  }

  if (selection.id) {
    await environmentManager.loginToEnvironment(selection.id);
  }
}
