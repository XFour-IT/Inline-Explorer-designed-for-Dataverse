import { expect } from 'chai';
import sinon from 'sinon';
import { Response } from 'node-fetch';
import * as fetchModule from 'node-fetch';
import * as vscode from 'vscode';
import { DataverseClient } from '../../src/dataverseClient';
import { GuidDecorationManager } from '../../src/guidDecorationManager';

const createContext = (): vscode.ExtensionContext => ({
  subscriptions: [],
  secrets: {
    store: sinon.stub().resolves(undefined)
  }
} as unknown as vscode.ExtensionContext);

const createResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });

interface FakeDocument {
  languageId: string;
  fileName: string;
  lineAt: (line: number) => { text: string; lineNumber: number };
}

interface FakeEditor {
  document: FakeDocument;
  selection: { active: { line: number; character: number } };
  setDecorations: sinon.SinonStub;
}

const createEditor = (line: string, cursor = 0): FakeEditor => ({
  document: {
    languageId: 'xml',
    fileName: 'test.xml',
    lineAt: () => ({ text: line, lineNumber: 0 })
  },
  selection: { active: { line: 0, character: cursor } },
  setDecorations: sinon.stub()
});

describe('Guid decoration integration', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('resolves form metadata and caches the result', async () => {
    const context = createContext();
    const client = new DataverseClient(context);
    Object.assign(client as any, {
      environmentUrl: 'https://org.example',
      accessToken: 'token'
    });

    sinon.stub(client as any, 'ensureAuthenticated').resolves();

    const guid = '11111111-1111-1111-1111-111111111111';
    const fetchStub = sinon.stub(fetchModule, 'default');
    fetchStub.onCall(0).resolves(createResponse({ value: [{ componenttype: 60, objectid: guid }] }));
    fetchStub.onCall(1).resolves(createResponse({ name: 'Account Form', type: 2 }));

    const manager = new GuidDecorationManager(client);
    const editor = createEditor(`prefix ${guid} suffix`, 12);

    await manager.refresh(editor as unknown as vscode.TextEditor);

    expect(fetchStub.callCount).to.equal(2);
    const finalCall = editor.setDecorations.getCall(1).args[1][0];
    expect(finalCall.renderOptions.after.contentText).to.equal('// Form - Account Form (Main)');

    await manager.refresh(editor as unknown as vscode.TextEditor);

    expect(fetchStub.callCount).to.equal(2);
    const cachedCall = editor.setDecorations.getCall(3).args[1][0];
    expect(cachedCall.renderOptions.after.contentText).to.equal('// Form - Account Form (Main)');
  });
});
