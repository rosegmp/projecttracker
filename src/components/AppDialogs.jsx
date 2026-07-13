import React, { useEffect, useRef, useState } from 'react';
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

function registerAppDialogHandler(handler) {
  appDialogHandler = handler;
  return () => {
    if (appDialogHandler === handler) appDialogHandler = null;
  };
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

export default function AppDialogHost() {
  const [dialog, setDialog] = useState(null);
  const resolverRef = useRef(null);

  useEffect(() => registerAppDialogHandler((nextDialog) =>
    new Promise((resolve) => {
      resolverRef.current = resolve;
      setDialog(nextDialog);
    })), []);

  function closeDialog(result) {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setDialog(null);
    resolver?.(result);
  }

  if (!dialog) return null;

  return renderModalPortal(
    <div className="modal-backdrop" onClick={() => closeDialog(false)}>
      <div className="modal-card compact-modal-card app-dialog-modal" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">{dialog.type === 'confirm' ? 'Confirm' : 'Message'}</p>
            <h2 id="app-dialog-title">{dialog.title}</h2>
          </div>
        </div>
        <div className="app-dialog-copy">
          <p>{dialog.message}</p>
        </div>
        <div className="modal-actions">
          {dialog.type === 'confirm' ? (
            <button className="button secondary" type="button" onClick={() => closeDialog(false)}>
              {dialog.cancelLabel || 'Cancel'}
            </button>
          ) : null}
          <button
            className={`button ${dialog.tone === 'danger' ? 'secondary danger' : 'primary'}`}
            type="button"
            onClick={() => closeDialog(true)}
          >
            {dialog.confirmLabel || 'OK'}
          </button>
        </div>
      </div>
    </div>,
  );
}
