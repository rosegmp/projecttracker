import { personAssignmentLabel } from './accessUi.js';
import { subcontractorComplianceStatus } from './certificateStatus.js';

export function buildSubcontractorComplianceWarnings(subcontractors = [], certificates = [], documents = [], todayIso) {
  const certificatesBySubcontractor = new Map();
  certificates.forEach((certificate) => {
    const subcontractorId = String(certificate.subcontractorId || '');
    if (!certificatesBySubcontractor.has(subcontractorId)) certificatesBySubcontractor.set(subcontractorId, []);
    certificatesBySubcontractor.get(subcontractorId).push(certificate);
  });
  const documentsBySubcontractor = new Map();
  documents.forEach((document) => {
    const subcontractorId = String(document.subcontractorId || '');
    if (!documentsBySubcontractor.has(subcontractorId)) documentsBySubcontractor.set(subcontractorId, []);
    documentsBySubcontractor.get(subcontractorId).push(document);
  });

  const warnings = new Map();
  subcontractors.forEach((subcontractor) => {
    const assignmentLabel = personAssignmentLabel(subcontractor).trim();
    if (!assignmentLabel) return;
    const status = subcontractorComplianceStatus(
      subcontractor,
      certificatesBySubcontractor.get(String(subcontractor.id || '')) || [],
      documentsBySubcontractor.get(String(subcontractor.id || '')) || [],
      todayIso,
    );
    if (status.id !== 'needs-attention') return;
    const missing = status.missing.map((requirement) => requirement.label);
    warnings.set(assignmentLabel, {
      subcontractorId: subcontractor.id,
      missing,
      message: `Compliance attention needed: ${missing.join(', ')}.`,
    });
  });
  return warnings;
}
