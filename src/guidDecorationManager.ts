import * as vscode from 'vscode';
import { DataverseClient } from './dataverseClient';

const GUID_REGEX = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

export class GuidDecorationManager {
  private readonly decorationType: vscode.TextEditorDecorationType;
  private readonly client: DataverseClient;
  private currentRequestId = 0;

  constructor(client: DataverseClient) {
    this.client = client;
    this.decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        margin: '0 0 0 1rem',
        color: new vscode.ThemeColor('editorCodeLens.foreground'),
        fontStyle: 'italic'
      },
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen
    });
  }

  public register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      this.decorationType,
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          void this.updateDecorations(editor);
        }
      }),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        void this.updateDecorations(event.textEditor);
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        const editor = vscode.window.visibleTextEditors.find((e) => e.document === event.document);
        if (editor) {
          void this.updateDecorations(editor);
        }
      })
    );

    if (vscode.window.activeTextEditor) {
      void this.updateDecorations(vscode.window.activeTextEditor);
    }
  }

  public async refresh(editor: vscode.TextEditor): Promise<void> {
    await this.updateDecorations(editor);
  }

  private async updateDecorations(editor: vscode.TextEditor): Promise<void> {
    if (!this.isApplicable(editor.document)) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    const selection = editor.selection;
    const line = editor.document.lineAt(selection.active.line);
    const matches = [...line.text.matchAll(GUID_REGEX)];
    if (matches.length === 0) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    const match = this.pickMatch(matches, selection.active.character);
    if (!match || match.index === undefined) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    const guid = match[0];
    const range = new vscode.Range(
      line.lineNumber,
      match.index + match[0].length,
      line.lineNumber,
      match.index + match[0].length
    );

    const requestId = ++this.currentRequestId;

    if (!this.client.isAuthenticated()) {
      this.applyDecoration(editor, range, '// Login to Dataverse to resolve GUID');
      return;
    }

    this.applyDecoration(editor, range, '// Resolving Dataverse component…');

    try {
      const info = await this.client.getComponentInfo(guid);
      if (requestId !== this.currentRequestId) {
        return;
      }
      const text = `// ${info.componentType} - ${info.displayName}`;
      this.applyDecoration(editor, range, text);
    } catch (error) {
      if (requestId !== this.currentRequestId) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.applyDecoration(editor, range, `// ${message}`);
    }
  }

  private applyDecoration(editor: vscode.TextEditor, range: vscode.Range, contentText: string): void {
    const decoration: vscode.DecorationOptions = {
      range,
      renderOptions: {
        after: {
          contentText,
          color: 'rgba(128,128,128,0.65)',
          fontStyle: 'italic'
        }
      }
    };
    editor.setDecorations(this.decorationType, [decoration]);
  }

  private isApplicable(document: vscode.TextDocument): boolean {
    return document.languageId === 'xml' || document.fileName.toLowerCase().endsWith('.xml');
  }

  private pickMatch(matches: RegExpMatchArray[], cursorPosition: number): RegExpMatchArray | undefined {
    const containing = matches.find((m) => {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      return cursorPosition >= start && cursorPosition <= end;
    });
    return containing ?? matches[0];
  }
}
