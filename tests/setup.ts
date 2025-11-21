import mock from 'mock-require';
import sinon from 'sinon';

type Listener<T> = (value: T) => void;

interface EventEmitter<T> {
  event: (listener: Listener<T>) => { dispose: () => void };
  fire: (value: T) => void;
  listeners: Listener<T>[];
}

const createEmitter = <T>(): EventEmitter<T> => {
  const listeners: Listener<T>[] = [];
  return {
    event: (listener: Listener<T>) => {
      listeners.push(listener);
      return {
        dispose: () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        }
      };
    },
    fire: (value: T) => {
      listeners.slice().forEach((listener) => listener(value));
    },
    listeners
  };
};

const activeTextEditorEmitter = createEmitter<any>();
const selectionChangeEmitter = createEmitter<any>();
const documentChangeEmitter = createEmitter<any>();

class Range {
  public readonly start: { line: number; character: number };

  public readonly end: { line: number; character: number };

  constructor(public readonly startLine: number, public readonly startCharacter: number, public readonly endLine: number, public readonly endCharacter: number) {
    this.start = { line: startLine, character: startCharacter };
    this.end = { line: endLine, character: endCharacter };
  }
}

class ThemeColor {
  constructor(public readonly id: string) {}
}

const createTextEditorDecorationType = sinon.stub().callsFake(() => ({
  dispose: sinon.stub()
}));

const vscodeMock = {
  window: {
    createTextEditorDecorationType,
    onDidChangeActiveTextEditor: activeTextEditorEmitter.event,
    onDidChangeTextEditorSelection: selectionChangeEmitter.event,
    showInformationMessage: sinon.stub(),
    visibleTextEditors: [] as any[],
    activeTextEditor: undefined as any
  },
  workspace: {
    onDidChangeTextDocument: documentChangeEmitter.event
  },
  Range,
  ThemeColor,
  DecorationRangeBehavior: {
    ClosedOpen: 1
  }
};

mock('vscode', vscodeMock);

(global as any).__vscodeMock = {
  ...vscodeMock,
  __events: {
    activeTextEditorEmitter,
    selectionChangeEmitter,
    documentChangeEmitter
  }
};

export {};
