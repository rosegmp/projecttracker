import React from 'react';
import {
  Add24Regular,
  AppFolder24Regular,
  ArrowBidirectionalUpDown24Regular,
  ArrowClockwise24Regular,
  ArrowDown24Regular,
  ArrowDownload24Regular,
  ArrowMove24Regular,
  ArrowUp24Regular,
  ArrowUpload24Regular,
  Camera24Regular,
  Checkmark24Regular,
  ChevronRight24Regular,
  Delete24Regular,
  Document24Regular,
  Edit24Regular,
  Eye24Regular,
  Mail24Regular,
  Navigation24Regular,
  ReOrderDotsVertical24Regular,
  SignOut24Regular,
  Warning24Regular,
} from '@fluentui/react-icons';

const ICONS = {
  drag: ReOrderDotsVertical24Regular,
  upload: ArrowUpload24Regular,
  download: ArrowDownload24Regular,
  move: ArrowMove24Regular,
  replace: ArrowClockwise24Regular,
  edit: Edit24Regular,
  delete: Delete24Regular,
  camera: Camera24Regular,
  eye: Eye24Regular,
  mail: Mail24Regular,
  signOut: SignOut24Regular,
  dependency: ArrowBidirectionalUpDown24Regular,
  check: Checkmark24Regular,
  chevronRight: ChevronRight24Regular,
  arrowUp: ArrowUp24Regular,
  arrowDown: ArrowDown24Regular,
  folder: AppFolder24Regular,
  document: Document24Regular,
  add: Add24Regular,
  warning: Warning24Regular,
  navigation: Navigation24Regular,
};

export default function FluentIcon({ name, size = 18, className = '' }) {
  const IconComponent = ICONS[name];
  if (!IconComponent) return null;
  return (
    <IconComponent
      className={`fluent-icon ${className}`.trim()}
      aria-hidden="true"
      focusable="false"
      style={{ fontSize: `${size}px` }}
    />
  );
}
