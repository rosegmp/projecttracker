import React, { useEffect, useState } from 'react';
import { clearDigitalApprovalToken, loadDigitalApproval, respondToDigitalApproval } from '../services/digitalApprovals.js';

function detailRows(snapshot = {}) {
  if (snapshot.kind === 'change_order') {
    const terms = snapshot.changeOrderSnapshot || {};
    return [
      ['Change order', `${terms.number || ''} ${terms.title || ''}`.trim()],
      ['Scope', terms.description], ['Reason', terms.reason], ['Cost impact', terms.costImpact],
      ['Schedule impact', terms.scheduleDays ? `${terms.scheduleDays} days` : 'None'], ['Notes', terms.notes],
    ];
  }
  if (snapshot.kind === 'selection') {
    const terms = snapshot.selectionSnapshot || {};
    return [['Selection', terms.itemName], ['Chosen option', terms.chosenOption], ['Vendor', terms.vendor], ['Request', snapshot.message]];
  }
  if (snapshot.kind === 'subcontractor_agreement') {
    return [['Company', snapshot.company], ['Contact', snapshot.contactName], ['Document', 'Destiny Homes subcontractor agreement']];
  }
  return [['Request', snapshot.title], ['Message', snapshot.message], ['Due date', snapshot.dueDate]];
}

export default function DigitalApprovalPage({ token }) {
  const [approval, setApproval] = useState(null);
  const [draft, setDraft] = useState({ signerName: '', signerEmail: '', comment: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadDigitalApproval(token)
      .then((result) => { if (!cancelled) setApproval(result.approval); })
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Unable to load approval.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  async function decide(decision) {
    if (!draft.signerName.trim() || !draft.signerEmail.trim()) {
      setError('Enter your full name and the email address that received this request.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await respondToDigitalApproval(token, { ...draft, decision });
      setApproval(result.approval);
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : 'Unable to save your decision.');
    } finally { setSaving(false); }
  }

  const pending = approval?.status === 'pending';
  return (
    <main className="digital-approval-page">
      <section className="digital-approval-card" aria-labelledby="digital-approval-title">
        <header>
          <p className="eyebrow">Destiny Homes LLC</p>
          <h1 id="digital-approval-title">{approval?.title || 'Secure approval'}</h1>
          <p>Review the issued terms and record your decision.</p>
        </header>
        {loading ? <div className="empty-state compact" role="status"><p>Loading approval request…</p></div> : null}
        {error ? <div className="audit-trail-message error" role="alert">{error}</div> : null}
        {approval ? (
          <>
            <dl className="digital-approval-details">
              {detailRows(approval.snapshot).filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}
              <div><dt>Link expires</dt><dd>{new Date(approval.expiresAt).toLocaleString()}</dd></div>
            </dl>
            {pending ? (
              <div className="digital-approval-form">
                <label><span>Full name</span><input value={draft.signerName} onChange={(event) => setDraft((current) => ({ ...current, signerName: event.target.value }))} autoComplete="name" /></label>
                <label><span>Email that received this request</span><input type="email" value={draft.signerEmail} onChange={(event) => setDraft((current) => ({ ...current, signerEmail: event.target.value }))} autoComplete="email" /></label>
                <label><span>Comments (optional)</span><textarea rows={4} value={draft.comment} onChange={(event) => setDraft((current) => ({ ...current, comment: event.target.value }))} /></label>
                <p>By selecting Approve or Decline, you confirm that the name and email above identify you and that your decision applies to the issued version shown here.</p>
                <div><button className="button primary" type="button" disabled={saving} onClick={() => void decide('approved')}>{saving ? 'Saving…' : 'Approve'}</button><button className="button danger" type="button" disabled={saving} onClick={() => void decide('declined')}>Decline</button></div>
              </div>
            ) : (
              <div className={`digital-approval-result ${approval.status}`} role="status">
                <h2>{approval.status === 'approved' ? 'Approved' : approval.status === 'declined' ? 'Declined' : 'Request closed'}</h2>
                {approval.signerName ? <p>Recorded for {approval.signerName} on {new Date(approval.respondedAt).toLocaleString()}.</p> : null}
                {approval.comment ? <p>{approval.comment}</p> : null}
                {approval.signedUrl ? <a className="button secondary" href={approval.signedUrl} download={approval.signedPdfFileName || 'signed-approval.pdf'}>Download signed PDF</a> : <p>{approval.documentStatus === 'failed' ? 'The signed PDF is still being prepared.' : null}</p>}
              </div>
            )}
          </>
        ) : null}
        <footer><button className="button secondary" type="button" onClick={() => { clearDigitalApprovalToken(); window.location.assign('/'); }}>Return to Project Hub</button></footer>
      </section>
    </main>
  );
}
