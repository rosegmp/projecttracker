import React from 'react';
import { getStepStatusOption } from '../utils/stepStatus.js';
import FluentIcon from './FluentIcon.jsx';

export default function StepStatusButton({ row, onClick }) {
  const status = getStepStatusOption(row.status, row.done);

  return (
    <button
      className={`schedule-step-status-button status-${status.value}`}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick(row);
      }}
      aria-label={`Change status for ${row.label}. Current status: ${status.label}`}
      title={`${status.label} — change status`}
    >
      <FluentIcon name={status.icon} size={16} />
    </button>
  );
}
