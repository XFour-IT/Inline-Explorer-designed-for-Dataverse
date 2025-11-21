import { expect } from 'chai';
import sinon from 'sinon';
import * as vscode from 'vscode';
import { GuidDecorationManager } from '../../src/guidDecorationManager';
import { DataverseClient, ComponentInfo } from '../../src/dataverseClient';

interface FakeLine {
  text: string;
  lineNumber: number;
}

interface FakeDocument {
  languageId: string;
  fileName: string;
  lineAt: (line: number) => FakeLine;
}

interface FakeEditor {
  document: FakeDocument;
  selection: { active: { line: number; character: number } };
  setDecorations: sinon.SinonStub;
}

const createDocument = (lines: string[], languageId = 'xml', fileName = 'test.xml'): FakeDocument => ({
  languageId,
  fileName,
  lineAt: (line: number) => ({
    text: lines[line],
    lineNumber: line
  })
});

const createEditor = (lines: string[], cursorCharacter = 0, languageId?: string): FakeEditor => ({
  document: createDocument(lines, languageId ?? 'xml', (languageId ?? 'xml') === 'xml' ? 'test.xml' : 'test.txt'),
  selection: { active: { line: 0, character: cursorCharacter } },
  setDecorations: sinon.stub()
});

describe('GuidDecorationManager', () => {
  let client: sinon.SinonStubbedInstance<DataverseClient>;

  beforeEach(() => {
    const windowStub = (vscode.window as any);
    if (windowStub.createTextEditorDecorationType.resetHistory) {
      windowStub.createTextEditorDecorationType.resetHistory();
    }
    client = {
      isAuthenticated: sinon.stub().returns(true),
      getComponentInfo: sinon.stub().resolves({ componentType: 'Entity', displayName: 'Account' } as ComponentInfo)
    } as unknown as sinon.SinonStubbedInstance<DataverseClient>;
  });

  afterEach(() => {
    sinon.restore();
  });

  it('registers event handlers on activation', () => {
    const manager = new GuidDecorationManager(client as unknown as DataverseClient);
    const updateStub = sinon.stub(manager as any, 'updateDecorations').resolves();
    const context = { subscriptions: [] as vscode.Disposable[] } as unknown as vscode.ExtensionContext;
    const editor = createEditor(['00000000-0000-0000-0000-000000000000']);
    (vscode.window as any).activeTextEditor = editor;
    (vscode.window as any).visibleTextEditors = [editor];

    manager.register(context);

    const events = (global as any).__vscodeMock.__events;
    events.activeTextEditorEmitter.fire(editor);
    events.selectionChangeEmitter.fire({ textEditor: editor });
    events.documentChangeEmitter.fire({ document: editor.document });

    expect(updateStub.callCount).to.be.greaterThan(0);
    expect(context.subscriptions.length).to.be.greaterThan(0);
  });

  it('clears decorations when document is not XML', async () => {
    const manager = new GuidDecorationManager(client as unknown as DataverseClient);
    const editor = createEditor(['no guid here'], 0, 'plaintext');

    await manager.refresh(editor as unknown as vscode.TextEditor);

    expect(editor.setDecorations.calledOnce).to.be.true;
    expect(editor.setDecorations.firstCall.args[1]).to.deep.equal([]);
  });

  it('clears decorations when no GUIDs are present', async () => {
    const manager = new GuidDecorationManager(client as unknown as DataverseClient);
    const editor = createEditor(['no guid here']);

    await manager.refresh(editor as unknown as vscode.TextEditor);

    expect(editor.setDecorations.calledOnce).to.be.true;
    expect(editor.setDecorations.firstCall.args[1]).to.deep.equal([]);
  });

  it('shows login prompt when unauthenticated', async () => {
    (client.isAuthenticated as sinon.SinonStub).returns(false);
    const manager = new GuidDecorationManager(client as unknown as DataverseClient);
    const editor = createEditor([`${'a'.repeat(8)}-${'b'.repeat(4)}-${'c'.repeat(4)}-${'d'.repeat(4)}-${'e'.repeat(12)}`]);

    await manager.refresh(editor as unknown as vscode.TextEditor);

    expect(editor.setDecorations.calledOnce).to.be.true;
    const applied = editor.setDecorations.firstCall.args[1][0];
    expect(applied.renderOptions.after.contentText).to.equal('// Login to Dataverse to resolve GUID');
  });

  it('renders resolved component info when authenticated', async () => {
    const manager = new GuidDecorationManager(client as unknown as DataverseClient);
    const guid = '11111111-1111-1111-1111-111111111111';
    const editor = createEditor([`prefix ${guid} suffix`], 12);

    await manager.refresh(editor as unknown as vscode.TextEditor);

    expect(editor.setDecorations.callCount).to.equal(2);
    const finalCall = editor.setDecorations.getCall(1).args[1][0];
    expect(finalCall.renderOptions.after.contentText).to.equal('// Entity - Account');
  });

  it('renders error message when component lookup fails', async () => {
    (client.getComponentInfo as sinon.SinonStub).rejects(new Error('boom'));
    const manager = new GuidDecorationManager(client as unknown as DataverseClient);
    const guid = '11111111-1111-1111-1111-111111111111';
    const editor = createEditor([`prefix ${guid} suffix`], 12);

    await manager.refresh(editor as unknown as vscode.TextEditor);

    expect(editor.setDecorations.callCount).to.equal(2);
    const finalCall = editor.setDecorations.getCall(1).args[1][0];
    expect(finalCall.renderOptions.after.contentText).to.equal('// boom');
  });
});
