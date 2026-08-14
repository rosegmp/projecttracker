import { useEffect, useMemo, useState } from 'react';
import { loadComplianceAssignmentSnapshot } from '../services/insuranceCertificates.js';
import { buildSubcontractorComplianceWarnings } from '../utils/complianceAssignmentWarnings.js';

export default function useSubcontractorComplianceWarnings(subcontractors = [], enabled = true) {
  const [snapshot, setSnapshot] = useState({ status: 'idle', certificates: [], documents: [], error: '' });
  const subcontractorScope = useMemo(() => subcontractors
    .map((subcontractor) => [
      subcontractor.id,
      subcontractor.version,
      subcontractor.inactive === true,
      subcontractor.companyType,
      subcontractor.is1099Exempt === true,
    ].join(':'))
    .sort()
    .join('|'), [subcontractors]);

  useEffect(() => {
    let active = true;
    if (!enabled || !subcontractors.length) {
      setSnapshot({ status: 'idle', certificates: [], documents: [], error: '' });
      return () => { active = false; };
    }
    setSnapshot((current) => ({ ...current, status: 'loading', error: '' }));
    loadComplianceAssignmentSnapshot()
      .then((nextSnapshot) => {
        if (active) setSnapshot({ ...nextSnapshot, status: 'ready', error: '' });
      })
      .catch((error) => {
        if (active) setSnapshot({
          status: 'error',
          certificates: [],
          documents: [],
          error: error instanceof Error ? error.message : 'Unable to check subcontractor compliance.',
        });
      });
    return () => { active = false; };
  }, [enabled, subcontractorScope]);

  return useMemo(() => {
    const warnings = snapshot.status === 'ready'
      ? buildSubcontractorComplianceWarnings(subcontractors, snapshot.certificates, snapshot.documents)
      : new Map();
    warnings.loadStatus = snapshot.status;
    warnings.loadError = snapshot.error;
    return warnings;
  }, [snapshot, subcontractors]);
}
