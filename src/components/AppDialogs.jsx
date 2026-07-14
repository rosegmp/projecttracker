import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const modalEscapeStack = [];

function ModalPortal({ content }) {
  const closeFromBackdrop = content?.props?.onClick;
  const escapeIdRef = useRef(Symbol('modal-escape'));

  useEffect(() => {
    if (typeof document === 'undefined' || typeof closeFromBackdrop !== 'function') return undefined;

    const escapeEntry = { id: escapeIdRef.current, close: closeFromBackdrop };
    modalEscapeStack.push(escapeEntry);

    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;
      if (modalEscapeStack.at(-1)?.id !== escapeEntry.id) return;
      event.preventDefault();
      event.stopPropagation();
      escapeEntry.close(event);
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
      const stackIndex = modalEscapeStack.findIndex((entry) => entry.id === escapeEntry.id);
      if (stackIndex >= 0) modalEscapeStack.splice(stackIndex, 1);
    };
  }, [closeFromBackdrop]);

  if (typeof document === 'undefined') return content;
  return createPortal(content, document.body);
}

export function renderModalPortal(content) {
  return <ModalPortal content={content} />;
}

let appDialogHandler = null;
let undoActionHandler = null;
let downloadProgressHandler = null;

function registerAppDialogHandler(handler) {
  appDialogHandler = handler;
  return () => {
    if (appDialogHandler === handler) appDialogHandler = null;
  };
}

function registerUndoActionHandler(handler) {
  undoActionHandler = handler;
  return () => {
    if (undoActionHandler === handler) undoActionHandler = null;
  };
}

export function showUndoAction({ message, onUndo, onCommit, duration = 8000 }) {
  const action = {
    message: String(message || 'Item deleted.'),
    onUndo,
    onCommit,
    duration: Math.max(1000, Number(duration) || 8000),
  };
  if (!undoActionHandler) {
    void Promise.resolve(action.onCommit?.()).catch(() => {});
    return;
  }
  undoActionHandler(action);
}

export function showAppAlert(message, title = 'Notice') {
  if (!appDialogHandler) {
    window.alert(message);
    return Promise.resolve();
  }
  return appDialogHandler({
    type: 'alert',
    title,
    message: String(message || ''),
    confirmLabel: 'OK',
  });
}

export function showAppConfirm(message, options = {}) {
  const payload = {
    type: 'confirm',
    title: options.title || 'Confirm action',
    message: String(message || ''),
    confirmLabel: options.confirmLabel || 'Confirm',
    cancelLabel: options.cancelLabel || 'Cancel',
    tone: options.tone || 'default',
  };
  if (!appDialogHandler) return Promise.resolve(window.confirm(payload.message));
  return appDialogHandler(payload);
}

export function showAppChoice(message, options = {}) {
  const payload = {
    type: 'choice',
    title: options.title || 'Choose an action',
    message: String(message || ''),
    options: Array.isArray(options.options) ? options.options : [],
    cancelLabel: options.cancelLabel || 'Cancel',
  };
  if (!appDialogHandler) return Promise.resolve(null);
  return appDialogHandler(payload);
}

function registerDownloadProgressHandler(handler) {
  downloadProgressHandler = handler;
  return () => {
    if (downloadProgressHandler === handler) downloadProgressHandler = null;
  };
}

export function beginDownloadProgress(label) {
  const id = `download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  downloadProgressHandler?.({ type: 'start', id, label: String(label || 'Downloading file') });
  return {
    update(loaded, total = 0) {
      downloadProgressHandler?.({ type: 'update', id, loaded: Number(loaded) || 0, total: Number(total) || 0 });
    },
    complete(message = 'Download complete') {
      downloadProgressHandler?.({ type: 'complete', id, message });
    },
    close() {
      downloadProgressHandler?.({ type: 'close', id });
    },
  };
}

export default function AppDialogHost() {
  const [dialog, setDialog] = useState(null);
  const [undoAction, setUndoAction] = useState(null);
  const [downloadStatus, setDownloadStatus] = useState(null);
  const resolverRef = useRef(null);
  const undoActionRef = useRef(null);
  const undoTimerRef = useRef(null);
  const downloadTimerRef = useRef(null);

  useEffect(() => registerAppDialogHandler((nextDialog) =>
    new Promise((resolve) => {
      resolverRef.current = resolve;
      setDialog(nextDialog);
    })), []);

  const commitUndoAction = useCallback((action = undoActionRef.current) => {
    if (!action || undoActionRef.current?.id !== action.id) return;
    window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    undoActionRef.current = null;
    setUndoAction(null);
    void Promise.resolve(action.onCommit?.()).catch(() => {});
  }, []);

  useEffect(() => registerUndoActionHandler((nextAction) => {
    const previousAction = undoActionRef.current;
    if (previousAction) {
      window.clearTimeout(undoTimerRef.current);
      void Promise.resolve(previousAction.onCommit?.()).catch(() => {});
    }

    const action = {
      ...nextAction,
      id: `undo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      busy: false,
    };
    undoActionRef.current = action;
    setUndoAction(action);
    undoTimerRef.current = window.setTimeout(() => commitUndoAction(action), action.duration);
  }), [commitUndoAction]);

  useEffect(() => () => {
    window.clearTimeout(undoTimerRef.current);
    const pendingAction = undoActionRef.current;
    undoActionRef.current = null;
    if (pendingAction) void Promise.resolve(pendingAction.onCommit?.()).catch(() => {});
  }, []);

  useEffect(() => registerDownloadProgressHandler((event) => {
    if (event.type === 'start') {
      window.clearTimeout(downloadTimerRef.current);
      setDownloadStatus({ id: event.id, label: event.label, loaded: 0, total: 0, complete: false });
      return;
    }
    setDownloadStatus((current) => {
      if (!current || current.id !== event.id) return current;
      if (event.type === 'close') return null;
      if (event.type === 'complete') {
        window.clearTimeout(downloadTimerRef.current);
        downloadTimerRef.current = window.setTimeout(() => setDownloadStatus(null), 2400);
        return { ...current, complete: true, message: event.message };
      }
      return { ...current, loaded: event.loaded, total: event.total };
    });
  }), []);

  useEffect(() => () => window.clearTimeout(downloadTimerRef.current), []);

  function closeDialog(result) {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setDialog(null);
    resolver?.(result);
  }

  async function handleUndo() {
    const action = undoActionRef.current;
    if (!action || action.busy) return;
    window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    const busyAction = { ...action, busy: true };
    undoActionRef.current = busyAction;
    setUndoAction(busyAction);
    try {
      await action.onUndo?.();
      if (undoActionRef.current?.id === action.id) {
        undoActionRef.current = null;
        setUndoAction(null);
      }
    } catch (error) {
      if (undoActionRef.current?.id === action.id) {
        undoActionRef.current = action;
        setUndoAction(action);
      }
      void showAppAlert(error instanceof Error ? error.message : 'Unable to restore the deleted item.', 'Undo failed');
    }
  }

  return (
    <>
      {dialog ? renderModalPortal(
        <div className="modal-backdrop" onClick={() => closeDialog(false)}>
          <div className="modal-card compact-modal-card app-dialog-modal" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <div>
                <p className="eyebrow">{dialog.type === 'confirm' ? 'Confirm' : dialog.type === 'choice' ? 'Choose action' : 'Message'}</p>
                <h2 id="app-dialog-title">{dialog.title}</h2>
              </div>
            </div>
            <div className="app-dialog-copy">
              <p>{dialog.message}</p>
            </div>
            <div className="modal-actions">
              {dialog.type === 'confirm' || dialog.type === 'choice' ? (
                <button className="button secondary" type="button" onClick={() => closeDialog(false)}>
                  {dialog.cancelLabel || 'Cancel'}
                </button>
              ) : null}
              {dialog.type === 'choice' ? dialog.options.map((option) => (
                <button
                  key={option.value}
                  className={`button ${option.tone === 'primary' ? 'primary' : 'secondary'}`}
                  type="button"
                  onClick={() => closeDialog(option.value)}
                >
                  {option.label}
                </button>
              )) : (
                <button
                  className={`button ${dialog.tone === 'danger' ? 'secondary danger' : 'primary'}`}
                  type="button"
                  onClick={() => closeDialog(true)}
                >
                  {dialog.confirmLabel || 'OK'}
                </button>
              )}
            </div>
          </div>
        </div>,
      ) : null}
      {undoAction && typeof document !== 'undefined' ? createPortal(
        <div className="undo-toast" role="status" aria-live="polite">
          <span className="undo-toast-copy">{undoAction.message}</span>
          <button className="button secondary" type="button" disabled={undoAction.busy} onClick={() => void handleUndo()}>
            {undoAction.busy ? 'Restoring...' : 'Undo'}
          </button>
        </div>,
        document.body,
      ) : null}
      {downloadStatus && typeof document !== 'undefined' ? createPortal(
        <div className="download-progress-toast" role="status" aria-live="polite">
          <div className="download-progress-copy">
            <strong>{downloadStatus.complete ? downloadStatus.message : downloadStatus.label}</strong>
            {!downloadStatus.complete ? (
              <span>
                {downloadStatus.total > 0
                  ? `${Math.min(100, Math.round((downloadStatus.loaded / downloadStatus.total) * 100))}%`
                  : 'Downloading...'}
              </span>
            ) : null}
          </div>
          {!downloadStatus.complete ? (
            <progress
              className="download-progress-bar"
              value={downloadStatus.total > 0 ? downloadStatus.loaded : undefined}
              max={downloadStatus.total > 0 ? downloadStatus.total : undefined}
            />
          ) : null}
        </div>,
        document.body,
      ) : null}
    </>
  );
}
