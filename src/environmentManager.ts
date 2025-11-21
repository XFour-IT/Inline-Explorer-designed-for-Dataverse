import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { DataverseClient } from './dataverseClient';
import { GuidDecorationManager } from './guidDecorationManager';

export interface StoredEnvironment {
  id: string;
  name: string;
  environmentUrl: string;
  tenantId?: string;
  clientId?: string;
  hasClientSecret?: boolean;
}

interface EnvironmentFormPayload {
  name: string;
  environmentUrl: string;
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
}

const environmentsKey = 'dataverse.environments';

export class EnvironmentManager {
  private readonly context: vscode.ExtensionContext;
  private readonly client: DataverseClient;
  private readonly decorationManager?: GuidDecorationManager;
  private view?: vscode.WebviewView;

  constructor(
    context: vscode.ExtensionContext,
    client: DataverseClient,
    decorationManager?: GuidDecorationManager
  ) {
    this.context = context;
    this.client = client;
    this.decorationManager = decorationManager;
  }

  public registerViewProvider(): vscode.Disposable {
    const provider: vscode.WebviewViewProvider = {
      resolveWebviewView: (webviewView) => {
        this.view = webviewView;
        webviewView.webview.options = {
          enableScripts: true
        };
        webviewView.webview.onDidReceiveMessage(async (message) => {
          switch (message.type) {
            case 'ready':
              this.sendEnvironments();
              this.sendConfiguration();
              break;
            case 'addEnvironment':
              await this.handleAddEnvironment(message.payload as EnvironmentFormPayload);
              break;
            case 'deleteEnvironment':
              await this.deleteEnvironment(message.payload as string);
              break;
            case 'loginEnvironment':
              await this.loginToEnvironment(message.payload as string);
              break;
            default:
              break;
          }
        });
        webviewView.webview.html = this.getHtml(webviewView.webview);
      }
    };

    const registration = vscode.window.registerWebviewViewProvider(
      'dataverse.environments',
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true }
      }
    );

    const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('dataverse.allowCustomClientCredentials')) {
        this.sendConfiguration();
      }
    });

    return vscode.Disposable.from(registration, configListener);
  }

  public async revealView(): Promise<void> {
    await vscode.commands.executeCommand('dataverse.environments.focus');
  }

  public getEnvironments(): StoredEnvironment[] {
    return this.context.globalState.get<StoredEnvironment[]>(environmentsKey, []);
  }

  public async promptForEnvironment(): Promise<StoredEnvironment | undefined> {
    const allowCustomCredentials = this.allowCustomCredentials();

    const name = await vscode.window.showInputBox({
      prompt: 'Enter a name for this Dataverse environment',
      ignoreFocusOut: true,
      validateInput: (value) => (!value ? 'Environment name is required.' : null)
    });
    if (!name) {
      return undefined;
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
      return undefined;
    }

    const tenantId = await vscode.window.showInputBox({
      prompt: 'Optional: provide your Azure AD tenant ID (leave blank for common)',
      ignoreFocusOut: true,
      placeHolder: 'common'
    });

    let clientId: string | undefined;
    let clientSecret: string | undefined;
    if (allowCustomCredentials) {
      clientId = await vscode.window.showInputBox({
        prompt: 'Optional: provide a custom Azure AD application (client) ID',
        ignoreFocusOut: true,
        placeHolder: 'Leave blank to use the default authentication flow'
      });

      if (clientId) {
        clientSecret = await vscode.window.showInputBox({
          prompt: 'Optional: provide a client secret for the custom application',
          ignoreFocusOut: true,
          placeHolder: 'Leave blank to authenticate interactively',
          password: true
        });
      }
    }

    const environment = await this.addEnvironmentInternal({
      name,
      environmentUrl,
      tenantId: tenantId || undefined,
      clientId: clientId || undefined,
      clientSecret: clientSecret || undefined
    });

    return environment;
  }

  public async loginToEnvironment(environmentId: string): Promise<void> {
    const environment = this.getEnvironments().find((env) => env.id === environmentId);
    if (!environment) {
      void vscode.window.showErrorMessage('The selected environment could not be found.');
      return;
    }

    const secret = environment.hasClientSecret
      ? await this.context.secrets.get(this.getSecretKey(environment.id))
      : undefined;

    try {
      await this.client.login({
        environmentUrl: environment.environmentUrl,
        tenantId: environment.tenantId,
        clientId: environment.clientId,
        clientSecret: secret ?? undefined
      });
      void vscode.window.showInformationMessage(`Connected to ${environment.name}.`);
      if (vscode.window.activeTextEditor) {
        void this.decorationManager?.refresh(vscode.window.activeTextEditor);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication failed.';
      void vscode.window.showErrorMessage(message);
    }
  }

  public allowCustomCredentials(): boolean {
    return Boolean(
      vscode.workspace.getConfiguration('dataverse').get<boolean>('allowCustomClientCredentials')
    );
  }

  public async deleteEnvironment(environmentId: string): Promise<void> {
    const environments = this.getEnvironments();
    const updated = environments.filter((env) => env.id !== environmentId);
    await this.context.globalState.update(environmentsKey, updated);
    await this.context.secrets.delete(this.getSecretKey(environmentId));
    this.sendEnvironments();
  }

  private async handleAddEnvironment(payload: EnvironmentFormPayload): Promise<void> {
    const environment = await this.addEnvironmentInternal(payload);
    if (environment) {
      void vscode.window.showInformationMessage(`${environment.name} saved.`);
    }
  }

  private async addEnvironmentInternal(payload: EnvironmentFormPayload): Promise<StoredEnvironment | undefined> {
    if (!payload.name || !payload.environmentUrl) {
      void vscode.window.showErrorMessage('Name and environment URL are required.');
      return undefined;
    }

    const allowCustomCredentials = this.allowCustomCredentials();
    const environments = this.getEnvironments();
    const id = randomUUID();

    const sanitizedUrl = payload.environmentUrl.replace(/\/?$/u, '');
    const environment: StoredEnvironment = {
      id,
      name: payload.name,
      environmentUrl: sanitizedUrl,
      tenantId: payload.tenantId || undefined,
      clientId: allowCustomCredentials ? payload.clientId || undefined : undefined,
      hasClientSecret: Boolean(allowCustomCredentials && payload.clientSecret)
    };

    environments.push(environment);
    await this.context.globalState.update(environmentsKey, environments);

    if (environment.hasClientSecret && payload.clientSecret) {
      await this.context.secrets.store(this.getSecretKey(id), payload.clientSecret);
    }

    this.sendEnvironments();
    return environment;
  }

  private sendEnvironments(): void {
    if (this.view) {
      this.view.webview.postMessage({
        type: 'environments',
        payload: this.getEnvironments()
      });
    }
  }

  private sendConfiguration(): void {
    if (this.view) {
      this.view.webview.postMessage({
        type: 'configuration',
        payload: { allowCustomCredentials: this.allowCustomCredentials() }
      });
    }
  }

  private getSecretKey(environmentId: string): string {
    return `dataverse.clientSecret.${environmentId}`;
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = Date.now().toString();
    const styles = `
      <style>
        body { font-family: var(--vscode-font-family); padding: 8px; }
        .section { margin-bottom: 16px; }
        .env-card { border: 1px solid var(--vscode-editorWidget-border); border-radius: 4px; padding: 8px; margin-bottom: 8px; }
        .env-card h4 { margin: 0 0 6px 0; }
        .env-actions { display: flex; gap: 8px; margin-top: 8px; }
        label { display: block; margin: 8px 0 4px; }
        input { width: 100%; padding: 4px; }
        .hint { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 4px; }
        button { margin-top: 8px; }
        .muted { color: var(--vscode-disabledForeground); }
      </style>
    `;

    const script = `
      const vscode = acquireVsCodeApi();
      const form = document.getElementById('environment-form');
      const credentialsSection = document.getElementById('credentials-section');
      const credentialsNote = document.getElementById('credentials-note');

      form?.addEventListener('submit', (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        vscode.postMessage({
          type: 'addEnvironment',
          payload: {
            name: formData.get('name'),
            environmentUrl: formData.get('environmentUrl'),
            tenantId: formData.get('tenantId') || undefined,
            clientId: formData.get('clientId') || undefined,
            clientSecret: formData.get('clientSecret') || undefined
          }
        });
        form.reset();
      });

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message.type === 'environments') {
          renderEnvironments(message.payload);
        }
        if (message.type === 'configuration') {
          toggleCredentials(Boolean(message.payload?.allowCustomCredentials));
        }
      });

      function renderEnvironments(environments) {
        const list = document.getElementById('environment-list');
        list.innerHTML = '';
        if (!environments || environments.length === 0) {
          list.innerHTML = '<p class="muted">No environments saved yet.</p>';
          return;
        }
        environments.forEach((env) => {
          const card = document.createElement('div');
          card.className = 'env-card';
          const parts = [
            '<h4>' + env.name + '</h4>',
            '<div>' + env.environmentUrl + '</div>'
          ];
          if (env.tenantId) {
            parts.push('<div>Tenant: ' + env.tenantId + '</div>');
          }
          if (env.clientId) {
            const secretNote = env.hasClientSecret ? ' (secret stored)' : '';
            parts.push('<div>Custom app: ' + env.clientId + secretNote + '</div>');
          }
          parts.push(
            '<div class="env-actions">' +
              '<button data-action="login" data-id="' + env.id + '">Login</button>' +
              '<button data-action="delete" data-id="' + env.id + '">Remove</button>' +
            '</div>'
          );
          card.innerHTML = parts.join('');
          list.appendChild(card);
        });

        list.querySelectorAll('button').forEach((button) => {
          button.addEventListener('click', (event) => {
            const action = button.getAttribute('data-action');
            const id = button.getAttribute('data-id');
            if (action === 'delete') {
              vscode.postMessage({ type: 'deleteEnvironment', payload: id });
            }
            if (action === 'login') {
              vscode.postMessage({ type: 'loginEnvironment', payload: id });
            }
          });
        });
      }

      function toggleCredentials(enabled) {
        if (!credentialsSection || !credentialsNote) {
          return;
        }
        if (enabled) {
          credentialsSection.style.display = 'block';
          credentialsNote.style.display = 'none';
        } else {
          credentialsSection.style.display = 'none';
          credentialsNote.style.display = 'block';
        }
      }

      vscode.postMessage({ type: 'ready' });
    `;

    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}';" />
          ${styles}
        </head>
        <body>
          <div class="section">
            <h3>Saved environments</h3>
            <div id="environment-list"></div>
          </div>
          <div class="section">
            <h3>Add environment</h3>
            <form id="environment-form">
              <label for="name">Name</label>
              <input id="name" name="name" required />

              <label for="environmentUrl">Environment URL</label>
              <input id="environmentUrl" name="environmentUrl" type="url" required placeholder="https://org.crm.dynamics.com" />

              <label for="tenantId">Tenant ID (optional)</label>
              <input id="tenantId" name="tenantId" placeholder="common" />

              <div id="credentials-section">
                <label for="clientId">Custom client ID (optional)</label>
                <input id="clientId" name="clientId" />

                <label for="clientSecret">Client secret (optional)</label>
                <input id="clientSecret" name="clientSecret" type="password" />
                <div class="hint">Client secrets are stored securely in the VS Code Secret Store.</div>
              </div>
              <div class="hint" id="credentials-note">Enable "Dataverse: Allow custom client credentials" in settings to provide client ID and secret.</div>

              <button type="submit">Save environment</button>
            </form>
          </div>
          <script nonce="${nonce}">${script}</script>
        </body>
      </html>
    `;
  }
}
