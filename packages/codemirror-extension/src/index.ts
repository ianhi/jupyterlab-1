// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import CodeMirror from 'codemirror';

import { Menu } from '@lumino/widgets';

import {
  ILabShell,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { IEditMenu, IMainMenu } from '@jupyterlab/mainmenu';

import { Cell, MarkdownCell } from '@jupyterlab/cells';

import { IEditorServices } from '@jupyterlab/codeeditor';

import {
  editorServices,
  EditorSyntaxStatus,
  CodeMirrorEditor,
  Mode,
  ICodeMirror
} from '@jupyterlab/codemirror';

import { IDocumentWidget } from '@jupyterlab/docregistry';

import { IEditorTracker, FileEditor } from '@jupyterlab/fileeditor';

import { INotebookTracker } from '@jupyterlab/notebook';

import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { IStatusBar } from '@jupyterlab/statusbar';

import { ITranslator } from '@jupyterlab/translation';

/**
 * The command IDs used by the codemirror plugin.
 */
namespace CommandIDs {
  export const changeKeyMap = 'codemirror:change-keymap';

  export const changeTheme = 'codemirror:change-theme';

  export const changeMode = 'codemirror:change-mode';

  export const find = 'codemirror:find';

  export const goToLine = 'codemirror:go-to-line';
}

/** The CodeMirror singleton. */
const codemirrorSingleton: JupyterFrontEndPlugin<ICodeMirror> = {
  id: '@jupyterlab/codemirror-extension:codemirror',
  provides: ICodeMirror,
  activate: activateCodeMirror
};

/**
 * The editor services.
 */
const services: JupyterFrontEndPlugin<IEditorServices> = {
  id: '@jupyterlab/codemirror-extension:services',
  provides: IEditorServices,
  activate: activateEditorServices
};

/**
 * The editor commands.
 */
const commands: JupyterFrontEndPlugin<void> = {
  id: '@jupyterlab/codemirror-extension:commands',
  requires: [IEditorTracker, INotebookTracker, ISettingRegistry, ITranslator],
  optional: [IMainMenu],
  activate: activateEditorCommands,
  autoStart: true
};

/**
 * The JupyterLab plugin for the EditorSyntax status item.
 */
export const editorSyntaxStatus: JupyterFrontEndPlugin<void> = {
  id: '@jupyterlab/codemirror-extension:editor-syntax-status',
  autoStart: true,
  requires: [IEditorTracker, ILabShell, ITranslator],
  optional: [IStatusBar],
  activate: (
    app: JupyterFrontEnd,
    tracker: IEditorTracker,
    labShell: ILabShell,
    translator: ITranslator,
    statusBar: IStatusBar | null
  ) => {
    if (!statusBar) {
      // Automatically disable if statusbar missing
      return;
    }
    const item = new EditorSyntaxStatus({ commands: app.commands, translator });
    labShell.currentChanged.connect(() => {
      const current = labShell.currentWidget;
      if (current && tracker.has(current) && item.model) {
        item.model.editor = (current as IDocumentWidget<
          FileEditor
        >).content.editor;
      }
    });
    statusBar.registerStatusItem(
      '@jupyterlab/codemirror-extension:editor-syntax-status',
      {
        item,
        align: 'left',
        rank: 0,
        isActive: () =>
          !!labShell.currentWidget &&
          !!tracker.currentWidget &&
          labShell.currentWidget === tracker.currentWidget
      }
    );
  }
};

/**
 * Export the plugins as default.
 */
const plugins: JupyterFrontEndPlugin<any>[] = [
  commands,
  services,
  editorSyntaxStatus,
  codemirrorSingleton
];
export default plugins;

/**
 * The plugin ID used as the key in the setting registry.
 */
const id = commands.id;

/**
 * Set up the editor services.
 */
function activateEditorServices(app: JupyterFrontEnd): IEditorServices {
  CodeMirror.prototype.save = () => {
    void app.commands.execute('docmanager:save');
  };
  return editorServices;
}

/**
 * Simplest implementation of the CodeMirror singleton provider.
 */
class CodeMirrorSingleton implements ICodeMirror {
  get CodeMirror() {
    return CodeMirror;
  }
}

/**
 * Set up the CodeMirror singleton.
 */
function activateCodeMirror(app: JupyterFrontEnd): ICodeMirror {
  return new CodeMirrorSingleton();
}

/**
 * Set up the editor widget menu and commands.
 */
function activateEditorCommands(
  app: JupyterFrontEnd,
  fileEditorTracker: IEditorTracker,
  notebookTracker: INotebookTracker,
  settingRegistry: ISettingRegistry,
  translator: ITranslator,
  mainMenu: IMainMenu | null
): void {
  const trans = translator.load('jupyterlab');
  const { commands, restored } = app;
  let {
    theme,
    keyMap,
    scrollPastEnd,
    styleActiveLine,
    styleSelectedText,
    selectionPointer,
    lineWiseCopyCut
  } = CodeMirrorEditor.defaultConfig;
  /**
   * Update the setting values.
   */
  async function updateSettings(
    settings: ISettingRegistry.ISettings
  ): Promise<void> {
    keyMap = (settings.get('keyMap').composite as string | null) || keyMap;
    if (keyMap === 'vim') {
      // @ts-expect-error
      await import('codemirror/keymap/vim.js');
      const vim = (CodeMirror as any).Vim;
      vim.defineMotion(
        'moveByLinesOrCell',
        (cm: any, head: any, motionArgs: any, vim: any) => {
          let cur = head;
          let endCh = cur.ch;
          let currentCell = activeCell;
          // TODO: these references will be undefined
          // Depending what our last motion was, we may want to do different
          // things. If our last motion was moving vertically, we want to
          // preserve the HPos from our last horizontal move.  If our last motion
          // was going to the end of a line, moving vertically we should go to
          // the end of the line, etc.
          switch (vim.lastMotion) {
            case 'moveByLines':
            case 'moveByDisplayLines':
            case 'moveByScroll':
            case 'moveToColumn':
            case 'moveToEol':
            // JUPYTER PATCH: add our custom method to the motion cases
            // eslint-disable-next-line no-fallthrough
            case 'moveByLinesOrCell':
              endCh = vim.lastHPos;
              break;
            default:
              vim.lastHPos = endCh;
          }
          let repeat = motionArgs.repeat + (motionArgs.repeatOffset || 0);
          let line = motionArgs.forward ? cur.line + repeat : cur.line - repeat;
          let first = cm.firstLine();
          let last = cm.lastLine();
          // Vim cancels linewise motions that start on an edge and move beyond
          // that edge. It does not cancel motions that do not start on an edge.

          // JUPYTER PATCH BEGIN
          // here we insert the jumps to the next cells
          if (line < first || line > last) {
            // var currentCell = ns.notebook.get_selected_cell();
            // var currentCell = tracker.activeCell;
            // var key = '';
            if (currentCell?.model.type === 'markdown') {
              (currentCell as MarkdownCell).rendered = true;
            }
            if (motionArgs.forward) {
              void commands.execute('notebook:move-cursor-down');
            } else {
              void commands.execute('notebook:move-cursor-up');
            }
            return;
          }
          vim.lastHSPos = cm.charCoords(
            CodeMirror.Pos(line, endCh),
            'div'
          ).left;
          return (CodeMirror as any).Pos(line, endCh);
        }
      );
      vim.mapCommand(
        'k',
        'motion',
        'moveByLinesOrCell',
        { forward: false, linewise: true },
        { context: 'normal' }
      );
      vim.mapCommand(
        'j',
        'motion',
        'moveByLinesOrCell',
        { forward: true, linewise: true },
        { context: 'normal' }
      );
      CodeMirror.prototype.save = () => {
        void commands.execute('docmanager:save');
      };
      vim.defineEx('quit', 'q', function (cm: any) {
        void commands.execute('notebook:enter-command-mode');
      });
      vim.defineAction('splitCell', (cm: any, actionArgs: any) => {
        void commands.execute('notebook:split-cell-at-cursor');
      });
      vim.mapCommand('-', 'action', 'splitCell', {}, { extra: 'normal' });
      commands.addKeyBinding({
        selector: '.jp-Notebook.jp-mod-editMode',
        keys: ['Ctrl J'],
        command: 'notebook:move-cursor-down'
      });
      commands.addKeyBinding({
        selector: '.jp-Notebook.jp-mod-editMode',
        keys: ['Ctrl K'],
        command: 'notebook:move-cursor-up'
      });
      commands.addKeyBinding({
        selector: '.jp-Notebook.jp-mod-editMode',
        keys: ['Escape'],
        command: 'codemirror:leave-vim-insert-mode'
      });
      commands.addKeyBinding({
        selector: '.jp-Notebook.jp-mod-editMode',
        keys: ['Shift Escape'],
        command: 'notebook:enter-command-mode'
      });
    } else {
      commands.addKeyBinding({
        selector: '.jp-Notebook.jp-mod-editMode',
        keys: ['Escape'],
        command: 'notebook:enter-command-mode'
      });
    }
    theme = (settings.get('theme').composite as string | null) || theme;
    // Lazy loading of theme stylesheets
    if (theme !== 'jupyter' && theme !== 'default') {
      const filename =
        theme === 'solarized light' || theme === 'solarized dark'
          ? 'solarized'
          : theme;

      await import(`codemirror/theme/${filename}.css`);
    }

    scrollPastEnd =
      (settings.get('scrollPastEnd').composite as boolean | null) ??
      scrollPastEnd;
    styleActiveLine =
      (settings.get('styleActiveLine').composite as
        | boolean
        | CodeMirror.StyleActiveLine) ?? styleActiveLine;
    styleSelectedText =
      (settings.get('styleSelectedText').composite as boolean) ??
      styleSelectedText;
    selectionPointer =
      (settings.get('selectionPointer').composite as boolean | string) ??
      selectionPointer;
    lineWiseCopyCut =
      (settings.get('lineWiseCopyCut').composite as boolean) ?? lineWiseCopyCut;
  }

  /**
   * Update the settings of the current tracker instances.
   */
  function updateFileEditorTracker(): void {
    fileEditorTracker.forEach(widget => {
      if (widget.content.editor instanceof CodeMirrorEditor) {
        const { editor } = widget.content;
        editor.setOption('keyMap', keyMap);
        editor.setOption('lineWiseCopyCut', lineWiseCopyCut);
        editor.setOption('scrollPastEnd', scrollPastEnd);
        editor.setOption('selectionPointer', selectionPointer);
        editor.setOption('styleActiveLine', styleActiveLine);
        editor.setOption('styleSelectedText', styleSelectedText);
        editor.setOption('theme', theme);
      }
    });
  }

  /**
   * Update the settings of the current notebook tracker instances.
   */
  function updateNotebookTracker(): void {
    notebookTracker.forEach(widget => {
      widget.content.widgets.forEach(cell => {
        if (cell.inputArea.editor instanceof CodeMirrorEditor) {
          const cm = cell.inputArea.editor.editor;
          cm.setOption('keyMap', keyMap);
          cm.setOption('theme', theme);
          cm.setOption('styleActiveLine', styleActiveLine);
          cm.setOption('lineWiseCopyCut', lineWiseCopyCut);
        }
      });
    });
  }

  // Fetch the initial state of the settings.
  Promise.all([settingRegistry.load(id), restored])
    .then(async ([settings]) => {
      await updateSettings(settings);
      updateFileEditorTracker();
      updateNotebookTracker();
      settings.changed.connect(async () => {
        await updateSettings(settings);
        updateFileEditorTracker();
        updateNotebookTracker();
      });
      // connect to signal here to ensure vim keymap has
      // been imported in case we need it
      notebookTracker.newCellCreated.connect((sender, cell) => {
        if (cell?.inputArea.editor instanceof CodeMirrorEditor) {
          const editor = cell.inputArea.editor.editor;
          editor.setOption('keyMap', keyMap);
          editor.setOption('styleActiveLine', styleActiveLine);
          editor.setOption('lineWiseCopyCut', lineWiseCopyCut);
        }
      });
    })
    .catch((reason: Error) => {
      console.error(reason.message);
      updateFileEditorTracker();
      updateNotebookTracker();
    });

  /**
   * Handle the settings of new widgets.
   */
  fileEditorTracker.widgetAdded.connect((sender, widget) => {
    if (widget.content.editor instanceof CodeMirrorEditor) {
      const { editor } = widget.content;
      editor.setOption('keyMap', keyMap);
      editor.setOption('lineWiseCopyCut', lineWiseCopyCut);
      editor.setOption('selectionPointer', selectionPointer);
      editor.setOption('scrollPastEnd', scrollPastEnd);
      editor.setOption('styleActiveLine', styleActiveLine);
      editor.setOption('styleSelectedText', styleSelectedText);
      editor.setOption('theme', theme);
    }
  });

  /**
   * Handle the settings of new widgets.
   */
  notebookTracker.widgetAdded.connect((sender, widget) => {
    widget.content.widgets.forEach(cell => {
      if (cell.inputArea.editor instanceof CodeMirrorEditor) {
        const cm = cell.inputArea.editor.editor;
        // Do not set scrollPastEnd option.
        cm.setOption('keyMap', keyMap);
        cm.setOption('theme', theme);
        cm.setOption('styleActiveLine', styleActiveLine);
        cm.setOption('lineWiseCopyCut', lineWiseCopyCut);
      }
    });
  });

  let activeCell: Cell | null = null;

  commands.addCommand('codemirror:leave-vim-insert-mode', {
    label: 'Leave VIM Insert Mode',
    execute: args => {
      if (activeCell) {
        let editor = activeCell.editor as CodeMirrorEditor;
        (CodeMirror as any).Vim.handleKey(editor.editor, '<Esc>');
      }
    }
  });

  /**
   * A test for whether the tracker has an active widget.
   */
  function isEnabled(): boolean {
    return (
      (fileEditorTracker.currentWidget !== null &&
        fileEditorTracker.currentWidget === app.shell.currentWidget) ||
      (notebookTracker.currentWidget !== null &&
        notebookTracker.currentWidget === app.shell.currentWidget)
    );
  }

  /**
   * Create a menu for the editor.
   */
  const themeMenu = new Menu({ commands });
  const keyMapMenu = new Menu({ commands });
  const modeMenu = new Menu({ commands });

  themeMenu.title.label = trans.__('Text Editor Theme');
  keyMapMenu.title.label = trans.__('Text Editor Key Map');
  modeMenu.title.label = trans.__('Text Editor Syntax Highlighting');

  commands.addCommand(CommandIDs.changeTheme, {
    label: args => {
      if (args['theme'] === 'default') {
        return trans.__('codemirror');
      } else {
        return args['displayName'] as string;
      }
    },
    execute: args => {
      const key = 'theme';
      const value = (theme = (args['theme'] as string) || theme);

      return settingRegistry.set(id, key, value).catch((reason: Error) => {
        console.error(`Failed to set ${id}:${key} - ${reason.message}`);
      });
    },
    isToggled: args => args['theme'] === theme
  });

  commands.addCommand(CommandIDs.changeKeyMap, {
    label: args => {
      const title = args['displayName'] as string;
      const keyMap = args['keyMap'] as string;
      return keyMap === 'sublime' ? trans.__('Sublime Text') : title;
    },
    execute: args => {
      const key = 'keyMap';
      const value = (keyMap = (args['keyMap'] as string) || keyMap);

      return settingRegistry.set(id, key, value).catch((reason: Error) => {
        console.error(`Failed to set ${id}:${key} - ${reason.message}`);
      });
    },
    isToggled: args => args['keyMap'] === keyMap
  });

  commands.addCommand(CommandIDs.find, {
    label: trans.__('Find...'),
    execute: () => {
      const widget = fileEditorTracker.currentWidget;
      if (!widget) {
        return;
      }
      const editor = widget.content.editor as CodeMirrorEditor;
      editor.execCommand('find');
    },
    isEnabled
  });

  commands.addCommand(CommandIDs.goToLine, {
    label: trans.__('Go to Line...'),
    execute: () => {
      const widget = fileEditorTracker.currentWidget;
      if (!widget) {
        return;
      }
      const editor = widget.content.editor as CodeMirrorEditor;
      editor.execCommand('jumpToLine');
    },
    isEnabled
  });

  commands.addCommand(CommandIDs.changeMode, {
    label: args => args['name'] as string,
    execute: args => {
      const name = args['name'] as string;
      const widget = fileEditorTracker.currentWidget;
      if (name && widget) {
        const spec = Mode.findByName(name);
        if (spec) {
          widget.content.model.mimeType = spec.mime;
        }
      }
    },
    isEnabled,
    isToggled: args => {
      const widget = fileEditorTracker.currentWidget;
      if (!widget) {
        return false;
      }
      const mime = widget.content.model.mimeType;
      const spec = Mode.findByMIME(mime);
      const name = spec && spec.name;
      return args['name'] === name;
    }
  });

  Mode.getModeInfo()
    .sort((a, b) => {
      const aName = a.name || '';
      const bName = b.name || '';
      return aName.localeCompare(bName);
    })
    .forEach(spec => {
      // Avoid mode name with a curse word.
      if (spec.mode.indexOf('brainf') === 0) {
        return;
      }
      modeMenu.addItem({
        command: CommandIDs.changeMode,
        args: { ...spec } as any // TODO: Casting to `any` until lumino typings are fixed
      });
    });

  // FIXME-TRANS: Check this is working as expected
  [
    ['jupyter', trans.__('jupyter')],
    ['default', trans.__('default')],
    ['abcdef', trans.__('abcdef')],
    ['base16-dark', trans.__('base16-dark')],
    ['base16-light', trans.__('base16-light')],
    ['hopscotch', trans.__('hopscotch')],
    ['material', trans.__('material')],
    ['mbo', trans.__('mbo')],
    ['mdn-like', trans.__('mdn-like')],
    ['seti', trans.__('seti')],
    ['solarized dark', trans.__('solarized dark')],
    ['solarized light', trans.__('solarized light')],
    ['the-matrix', trans.__('the-matrix')],
    ['xq-light', trans.__('xq-light')],
    ['zenburn', trans.__('zenburn')]
  ].forEach(([name, displayName]) =>
    themeMenu.addItem({
      command: CommandIDs.changeTheme,
      args: { theme: name, displayName: displayName }
    })
  );

  // FIXME-TRANS: Check this is working as expected
  [
    ['default', trans.__('default')],
    ['sublime', trans.__('sublime')],
    ['vim', trans.__('vim')],
    ['emacs', trans.__('emacs')]
  ].forEach(([name, displayName]) => {
    keyMapMenu.addItem({
      command: CommandIDs.changeKeyMap,
      args: { keyMap: name, displayName: displayName }
    });
  });

  if (mainMenu) {
    // Add some of the editor settings to the settings menu.
    mainMenu.settingsMenu.addGroup(
      [
        { type: 'submenu' as Menu.ItemType, submenu: keyMapMenu },
        { type: 'submenu' as Menu.ItemType, submenu: themeMenu }
      ],
      10
    );

    // Add the syntax highlighting submenu to the `View` menu.
    mainMenu.viewMenu.addGroup([{ type: 'submenu', submenu: modeMenu }], 40);

    // Add go to line capabilities to the edit menu.
    mainMenu.editMenu.goToLiners.add({
      tracker: fileEditorTracker,
      goToLine: (widget: IDocumentWidget<FileEditor>) => {
        const editor = widget.content.editor as CodeMirrorEditor;
        editor.execCommand('jumpToLine');
      }
    } as IEditMenu.IGoToLiner<IDocumentWidget<FileEditor>>);
  }
}
