import * as vscode from 'vscode';
import { DataverseClient } from './dataverseClient';
import { GuidDecorationManager } from './guidDecorationManager';

let client: DataverseClient | undefined;
let decorationManager: GuidDecorationManager | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  client = new DataverseClient(context);
  decorationManager = new GuidDecorationManager(client);
  decorationManager.register(context);

  const loginCommand = vscode.commands.registerCommand('dataverse.login', async () => {
    if (!client) {
      return;
    }

    const environmentUrl = await vscode.window.showInputBox({
      prompt: 'Enter the base URL for your Dataverse environment (e.g. https://org.crm.dynamics.com)',
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value) {
          return 'Environment URL is required.';
        }
        try {
          // eslint-disable-next-line no-new
          new URL(value);
          return null;
        } catch (error) {
          return 'Enter a valid URL, including https://.';
        }
      }
    });

    if (!environmentUrl) {
      return;
    }

    const clientId = await vscode.window.showInputBox({
      prompt: 'Optional: provide a custom Azure AD application (client) ID',
      ignoreFocusOut: true,
      placeHolder: 'Leave blank to use the default Dataverse first-party application'
    });

    const tenantId = await vscode.window.showInputBox({
      prompt: 'Optional: provide your Azure AD tenant ID (leave blank for common)',
      ignoreFocusOut: true,
      placeHolder: 'common'
    });

    try {
      await client.login(environmentUrl, clientId || undefined, tenantId || undefined);
      void vscode.window.showInformationMessage('Successfully authenticated with Dataverse.');
      if (vscode.window.activeTextEditor) {
        void decorationManager?.refresh(vscode.window.activeTextEditor);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication failed.';
      void vscode.window.showErrorMessage(message);
    }
  });

  context.subscriptions.push(loginCommand);
}

export function deactivate(): void {
  // nothing to dispose explicitly
}
