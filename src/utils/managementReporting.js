function amount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function daysBetween(first, second) {
  const start = new Date(`${first}T12:00:00`);
  const end = new Date(`${second}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.floor((end - start) / 86400000));
}

function complete(value) {
  return ['done', 'complete', 'completed', 'passed', 'approved', 'cancelled', 'not_applicable'].includes(String(value || '').toLowerCase());
}

export function buildManagementReport(projects = [], workflows = {}, todayIso = '') {
  const byProject = (records = [], projectId) => records.filter((record) => record.projectId === projectId);
  return projects.map((project) => {
    const steps = (project.phases || []).flatMap((phase) => phase.steps || []);
    const overdueSteps = steps.filter((step) => !complete(step.status) && !step.done && step.end && step.end < todayIso);
    const scheduleVarianceDays = overdueSteps.reduce((maximum, step) => Math.max(maximum, daysBetween(step.end, todayIso)), 0);
    const budgetItems = byProject(workflows.budgetItems, project.id).filter((item) => item.status !== 'void');
    const commitments = byProject(workflows.commitments, project.id).filter((item) => item.status !== 'void');
    const currentBudget = budgetItems.reduce((sum, item) => sum + amount(item.originalBudget) + amount(item.approvedChanges), 0);
    const forecast = budgetItems.reduce((sum, item) => sum + amount(item.forecastCost), 0);
    const committed = commitments.reduce((sum, item) => sum + amount(item.committedAmount), 0);
    const changeOrders = byProject(workflows.changeOrders, project.id);
    const portalItems = byProject(workflows.portalItems, project.id);
    const selections = project.selections || [];
    const outstandingApprovals = changeOrders.filter((item) => ['proposed', 'pending', 'sent'].includes(String(item.status || '').toLowerCase())).length
      + portalItems.filter((item) => item.itemType === 'approval' && item.status === 'response_requested').length
      + selections.filter((item) => String(item.status || '').toLowerCase() === 'needs decision').length;
    const closeout = byProject(workflows.closeoutItems, project.id).filter((item) => item.required !== false && item.status !== 'not_applicable');
    const closeoutComplete = closeout.filter((item) => complete(item.status)).length;
    const closeoutPercent = closeout.length ? Math.round((closeoutComplete / closeout.length) * 100) : null;
    const budgetExposure = Math.max(0, forecast - currentBudget, committed - currentBudget);
    const attentionCount = overdueSteps.length + outstandingApprovals + (budgetExposure > 0 ? 1 : 0) + (closeoutPercent != null && closeoutPercent < 100 ? 1 : 0);
    return {
      projectId: project.id,
      projectName: project.name || 'Project',
      status: project.status || 'planning',
      customerName: project.customerName || '',
      scheduleVarianceDays,
      overdueSteps: overdueSteps.length,
      currentBudget,
      forecast,
      committed,
      budgetExposure,
      outstandingApprovals,
      closeoutComplete,
      closeoutRequired: closeout.length,
      closeoutPercent,
      attentionCount,
    };
  }).sort((left, right) => right.attentionCount - left.attentionCount || left.projectName.localeCompare(right.projectName));
}

export function summarizeManagementReport(rows = []) {
  const budget = rows.reduce((sum, row) => sum + row.currentBudget, 0);
  const forecast = rows.reduce((sum, row) => sum + row.forecast, 0);
  return {
    projects: rows.length,
    delayedProjects: rows.filter((row) => row.scheduleVarianceDays > 0).length,
    budget,
    forecast,
    budgetExposure: rows.reduce((sum, row) => sum + row.budgetExposure, 0),
    outstandingApprovals: rows.reduce((sum, row) => sum + row.outstandingApprovals, 0),
    closeoutPercent: rows.reduce((sum, row) => sum + row.closeoutComplete, 0) / Math.max(1, rows.reduce((sum, row) => sum + row.closeoutRequired, 0)) * 100,
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function managementReportCsv(rows = [], generatedAt = new Date()) {
  const headings = ['Project', 'Status', 'Customer', 'Schedule variance days', 'Overdue steps', 'Current budget', 'Forecast', 'Committed', 'Budget exposure', 'Outstanding approvals', 'Closeout complete', 'Closeout required', 'Closeout percent'];
  const output = rows.map((row) => [row.projectName, row.status, row.customerName, row.scheduleVarianceDays, row.overdueSteps, row.currentBudget.toFixed(2), row.forecast.toFixed(2), row.committed.toFixed(2), row.budgetExposure.toFixed(2), row.outstandingApprovals, row.closeoutComplete, row.closeoutRequired, row.closeoutPercent == null ? '' : row.closeoutPercent]);
  return `Generated,${csvCell(generatedAt.toISOString())}\r\n${[headings, ...output].map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
