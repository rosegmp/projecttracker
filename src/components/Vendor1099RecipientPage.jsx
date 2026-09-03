import React, { useEffect, useState } from 'react';
import { deliverBlob } from '../platform/platformAdapter.js';
import {
  clearVendor1099RecipientToken,
  consentToVendor1099ElectronicDelivery,
  downloadVendor1099ConsentSample,
  downloadVendor1099RecipientPdf,
  loadVendor1099RecipientRequest,
  withdrawVendor1099ElectronicConsent,
} from '../services/vendor1099Recipient.js';

export default function Vendor1099RecipientPage({ token }) {
  const [request, setRequest] = useState(null);
  const [draft, setDraft] = useState({ signerName: '', signerEmail: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    setLoading(true);
    try {
      const result = await loadVendor1099RecipientRequest(token);
      setRequest(result.request);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load this tax-document request.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, [token]);

  async function openSample() {
    setBusy(true);
    setError('');
    try {
      const blob = await downloadVendor1099ConsentSample(token);
      await deliverBlob(blob, 'Destiny-Homes-PDF-access-test.pdf', { share: false });
      await refresh();
    } catch (sampleError) {
      setError(sampleError instanceof Error ? sampleError.message : 'Unable to open the PDF access test.');
    } finally { setBusy(false); }
  }

  async function consent() {
    if (!draft.signerName.trim() || !draft.signerEmail.trim()) {
      setError('Enter your full name and the email address that received this request.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await consentToVendor1099ElectronicDelivery(token, draft.signerName, draft.signerEmail);
      setRequest(result.request);
    } catch (consentError) {
      setError(consentError instanceof Error ? consentError.message : 'Unable to record electronic-delivery consent.');
    } finally { setBusy(false); }
  }

  async function downloadCopy() {
    setBusy(true);
    setError('');
    try {
      const blob = await downloadVendor1099RecipientPdf(token);
      await deliverBlob(blob, request?.fileName || `Form-1099-NEC-${request?.taxYear || ''}.pdf`, { share: false });
      await refresh();
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Unable to download the recipient copy.');
    } finally { setBusy(false); }
  }

  async function withdraw() {
    setBusy(true);
    setError('');
    try {
      const result = await withdrawVendor1099ElectronicConsent(token);
      setRequest(result.request);
    } catch (withdrawError) {
      setError(withdrawError instanceof Error ? withdrawError.message : 'Unable to withdraw electronic-delivery consent.');
    } finally { setBusy(false); }
  }

  const consentPending = request?.mode === 'consent' && request?.status === 'consent_requested';
  const copyAvailable = request?.mode === 'delivery' && ['available', 'delivered'].includes(request?.status);
  return (
    <main className="digital-approval-page">
      <section className="digital-approval-card vendor-tax-recipient" aria-labelledby="vendor-tax-title">
        <header><p className="eyebrow">Destiny Homes LLC</p><h1 id="vendor-tax-title">Secure Form 1099-NEC delivery</h1><p>Your tax document is protected by a private, expiring link.</p></header>
        {loading ? <div className="empty-state compact" role="status"><p>Loading secure tax-document request…</p></div> : null}
        {error ? <div className="audit-trail-message error" role="alert">{error}</div> : null}
        {request ? <>
          <dl className="digital-approval-details"><div><dt>Recipient</dt><dd>{request.vendorName}</dd></div><div><dt>Tax year</dt><dd>{request.taxYear}</dd></div><div><dt>Form</dt><dd>1099-NEC recipient copy · TIN ending {request.taxIdLastFour}</dd></div><div><dt>Link expires</dt><dd>{new Date(request.expiresAt).toLocaleString()}</dd></div></dl>
          {consentPending ? <div className="digital-approval-form">
            <h2>Choose electronic delivery</h2>
            <div className="vendor-tax-disclosures">{(request.disclosures || []).map((item) => <p key={item}>{item}</p>)}</div>
            <button className="button secondary" type="button" disabled={busy} onClick={() => void openSample()}>{request.sampleAccessed ? 'PDF access confirmed' : 'Open PDF access test'}</button>
            <label><span>Full name</span><input autoComplete="name" value={draft.signerName} onChange={(event) => setDraft((current) => ({ ...current, signerName: event.target.value }))} /></label>
            <label><span>Email that received this request</span><input type="email" autoComplete="email" value={draft.signerEmail} onChange={(event) => setDraft((current) => ({ ...current, signerEmail: event.target.value }))} /></label>
            <button className="button primary" type="button" disabled={busy || !request.sampleAccessed} onClick={() => void consent()}>Consent to electronic delivery for {request.taxYear}</button>
            <p>If you do not consent, Destiny Homes will provide a paper copy.</p>
          </div> : null}
          {request.status === 'consented' ? <div className="digital-approval-result approved"><h2>Consent recorded</h2><p>Your {request.taxYear} recipient copy will be sent through a new secure link when it is available.</p><button className="button secondary" type="button" disabled={busy} onClick={() => void withdraw()}>Withdraw consent</button></div> : null}
          {copyAvailable ? <div className="digital-approval-result approved"><h2>Your recipient copy is available</h2><p>The PDF remains available until {new Date(request.availableUntil).toLocaleDateString()}.</p><button className="button primary" type="button" disabled={busy} onClick={() => void downloadCopy()}>{request.status === 'delivered' ? 'Download again' : 'Download Form 1099-NEC'}</button><button className="button secondary" type="button" disabled={busy} onClick={() => void withdraw()}>Request future paper delivery</button></div> : null}
          {['paper_required', 'withdrawn'].includes(request.status) ? <div className="digital-approval-result declined"><h2>Paper delivery required</h2><p>Contact Destiny Homes if your mailing address needs to be updated.</p></div> : null}
        </> : null}
        <footer><button className="button secondary" type="button" onClick={() => { clearVendor1099RecipientToken(); window.location.assign('/'); }}>Return to Project Hub</button></footer>
      </section>
    </main>
  );
}
