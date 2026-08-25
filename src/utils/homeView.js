import { buildAuditTrailEntries } from './auditTrail.js';
import { getScheduleAssignees, getTaskAssignees } from './assignees.js';
import { personAssignmentLabel } from './accessUi.js';
import {
  certificateEligible,
  sortCertificatesByExpiration,
  subcontractorComplianceStatus,
  subcontractorCertificateStatus,
  subcontractorLabel,
} from './certificateStatus.js';

export function getLocalIsoDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addLocalDays(value, amount) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + amount);
  return date;
}

function intersectsDate(start, end, dateIso) {
  const first = start || end || '';
  const last = end || start || '';
  return !!first && first <= dateIso && last >= dateIso;
}

function intersectsRange(start, end, rangeStart, rangeEnd) {
  const first = start || end || '';
  const last = end || start || '';
  return !!first && first <= rangeEnd && last >= rangeStart;
}

function isCompleteStatus(value) {
  return ['done', 'complete', 'completed', 'passed', 'approved'].includes(String(value || '').trim().toLowerCase());
}

function isStepComplete(step) {
  return !!step?.done || isCompleteStatus(step?.status);
}

function predecessorRefs(value) {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  return source
    .map((item) => typeof item === 'string'
      ? { id: String(item).trim(), type: 'step' }
      : { id: String(item?.id || '').trim(), type: item?.type === 'inspection' ? 'inspection' : 'step' })
    .filter((item) => item.id);
}

function buildProjectBlockedSteps(project, todayIso) {
  const blocked = [];
  (project?.phases || []).forEach((phase) => {
    if (isCompleteStatus(phase?.status)) return;
    const stepMap = new Map((phase.steps || []).filter((step) => step?.id).map((step) => [String(step.id), step]));
    const inspectionMap = new Map((project.inspections || []).filter((inspection) => inspection?.id).map((inspection) => [String(inspection.id), inspection]));
    (phase.steps || []).forEach((step) => {
      if (isStepComplete(step)) return;
      const delayed = String(step.status || '').toLowerCase() === 'delayed';
      const waitingOnPredecessor = predecessorRefs(step.predecessors).some(({ id, type }) => {
        const predecessor = type === 'inspection' ? inspectionMap.get(id) : stepMap.get(id);
        return predecessor && (type === 'inspection' ? !isCompleteStatus(predecessor.status) : !isStepComplete(predecessor));
      });
      const shouldHaveStarted = !!step.start && step.start <= todayIso;
      if (!delayed && !(waitingOnPredecessor && shouldHaveStarted)) return;
      blocked.push({
        ...step,
        type: 'step',
        label: step.name || 'Schedule step',
        projectId: project.id,
        projectName: project.name || 'Project',
        phaseId: phase.id,
        phaseName: phase.name || 'Phase',
        attentionKind: delayed ? 'Delayed' : 'Blocked',
      });
    });
  });
  return blocked;
}

function compareItems(left, right) {
  return `${left.projectName || ''}\u0000${left.label || ''}`.localeCompare(
    `${right.projectName || ''}\u0000${right.label || ''}`,
  );
}

export function buildHomeDaySummary(projects = [], tasks = [], dateIso = '') {
  const projectNames = new Map((projects || []).map((project) => [project.id, project.name || 'Project']));
  const inspections = [];
  const scheduleItems = [];

  (projects || []).forEach((project) => {
    (project.inspections || []).forEach((inspection) => {
      if (inspection.date !== dateIso) return;
      inspections.push({
        ...inspection,
        type: 'inspection',
        label: inspection.subcode || inspection.inspectionType || 'Inspection',
        projectId: project.id,
        projectName: project.name || 'Project',
      });
    });

    (project.phases || []).forEach((phase) => {
      if (intersectsDate(phase.start, phase.end, dateIso)) {
        scheduleItems.push({
          ...phase,
          type: 'phase',
          label: phase.name || 'Phase',
          projectId: project.id,
          projectName: project.name || 'Project',
        });
      }
      (phase.steps || []).forEach((step) => {
        if (!intersectsDate(step.start, step.end, dateIso)) return;
        scheduleItems.push({
          ...step,
          type: 'step',
          label: step.name || 'Schedule step',
          projectId: project.id,
          projectName: project.name || 'Project',
          phaseId: phase.id,
          phaseName: phase.name || 'Phase',
        });
      });
    });
  });

  const openTasks = (tasks || [])
    .filter((task) => !task.done && task.due === dateIso)
    .map((task) => ({
      ...task,
      type: 'task',
      label: task.label || 'Task',
      projectName: task.projectId ? projectNames.get(task.projectId) || 'Project' : 'General',
    }));

  return {
    inspections: inspections.sort(compareItems),
    openTasks: openTasks.sort(compareItems),
    scheduleItems: scheduleItems.sort(compareItems),
  };
}

export function buildHomeRangeSummary(projects = [], tasks = [], rangeStart = '', rangeEnd = rangeStart) {
  const projectNames = new Map((projects || []).map((project) => [project.id, project.name || 'Project']));
  const inspections = [];
  const scheduleItems = [];

  (projects || []).forEach((project) => {
    (project.inspections || []).forEach((inspection) => {
      if (!inspection.date || inspection.date < rangeStart || inspection.date > rangeEnd || isCompleteStatus(inspection.status)) return;
      inspections.push({
        ...inspection,
        type: 'inspection',
        label: inspection.subcode || inspection.inspectionType || 'Inspection',
        projectId: project.id,
        projectName: project.name || 'Project',
      });
    });
    (project.phases || []).forEach((phase) => {
      if (intersectsRange(phase.start, phase.end, rangeStart, rangeEnd) && !isCompleteStatus(phase.status)) {
        scheduleItems.push({
          ...phase,
          type: 'phase',
          label: phase.name || 'Phase',
          projectId: project.id,
          projectName: project.name || 'Project',
        });
      }
      (phase.steps || []).forEach((step) => {
        if (!intersectsRange(step.start, step.end, rangeStart, rangeEnd) || isStepComplete(step)) return;
        scheduleItems.push({
          ...step,
          type: 'step',
          label: step.name || 'Schedule step',
          projectId: project.id,
          projectName: project.name || 'Project',
          phaseId: phase.id,
          phaseName: phase.name || 'Phase',
        });
      });
    });
  });

  const openTasks = (tasks || [])
    .filter((task) => !task.done && task.due && task.due >= rangeStart && task.due <= rangeEnd)
    .map((task) => ({
      ...task,
      type: 'task',
      label: task.label || 'Task',
      projectName: task.projectId ? projectNames.get(task.projectId) || 'Project' : 'General',
    }));

  const byDateThenName = (left, right) => {
    const leftDate = left.due || left.date || left.start || '';
    const rightDate = right.due || right.date || right.start || '';
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    return compareItems(left, right);
  };
  return {
    inspections: inspections.sort(byDateThenName),
    openTasks: openTasks.sort(byDateThenName),
    scheduleItems: scheduleItems.sort(byDateThenName),
  };
}

function normalizeIdentity(value) {
  return String(value || '').trim().toLowerCase();
}

function activeUserAssignmentLabels(activeUser = null, people = []) {
  const userName = normalizeIdentity(activeUser?.name);
  const userEmail = normalizeIdentity(activeUser?.email);
  const labels = new Set(
    (people || [])
      .filter((person) => userEmail && normalizeIdentity(person?.email) === userEmail)
      .map((person) => normalizeIdentity(personAssignmentLabel(person)))
      .filter(Boolean),
  );
  if (userName) labels.add(userName);
  if (userEmail) labels.add(userEmail);
  return { labels, userName };
}

function belongsToActiveUser(assignees = [], activeUser = null, people = []) {
  if (activeUser?.role === 'Admin') return true;
  const { labels, userName } = activeUserAssignmentLabels(activeUser, people);
  return (assignees || []).some((assignee) => {
    const normalized = normalizeIdentity(assignee);
    if (labels.has(normalized)) return true;
    return userName && (normalized === userName || normalized.startsWith(`${userName} (`));
  });
}

export function buildHomeOpenTasks(tasks = [], projects = [], activeUser = null, people = []) {
  const projectNames = new Map((projects || []).map((project) => [project.id, project.name || 'Project']));

  return (tasks || [])
    .filter((task) => !task.done && belongsToActiveUser(getTaskAssignees(task), activeUser, people))
    .map((task) => ({
      ...task,
      type: 'task',
      label: task.label || 'Task',
      projectName: task.projectId ? projectNames.get(task.projectId) || 'Project' : 'General',
    }))
    .sort((left, right) => {
      const leftDue = left.due || '9999-12-31';
      const rightDue = right.due || '9999-12-31';
      if (leftDue !== rightDue) return leftDue.localeCompare(rightDue);
      return compareItems(left, right);
    });
}

export function buildMyDaySummary(
  projects = [],
  scopedTasks = [],
  activeUser = null,
  people = [],
  todayIso = getLocalIsoDate(),
) {
  const today = buildHomeRangeSummary(projects, scopedTasks, todayIso, todayIso);
  const attention = buildHomeAttentionSummary(projects, scopedTasks, todayIso, []);
  const scheduleForUser = (item) => belongsToActiveUser(getScheduleAssignees(item), activeUser, people);
  const byDateThenName = (left, right) => {
    const leftDate = left.due || left.date || left.start || '';
    const rightDate = right.due || right.date || right.start || '';
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    return compareItems(left, right);
  };
  const overdueItems = [
    ...attention.overdueTasks,
    ...attention.overdueInspections,
    ...attention.blockedSteps.filter(scheduleForUser),
  ].sort(byDateThenName);

  return {
    tasks: today.openTasks,
    inspections: today.inspections,
    scheduleItems: today.scheduleItems.filter(scheduleForUser),
    overdueItems,
  };
}

export function buildHomeAttentionSummary(projects = [], scopedTasks = [], todayIso = '', allVisibleTasks = scopedTasks) {
  const projectNames = new Map((projects || []).map((project) => [project.id, project.name || 'Project']));
  const overdueTasks = (scopedTasks || [])
    .filter((task) => !task.done && task.due && task.due < todayIso)
    .map((task) => ({
      ...task,
      type: 'task',
      label: task.label || 'Task',
      projectName: task.projectId ? projectNames.get(task.projectId) || 'Project' : 'General',
      attentionKind: 'Overdue',
    }));
  const unassignedTasks = (allVisibleTasks || [])
    .filter((task) => !task.done && getTaskAssignees(task).length === 0)
    .map((task) => ({
      ...task,
      type: 'task',
      label: task.label || 'Task',
      projectName: task.projectId ? projectNames.get(task.projectId) || 'Project' : 'General',
      attentionKind: 'Unassigned',
    }));
  const overdueInspections = [];
  const blockedSteps = [];
  (projects || []).forEach((project) => {
    (project.inspections || []).forEach((inspection) => {
      if (!inspection.date || inspection.date >= todayIso || isCompleteStatus(inspection.status)) return;
      overdueInspections.push({
        ...inspection,
        type: 'inspection',
        label: inspection.subcode || inspection.inspectionType || 'Inspection',
        projectId: project.id,
        projectName: project.name || 'Project',
        attentionKind: 'Overdue',
      });
    });
    if (!isCompleteStatus(project?.status)) {
      blockedSteps.push(...buildProjectBlockedSteps(project, todayIso));
    }
  });

  const byDueDate = (left, right) => {
    const leftDate = left.due || left.date || left.start || '';
    const rightDate = right.due || right.date || right.start || '';
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    return compareItems(left, right);
  };
  return {
    overdueTasks: overdueTasks.sort(byDueDate),
    overdueInspections: overdueInspections.sort(byDueDate),
    blockedSteps: blockedSteps.sort(byDueDate),
    unassignedTasks: unassignedTasks.sort(byDueDate),
  };
}

function actionOwner(item) {
  if (item.type === 'task') return getTaskAssignees(item).join(', ') || 'Unassigned';
  if (item.type === 'step' || item.type === 'phase') {
    return getScheduleAssignees(item).join(', ') || 'Unassigned';
  }
  if (item.type === 'inspection') return String(item.agency || '').trim() || 'Unassigned';
  if (item.type === 'certificate') return item.ownerLabel || 'Unassigned';
  if (item.type === 'selection' || item.type === 'portal') return item.ownerLabel || 'Unassigned';
  if (item.type === 'rfi' || item.type === 'submittal') return item.ownerLabel || 'Unassigned';
  if (['change-order', 'budget', 'commitment', 'budget-summary'].includes(item.type)) {
    return item.ownerLabel || 'Unassigned';
  }
  if (item.type === 'warranty' || item.type === 'closeout') return item.ownerLabel || 'Unassigned';
  if (item.type === 'offline-sync') return item.ownerLabel || 'You';
  return 'Unassigned';
}

function actionStatus(item) {
  if (item.type === 'task') return item.done ? 'Complete' : 'Open';
  if (item.type === 'step') return item.attentionKind || item.status || 'Blocked';
  return item.status || 'Open';
}

export function buildHomeActionCenterItems(attention = {}) {
  const sources = [
    {
      items: attention.offlineSyncExceptions,
      reason: 'Device-saved change failed to sync',
      tone: 'danger',
      rank: 0,
    },
    { items: attention.overdueTasks, reason: 'Task is past due', tone: 'danger', rank: 0 },
    { items: attention.overdueInspections, reason: 'Inspection is past due', tone: 'danger', rank: 1 },
    {
      items: attention.overdueDocuments,
      reason: (item) => item.attentionReason,
      tone: 'danger',
      rank: 1,
    },
    {
      items: attention.financialExceptions,
      reason: (item) => item.attentionReason,
      tone: (item) => item.attentionTone || 'danger',
      rank: (item) => item.attentionRank ?? 2,
    },
    {
      items: attention.warrantyCloseoutExceptions,
      reason: (item) => item.attentionReason,
      tone: 'danger',
      rank: 1,
    },
    {
      items: attention.pendingDecisions,
      reason: (item) => item.attentionReason,
      tone: (item) => item.attentionTone,
      rank: (item) => item.attentionRank,
    },
    {
      items: attention.certificateExceptions,
      reason: (item) => item.attentionReason,
      tone: (item) => item.attentionTone,
      rank: (item) => item.attentionRank,
    },
    { items: attention.blockedSteps, reason: 'Schedule is blocked or delayed', tone: 'warning', rank: 4 },
    { items: attention.unassignedTasks, reason: 'Work has no owner', tone: 'neutral', rank: 5 },
  ];
  const actionsBySource = new Map();

  sources.forEach(({ items = [], reason, tone, rank }) => {
    items.forEach((item) => {
      const itemReason = typeof reason === 'function' ? reason(item) : reason;
      const itemTone = typeof tone === 'function' ? tone(item) : tone;
      const itemRank = typeof rank === 'function' ? rank(item) : rank;
      const sourceKey = `${item.type}-${item.projectId || 'general'}-${item.id}`;
      const current = actionsBySource.get(sourceKey);
      if (current) {
        current.reasons.push(itemReason);
        current.reason = current.reasons.join(' · ');
        current.rank = Math.min(current.rank, itemRank);
        if (itemTone === 'danger') current.tone = itemTone;
        return;
      }
      actionsBySource.set(sourceKey, {
        sourceKey,
        item,
        label: item.label || 'Work item',
        projectName: item.projectName || 'General',
        owner: actionOwner(item),
        dueDate: item.due || item.date || item.start || '',
        reasons: [itemReason],
        reason: itemReason,
        status: actionStatus(item),
        tone: itemTone,
        rank: itemRank,
      });
    });
  });

  return [...actionsBySource.values()].sort((left, right) => {
    const leftDate = left.dueDate || '9999-12-31';
    const rightDate = right.dueDate || '9999-12-31';
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    if (left.rank !== right.rank) return left.rank - right.rank;
    return `${left.projectName}\u0000${left.label}`.localeCompare(`${right.projectName}\u0000${right.label}`);
  });
}

export function buildHomeCertificateExceptions(
  subcontractors = [],
  certificates = [],
  todayIso = getLocalIsoDate(),
  complianceDocuments = [],
) {
  const certificatesBySubcontractor = new Map();
  (certificates || []).forEach((certificate) => {
    const subcontractorId = String(certificate?.subcontractorId || '').trim();
    if (!subcontractorId) return;
    if (!certificatesBySubcontractor.has(subcontractorId)) certificatesBySubcontractor.set(subcontractorId, []);
    certificatesBySubcontractor.get(subcontractorId).push(certificate);
  });

  const exceptions = (subcontractors || [])
    .filter(certificateEligible)
    .map((subcontractor) => {
      const subcontractorCertificates = sortCertificatesByExpiration(certificatesBySubcontractor.get(subcontractor.id) || []);
      const latestCertificate = subcontractorCertificates[0] || null;
      const status = subcontractorCertificateStatus(subcontractor, subcontractorCertificates, todayIso);
      if (!['expired', 'expiring', 'missing'].includes(status.id)) return null;
      const reasonByStatus = {
        expired: 'Certificate is expired',
        expiring: 'Certificate expires within 30 days',
        missing: latestCertificate ? 'Certificate expiration is missing' : 'Required certificate is missing',
      };
      return {
        id: latestCertificate?.id || `missing-${subcontractor.id}`,
        type: 'certificate',
        label: 'Insurance certificate',
        projectName: 'Portfolio',
        projectId: '',
        subcontractorId: subcontractor.id,
        hasCertificate: Boolean(latestCertificate),
        ownerLabel: subcontractorLabel(subcontractor),
        expirationDate: latestCertificate?.expirationDate || '',
        due: latestCertificate?.expirationDate || '',
        status: status.label,
        statusId: status.id,
        attentionReason: reasonByStatus[status.id],
        attentionTone: status.id === 'expiring' ? 'warning' : 'danger',
        attentionRank: status.id === 'expired' ? 2 : status.id === 'missing' ? 3 : 4,
      };
    })
    .filter(Boolean);

  const expiring = exceptions.filter((item) => item.statusId === 'expired' || item.statusId === 'expiring');
  const missing = exceptions.filter((item) => item.statusId === 'missing');
  const aggregateItems = [];

  if (expiring.length) {
    const expiredCount = expiring.filter((item) => item.statusId === 'expired').length;
    const expiringCount = expiring.length - expiredCount;
    const reasons = [];
    if (expiredCount) reasons.push(`${expiredCount} expired`);
    if (expiringCount) reasons.push(`${expiringCount} expiring within 30 days`);
    const dueDates = expiring.map((item) => item.due).filter(Boolean).sort();
    aggregateItems.push({
      id: 'expired-expiring',
      type: 'certificate',
      label: 'Expired / expiring certificates',
      projectName: 'Portfolio',
      projectId: '',
      ownerLabel: `${expiring.length} subcontractor${expiring.length === 1 ? '' : 's'}`,
      due: dueDates[0] || '',
      status: reasons.join(' · '),
      statusId: 'expired-expiring',
      attentionReason: `${expiring.length} certificate${expiring.length === 1 ? ' needs' : 's need'} attention`,
      attentionTone: expiredCount ? 'danger' : 'warning',
      attentionRank: expiredCount ? 2 : 4,
      certificateCount: expiring.length,
    });
  }

  if (missing.length) {
    const missingCertificateCount = missing.filter((item) => !item.hasCertificate).length;
    const missingExpirationCount = missing.length - missingCertificateCount;
    const reasons = [];
    if (missingCertificateCount) reasons.push(`${missingCertificateCount} certificate${missingCertificateCount === 1 ? '' : 's'} missing`);
    if (missingExpirationCount) reasons.push(`${missingExpirationCount} expiration date${missingExpirationCount === 1 ? '' : 's'} missing`);
    aggregateItems.push({
      id: 'missing',
      type: 'certificate',
      label: 'Missing certificates',
      projectName: 'Portfolio',
      projectId: '',
      ownerLabel: `${missing.length} subcontractor${missing.length === 1 ? '' : 's'}`,
      due: '',
      status: reasons.join(' · '),
      statusId: 'missing',
      attentionReason: `${missing.length} certificate record${missing.length === 1 ? ' needs' : 's need'} attention`,
      attentionTone: 'danger',
      attentionRank: 3,
      certificateCount: missing.length,
    });
  }

  const documentsBySubcontractor = new Map();
  (complianceDocuments || []).forEach((document) => {
    const subcontractorId = String(document?.subcontractorId || '').trim();
    if (!subcontractorId) return;
    if (!documentsBySubcontractor.has(subcontractorId)) documentsBySubcontractor.set(subcontractorId, []);
    documentsBySubcontractor.get(subcontractorId).push(document);
  });
  const missingDocuments = (subcontractors || [])
    .filter(certificateEligible)
    .flatMap((subcontractor) => {
      const status = subcontractorComplianceStatus(
        subcontractor,
        certificatesBySubcontractor.get(subcontractor.id) || [],
        documentsBySubcontractor.get(subcontractor.id) || [],
        todayIso,
      );
      return status.missing
        .filter((requirement) => ['subcontractor_agreement', 'w9'].includes(requirement.id))
        .map((requirement) => ({ subcontractor, requirement }));
    });
  if (missingDocuments.length) {
    const agreementCount = missingDocuments.filter((item) => item.requirement.id === 'subcontractor_agreement').length;
    const w9Count = missingDocuments.length - agreementCount;
    const affectedSubcontractors = new Set(missingDocuments.map((item) => item.subcontractor.id));
    const reasons = [];
    if (agreementCount) reasons.push(`${agreementCount} agreement${agreementCount === 1 ? '' : 's'} missing`);
    if (w9Count) reasons.push(`${w9Count} ${w9Count === 1 ? 'Form W-9' : 'Forms W-9'} missing`);
    aggregateItems.push({
      id: 'missing-compliance-documents',
      type: 'certificate',
      label: 'Missing compliance documents',
      projectName: 'Portfolio',
      projectId: '',
      ownerLabel: `${affectedSubcontractors.size} subcontractor${affectedSubcontractors.size === 1 ? '' : 's'}`,
      due: '',
      status: reasons.join(' Â· '),
      statusId: 'needs-attention',
      attentionReason: `${missingDocuments.length} required document${missingDocuments.length === 1 ? ' needs' : 's need'} attention`,
      attentionTone: 'danger',
      attentionRank: 3,
      certificateCount: missingDocuments.length,
    });
  }

  return aggregateItems;
}

function portalAudienceOwner(audience) {
  if (audience === 'customer') return 'Customer';
  if (audience === 'subcontractor') return 'Subcontractor';
  return 'Customers and subcontractors';
}

function newestPortalItemBySelection(portalItems = []) {
  const result = new Map();
  [...portalItems]
    .sort((left, right) => String(right?.updatedAt || '').localeCompare(String(left?.updatedAt || '')))
    .forEach((item) => {
      const selectionId = String(item?.selectionId || '').trim();
      if (!selectionId || item?.itemType !== 'approval' || result.has(selectionId)) return;
      result.set(selectionId, item);
    });
  return result;
}

export function buildHomePendingDecisionExceptions(
  projects = [],
  portalItems = [],
  todayIso = getLocalIsoDate(),
  { includeSelections = true } = {},
) {
  const projectNames = new Map((projects || []).map((project) => [project.id, project.name || 'Project']));
  const latestApprovalBySelection = newestPortalItemBySelection(portalItems);
  const representedPortalIds = new Set();
  const selectionItems = [];

  if (includeSelections) {
    (projects || []).forEach((project) => {
      (project?.selections || []).forEach((selection) => {
        if (String(selection?.status || 'needs decision').trim().toLowerCase() !== 'needs decision') return;
        const approval = latestApprovalBySelection.get(String(selection.id));
        const approvalPending = approval?.status === 'response_requested';
        if (approvalPending) representedPortalIds.add(approval.id);
        selectionItems.push({
          id: selection.id,
          type: 'selection',
          label: selection.itemName || 'Selection',
          projectId: project.id,
          projectName: project.name || 'Project',
          ownerLabel: approvalPending ? portalAudienceOwner(approval.audience) : 'Unassigned',
          due: approvalPending ? approval.dueDate || '' : '',
          status: approvalPending ? 'Response requested' : 'Needs decision',
          attentionReason: approvalPending ? 'Customer approval is pending' : 'Selection needs a decision',
          attentionTone: approvalPending && approval.dueDate && approval.dueDate < todayIso ? 'danger' : 'warning',
          attentionRank: approvalPending && approval.dueDate && approval.dueDate < todayIso ? 2 : 4,
          portalItemId: approvalPending ? approval.id : '',
        });
      });
    });
  }

  const portalActionItems = (portalItems || [])
    .filter((item) => item?.status === 'response_requested' && !representedPortalIds.has(item.id))
    .filter((item) => {
      const selectionId = String(item?.selectionId || '').trim();
      if (!selectionId || item?.itemType !== 'approval') return true;
      return latestApprovalBySelection.get(selectionId)?.id === item.id;
    })
    .filter((item) => projectNames.has(item.projectId))
    .map((item) => {
      const overdue = !!item.dueDate && item.dueDate < todayIso;
      return {
        ...item,
        type: 'portal',
        label: item.title || item.number || 'Portal request',
        projectName: projectNames.get(item.projectId) || 'Project',
        ownerLabel: portalAudienceOwner(item.audience),
        due: item.dueDate || '',
        status: 'Response requested',
        attentionReason: overdue ? 'Portal response is overdue' : 'Portal response is pending',
        attentionTone: overdue ? 'danger' : 'warning',
        attentionRank: overdue ? 2 : 4,
      };
    });

  return [...selectionItems, ...portalActionItems];
}

export function buildHomeOverdueDocumentExceptions(
  projects = [],
  rfis = [],
  submittals = [],
  todayIso = getLocalIsoDate(),
) {
  const projectNames = new Map((projects || []).map((project) => [project.id, project.name || 'Project']));
  const overdueRfis = (rfis || [])
    .filter((item) => item?.dueDate && item.dueDate < todayIso && item.status === 'open')
    .filter((item) => projectNames.has(item.projectId))
    .map((item) => ({
      ...item,
      type: 'rfi',
      label: [item.number, item.title].filter(Boolean).join(' · ') || 'RFI',
      projectName: projectNames.get(item.projectId) || 'Project',
      ownerLabel: String(item.responsibleName || '').trim() || 'Unassigned',
      due: item.dueDate,
      attentionReason: 'RFI response is overdue',
    }));
  const actionableSubmittalStatuses = new Set(['submitted', 'under_review', 'revise_resubmit', 'rejected']);
  const overdueSubmittals = (submittals || [])
    .filter((item) => item?.dueDate && item.dueDate < todayIso && actionableSubmittalStatuses.has(item.status))
    .filter((item) => projectNames.has(item.projectId))
    .map((item) => {
      const needsResubmission = ['revise_resubmit', 'rejected'].includes(item.status);
      return {
        ...item,
        type: 'submittal',
        label: [item.number, item.title].filter(Boolean).join(' · ') || 'Submittal',
        projectName: projectNames.get(item.projectId) || 'Project',
        ownerLabel: needsResubmission
          ? String(item.subcontractorName || '').trim() || 'Unassigned'
          : String(item.reviewer || '').trim() || 'Unassigned',
        due: item.dueDate,
        attentionReason: needsResubmission ? 'Submittal resubmission is overdue' : 'Submittal review is overdue',
      };
    });
  return [...overdueRfis, ...overdueSubmittals];
}

function workflowNumberLabel(item, fallback) {
  return [item?.number, item?.title].filter(Boolean).join(' · ') || fallback;
}

function numericAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

export function buildHomeFinancialExceptions(
  projects = [],
  changeOrders = [],
  budgetItems = [],
  commitments = [],
  todayIso = getLocalIsoDate(),
) {
  const projectNames = new Map((projects || []).map((project) => [project.id, project.name || 'Project']));
  const visibleRecord = (item) => projectNames.has(item?.projectId);
  const exceptions = (changeOrders || [])
    .filter((item) => visibleRecord(item) && item.status === 'proposed' && item.dueDate && item.dueDate < todayIso)
    .map((item) => ({
      ...item,
      type: 'change-order',
      label: workflowNumberLabel(item, 'Change order'),
      projectName: projectNames.get(item.projectId),
      ownerLabel: 'Unassigned',
      due: item.dueDate,
      attentionReason: 'Change-order response is overdue',
      attentionTone: 'danger',
      attentionRank: 1,
    }));

  (budgetItems || [])
    .filter((item) => visibleRecord(item) && item.status === 'active')
    .forEach((item) => {
      const currentBudget = numericAmount(item.originalBudget) + numericAmount(item.approvedChanges);
      const shared = {
        ...item,
        type: 'budget',
        label: workflowNumberLabel(item, 'Budget item'),
        projectName: projectNames.get(item.projectId),
        ownerLabel: 'Unassigned',
        status: 'over_budget',
        attentionTone: 'danger',
        attentionRank: 3,
      };
      if (numericAmount(item.actualCost) > currentBudget) {
        exceptions.push({ ...shared, attentionReason: 'Actual cost exceeds current budget' });
      }
      if (numericAmount(item.forecastCost) > currentBudget) {
        exceptions.push({ ...shared, attentionReason: 'Forecast exceeds current budget' });
      }
    });

  const activeCommitmentStatuses = new Set(['approved', 'issued', 'complete']);
  (commitments || [])
    .filter((item) => visibleRecord(item) && activeCommitmentStatuses.has(item.status))
    .forEach((item) => {
      const shared = {
        ...item,
        type: 'commitment',
        label: workflowNumberLabel(item, 'Commitment'),
        projectName: projectNames.get(item.projectId),
        ownerLabel: String(item.vendorName || '').trim() || 'Unassigned',
        attentionTone: 'danger',
        attentionRank: 3,
      };
      if (['approved', 'issued'].includes(item.status) && item.endDate && item.endDate < todayIso) {
        exceptions.push({ ...shared, due: item.endDate, attentionReason: 'Commitment is past its end date' });
      }
      if (numericAmount(item.paidAmount) > numericAmount(item.committedAmount)) {
        exceptions.push({ ...shared, status: 'overpaid', attentionReason: 'Payments exceed committed amount' });
      }
    });

  (projects || []).forEach((project) => {
    const projectBudgetItems = (budgetItems || []).filter((item) => item.projectId === project.id);
    const projectCommitments = (commitments || []).filter((item) => item.projectId === project.id && item.status !== 'void');
    const currentBudget = projectBudgetItems.reduce(
      (sum, item) => sum + numericAmount(item.originalBudget) + numericAmount(item.approvedChanges),
      0,
    );
    const committed = projectCommitments.reduce((sum, item) => sum + numericAmount(item.committedAmount), 0);
    if (committed <= currentBudget || committed <= 0) return;
    exceptions.push({
      id: `budget-summary-${project.id}`,
      type: 'budget-summary',
      label: 'Budget commitments',
      projectId: project.id,
      projectName: project.name || 'Project',
      ownerLabel: 'Unassigned',
      status: 'overcommitted',
      attentionReason: 'Commitments exceed current budget',
      attentionTone: 'danger',
      attentionRank: 3,
    });
  });

  return exceptions;
}

export function buildHomeWarrantyCloseoutExceptions(
  projects = [],
  warrantyItems = [],
  closeoutItems = [],
  todayIso = getLocalIsoDate(),
) {
  const projectNames = new Map((projects || []).map((project) => [project.id, project.name || 'Project']));
  const visibleRecord = (item) => projectNames.has(item?.projectId);
  const actionableWarrantyStatuses = new Set(['open', 'scheduled', 'in_progress']);
  const overdueWarranty = (warrantyItems || [])
    .filter((item) => visibleRecord(item) && actionableWarrantyStatuses.has(item.status))
    .filter((item) => item.dueDate && item.dueDate < todayIso)
    .map((item) => ({
      ...item,
      type: 'warranty',
      label: workflowNumberLabel(item, 'Warranty item'),
      projectName: projectNames.get(item.projectId),
      ownerLabel: String(item.responsibleName || '').trim() || 'Unassigned',
      due: item.dueDate,
      attentionReason: 'Warranty target date is overdue',
    }));
  const actionableCloseoutStatuses = new Set(['not_started', 'in_progress', 'blocked']);
  const overdueCloseout = (closeoutItems || [])
    .filter((item) => visibleRecord(item) && item.required !== false && actionableCloseoutStatuses.has(item.status))
    .filter((item) => item.dueDate && item.dueDate < todayIso)
    .map((item) => ({
      ...item,
      type: 'closeout',
      label: workflowNumberLabel(item, 'Closeout item'),
      projectName: projectNames.get(item.projectId),
      ownerLabel: String(item.responsibleName || '').trim() || 'Unassigned',
      due: item.dueDate,
      attentionReason: item.category === 'Punch list'
        ? 'Punch-list deadline is overdue'
        : 'Closeout deadline is overdue',
    }));
  return [...overdueWarranty, ...overdueCloseout];
}

export function buildHomeOfflineSyncExceptions(
  projects = [],
  operations = [],
  ownerLabel = 'You',
) {
  const projectNames = new Map((projects || []).map((project) => [project.id, project.name || 'Project']));
  return (operations || [])
    .filter((operation) => operation?.status === 'needs-attention' && projectNames.has(operation.projectId))
    .map((operation) => {
      const record = operation.payload || {};
      let fallback = 'Device-saved change';
      if (operation.kind === 'daily-log.save') fallback = record.date || record.title || 'Daily log';
      else if (operation.kind === 'task.save') fallback = record.label || 'Task';
      else if (operation.kind === 'warranty-item.save') fallback = workflowNumberLabel(record, 'Warranty item');
      else if (operation.kind === 'inspection.save') fallback = record.subcode || record.inspectionType || 'Inspection';
      return {
        id: operation.id,
        type: 'offline-sync',
        label: operation.action === 'delete' ? `Delete ${fallback}` : fallback,
        projectId: operation.projectId,
        projectName: projectNames.get(operation.projectId),
        ownerLabel: String(ownerLabel || '').trim() || 'You',
        status: 'Needs attention',
        operationKind: operation.kind,
        entityId: operation.entityId,
      };
    });
}

export function getProjectOperationalHealth(project, tasks = [], todayIso = getLocalIsoDate()) {
  if (String(project?.status || '').toLowerCase() === 'done') {
    return { label: 'Completed', tone: 'done', issueCount: 0 };
  }
  const projectTasks = (tasks || []).filter((task) => task.projectId === project?.id && !task.done);
  const overdueTaskCount = projectTasks.filter((task) => task.due && task.due < todayIso).length;
  const overdueInspectionCount = (project?.inspections || []).filter(
    (inspection) => inspection.date && inspection.date < todayIso && !isCompleteStatus(inspection.status),
  ).length;
  const blockedStepCount = buildProjectBlockedSteps(project, todayIso).length;
  const issueCount = overdueTaskCount + overdueInspectionCount + blockedStepCount;
  if (issueCount) return { label: `Needs attention · ${issueCount}`, tone: 'attention', issueCount };
  if (project?.end && project.end < todayIso) return { label: 'Past target date', tone: 'attention', issueCount: 1 };
  if (String(project?.status || '').toLowerCase() === 'planning') return { label: 'In planning', tone: 'planning', issueCount: 0 };
  return { label: 'On track', tone: 'good', issueCount: 0 };
}

export function groupRecentAuditChanges(rows = [], now = new Date()) {
  const today = getLocalIsoDate(now);
  const yesterday = getLocalIsoDate(addLocalDays(now, -1));
  const groups = { today: [], yesterday: [] };
  buildAuditTrailEntries(rows).forEach((entry) => {
    const entryDate = getLocalIsoDate(entry.createdAt);
    if (entryDate === today) groups.today.push(entry);
    else if (entryDate === yesterday) groups.yesterday.push(entry);
  });
  const newestFirst = (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  groups.today.sort(newestFirst);
  groups.yesterday.sort(newestFirst);
  return groups;
}
