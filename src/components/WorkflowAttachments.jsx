import React from 'react';
import { deleteProjectFileFromStorage, downloadProjectFileFromStorage, uploadProjectFileToStorage } from '../services/trackerData.js';
import { formatFileSize } from '../utils/fileUi.js';
import { openPreview } from '../platform/platformAdapter.js';
import FluentIcon from './FluentIcon.jsx';

function createAttachmentId() {
  return globalThis.crypto?.randomUUID?.() || `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function addPendingWorkflowAttachments(draft, fileList, field = 'attachments') {
  const files = Array.from(fileList || []);
  if (!files.length) return draft;
  return {
    ...draft,
    [field]: [
      ...(draft?.[field] || []),
      ...files.map((file) => ({ id: createAttachmentId(), name: file.name, originalName: file.name, type: file.type, size: file.size, file })),
    ],
  };
}

export function removeWorkflowAttachment(draft, attachmentId, field = 'attachments') {
  const existing = (draft?.[field] || []).find((item) => item.id === attachmentId);
  return {
    ...draft,
    [field]: (draft?.[field] || []).filter((item) => item.id !== attachmentId),
    deletedAttachments: existing?.storagePath ? [...(draft?.deletedAttachments || []), existing] : draft?.deletedAttachments || [],
  };
}

export async function prepareWorkflowAttachments(projectId, folderId, draft, field = 'attachments') {
  const uploaded = [];
  const attachments = [];
  for (const attachment of draft?.[field] || []) {
    if (!attachment.file) {
      attachments.push(attachment);
      continue;
    }
    const attachmentId = attachment.id || createAttachmentId();
    const stored = {
      id: attachmentId,
      name: attachment.name || attachment.file.name,
      originalName: attachment.originalName || attachment.file.name,
      type: attachment.type || attachment.file.type,
      size: Number(attachment.size || attachment.file.size) || 0,
      uploadedAt: new Date().toISOString(),
      ...(await uploadProjectFileToStorage(projectId, folderId, attachmentId, attachment.file)),
    };
    uploaded.push(stored);
    attachments.push(stored);
  }
  const prepared = { ...draft, [field]: attachments };
  delete prepared.deletedAttachments;
  return { prepared, uploaded };
}

export async function deleteWorkflowAttachments(attachments) {
  await Promise.allSettled((attachments || []).filter((item) => item?.storagePath).map((item) => deleteProjectFileFromStorage(item)));
}

async function openAttachment(attachment) {
  const source = attachment?.file || (attachment?.storagePath ? await downloadProjectFileFromStorage(attachment) : attachment?.dataUrl || '');
  if (source) openPreview(source, { features: 'noopener' });
}

export default function WorkflowAttachments({ attachments = [], onAdd, onRemove, label = 'Attachments', addLabel = 'Add files', disabled = false }) {
  return (
    <section className="workflow-attachments full" aria-label={label}>
      <div className="workflow-attachments-heading">
        <div><strong>{label}</strong><span>{attachments.length} file(s)</span></div>
        {onAdd ? <label className="button secondary workflow-attachment-picker"><FluentIcon name="upload" size={16} />{addLabel}<input className="visually-hidden" type="file" multiple onChange={(event) => { onAdd(event.target.files); event.target.value = ''; }} disabled={disabled} /></label> : null}
      </div>
      {attachments.length ? <div className="workflow-attachment-list">{attachments.map((attachment) => (
        <div className="workflow-attachment-row" key={attachment.id}>
          <button type="button" onClick={() => void openAttachment(attachment)} aria-label={`Open ${attachment.name || attachment.originalName || 'attachment'}`}><FluentIcon name="document" size={18} /></button>
          <span><strong>{attachment.name || attachment.originalName || 'Attachment'}</strong><small>{attachment.size ? formatFileSize(attachment.size) : attachment.file ? 'Pending upload' : ''}</small></span>
          {onRemove ? <button className="button secondary gantt-icon-button" type="button" onClick={() => onRemove(attachment.id)} disabled={disabled} aria-label={`Remove ${attachment.name || attachment.originalName || 'attachment'}`}><FluentIcon name="delete" size={16} /></button> : null}
        </div>
      ))}</div> : <p className="project-workflow-contractor-empty">No files added.</p>}
    </section>
  );
}
