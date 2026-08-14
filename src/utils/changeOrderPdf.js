const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2);

function pdfText(value) {
  return String(value ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2022/g, '-')
    .replace(/[^\x20-\x7e\n]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function plainText(value) {
  return String(value ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2022/g, '-')
    .replace(/[^\x20-\x7e\n]/g, ' ')
    .trim();
}

function wrapText(value, maxCharacters) {
  const paragraphs = plainText(value).split(/\r?\n/);
  const lines = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
    } else {
      let line = '';
      words.forEach((word) => {
        if (!line) {
          line = word;
        } else if (`${line} ${word}`.length <= maxCharacters) {
          line += ` ${word}`;
        } else {
          lines.push(line);
          line = word;
        }
      });
      if (line) lines.push(line);
    }
    if (paragraphIndex < paragraphs.length - 1 && lines.at(-1) !== '') lines.push('');
  });
  return lines.length ? lines : [''];
}

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Not specified';
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value) {
  if (!value) return 'Not specified';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return plainText(value) || 'Not specified';
  return `${match[2]}/${match[3]}/${match[1]}`;
}

function safeFilePart(value) {
  return (plainText(value) || 'change-order').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');
}

function textCommand(text, x, y, size = 10, font = 'F1', color = '0.12 0.15 0.24') {
  return `BT /${font} ${size} Tf ${color} rg 1 0 0 1 ${x} ${y} Tm (${pdfText(text)}) Tj ET`;
}

function lineCommand(x1, y1, x2, y2, width = 1, color = '0.78 0.80 0.86') {
  return `${color} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S`;
}

function rectCommand(x, y, width, height, fill = '0.96 0.97 0.99', stroke = '0.78 0.80 0.86') {
  return `${fill} rg ${stroke} RG ${x} ${y} ${width} ${height} re B`;
}

function createApprovalDocument(project, record) {
  const pages = [];
  let commands = [];
  let y = PAGE_HEIGHT - MARGIN;

  function newPage(continued = false) {
    if (commands.length) pages.push(commands.join('\n'));
    commands = [];
    y = PAGE_HEIGHT - MARGIN;
    const pageHeading = continued ? 'CHANGE ORDER - CONTINUED' : 'CHANGE ORDER';
    commands.push(textCommand('DESTINY HOMES LLC', MARGIN, y, 18, 'F2', '0.24 0.26 0.47'));
    commands.push(textCommand('102 Destiny Way, Lakewood, NJ 08701', MARGIN, y - 18, 9, 'F1', '0.36 0.39 0.48'));
    commands.push(textCommand(pageHeading, continued ? 356 : PAGE_WIDTH - MARGIN - 176, y, continued ? 12 : 15, 'F2', '0.24 0.26 0.47'));
    commands.push(lineCommand(MARGIN, y - 30, PAGE_WIDTH - MARGIN, y - 30, 1.5, '0.24 0.26 0.47'));
    y -= 54;
  }

  function ensureSpace(height) {
    if (y - height < 54) newPage(true);
  }

  function labelValue(label, value, x, width) {
    commands.push(textCommand(label.toUpperCase(), x, y, 7.5, 'F2', '0.36 0.39 0.48'));
    commands.push(textCommand(value || 'Not specified', x, y - 15, 10, 'F1'));
    commands.push(lineCommand(x, y - 21, x + width, y - 21, 0.6));
  }

  function section(title, value) {
    const lines = wrapText(value || 'Not specified', 92);
    const sectionHeading = title.toUpperCase();
    ensureSpace(45);
    commands.push(textCommand(sectionHeading, MARGIN, y, 8, 'F2', '0.24 0.26 0.47'));
    y -= 17;
    lines.forEach((line) => {
      if (y - 13 < 70) {
        newPage(true);
        commands.push(textCommand(`${sectionHeading} - CONTINUED`, MARGIN, y, 8, 'F2', '0.24 0.26 0.47'));
        y -= 17;
      }
      commands.push(textCommand(line, MARGIN, y, 10));
      y -= 13;
    });
    ensureSpace(26);
    y -= 10;
    commands.push(lineCommand(MARGIN, y, PAGE_WIDTH - MARGIN, y, 0.6));
    y -= 16;
  }

  newPage();
  const columnGap = 20;
  const halfWidth = (CONTENT_WIDTH - columnGap) / 2;
  labelValue('Change order', plainText(record.number) || 'Not specified', MARGIN, halfWidth);
  labelValue('Status', plainText(record.status || 'proposed').toUpperCase(), MARGIN + halfWidth + columnGap, halfWidth);
  y -= 44;
  labelValue('Project', plainText(project.name) || 'Not specified', MARGIN, halfWidth);
  labelValue('Customer', plainText(project.customerName) || 'Not specified', MARGIN + halfWidth + columnGap, halfWidth);
  y -= 44;
  labelValue('Project address', plainText(project.address) || 'Not specified', MARGIN, halfWidth);
  labelValue('Response due', formatDate(record.dueDate), MARGIN + halfWidth + columnGap, halfWidth);
  y -= 52;

  commands.push(rectCommand(MARGIN, y - 54, CONTENT_WIDTH, 54));
  commands.push(textCommand('COST IMPACT', MARGIN + 14, y - 17, 8, 'F2', '0.36 0.39 0.48'));
  commands.push(textCommand(money(record.costImpact), MARGIN + 14, y - 39, 14, 'F2', '0.12 0.15 0.24'));
  commands.push(textCommand('SCHEDULE IMPACT', MARGIN + 190, y - 17, 8, 'F2', '0.36 0.39 0.48'));
  commands.push(textCommand(record.scheduleDays ? `${plainText(record.scheduleDays)} day(s)` : 'No change specified', MARGIN + 190, y - 39, 12, 'F2'));
  commands.push(textCommand('PREPARED', MARGIN + 390, y - 17, 8, 'F2', '0.36 0.39 0.48'));
  commands.push(textCommand(new Date().toLocaleDateString('en-US'), MARGIN + 390, y - 39, 11, 'F2'));
  y -= 78;

  const titleLines = wrapText(plainText(record.title) || 'Untitled change order', 58);
  ensureSpace((titleLines.length * 20) + 10);
  titleLines.forEach((line) => {
    commands.push(textCommand(line, MARGIN, y, 16, 'F2'));
    y -= 20;
  });
  y -= 6;
  section('Description / scope', record.description);
  section('Reason for change', record.reason);
  if (plainText(record.notes)) section('Additional notes', record.notes);

  const attachmentNames = (record.attachments || []).map((attachment) => plainText(attachment.name || attachment.originalName)).filter(Boolean);
  if (attachmentNames.length) section('Referenced attachments', attachmentNames.map((name, index) => `${index + 1}. ${name}`).join('\n'));

  ensureSpace(190);
  commands.push(textCommand('CUSTOMER APPROVAL', MARGIN, y, 11, 'F2', '0.24 0.26 0.47'));
  y -= 22;
  const approvalCopy = wrapText('I acknowledge the scope, cost impact, and schedule impact described in this change order and authorize Destiny Homes LLC to proceed as indicated.', 92);
  approvalCopy.forEach((line) => {
    commands.push(textCommand(line, MARGIN, y, 9.5));
    y -= 13;
  });
  y -= 14;
  commands.push(rectCommand(MARGIN, y - 10, 10, 10, '1 1 1'));
  commands.push(textCommand('APPROVED', MARGIN + 18, y - 8, 9, 'F2'));
  commands.push(rectCommand(MARGIN + 116, y - 10, 10, 10, '1 1 1'));
  commands.push(textCommand('REJECTED', MARGIN + 134, y - 8, 9, 'F2'));
  y -= 52;
  commands.push(lineCommand(MARGIN, y, MARGIN + 310, y, 0.8, '0.36 0.39 0.48'));
  commands.push(lineCommand(MARGIN + 344, y, PAGE_WIDTH - MARGIN, y, 0.8, '0.36 0.39 0.48'));
  commands.push(textCommand('Customer signature', MARGIN, y - 14, 8, 'F1', '0.36 0.39 0.48'));
  commands.push(textCommand('Date', MARGIN + 344, y - 14, 8, 'F1', '0.36 0.39 0.48'));
  y -= 48;
  commands.push(lineCommand(MARGIN, y, MARGIN + 310, y, 0.8, '0.36 0.39 0.48'));
  commands.push(textCommand('Printed name', MARGIN, y - 14, 8, 'F1', '0.36 0.39 0.48'));

  pages.push(commands.join('\n'));
  return pages;
}

function assemblePdf(pageStreams) {
  const objects = [];
  const pageObjectIds = [];
  const contentObjectIds = [];
  const firstPageObjectId = 5;
  pageStreams.forEach((_, index) => {
    pageObjectIds.push(firstPageObjectId + (index * 2));
    contentObjectIds.push(firstPageObjectId + (index * 2) + 1);
  });
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageStreams.length} >>`;
  objects[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
  pageStreams.forEach((stream, index) => {
    objects[pageObjectIds[index] - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >>`;
    objects[contentObjectIds[index] - 1] = `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = '%PDF-1.4\n%PDFGEN\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = new TextEncoder().encode(pdf).length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([new TextEncoder().encode(pdf)], { type: 'application/pdf' });
}

export function buildChangeOrderApprovalPdf(project, record) {
  if (!record) throw new Error('Change order not found.');
  return assemblePdf(createApprovalDocument(project || {}, record));
}

export function getChangeOrderApprovalPdfFileName(project, record) {
  return `${safeFilePart(project?.name || 'Project')}-${safeFilePart(record?.number || 'Change-Order')}-Customer-Approval.pdf`;
}
