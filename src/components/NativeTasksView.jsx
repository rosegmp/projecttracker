import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildTaskAssigneeDirectory, buildTaskAssigneeOptions, getVisibleProjectsForUser, getVisibleTasksForUser, personAssignmentLabel } from '../utils/accessUi.js';
import {
  createPerson, createTask, deleteTask, downloadProjectFileFromStorage, isSupabaseStorageConfigured,
  updatePerson, updateTask, uploadProjectFileToStorage,
} from '../services/trackerData.js';
import { isOverdue } from '../utils/schedule.js';
import { formatShortDate } from '../utils/calendarUi.js';
import { dataUrlToBlob, downloadBlobForCurrentPlatform, isShareDismissed } from '../utils/fileUi.js';
import { showAppAlert, showAppConfirm } from './AppDialogs.jsx';
import { EmailAddressModal } from './FormDialogs.jsx';
import FluentIcon from './FluentIcon.jsx';
import PersonModal from './PersonModal.jsx';
import { DashboardStat, PageStats } from './SharedUI.jsx';
import TaskRow from './TaskRow.jsx';

export default function NativeTasksView({
  data,
  onStateChange,
  refresh,
  loading,
  activeUser = null,
  projectFilter = 'all',
  onProjectFilterChange = () => {},
  embedded = false,
  lockedProjectId = '',
  highlightTaskId = '',
  highlightToken = '',
  onOpenSelection = () => {},
}) {
  const defaultTaskProjectId = lockedProjectId || (projectFilter !== 'all' ? projectFilter : '');
  const [statusFilter, setStatusFilter] = useState('all');
  const [groupBy, setGroupBy] = useState('none');
  const [newTask, setNewTask] = useState({ label: '', projectId: defaultTaskProjectId, due: '', assignee: '' });
  const [editingTaskId, setEditingTaskId] = useState('');
  const [editDraft, setEditDraft] = useState({ label: '', projectId: '', due: '', assignee: '', attachments: [] });
  const [newTaskFiles, setNewTaskFiles] = useState([]);
  const [editPendingFiles, setEditPendingFiles] = useState([]);
  const [createAttachmentInputKey, setCreateAttachmentInputKey] = useState(0);
  const [editAttachmentInputKey, setEditAttachmentInputKey] = useState(0);
  const [personDraft, setPersonDraft] = useState(null);
  const [emailDraft, setEmailDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState('');
  const [taskSaveMessage, setTaskSaveMessage] = useState('');
  const [activeHighlightTaskId, setActiveHighlightTaskId] = useState('');
  const createAttachmentInputRef = useRef(null);
  const editAttachmentInputRef = useRef(null);
  const createTaskNameInputRef = useRef(null);
  const taskRowRefs = useRef({});
  const dataRef = useRef(data);
  const taskSaveMessageTimerRef = useRef(0);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => () => {
    if (taskSaveMessageTimerRef.current) {
      window.clearTimeout(taskSaveMessageTimerRef.current);
    }
  }, []);

  const visibleProjects = useMemo(
    () => getVisibleProjectsForUser(data.projects, data.settings, activeUser),
    [activeUser, data.projects, data.settings],
  );

  const visibleTasks = useMemo(
    () => getVisibleTasksForUser(data.tasks, data.settings, visibleProjects),
    [data.tasks, data.settings, visibleProjects],
  );
  const effectiveProjectFilter = lockedProjectId || projectFilter;

  useEffect(() => {
    if (lockedProjectId) return;
    if (!visibleProjects.length) {
      onProjectFilterChange('all');
      return;
    }
    if (projectFilter !== 'all' && !visibleProjects.some((project) => project.id === projectFilter)) {
      onProjectFilterChange('all');
    }
  }, [lockedProjectId, onProjectFilterChange, projectFilter, visibleProjects]);

  useEffect(() => {
    setNewTask((current) => {
      if (current.projectId === defaultTaskProjectId) return current;
      if (current.projectId && current.projectId !== lockedProjectId && current.projectId !== projectFilter) return current;
      return { ...current, projectId: defaultTaskProjectId };
    });
  }, [defaultTaskProjectId, lockedProjectId, projectFilter]);

  const projectMap = useMemo(
    () => new Map(visibleProjects.map((project) => [project.id, project])),
    [visibleProjects],
  );
  const assigneeOptions = useMemo(
    () => buildTaskAssigneeOptions(data.subs || [], data.employees || []),
    [data.employees, data.subs],
  );
  const assigneeDirectory = useMemo(
    () => buildTaskAssigneeDirectory(data.subs || [], data.employees || []),
    [data.employees, data.subs],
  );
  const selectionLinksByTaskId = useMemo(() => {
    const links = new Map();
    visibleProjects.forEach((project) => {
      (project.selections || []).forEach((selection) => {
        (selection.taskIds || []).forEach((taskId) => {
          if (!taskId || links.has(taskId)) return;
          links.set(taskId, {
            projectId: project.id,
            selectionId: selection.id,
            label: selection.itemName || selection.chosenOption || 'Selection',
          });
        });
      });
    });
    return links;
  }, [visibleProjects]);

  const filteredTasks = useMemo(() => {
    const tasks =
      effectiveProjectFilter === 'all'
        ? visibleTasks
        : visibleTasks.filter((task) => task.projectId === effectiveProjectFilter);
    const scopedTasks =
      statusFilter === 'open'
        ? tasks.filter((task) => !task.done)
        : statusFilter === 'completed'
          ? tasks.filter((task) => !!task.done)
          : tasks;
    return [...scopedTasks].sort((a, b) => {
      const aProjectName = projectMap.get(a.projectId)?.name || 'No project assigned';
      const bProjectName = projectMap.get(b.projectId)?.name || 'No project assigned';
      if (aProjectName !== bProjectName) return aProjectName.localeCompare(bProjectName);
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      const aKey = a.due || '9999-12-31';
      const bKey = b.due || '9999-12-31';
      if (aKey !== bKey) return aKey < bKey ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  }, [effectiveProjectFilter, projectMap, statusFilter, visibleTasks]);

  const projectScopedTasks = useMemo(
    () =>
      effectiveProjectFilter === 'all'
        ? visibleTasks
        : visibleTasks.filter((task) => task.projectId === effectiveProjectFilter),
    [effectiveProjectFilter, visibleTasks],
  );

  const totals = useMemo(
    () => ({
      total: visibleTasks.length,
      open: visibleTasks.filter((task) => !task.done).length,
      overdue: visibleTasks.filter((task) => isOverdue(task.due, task.done)).length,
      assigned: visibleTasks.filter((task) => task.assignee).length,
    }),
    [visibleTasks],
  );

  const groupedTasks = useMemo(() => {
    if (groupBy !== 'assignee') return [];
    const groups = new Map();
    filteredTasks.forEach((task) => {
      const key = task.assignee?.trim() || 'Unassigned';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(task);
    });
    return [...groups.entries()]
      .sort((a, b) => {
        if (a[0] === 'Unassigned') return 1;
        if (b[0] === 'Unassigned') return -1;
        return a[0].localeCompare(b[0]);
      })
      .map(([label, tasks]) => ({ label, tasks }));
  }, [filteredTasks, groupBy]);

  const openTasksByAssignee = useMemo(() => {
    const groups = new Map();
    projectScopedTasks
      .filter((task) => !task.done)
      .forEach((task) => {
        const key = task.assignee?.trim() || 'Unassigned';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(task);
      });
    groups.forEach((tasks) =>
      tasks.sort((a, b) => {
        const aProjectName = projectMap.get(a.projectId)?.name || 'No project assigned';
        const bProjectName = projectMap.get(b.projectId)?.name || 'No project assigned';
        if (aProjectName !== bProjectName) return aProjectName.localeCompare(bProjectName);
        const aDue = a.due || '9999-12-31';
        const bDue = b.due || '9999-12-31';
        if (aDue !== bDue) return aDue < bDue ? -1 : 1;
        return a.label.localeCompare(b.label);
      }),
    );
    return groups;
  }, [projectMap, projectScopedTasks]);

  function commitTaskState(nextState) {
    dataRef.current = nextState;
    onStateChange(nextState);
  }

  function showTaskSaveMessage(message) {
    if (taskSaveMessageTimerRef.current) {
      window.clearTimeout(taskSaveMessageTimerRef.current);
    }
    setTaskSaveMessage(message);
    taskSaveMessageTimerRef.current = window.setTimeout(() => {
      setTaskSaveMessage('');
      taskSaveMessageTimerRef.current = 0;
    }, 1800);
  }

  function openMailto(email, subject, body) {
    window.location.href = `mailto:${encodeURIComponent(email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  function startEmailDraft({ title, description, email = '', person = null, subject, body }) {
    setEmailDraft({
      title,
      description,
      email,
      subject,
      body,
      saveToPerson: false,
      canSave: !!person?.id,
      personId: person?.id || '',
      personType: person?.directoryType || person?.peopleType || 'emp',
      personLabel: person ? personAssignmentLabel(person) : '',
    });
  }

  async function runTaskMutation(mutation) {
    setSaving(true);
    try {
      const nextState = await mutation(dataRef.current);
      commitTaskState(nextState);
    } finally {
      setSaving(false);
    }
  }

  function appendTaskFiles(currentFiles, fileList) {
    const nextFiles = Array.from(fileList || []);
    if (!nextFiles.length) return currentFiles;
    return [...currentFiles, ...nextFiles];
  }

  async function createTaskAttachmentRecord(projectId, taskId, file) {
    if (!isSupabaseStorageConfigured()) {
      throw new Error('Supabase Storage is not configured for task attachments.');
    }
    const attachmentId = `task-file-${taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const storageProjectId = projectId || 'unassigned-task';
    const storageMeta = await uploadProjectFileToStorage(storageProjectId, 'task-attachments', attachmentId, file);
    return {
      id: attachmentId,
      name: '',
      originalName: file.name,
      size: file.size,
      type: file.type,
      uploadedAt: new Date().toISOString(),
      ...storageMeta,
      dataUrl: '',
    };
  }

  async function createTaskAttachmentRecords(projectId, taskId, files) {
    return Promise.all((files || []).map((file) => createTaskAttachmentRecord(projectId, taskId, file)));
  }

  function openAttachmentPicker(inputRef) {
    const input = inputRef?.current || null;
    if (!input) return;
    input.value = '';
    input.click();
  }

  function handleCreateAttachmentAdd(event) {
    const files = Array.from(event.target.files || []);
    setNewTaskFiles((current) => appendTaskFiles(current, files));
    event.target.value = '';
    setCreateAttachmentInputKey((current) => current + 1);
  }

  function handleEditAttachmentAdd(event) {
    const files = Array.from(event.target.files || []);
    setEditPendingFiles((current) => appendTaskFiles(current, files));
    event.target.value = '';
    setEditAttachmentInputKey((current) => current + 1);
  }

  async function handleDownloadTaskAttachment(attachment) {
    try {
      let blob = null;
      if (attachment?.storagePath && attachment?.storageBucket) {
        blob = await downloadProjectFileFromStorage(attachment);
      } else if (attachment?.dataUrl) {
        blob = await dataUrlToBlob(attachment.dataUrl);
      } else {
        return;
      }
      await downloadBlobForCurrentPlatform(blob, attachment.originalName || attachment.name || 'attachment');
    } catch (error) {
      if (isShareDismissed(error)) return;
      await showAppAlert(error instanceof Error ? error.message : 'Unable to download attachment.', 'Download failed');
    }
  }

  async function handleCreateTask(event) {
    event.preventDefault();
    if (saving || !newTask.label.trim()) return;
    setSaving(true);
    try {
      const targetProjectId = newTask.projectId || defaultTaskProjectId;
      const taskId = `t${Date.now()}`;
      const attachments = await createTaskAttachmentRecords(targetProjectId, taskId, newTaskFiles);
      const nextState = await createTask(dataRef.current, {
        ...newTask,
        projectId: targetProjectId,
        id: taskId,
        attachments,
        createdAt: new Date().toISOString(),
      });
      commitTaskState(nextState);
      setNewTask({ label: '', projectId: defaultTaskProjectId, due: '', assignee: '' });
      setNewTaskFiles([]);
      setCreateAttachmentInputKey((current) => current + 1);
      showTaskSaveMessage('Task saved');
      window.requestAnimationFrame(() => {
        createTaskNameInputRef.current?.focus();
      });
    } catch (error) {
      await showAppAlert(error instanceof Error ? error.message : 'Failed to add task.', 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function startCreateAssignee() {
    setPersonDraft({
      id: '',
      first: '',
      last: '',
      company: '',
      role: '',
      phone: '',
      email: '',
      license: '',
      notes: '',
      tags: '',
      type: 'emp',
    });
  }

  async function handleSaveAssigneePerson() {
    if (!personDraft) return;
    if (!personDraft.first.trim() && !personDraft.last.trim() && !personDraft.company.trim()) return;
    setSaving(true);
    try {
      const nextState = await createPerson(dataRef.current, personDraft.type, personDraft);
      const createdPerson = (personDraft.type === 'sub' ? nextState.subs : nextState.employees)?.at(-1);
      const nextAssignee = createdPerson ? personAssignmentLabel(createdPerson) : '';
      commitTaskState(nextState);
      if (nextAssignee) {
        setNewTask((current) => ({ ...current, assignee: nextAssignee }));
        setEditDraft((current) => ({ ...current, assignee: editingTaskId ? nextAssignee : current.assignee }));
      }
      setPersonDraft(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(task, done) {
    await runTaskMutation((currentState) => updateTask(currentState, task.id, { done }));
  }

  function handleEditStart(task) {
    setEditingTaskId(task.id);
    setEditDraft({
      label: task.label,
      projectId: task.projectId || '',
      due: task.due || '',
      assignee: task.assignee || '',
      attachments: Array.isArray(task.attachments) ? task.attachments : [],
    });
    setEditPendingFiles([]);
  }

  function getTaskSelectionLink(task) {
    if (task?.sourceSelectionId && task?.sourceSelectionProjectId) {
      return {
        projectId: task.sourceSelectionProjectId,
        selectionId: task.sourceSelectionId,
        label: task.sourceSelectionLabel || 'Selection',
      };
    }
    return selectionLinksByTaskId.get(task.id) || null;
  }

  function handleOpenTaskSelection(task) {
    const link = getTaskSelectionLink(task);
    if (!link?.projectId || !link?.selectionId) return;
    onOpenSelection(link);
  }

  useEffect(() => {
    if (!highlightTaskId) return;
    setStatusFilter('all');
    setActiveHighlightTaskId(highlightTaskId);
    const scrollTimer = window.setTimeout(() => {
      taskRowRefs.current[highlightTaskId]?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 80);
    const clearTimer = window.setTimeout(() => {
      setActiveHighlightTaskId((current) => (current === highlightTaskId ? '' : current));
    }, 2400);
    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [highlightTaskId, highlightToken]);

  function handleEditCancel() {
    setEditingTaskId('');
    setEditDraft({ label: '', projectId: '', due: '', assignee: '', attachments: [] });
    setEditPendingFiles([]);
    setEditAttachmentInputKey((current) => current + 1);
  }

  async function handleEditSave(task) {
    if (saving || !editDraft.label.trim()) return;
    setSaving(true);
    try {
      const nextAttachments = [
        ...(editDraft.attachments || []),
        ...(await createTaskAttachmentRecords(editDraft.projectId || task.projectId || '', task.id, editPendingFiles)),
      ];
      const nextState = await updateTask(dataRef.current, task.id, {
        label: editDraft.label.trim(),
        projectId: editDraft.projectId || '',
        due: editDraft.due,
        assignee: editDraft.assignee || '',
        attachments: nextAttachments,
      });
      commitTaskState(nextState);
      handleEditCancel();
    } catch (error) {
      await showAppAlert(error instanceof Error ? error.message : 'Failed to save task.', 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(task) {
    const confirmed = await showAppConfirm(`Delete "${task.label}"?`, {
      title: 'Delete task',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;
    setDeletingTaskId(task.id);
    try {
      await runTaskMutation((currentState) => deleteTask(currentState, task.id));
      if (editingTaskId === task.id) handleEditCancel();
    } finally {
      setDeletingTaskId('');
    }
  }

  async function continueEmailDraft() {
    if (!emailDraft) return;
    const nextEmail = String(emailDraft.email || '').trim();
    setSaving(true);
    try {
      if (nextEmail && emailDraft.saveToPerson && emailDraft.personId) {
        const nextState = await updatePerson(dataRef.current, emailDraft.personType, emailDraft.personId, {
          email: nextEmail,
        });
        commitTaskState(nextState);
      }
      openMailto(nextEmail, emailDraft.subject || '', emailDraft.body || '');
      setEmailDraft(null);
    } catch (error) {
      await showAppAlert(error instanceof Error ? error.message : 'Failed to save email address.', 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function handleEmailTask(task) {
    const assignee = assigneeDirectory.get(task.assignee || '');
    const email = assignee?.email || '';
    const projectName = projectMap.get(task.projectId)?.name || 'Task details';
    const subject = projectName;
    const body = [
      `Project: ${projectName}`,
      `Task: ${task.label}`,
      `Assignee: ${task.assignee || 'Unassigned'}`,
      `Due date: ${task.due ? formatShortDate(task.due) : 'No due date'}`,
      `Status: ${task.done ? 'Completed' : 'Open'}`,
    ].join('\n');
    if (email) {
      openMailto(email, subject, body);
      return;
    }
    startEmailDraft({
      title: `Email ${task.label}`,
      description: task.assignee
        ? `No email is saved for ${task.assignee}. Add one now, or continue without a recipient.`
        : 'No assignee email is saved for this task. Add one now, or continue without a recipient.',
      person: assignee || null,
      subject,
      body,
    });
  }

  function handleEmailAssigneeGroup(assigneeLabel) {
    const assignee = assigneeDirectory.get(assigneeLabel);
    const email = assignee?.email || '';
    const openTasks = openTasksByAssignee.get(assigneeLabel) || [];
    if (!openTasks.length) return;
    const subject =
      effectiveProjectFilter === 'all'
        ? `${assigneeLabel} open tasks`
        : `${projectMap.get(effectiveProjectFilter)?.name || 'Project'} open tasks`;
    const body = [
      `Assignee: ${assigneeLabel}`,
      '',
      'Open tasks:',
      ...openTasks.map((task, index) => {
        const projectName = projectMap.get(task.projectId)?.name || 'No project assigned';
        const dueText = task.due ? formatShortDate(task.due) : 'No due date';
        return `${index + 1}. [${projectName}] ${task.label} - ${dueText}`;
      }),
    ].join('\n');
    if (email) {
      openMailto(email, subject, body);
      return;
    }
    startEmailDraft({
      title: `Email ${assigneeLabel || 'assignee'} tasks`,
      description: assigneeLabel && assigneeLabel !== 'Unassigned'
        ? `No email is saved for ${assigneeLabel}. Add one now, or continue without a recipient.`
        : 'No email is saved for this task group. Add one now, or continue without a recipient.',
      person: assignee || null,
      subject,
      body,
    });
  }

  const taskContent = (
    <>
      <div className="panel-actions task-header-actions">
        <div className="task-toolbar task-toolbar-header">
          <div className="people-view-toggle" role="tablist" aria-label="Task status filter">
            <button
              className={`people-toggle-button${statusFilter === 'all' ? ' active' : ''}`}
              type="button"
              onClick={() => setStatusFilter('all')}
            >
              All
            </button>
            <button
              className={`people-toggle-button${statusFilter === 'open' ? ' active' : ''}`}
              type="button"
              onClick={() => setStatusFilter('open')}
            >
              Open
            </button>
            <button
              className={`people-toggle-button${statusFilter === 'completed' ? ' active' : ''}`}
              type="button"
              onClick={() => setStatusFilter('completed')}
            >
              Completed
            </button>
          </div>
          <label className="task-filter">
            <span>Group by</span>
            <select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
              <option value="none">None</option>
              <option value="assignee">Assignee</option>
            </select>
          </label>
        </div>
      </div>

      <div className="task-summary-strip">
        <div className="project-summary-chip">All tasks {totals.total}</div>
        <div className="project-summary-chip">Open {totals.open}</div>
        <div className="project-summary-chip">Overdue {totals.overdue}</div>
        <div className="project-summary-chip">Assigned {totals.assigned}</div>
        {!embedded ? <div className="project-summary-chip">Projects {visibleProjects.length}</div> : null}
      </div>

      <div className="workspace-control-grid">
        <section className="workspace-section workspace-control-card workspace-control-card-wide">
          <form className="task-create-panel workspace-plain-card" onSubmit={handleCreateTask}>
            <div className="task-create-grid">
              <input
                ref={createTaskNameInputRef}
                className="task-input"
                placeholder="Task name"
                value={newTask.label}
                onChange={(event) => setNewTask((current) => ({ ...current, label: event.target.value }))}
              />
              {lockedProjectId ? (
                <div className="task-input task-input-static">{projectMap.get(lockedProjectId)?.name || 'Project'}</div>
              ) : (
                <select
                  className="task-input"
                  value={newTask.projectId}
                  onChange={(event) => setNewTask((current) => ({ ...current, projectId: event.target.value }))}
                >
                  <option value="">Project...</option>
                  {visibleProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              )}
              <input
                className="task-input"
                type="date"
                value={newTask.due}
                onChange={(event) => setNewTask((current) => ({ ...current, due: event.target.value }))}
              />
              <div className="inline-action-field task-assignee-field">
                <select
                  className="task-input"
                  value={newTask.assignee}
                  onChange={(event) => setNewTask((current) => ({ ...current, assignee: event.target.value }))}
                >
                  <option value="">Assignee...</option>
                  {assigneeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <button className="button secondary" type="button" onClick={startCreateAssignee} disabled={saving}>
                  Add person
                </button>
              </div>
              <button className={`button primary${saving ? ' is-loading' : ''}`} type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Add task'}
              </button>
              <input
                key={createAttachmentInputKey}
                ref={createAttachmentInputRef}
                className="task-attachment-input"
                type="file"
                multiple
                onChange={handleCreateAttachmentAdd}
                disabled={saving}
              />
              {newTaskFiles.length ? (
                <div className="task-attachment-editor task-create-attachments">
                  <div className="task-attachment-editor-header">
                    <strong>Attachments</strong>
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => openAttachmentPicker(createAttachmentInputRef)}
                      disabled={saving}
                    >
                      Add more files
                    </button>
                  </div>
                  <div className="task-attachment-list">
                    {newTaskFiles.map((file, index) => (
                      <div key={`${file.name}-${file.size}-${file.lastModified}-${index}`} className="task-attachment-chip pending">
                        <span>{file.name}</span>
                        <button
                          className="button secondary gantt-icon-button"
                          type="button"
                          onClick={() => setNewTaskFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}
                          disabled={saving}
                          title="Remove pending attachment"
                          aria-label="Remove pending attachment"
                        >
                          <FluentIcon name="delete" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                  <button
                    className="button secondary task-add-attachment-button"
                    type="button"
                    onClick={() => openAttachmentPicker(createAttachmentInputRef)}
                    disabled={saving}
                  >
                    Add attachment
                  </button>
              )}
              <div className={`task-save-notice${taskSaveMessage ? ' visible' : ''}`} aria-live="polite">
                {taskSaveMessage || '\u00A0'}
              </div>
            </div>
          </form>
        </section>

      </div>

      <section className="workspace-section">
        <div className="task-list">
          {filteredTasks.length ? (
            groupBy === 'assignee' ? (
              groupedTasks.map((group) => (
                <section key={group.label} className="task-group">
                  <div className="task-group-header">
                    <h4>{group.label}</h4>
                    <div className="task-group-header-actions">
                      <span>{group.tasks.length}</span>
                      <button
                        className="button secondary gantt-icon-button"
                        type="button"
                        onClick={() => handleEmailAssigneeGroup(group.label)}
                        disabled={saving || !(openTasksByAssignee.get(group.label)?.length)}
                        title={
                          assigneeDirectory.get(group.label)?.email
                            ? 'Email all open tasks to assignee'
                            : 'Add an email or continue without a recipient'
                        }
                        aria-label={`Email open tasks for ${group.label}`}
                      >
                        <FluentIcon name="mail" />
                      </button>
                    </div>
                  </div>
                  {group.tasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      highlighted={activeHighlightTaskId === task.id}
                      rowRef={(node) => {
                        if (node) {
                          taskRowRefs.current[task.id] = node;
                        } else {
                          delete taskRowRefs.current[task.id];
                        }
                      }}
                      task={task}
                      assigneeLabel={task.assignee || ''}
                      assigneeEmail={assigneeDirectory.get(task.assignee || '')?.email || ''}
                      assigneeOptions={assigneeOptions}
                      projectOptions={visibleProjects}
                      projectName={projectMap.get(task.projectId)?.name}
                      selectionLink={getTaskSelectionLink(task)}
                      editingTaskId={editingTaskId}
                      editDraft={editDraft}
                      editPendingFiles={editPendingFiles}
                      onEditStart={handleEditStart}
                      onEditCancel={handleEditCancel}
                      onEditDraftChange={(field, value) =>
                        setEditDraft((current) => ({ ...current, [field]: value }))
                      }
                      editAttachmentInputRef={editAttachmentInputRef}
                      editAttachmentInputKey={editAttachmentInputKey}
                      onOpenEditAttachmentPicker={() => openAttachmentPicker(editAttachmentInputRef)}
                      onEditAttachmentAdd={handleEditAttachmentAdd}
                      onEditAttachmentRemove={(attachmentId) =>
                        setEditDraft((current) => ({
                          ...current,
                          attachments: (current.attachments || []).filter((attachment) => attachment.id !== attachmentId),
                        }))
                      }
                      onEditPendingAttachmentRemove={(index) =>
                        setEditPendingFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))
                      }
                      onEditSave={handleEditSave}
                      onToggle={handleToggle}
                      onEmail={handleEmailTask}
                      onAttachmentDownload={handleDownloadTaskAttachment}
                      onOpenSelection={handleOpenTaskSelection}
                      onDelete={handleDelete}
                      saving={saving}
                      deleting={deletingTaskId === task.id}
                    />
                  ))}
                </section>
              ))
            ) : (
              filteredTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  highlighted={activeHighlightTaskId === task.id}
                  rowRef={(node) => {
                    if (node) {
                      taskRowRefs.current[task.id] = node;
                    } else {
                      delete taskRowRefs.current[task.id];
                    }
                  }}
                  task={task}
                  assigneeLabel={task.assignee || ''}
                  assigneeEmail={assigneeDirectory.get(task.assignee || '')?.email || ''}
                  assigneeOptions={assigneeOptions}
                  projectOptions={visibleProjects}
                  projectName={projectMap.get(task.projectId)?.name}
                  selectionLink={getTaskSelectionLink(task)}
                  editingTaskId={editingTaskId}
                  editDraft={editDraft}
                  editPendingFiles={editPendingFiles}
                  onEditStart={handleEditStart}
                  onEditCancel={handleEditCancel}
                  onEditDraftChange={(field, value) =>
                    setEditDraft((current) => ({ ...current, [field]: value }))
                  }
                  editAttachmentInputRef={editAttachmentInputRef}
                  editAttachmentInputKey={editAttachmentInputKey}
                  onOpenEditAttachmentPicker={() => openAttachmentPicker(editAttachmentInputRef)}
                  onEditAttachmentAdd={handleEditAttachmentAdd}
                  onEditAttachmentRemove={(attachmentId) =>
                    setEditDraft((current) => ({
                      ...current,
                      attachments: (current.attachments || []).filter((attachment) => attachment.id !== attachmentId),
                    }))
                  }
                  onEditPendingAttachmentRemove={(index) =>
                    setEditPendingFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))
                  }
                  onEditSave={handleEditSave}
                  onToggle={handleToggle}
                  onEmail={handleEmailTask}
                  onAttachmentDownload={handleDownloadTaskAttachment}
                  onOpenSelection={handleOpenTaskSelection}
                  onDelete={handleDelete}
                  saving={saving}
                  deleting={deletingTaskId === task.id}
                />
              ))
            )
          ) : (
            <div className="empty-state">
              <h3>No tasks yet</h3>
              <p>{embedded ? 'Create a task above to add the first task for this project.' : 'Create a task above or switch the project filter to see more items.'}</p>
            </div>
          )}
        </div>
      </section>
      {!embedded ? (
        <>
          <PageStats settings={data.settings}>
            <DashboardStat label="All tasks" value={totals.total} tone="brand" />
            <DashboardStat label="Open" value={totals.open} />
            <DashboardStat label="Overdue" value={totals.overdue} />
            <DashboardStat label="Assigned" value={totals.assigned} />
            <DashboardStat label="Projects" value={visibleProjects.length} />
          </PageStats>
          <div className="page-refresh-footer">
            <button className="button secondary" type="button" onClick={refresh} disabled={loading || saving}>
              {loading ? 'Refreshing...' : saving ? 'Saving...' : 'Refresh data'}
            </button>
          </div>
        </>
      ) : null}
      {personDraft ? (
        <PersonModal
          draft={personDraft}
          type={personDraft.type}
          isEditing={false}
          saving={saving}
          showTypeSelector
          onChange={(field, value) => setPersonDraft((current) => (current ? { ...current, [field]: value } : current))}
          onClose={() => setPersonDraft(null)}
          onSave={handleSaveAssigneePerson}
          onDelete={() => {}}
        />
      ) : null}
      <EmailAddressModal
        draft={emailDraft}
        saving={saving}
        onChange={(value) => setEmailDraft((current) => (current ? { ...current, email: value } : current))}
        onToggleSave={(checked) => setEmailDraft((current) => (current ? { ...current, saveToPerson: checked } : current))}
        onClose={() => {
          if (saving) return;
          setEmailDraft(null);
        }}
        onSave={continueEmailDraft}
      />
    </>
  );

  if (embedded) {
    return <div className="project-tasks-embedded">{taskContent}</div>;
  }

  return (
    <section className="panel native-panel workspace-page top-level-tasks-page">
      {taskContent}
    </section>
  );
}

