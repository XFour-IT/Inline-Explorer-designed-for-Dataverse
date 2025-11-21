import fetch, { Response } from 'node-fetch';
import * as vscode from 'vscode';
import {
  AccessToken,
  ChainedTokenCredential,
  DeviceCodeCredential,
  VisualStudioCodeCredential,
  TokenCredential
} from '@azure/identity';

export interface ComponentInfo {
  componentType: string;
  displayName: string;
}

interface ComponentHandler {
  label: string;
  fetchDisplayName?: (guid: string) => Promise<string | undefined>;
}

interface SolutionComponentResponse {
  value?: Array<{ componenttype: number; objectid: string }>;
}

interface EntityDefinitionResponse {
  DisplayName?: {
    UserLocalizedLabel?: { Label?: string };
    LocalizedLabels?: Array<{ Label?: string }>;
  };
  LogicalName?: string;
}

interface NamedResponse {
  name?: string;
}

interface DisplayNamedResponse extends NamedResponse {
  displayname?: string;
}

interface SystemFormResponse extends NamedResponse {
  type?: number;
}

interface LocalizedLabelSet {
  UserLocalizedLabel?: { Label?: string };
  LocalizedLabels?: Array<{ Label?: string }>;
}

export class DataverseClient {
  private credential?: TokenCredential;
  private accessToken?: AccessToken;
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

    const scopes = [`${sanitizedUrl}/.default`];
    const tenant = tenantId || undefined;
    this.credential = this.createCredential(clientId, tenant);
    const token = await this.credential.getToken(scopes);
    if (!token) {
      throw new Error('Failed to authenticate with Dataverse.');
    }

    this.accessToken = token;
    this.scopes = scopes;
    await this.context.secrets.store('dataverse.environmentUrl', sanitizedUrl);
  }

  public async ensureAuthenticated(): Promise<void> {
    if (!this.credential || !this.environmentUrl || this.scopes.length === 0) {
      throw new Error('Dataverse login has not been initialized.');
    }

    const now = Date.now();
    if (this.accessToken && this.accessToken.expiresOnTimestamp - now > 60_000) {
      return;
    }

    const token = await this.credential.getToken(this.scopes);
    if (!token) {
      throw new Error('Failed to refresh access token for Dataverse.');
    }
    this.accessToken = token;
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
    const json = (await response.json()) as SolutionComponentResponse;
    const component = json.value?.[0];

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
        Authorization: `Bearer ${this.accessToken.token}`,
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
    const json = (await response.json()) as EntityDefinitionResponse;
    return this.pickLabel(json.DisplayName) ?? json.LogicalName;
  }

  private async getWebResourceName(guid: string): Promise<string | undefined> {
    if (!this.environmentUrl) {
      return undefined;
    }
    const url = `${this.environmentUrl}/api/data/v9.2/webresourceset(${guid})?$select=name,displayname`;
    const response = await this.apiGet(url);
    const json = (await response.json()) as DisplayNamedResponse;
    return json.displayname ?? json.name;
  }

  private async getSavedQueryName(guid: string): Promise<string | undefined> {
    if (!this.environmentUrl) {
      return undefined;
    }
    const url = `${this.environmentUrl}/api/data/v9.2/savedqueries(${guid})?$select=name`;
    const response = await this.apiGet(url);
    const json = (await response.json()) as NamedResponse;
    return json.name ?? undefined;
  }

  private async getWorkflowName(guid: string): Promise<string | undefined> {
    if (!this.environmentUrl) {
      return undefined;
    }
    const url = `${this.environmentUrl}/api/data/v9.2/workflows(${guid})?$select=name`;
    const response = await this.apiGet(url);
    const json = (await response.json()) as NamedResponse;
    return json.name;
  }

  private async getPluginAssemblyName(guid: string): Promise<string | undefined> {
    if (!this.environmentUrl) {
      return undefined;
    }
    const url = `${this.environmentUrl}/api/data/v9.2/pluginassemblies(${guid})?$select=name`;
    const response = await this.apiGet(url);
    const json = (await response.json()) as NamedResponse;
    return json.name;
  }

  private async getSdkStepName(guid: string): Promise<string | undefined> {
    if (!this.environmentUrl) {
      return undefined;
    }
    const url = `${this.environmentUrl}/api/data/v9.2/sdkmessageprocessingsteps(${guid})?$select=name`;
    const response = await this.apiGet(url);
    const json = (await response.json()) as NamedResponse;
    return json.name;
  }

  private async getSystemFormName(guid: string): Promise<string | undefined> {
    if (!this.environmentUrl) {
      return undefined;
    }
    const url = `${this.environmentUrl}/api/data/v9.2/systemforms(${guid})?$select=name,type`;
    const response = await this.apiGet(url);
    const json = (await response.json()) as SystemFormResponse;
    if (json.type && typeof json.type === 'number') {
      const typeName = this.resolveFormType(json.type);
      if (typeName) {
        return `${json.name ?? 'Form'} (${typeName})`;
      }
    }
    return json.name ?? undefined;
  }

  private async getCustomControlName(guid: string): Promise<string | undefined> {
    if (!this.environmentUrl) {
      return undefined;
    }
    const url = `${this.environmentUrl}/api/data/v9.2/customcontrols(${guid})?$select=name,displayname`;
    const response = await this.apiGet(url);
    const json = (await response.json()) as DisplayNamedResponse;
    return json.displayname ?? json.name;
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

  private pickLabel(label: LocalizedLabelSet | undefined): string | undefined {
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

  private createCredential(clientId?: string, tenantId?: string): TokenCredential {
    if (clientId) {
      return new DeviceCodeCredential({
        clientId,
        tenantId,
        userPromptCallback: (response) => {
          void vscode.window.showInformationMessage(response.message, { modal: true });
        }
      });
    }

    const vsCodeCredential = new VisualStudioCodeCredential({ tenantId });
    const deviceCodeFallback = new DeviceCodeCredential({
      tenantId,
      userPromptCallback: (response) => {
        void vscode.window.showInformationMessage(response.message, { modal: true });
      }
    });

    return new ChainedTokenCredential(vsCodeCredential, deviceCodeFallback);
  }
}
