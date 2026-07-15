import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildTaskAssigneeDirectory, buildTaskAssigneeOptions, getVisibleProjectsForUser, getVisibleTasksForUser, personAssignmentLabel } from '../utils/accessUi.js';
import {
  createPerson, createTask, deleteProjectFileFromStorage, deleteTask, isSupabaseStorageConfigured,
  updatePerson, updateTask, uploadProjectFileToStorage,
} from '../services/trackerData.js';
import { isOverdue } from '../utils/schedule.js';
import { formatShortDate } from '../utils/calendarUi.js';
import { downloadFileWithUi } from '../utils/downloadUi.js';
import { renderModalPortal, showAppAlert, showAppConfirm, showUndoAction } from './AppDialogs.jsx';
const EmailAddressModal = lazy(() => import('./FormDialogs.jsx').then((module) => ({ default: module.EmailAddressModal })));
import FluentIcon from './FluentIcon.jsx';
const PersonModal = lazy(() => import('./PersonModal.jsx'));
import { DashboardStat, PageStats } from './SharedUI.jsx';
import SavedFiltersControls from './SavedFiltersControls.jsx';
import TaskRow from './TaskRow.jsx';
import TaskCreateForm from './TaskCreateForm.jsx';
import ResponsiveFilterMenu from './ResponsiveFilterMenu.jsx';
import { useVirtualRange } from '../utils/virtualization.js';
import { openMailComposer } from '../platform/platformAdapter.js';
import { useEntityMutations } from '../hooks/useEntityMutations.js';
import { formatAssignees, getTaskAssignees, taskAssigneeFields } from '../utils/assignees.js';

function VirtualTaskItem({ taskId, onSize, children }) {
  const itemRef = useRef(null);

  useEffect(() => {
    const element = itemRef.current;
    if (!element) return undefined;
    const measure = () => onSize(taskId, element.offsetHeight + 12);
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [onSize, taskId]);

  return <div ref={itemRef} className="task-virtual-item">{children}</div>;
}

function VirtualTaskRows({ tasks, renderTask, highlightedTaskId = '' }) {
  const scrollRef = useRef(null);
  const sizesRef = useRef(new Map());
  const [sizeRevision, setSizeRevision] = useState(0);
  const getSize = useCallback((index) => sizesRef.current.get(tasks[index]?.id) || 104, [tasks]);
  const range = useVirtualRange({
    count: tasks.length,
    getSize,
    scrollRef,
    threshold: 30,
    revision: sizeRevision,
  });
  const recordSize = useCallback((taskId, size) => {
    if (sizesRef.current.get(taskId) === size) return;
    sizesRef.current.set(taskId, size);
    setSizeRevision((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!highlightedTaskId || !range.virtualized || !scrollRef.current) return;
    const index = tasks.findIndex((task) => task.id === highlightedTaskId);
    if (index < 0) return;
    let offset = 0;
    for (let itemIndex = 0; itemIndex < index; itemIndex += 1) offset += getSize(itemIndex);
    scrollRef.current.scrollTo({ top: Math.max(0, offset - scrollRef.current.clientHeight / 3), behavior: 'smooth' });
  }, [getSize, highlightedTaskId, range.virtualized, tasks]);

  return (
    <div ref={scrollRef} className={`task-virtual-list${range.virtualized ? ' active' : ''}`}>
      {range.beforeSize ? <div className="virtual-list-spacer" style={{ height: `${range.beforeSize}px` }} aria-hidden="true" /> : null}
      {tasks.slice(range.startIndex, range.endIndex).map((task) => (
        <VirtualTaskItem key={task.id} taskId={task.id} onSize={recordSize}>
          {renderTask(task)}
        </VirtualTaskItem>
      ))}
      {range.afterSize ? <div className="virtual-list-spacer" style={{ height: `${range.afterSize}px` }} aria-hidden="true" /> : null}
    </div>
  );
}

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
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [groupBy, setGroupBy] = useState('none');
  const [newTask, setNewTask] = useState({ label: '', projectId: defaultTaskProjectId, due: '', assignees: [] });
  const [mobileCreateTaskOpen, setMobileCreateTaskOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState('');
  const [editDraft, setEditDraft] = useState({ label: '', projectId: '', due: '', assignees: [], attachments: [] });
  const [newTaskFiles, setNewTaskFiles] = useState([]);
  const [editPendingFiles, setEditPendingFiles] = useState([]);
  const [createAttachmentInputKey, setCreateAttachmentInputKey] = useState(0);
  const [editAttachmentInputKey, setEditAttachmentInputKey] = useState(0);
  const [personDraft, setPersonDraft] = useState(null);
  const [emailDraft, setEmailDraft] = useState(null);
  const { runMutation, isMutating } = useEntityMutations();
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

  const projectScopedTasks = useMemo(
    () =>
      effectiveProjectFilter === 'all'
        ? visibleTasks
        : visibleTasks.filter((task) => task.projectId === effectiveProjectFilter),
    [effectiveProjectFilter, visibleTasks],
  );

  const taskAssigneeFilterOptions = useMemo(
    () => [...new Set(
      visibleTasks
        .flatMap((task) => getTaskAssignees(task))
        .filter(Boolean),
    )].sort((left, right) => left.localeCompare(right)),
    [visibleTasks],
  );

  const assigneeScopedTasks = useMemo(() => {
    if (assigneeFilter === 'all') return projectScopedTasks;
    if (assigneeFilter === '__unassigned__') {
      return projectScopedTasks.filter((task) => !getTaskAssignees(task).length);
    }
    return projectScopedTasks.filter((task) => getTaskAssignees(task).includes(assigneeFilter));
  }, [assigneeFilter, projectScopedTasks]);

  const filteredTasks = useMemo(() => {
    const scopedTasks =
      statusFilter === 'open'
        ? assigneeScopedTasks.filter((task) => !task.done)
        : statusFilter === 'completed'
          ? assigneeScopedTasks.filter((task) => !!task.done)
          : assigneeScopedTasks;
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
  }, [assigneeScopedTasks, projectMap, statusFilter]);

  const statusCounts = useMemo(
    () => ({
      all: assigneeScopedTasks.length,
      open: assigneeScopedTasks.filter((task) => !task.done).length,
      completed: assigneeScopedTasks.filter((task) => task.done).length,
    }),
    [assigneeScopedTasks],
  );

  const totals = useMemo(
    () => ({
      total: visibleTasks.length,
      open: visibleTasks.filter((task) => !task.done).length,
      overdue: visibleTasks.filter((task) => isOverdue(task.due, task.done)).length,
      assigned: visibleTasks.filter((task) => getTaskAssignees(task).length).length,
    }),
    [visibleTasks],
  );

  const groupedTasks = useMemo(() => {
    if (groupBy !== 'assignee') return [];
    const groups = new Map();
    filteredTasks.forEach((task) => {
      const keys = getTaskAssignees(task);
      (keys.length ? keys : ['Unassigned']).forEach((key) => {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(task);
      });
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
        const keys = getTaskAssignees(task);
        (keys.length ? keys : ['Unassigned']).forEach((key) => {
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(task);
        });
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
    openMailComposer(email, subject, body);
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

  async function runTaskMutation(key, mutation) {
    return runMutation(key, async () => {
      const nextState = await mutation(dataRef.current);
      commitTaskState(nextState);
      return nextState;
    });
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
    await downloadFileWithUi(attachment, { failureMessage: 'Unable to download attachment.' });
  }

  async function handleCreateTask(event) {
    event.preventDefault();
    if (isMutating('task:create') || !newTask.label.trim()) return;
    await runMutation('task:create', async () => {
      try {
      const targetProjectId = newTask.projectId || defaultTaskProjectId;
      const taskId = `t${Date.now()}`;
      const attachments = await createTaskAttachmentRecords(targetProjectId, taskId, newTaskFiles);
      const nextState = await createTask(dataRef.current, {
        ...newTask,
        ...taskAssigneeFields(newTask.assignees),
        projectId: targetProjectId,
        id: taskId,
        attachments,
        createdAt: new Date().toISOString(),
      });
      commitTaskState(nextState);
      setNewTask({ label: '', projectId: defaultTaskProjectId, due: '', assignees: [] });
      setNewTaskFiles([]);
      setCreateAttachmentInputKey((current) => current + 1);
      setMobileCreateTaskOpen(false);
      showTaskSaveMessage('Task saved');
      window.requestAnimationFrame(() => {
        createTaskNameInputRef.current?.focus();
      });
      } catch (error) {
        await showAppAlert(error instanceof Error ? error.message : 'Failed to add task.', 'Save failed');
      }
    });
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
    await runMutation('person:create-for-task', async () => {
      const nextState = await createPerson(dataRef.current, personDraft.type, personDraft);
      const createdPerson = (personDraft.type === 'sub' ? nextState.subs : nextState.employees)?.at(-1);
      const nextAssignee = createdPerson ? personAssignmentLabel(createdPerson) : '';
      commitTaskState(nextState);
      if (nextAssignee) {
        setNewTask((current) => ({ ...current, assignees: [...new Set([...(current.assignees || []), nextAssignee])] }));
        setEditDraft((current) => ({
          ...current,
          assignees: editingTaskId ? [...new Set([...(current.assignees || []), nextAssignee])] : current.assignees,
        }));
      }
      setPersonDraft(null);
    });
  }

  async function handleToggle(task, done) {
    await runTaskMutation(['task', task.id, 'save'], (currentState) => updateTask(currentState, task.id, { done }));
  }

  function handleEditStart(task) {
    setEditingTaskId(task.id);
    setEditDraft({
      label: task.label,
      projectId: task.projectId || '',
      due: task.due || '',
      assignees: getTaskAssignees(task),
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
    setEditDraft({ label: '', projectId: '', due: '', assignees: [], attachments: [] });
    setEditPendingFiles([]);
    setEditAttachmentInputKey((current) => current + 1);
  }

  async function handleEditSave(task) {
    const mutationKey = ['task', task.id, 'save'];
    if (isMutating(mutationKey) || !editDraft.label.trim()) return;
    await runMutation(mutationKey, async () => {
      try {
      const nextAttachments = [
        ...(editDraft.attachments || []),
        ...(await createTaskAttachmentRecords(editDraft.projectId || task.projectId || '', task.id, editPendingFiles)),
      ];
      const nextState = await updateTask(dataRef.current, task.id, {
        label: editDraft.label.trim(),
        projectId: editDraft.projectId || '',
        due: editDraft.due,
        ...taskAssigneeFields(editDraft.assignees),
        attachments: nextAttachments,
      });
      commitTaskState(nextState);
      handleEditCancel();
      } catch (error) {
        await showAppAlert(error instanceof Error ? error.message : 'Failed to save task.', 'Save failed');
      }
    });
  }

  async function handleDelete(task) {
    const confirmed = await showAppConfirm(`Delete "${task.label}"?`, {
      title: 'Delete task',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;
    await runMutation(['task', task.id, 'delete'], async () => {
      const deletedTask = {
        ...task,
        attachments: [...(task.attachments || [])],
      };
      const nextState = await deleteTask(dataRef.current, task.id, { preserveAttachments: true });
      commitTaskState(nextState);
      showUndoAction({
        message: `Deleted "${task.label}".`,
        onUndo: () => runTaskMutation(['task', task.id, 'restore'], (currentState) => createTask(currentState, deletedTask)),
        onCommit: async () => {
          for (const attachment of deletedTask.attachments) {
            if (attachment?.storagePath) await deleteProjectFileFromStorage(attachment);
          }
        },
      });
      if (editingTaskId === task.id) handleEditCancel();
    });
  }

  async function continueEmailDraft() {
    if (!emailDraft) return;
    const nextEmail = String(emailDraft.email || '').trim();
    await runMutation('task-email:continue', async () => {
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
      }
    });
  }

  function handleEmailTask(task) {
    const taskAssignees = getTaskAssignees(task);
    const people = taskAssignees.map((name) => assigneeDirectory.get(name)).filter(Boolean);
    const emails = [...new Set(people.map((person) => person.email).filter(Boolean))];
    const projectName = projectMap.get(task.projectId)?.name || 'Task details';
    const subject = projectName;
    const body = [
      `Project: ${projectName}`,
      `Task: ${task.label}`,
      `Assignees: ${formatAssignees(taskAssignees)}`,
      `Due date: ${task.due ? formatShortDate(task.due) : 'No due date'}`,
      `Status: ${task.done ? 'Completed' : 'Open'}`,
    ].join('\n');
    if (emails.length) {
      openMailto(emails.join(','), subject, body);
      return;
    }
    const assignee = people[0] || null;
    startEmailDraft({
      title: `Email ${task.label}`,
      description: taskAssignees.length
        ? `No email is saved for ${formatAssignees(taskAssignees)}. Add one now, or continue without a recipient.`
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

  const createSaving = isMutating('task:create');
  const personSaving = isMutating('person:create-for-task');
  const emailSaving = isMutating('task-email:continue');
  const isTaskSaving = (taskId) =>
    isMutating(['task', taskId, 'save']) ||
    isMutating(['task', taskId, 'delete']) ||
    isMutating(['task', taskId, 'restore']);

  const taskContent = (
    <>
      <div className="panel-actions task-header-actions">
        <div className="task-toolbar task-toolbar-header">
          <ResponsiveFilterMenu label="Task filters">
          <div className="people-view-toggle" role="tablist" aria-label="Task status filter">
            <button
              className={`people-toggle-button${statusFilter === 'all' ? ' active' : ''}`}
              type="button"
              onClick={() => setStatusFilter('all')}
            >
              All ({statusCounts.all})
            </button>
            <button
              className={`people-toggle-button${statusFilter === 'open' ? ' active' : ''}`}
              type="button"
              onClick={() => setStatusFilter('open')}
            >
              Open ({statusCounts.open})
            </button>
            <button
              className={`people-toggle-button${statusFilter === 'completed' ? ' active' : ''}`}
              type="button"
              onClick={() => setStatusFilter('completed')}
            >
              Completed ({statusCounts.completed})
            </button>
          </div>
          <label className="task-filter">
            <span>Assignee</span>
            <select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}>
              <option value="all">All assignees</option>
              <option value="__unassigned__">Unassigned</option>
              {taskAssigneeFilterOptions.map((assignee) => (
                <option key={assignee} value={assignee}>{assignee}</option>
              ))}
            </select>
          </label>
          <label className="task-filter">
            <span>Group by</span>
            <select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
              <option value="none">None</option>
              <option value="assignee">Assignee</option>
            </select>
          </label>
          {!embedded && !lockedProjectId ? (
            <SavedFiltersControls
              storageKey={`project-tracker:saved-filters:tasks:${activeUser?.id || 'default'}`}
              currentValue={{ projectId: projectFilter, status: statusFilter, assignee: assigneeFilter, groupBy }}
              onApply={(filter) => {
                onProjectFilterChange(
                  filter.projectId === 'all' || visibleProjects.some((project) => project.id === filter.projectId)
                    ? filter.projectId
                    : 'all',
                );
                setStatusFilter(['open', 'completed'].includes(filter.status) ? filter.status : 'all');
                setAssigneeFilter(
                  filter.assignee === '__unassigned__' || taskAssigneeFilterOptions.includes(filter.assignee)
                    ? filter.assignee
                    : 'all',
                );
                setGroupBy(filter.groupBy === 'assignee' ? 'assignee' : 'none');
              }}
              disabled={false}
            />
          ) : null}
          </ResponsiveFilterMenu>
        </div>
      </div>

      <div className="workspace-control-grid">
        <section className="workspace-section workspace-control-card workspace-control-card-wide">
          <button className="button primary mobile-task-create-trigger" type="button" onClick={() => setMobileCreateTaskOpen(true)}>
            <FluentIcon name="add" />
            Add task
          </button>
          <TaskCreateForm
            task={newTask}
            onTaskChange={(field, value) => setNewTask((current) => ({ ...current, [field]: value }))}
            lockedProjectName={lockedProjectId ? projectMap.get(lockedProjectId)?.name || 'Project' : ''}
            projects={visibleProjects}
            assigneeOptions={assigneeOptions}
            onAddPerson={startCreateAssignee}
            saving={createSaving}
            attachmentInputKey={createAttachmentInputKey}
            attachmentInputRef={createAttachmentInputRef}
            onAttachmentAdd={handleCreateAttachmentAdd}
            files={newTaskFiles}
            onOpenAttachmentPicker={() => openAttachmentPicker(createAttachmentInputRef)}
            onRemoveAttachment={(index) => setNewTaskFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}
            saveMessage={taskSaveMessage}
            nameInputRef={createTaskNameInputRef}
            onSubmit={handleCreateTask}
          />
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
                        disabled={!(openTasksByAssignee.get(group.label)?.length)}
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
                  <VirtualTaskRows
                    tasks={group.tasks}
                    highlightedTaskId={activeHighlightTaskId}
                    renderTask={(task) => (
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
                      assigneeLabel={formatAssignees(getTaskAssignees(task), '')}
                      assigneeEmails={getTaskAssignees(task).map((name) => assigneeDirectory.get(name)?.email).filter(Boolean)}
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
                      saving={isTaskSaving(task.id)}
                      deleting={isMutating(['task', task.id, 'delete'])}
                    />
                    )}
                  />
                </section>
              ))
            ) : (
              <VirtualTaskRows
                tasks={filteredTasks}
                highlightedTaskId={activeHighlightTaskId}
                renderTask={(task) => (
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
                  assigneeLabel={formatAssignees(getTaskAssignees(task), '')}
                  assigneeEmails={getTaskAssignees(task).map((name) => assigneeDirectory.get(name)?.email).filter(Boolean)}
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
                  saving={isTaskSaving(task.id)}
                  deleting={isMutating(['task', task.id, 'delete'])}
                />
                )}
              />
            )
          ) : (
            <div className="empty-state">
              <h3>No matching tasks</h3>
              <p>{embedded ? 'Change the task filters or use Add task to create a task for this project.' : 'Change the project, assignee, or status filters to see more items.'}</p>
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
            <button className="button secondary" type="button" onClick={refresh} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh data'}
            </button>
          </div>
        </>
      ) : null}
      <Suspense fallback={null}>
      {personDraft ? (
        <PersonModal
          draft={personDraft}
          type={personDraft.type}
          isEditing={false}
          saving={personSaving}
          showTypeSelector
          onChange={(field, value) => setPersonDraft((current) => (current ? { ...current, [field]: value } : current))}
          onClose={() => setPersonDraft(null)}
          onSave={handleSaveAssigneePerson}
          onDelete={() => {}}
        />
      ) : null}
      {emailDraft ? <EmailAddressModal
        draft={emailDraft}
        saving={emailSaving}
        onChange={(value) => setEmailDraft((current) => (current ? { ...current, email: value } : current))}
        onToggleSave={(checked) => setEmailDraft((current) => (current ? { ...current, saveToPerson: checked } : current))}
        onClose={() => {
          if (emailSaving) return;
          setEmailDraft(null);
        }}
        onSave={continueEmailDraft}
      /> : null}
      </Suspense>
      {mobileCreateTaskOpen ? renderModalPortal(
        <div className="modal-backdrop task-create-modal-backdrop" onClick={() => { if (!createSaving) setMobileCreateTaskOpen(false); }}>
          <TaskCreateForm
            task={newTask}
            onTaskChange={(field, value) => setNewTask((current) => ({ ...current, [field]: value }))}
            lockedProjectName={lockedProjectId ? projectMap.get(lockedProjectId)?.name || 'Project' : ''}
            projects={visibleProjects}
            assigneeOptions={assigneeOptions}
            onAddPerson={startCreateAssignee}
            saving={createSaving}
            attachmentInputKey={createAttachmentInputKey}
            attachmentInputRef={createAttachmentInputRef}
            onAttachmentAdd={handleCreateAttachmentAdd}
            files={newTaskFiles}
            onOpenAttachmentPicker={() => openAttachmentPicker(createAttachmentInputRef)}
            onRemoveAttachment={(index) => setNewTaskFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}
            saveMessage={taskSaveMessage}
            nameInputRef={createTaskNameInputRef}
            onSubmit={handleCreateTask}
            modal
            onClose={() => { if (!createSaving) setMobileCreateTaskOpen(false); }}
          />
        </div>,
      ) : null}
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
