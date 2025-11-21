import { expect } from 'chai';
import sinon from 'sinon';
import { Response } from 'node-fetch';
import * as fetchModule from 'node-fetch';
import * as vscode from 'vscode';
import { DataverseClient } from '../../src/dataverseClient';

const TEST_GUID = '11111111-1111-1111-1111-111111111111';

const createContext = (): vscode.ExtensionContext => ({
  subscriptions: [],
  secrets: {
    store: sinon.stub().resolves(undefined)
  }
} as unknown as vscode.ExtensionContext);

describe('DataverseClient', () => {
  let client: DataverseClient;

  const createAccessToken = (): { token: string; expiresOnTimestamp: number } => ({
    token: 'token',
    expiresOnTimestamp: Date.now() + 3_600_000
  });

  beforeEach(() => {
    client = new DataverseClient(createContext());
    Object.assign(client as any, {
      environmentUrl: 'https://org.example',
      accessToken: createAccessToken(),
      credential: { getToken: sinon.stub().resolves(createAccessToken()) }
    });
    sinon.stub(client as any, 'ensureAuthenticated').resolves();
    sinon.stub(console, 'warn');
  });

  afterEach(() => {
    sinon.restore();
  });

  const createResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });

  it('caches component info for repeated GUIDs', async () => {
    const fetchStub = sinon.stub(fetchModule, 'default').resolves(
      createResponse({ value: [{ componenttype: 1, objectid: TEST_GUID }] })
    );
    const resolverStub = sinon.stub(client as any, 'getEntityDisplayName').resolves('Account');

    const first = await client.getComponentInfo(TEST_GUID);
    const second = await client.getComponentInfo(TEST_GUID);

    expect(first).to.deep.equal({ componentType: 'Entity', displayName: 'Account' });
    expect(second).to.equal(first);
    expect(fetchStub.calledOnce).to.be.true;
    expect(resolverStub.calledOnce).to.be.true;
  });

  it('returns fallback info when component is missing', async () => {
    sinon.stub(fetchModule, 'default').resolves(createResponse({ value: [] }));

    const result = await client.getComponentInfo(TEST_GUID);

    expect(result.componentType).to.equal('Unknown component');
    expect(result.displayName).to.equal('Not found');
  });

  it('uses resolver display name when available', async () => {
    sinon.stub(fetchModule, 'default').resolves(
      createResponse({ value: [{ componenttype: 60, objectid: TEST_GUID }] })
    );
    const resolverStub = sinon.stub(client as any, 'getSystemFormName').resolves('Account Form (Main)');

    const result = await client.getComponentInfo(TEST_GUID);

    expect(resolverStub.calledOnceWithExactly(TEST_GUID.toLowerCase())).to.be.true;
    expect(result).to.deep.equal({ componentType: 'Form', displayName: 'Account Form (Main)' });
  });

  it('falls back to unknown name when resolver throws', async () => {
    sinon.stub(fetchModule, 'default').resolves(
      createResponse({ value: [{ componenttype: 66, objectid: TEST_GUID }] })
    );
    sinon.stub(client as any, 'getCustomControlName').rejects(new Error('boom'));

    const result = await client.getComponentInfo(TEST_GUID);

    expect(result.displayName).to.equal('Unknown name');
  });

  it('normalizes GUID casing', () => {
    const result = (client as any).normalizeGuid(TEST_GUID.toUpperCase());
    expect(result).to.equal(TEST_GUID);
  });

  it('formats GUID literal for Dataverse queries', () => {
    const formatted = (client as any).formatGuidLiteral(TEST_GUID);
    expect(formatted).to.equal(`guid'${TEST_GUID}'`);
  });

  it('resolves system form names with type metadata', async () => {
    const apiGetStub = sinon.stub(client as any, 'apiGet').resolves(
      new Response(
        JSON.stringify({ name: 'Account Main', type: 2 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await (client as any).getSystemFormName(TEST_GUID);

    expect(apiGetStub.calledOnce).to.be.true;
    expect(result).to.equal('Account Main (Main)');
  });

  it('returns undefined system form name when environment is missing', async () => {
    (client as any).environmentUrl = undefined;

    const result = await (client as any).getSystemFormName(TEST_GUID);

    expect(result).to.be.undefined;
  });

  it('resolves entity display name using localized labels', async () => {
    sinon.restore();
    client = new DataverseClient(createContext());
    Object.assign(client as any, {
      environmentUrl: 'https://org.example',
      accessToken: createAccessToken(),
      credential: { getToken: sinon.stub().resolves(createAccessToken()) }
    });
    sinon.stub(client as any, 'ensureAuthenticated').resolves();
    sinon.stub(console, 'warn');

    const apiGetStub = sinon.stub(client as any, 'apiGet').resolves(
      new Response(
        JSON.stringify({
          DisplayName: { UserLocalizedLabel: { Label: 'Account' } },
          LogicalName: 'account'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await (client as any).getEntityDisplayName(TEST_GUID);

    expect(apiGetStub.calledOnce).to.be.true;
    expect(result).to.equal('Account');
  });

  it('returns logical name when localized label missing', async () => {
    const apiGetStub = sinon.stub(client as any, 'apiGet').resolves(
      new Response(
        JSON.stringify({ LogicalName: 'account' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await (client as any).getEntityDisplayName(TEST_GUID);

    expect(apiGetStub.calledOnce).to.be.true;
    expect(result).to.equal('account');
  });

  it('retrieves web resource names with fallback', async () => {
    const apiGetStub = sinon.stub(client as any, 'apiGet').resolves(
      new Response(JSON.stringify({ displayname: 'Custom Script', name: 'new_/script.js' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const name = await (client as any).getWebResourceName(TEST_GUID);

    expect(apiGetStub.calledOnce).to.be.true;
    expect(name).to.equal('Custom Script');
  });

  it('retrieves saved query names', async () => {
    const apiGetStub = sinon.stub(client as any, 'apiGet').resolves(
      new Response(JSON.stringify({ name: 'Active Accounts' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const name = await (client as any).getSavedQueryName(TEST_GUID);

    expect(apiGetStub.calledOnce).to.be.true;
    expect(name).to.equal('Active Accounts');
  });

  it('indicates authentication status based on token and environment', () => {
    expect(client.isAuthenticated()).to.be.true;
    (client as any).accessToken = undefined;
    expect(client.isAuthenticated()).to.be.false;
    (client as any).accessToken = createAccessToken();
    (client as any).environmentUrl = undefined;
    expect(client.isAuthenticated()).to.be.false;
  });

  it('returns the configured environment URL', () => {
    expect(client.getEnvironmentUrl()).to.equal('https://org.example');
  });

  it('retrieves workflow names', async () => {
    const apiGetStub = sinon.stub(client as any, 'apiGet').resolves(
      new Response(JSON.stringify({ name: 'Approval Workflow' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const name = await (client as any).getWorkflowName(TEST_GUID);

    expect(apiGetStub.calledOnce).to.be.true;
    expect(name).to.equal('Approval Workflow');
  });

  it('retrieves plugin assembly names', async () => {
    const apiGetStub = sinon.stub(client as any, 'apiGet').resolves(
      new Response(JSON.stringify({ name: 'Contoso.Plugins' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const name = await (client as any).getPluginAssemblyName(TEST_GUID);

    expect(apiGetStub.calledOnce).to.be.true;
    expect(name).to.equal('Contoso.Plugins');
  });

  it('retrieves SDK step names', async () => {
    const apiGetStub = sinon.stub(client as any, 'apiGet').resolves(
      new Response(JSON.stringify({ name: 'PostCreate' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const name = await (client as any).getSdkStepName(TEST_GUID);

    expect(apiGetStub.calledOnce).to.be.true;
    expect(name).to.equal('PostCreate');
  });

  it('retrieves custom control display names with fallback', async () => {
    const apiGetStub = sinon.stub(client as any, 'apiGet').resolves(
      new Response(JSON.stringify({ displayname: 'Control Display', name: 'control_name' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const name = await (client as any).getCustomControlName(TEST_GUID);

    expect(apiGetStub.calledOnce).to.be.true;
    expect(name).to.equal('Control Display');
  });

  it('short-circuits lookups when environment is missing', async () => {
    (client as any).environmentUrl = undefined;

    expect(await (client as any).getWorkflowName(TEST_GUID)).to.be.undefined;
    expect(await (client as any).getPluginAssemblyName(TEST_GUID)).to.be.undefined;
    expect(await (client as any).getSdkStepName(TEST_GUID)).to.be.undefined;
    expect(await (client as any).getCustomControlName(TEST_GUID)).to.be.undefined;
    expect(await (client as any).getEntityDisplayName(TEST_GUID)).to.be.undefined;
    expect(await (client as any).getWebResourceName(TEST_GUID)).to.be.undefined;
    expect(await (client as any).getSavedQueryName(TEST_GUID)).to.be.undefined;
  });

  it('maps form types to friendly labels', () => {
    expect((client as any).resolveFormType(2)).to.equal('Main');
    expect((client as any).resolveFormType(7)).to.equal('Quick View');
    expect((client as any).resolveFormType(99)).to.be.undefined;
  });

  it('prefers localized labels when available', () => {
    const label = (client as any).pickLabel({
      LocalizedLabels: [
        { Label: 'Primary Name' }
      ]
    });

    expect(label).to.equal('Primary Name');
  });

  it('returns undefined label when no localized text present', () => {
    expect((client as any).pickLabel(undefined)).to.be.undefined;
    expect((client as any).pickLabel({ LocalizedLabels: [] })).to.be.undefined;
  });

  it('throws when API is called without an access token', async () => {
    (client as any).accessToken = undefined;

    try {
      await (client as any).apiGet('https://org.example/test');
      expect.fail('Expected apiGet to throw');
    } catch (error) {
      expect((error as Error).message).to.equal('Missing access token for Dataverse call.');
    }
  });

  it('throws when component lookup runs without environment', async () => {
    (client as any).environmentUrl = undefined;

    try {
      await client.getComponentInfo(TEST_GUID);
      expect.fail('Expected getComponentInfo to throw');
    } catch (error) {
      expect((error as Error).message).to.equal('Missing environment URL.');
    }
  });

  it('throws when API response is not ok', async () => {
    sinon.stub(fetchModule, 'default').resolves(new Response('bad', { status: 500 }));

    try {
      await (client as any).apiGet('https://org.example/api/data');
      expect.fail('Expected apiGet to throw');
    } catch (error) {
      expect((error as Error).message).to.include('500');
    }
  });

  it('rejects invalid GUIDs', async () => {
    try {
      await client.getComponentInfo('not-a-guid');
      expect.fail('Expected getComponentInfo to reject');
    } catch (error) {
      expect((error as Error).message).to.include('Invalid GUID');
    }
  });
});
