import fetch, { Response } from 'node-fetch';
import * as vscode from 'vscode';
import { AccountInfo, DeviceCodeRequest, PublicClientApplication } from '@azure/msal-node';

export interface ComponentInfo {
  componentType: string;
  displayName: string;
}

interface ComponentHandler {
  label: string;
  fetchDisplayName?: (guid: string) => Promise<string | undefined>;
}

export class DataverseClient {
  private pca?: PublicClientApplication;
  private account?: AccountInfo;
  private accessToken?: string;
  private accessTokenExpiry?: Date;
  private scopes: string[] = [];
  private environmentUrl?: string;
  private readonly cache = new Map<string, ComponentInfo>();
  private readonly componentHandlers: Record<number, ComponentHandler>;
  private readonly context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.componentHandlers = {
      1: { label: 'Entity', fetchDisplayName: (guid) => this.getEntityDisplayName(guid) },
      2: { label: 'Attribute' },
      24: { label: 'Web Resource', fetchDisplayName: (guid) => this.getWebResourceName(guid) },
      26: { label: 'Saved Query', fetchDisplayName: (guid) => this.getSavedQueryName(guid) },
      29: { label: 'Workflow', fetchDisplayName: (guid) => this.getWorkflowName(guid) },
      31: { label: 'Plugin Assembly', fetchDisplayName: (guid) => this.getPluginAssemblyName(guid) },
      32: { label: 'SDK Message Processing Step', fetchDisplayName: (guid) => this.getSdkStepName(guid) },
      60: { label: 'Form', fetchDisplayName: (guid) => this.getSystemFormName(guid) },
      61: { label: 'View', fetchDisplayName: (guid) => this.getSavedQueryName(guid) },
      66: { label: 'Custom Control', fetchDisplayName: (guid) => this.getCustomControlName(guid) }
    };
  }

  public async login(environmentUrl: string, clientId?: string, tenantId?: string): Promise<void> {
    const sanitizedUrl = environmentUrl.replace(/\/?$/u, '');
    this.environmentUrl = sanitizedUrl;

    const authority = `https://login.microsoftonline.com/${tenantId ?? 'common'}`;
    const resolvedClientId = clientId ?? '51f81489-12ee-4a9e-aaae-a2591f45987d';

    this.pca = new PublicClientApplication({
      auth: {
        authority,
        clientId: resolvedClientId
      },
      cache: {
        cachePlugin: undefined
      }
    });

    const scopes = [`${sanitizedUrl}/.default`];

    const request: DeviceCodeRequest = {
      scopes,
      deviceCodeCallback: (response) => {
        vscode.window.showInformationMessage(response.message, { modal: true });
      }
    };

    const result = await this.pca.acquireTokenByDeviceCode(request);
    if (!result) {
      throw new Error('Failed to authenticate with Dataverse.');
    }

    this.account = result.account ?? undefined;
    this.accessToken = result.accessToken;
    this.accessTokenExpiry = result.expiresOn ?? undefined;
    this.scopes = scopes;
    await this.context.secrets.store('dataverse.environmentUrl', sanitizedUrl);
  }

  public async ensureAuthenticated(): Promise<void> {
    if (!this.pca || !this.environmentUrl) {
      throw new Error('Dataverse login has not been initialized.');
    }

    const now = Date.now();
    if (this.accessToken && this.accessTokenExpiry && this.accessTokenExpiry.getTime() - now > 60_000) {
      return;
    }

    if (this.account) {
      try {
        const silentResult = await this.pca.acquireTokenSilent({
          account: this.account,
          scopes: this.scopes,
          forceRefresh: false
        });
        if (silentResult) {
          this.accessToken = silentResult.accessToken;
          this.accessTokenExpiry = silentResult.expiresOn ?? undefined;
          return;
        }
      } catch (error) {
        console.warn('Silent token acquisition failed, falling back to device code flow.', error);
      }
    }

    const scopes = this.scopes.length > 0 ? this.scopes : [`${this.environmentUrl}/.default`];
    const request: DeviceCodeRequest = {
      scopes,
      deviceCodeCallback: (response) => {
        vscode.window.showInformationMessage(response.message, { modal: true });
      }
    };
    const result = await this.pca.acquireTokenByDeviceCode(request);
    if (!result) {
      throw new Error('Failed to re-authenticate with Dataverse.');
    }
    this.account = result.account ?? undefined;
    this.accessToken = result.accessToken;
    this.accessTokenExpiry = result.expiresOn ?? undefined;
    this.scopes = scopes;
  }

  public isAuthenticated(): boolean {
    return Boolean(this.accessToken && this.environmentUrl);
  }

  public getEnvironmentUrl(): string | undefined {
    return this.environmentUrl;
  }

  public async getComponentInfo(guid: string): Promise<ComponentInfo> {
    const normalizedGuid = this.normalizeGuid(guid);
    const cached = this.cache.get(normalizedGuid);
    if (cached) {
      return cached;
    }

    await this.ensureAuthenticated();

    if (!this.environmentUrl) {
      throw new Error('Missing environment URL.');
    }

    const filterClause = encodeURIComponent(`objectid eq ${this.formatGuidLiteral(normalizedGuid)}`);
    const url = `${this.environmentUrl}/api/data/v9.2/solutioncomponents?$select=componenttype,objectid&$filter=${filterClause}`;
    const response = await this.apiGet(url);
    const json: any = await response.json();
    const component = Array.isArray(json?.value) ? json.value[0] : undefined;

    if (!component) {
      const info: ComponentInfo = {
        componentType: 'Unknown component',
        displayName: 'Not found'
      };
      this.cache.set(normalizedGuid, info);
      return info;
    }

    const typeCode: number = Number(component.componenttype);
    const handler = this.componentHandlers[typeCode];
    const label = handler?.label ?? `Component ${typeCode}`;
    let displayName: string | undefined;
    if (handler?.fetchDisplayName) {
      try {
        displayName = await handler.fetchDisplayName(normalizedGuid);
      } catch (error) {
        console.warn(`Failed to resolve display name for component type ${typeCode}`, error);
      }
    }
    const info: ComponentInfo = {
      componentType: label,
      displayName: displayName ?? 'Unknown name'
    };
    this.cache.set(normalizedGuid, info);
    return info;
  }

  private normalizeGuid(guid: string): string {
    const match = guid.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/u);
    if (!match) {
      throw new Error(`Invalid GUID: ${guid}`);
    }
    return match[0].toLowerCase();
  }

  private formatGuidLiteral(guid: string): string {
    return `guid'${guid}'`;
  }

  private async apiGet(url: string): Promise<Response> {
    await this.ensureAuthenticated();
    if (!this.accessToken) {
      throw new Error('Missing access token for Dataverse call.');
    }
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        Prefer: 'odata.include-annotations="*"'
      }
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Dataverse request failed (${response.status}): ${body}`);
    }
    return response;
  }

  private async getEntityDisplayName(metadataId: string): Promise<string | undefined> {
    if (!this.environmentUrl) {
      return undefined;
    }
    const url = `${this.environmentUrl}/api/data/v9.2/EntityDefinitions(${metadataId})?$select=DisplayName,LogicalName`;
    const response = await this.apiGet(url);
    const json: any = await response.json();
    return this.pickLabel(json?.DisplayName) ?? json?.LogicalName;
  }

  private async getWebResourceName(guid: string): Promise<string | undefined> {
    if (!this.environmentUrl) {
      return undefined;
    }
    const url = `${this.environmentUrl}/api/data/v9.2/webresourceset(${guid})?$select=name,displayname`;
    const response = await this.apiGet(url);
    const json: any = await response.json();
    return json?.displayname ?? json?.name;
  }

  private async getSavedQueryName(guid: string): Promise<string | undefined> {
    if (!this.environmentUrl) {
      return undefined;
    }
    const url = `${this.environmentUrl}/api/data/v9.2/savedqueries(${guid})?$select=name`;
    const response = await this.apiGet(url);
    const json: any = await response.json();
    return json?.name ?? undefined;
  }

  private async getWorkflowName(guid: string): Promise<string | undefined> {
    if (!this.environmentUrl) {
      return undefined;
    }
    const url = `${this.environmentUrl}/api/data/v9.2/workflows(${guid})?$select=name`;
    const response = await this.apiGet(url);
    const json: any = await response.json();
    return json?.name;
  }

  private async getPluginAssemblyName(guid: string): Promise<string | undefined> {
    if (!this.environmentUrl) {
      return undefined;
    }
    const url = `${this.environmentUrl}/api/data/v9.2/pluginassemblies(${guid})?$select=name`;
    const response = await this.apiGet(url);
    const json: any = await response.json();
    return json?.name;
  }

  private async getSdkStepName(guid: string): Promise<string | undefined> {
    if (!this.environmentUrl) {
      return undefined;
    }
    const url = `${this.environmentUrl}/api/data/v9.2/sdkmessageprocessingsteps(${guid})?$select=name`;
    const response = await this.apiGet(url);
    const json: any = await response.json();
    return json?.name;
  }

  private async getSystemFormName(guid: string): Promise<string | undefined> {
    if (!this.environmentUrl) {
      return undefined;
    }
    const url = `${this.environmentUrl}/api/data/v9.2/systemforms(${guid})?$select=name,type`;
    const response = await this.apiGet(url);
    const json: any = await response.json();
    if (json?.type && typeof json.type === 'number') {
      const typeName = this.resolveFormType(json.type);
      if (typeName) {
        return `${json.name ?? 'Form'} (${typeName})`;
      }
    }
    return json?.name ?? undefined;
  }

  private async getCustomControlName(guid: string): Promise<string | undefined> {
    if (!this.environmentUrl) {
      return undefined;
    }
    const url = `${this.environmentUrl}/api/data/v9.2/customcontrols(${guid})?$select=name,displayname`;
    const response = await this.apiGet(url);
    const json: any = await response.json();
    return json?.displayname ?? json?.name;
  }

  private resolveFormType(typeCode: number): string | undefined {
    const map: Record<number, string> = {
      2: 'Main',
      7: 'Quick View',
      8: 'Quick Create',
      10: 'Card',
      11: 'Main (Classic)'
    };
    return map[typeCode];
  }

  private pickLabel(label: any): string | undefined {
    if (!label) {
      return undefined;
    }
    if (label.UserLocalizedLabel?.Label) {
      return label.UserLocalizedLabel.Label;
    }
    if (Array.isArray(label.LocalizedLabels) && label.LocalizedLabels.length > 0) {
      return label.LocalizedLabels[0]?.Label;
    }
    return undefined;
  }
}
