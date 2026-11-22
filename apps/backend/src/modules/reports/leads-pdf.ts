import PDFDocument from 'pdfkit';

export interface PdfField { label: string; value: string | Date | null | undefined }
export interface PdfLead { code: string; groups: Array<{ title: string; fields: PdfField[] }> }

const colors = { ink: '#172554', muted: '#64748b', accent: '#4338ca', line: '#dbe3ef', pale: '#f6f8fc' };
const margin = 40;
const gap = 10;
const valueSize = 9.5;
const labelSize = 8;
const lineHeight = 13;
const cellPadding = 9;
const labelHeight = 14;

function displayValue(value: PdfField['value']): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return `${new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    }).format(value)} IST`;
  }
  return value.trim() || null;
}

/** Character-safe wrapping keeps long notes and unbroken text inside their cell. */
function wrapValue(doc: PDFKit.PDFDocument, text: string, width: number): string[] {
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let current = '';
    for (const token of paragraph.match(/\s+|\S+/gu) ?? []) {
      if (doc.widthOfString(current + token) <= width) {
        current += token;
        continue;
      }
      if (current) { lines.push(current.trimEnd()); current = ''; }
      if (/^\s+$/u.test(token)) continue;
      if (doc.widthOfString(token) <= width) { current = token; continue; }
      // A single unbroken value may be wider than a column: split by grapheme.
      for (const { segment } of segmenter.segment(token)) {
        if (current && doc.widthOfString(current + segment) > width) {
          lines.push(current);
          current = '';
        }
        current += segment;
      }
    }
    lines.push(current);
  }
  return lines;
}

/**
 * Render a two-column, sectioned export. Only populated fields are included.
 * Page breaks are explicit, including for a single field longer than a page.
 */
export function renderLeadsPdf(doc: PDFKit.PDFDocument, leads: PdfLead[], offset: number, hasMore: boolean): void {
  const width = doc.page.width - margin * 2;
  const columnWidth = (width - gap) / 2;
  const bottom = doc.page.height - margin;
  let y = margin;
  let currentLead = '';

  const text = (value: string, x: number, top: number, size: number, color: string) => {
    doc.fontSize(size).fillColor(color).text(value, x, top, { lineBreak: false });
  };
  const pageHeading = () => {
    doc.rect(margin, y, width, 36).fill(colors.ink);
    text('KotaLabs CRM  /  LEAD EXPORT', margin + 12, y + 10, 12, '#ffffff');
    y += 45;
  };
  const leadHeading = (continued = false) => {
    text(`${currentLead}${continued ? '  (continued)' : ''}`, margin, y, 12, colors.accent);
    y += 19;
  };
  const newPage = (continuing = true) => {
    doc.addPage();
    y = margin;
    pageHeading();
    if (continuing && currentLead) leadHeading(true);
  };
  pageHeading();
  text(`Records ${offset + (leads.length ? 1 : 0)}–${offset + leads.length}${hasMore ? '  ·  More records available in the next export batch' : ''}`, margin, y, 9, colors.muted);
  y += 22;
  if (!leads.length) text('No leads match these filters.', margin, y, 10, colors.muted);

  for (const lead of leads) {
    currentLead = lead.code;
    // Keep a heading and the start of its first section together.
    if (y + 90 > bottom) newPage(false);
    leadHeading();
    for (const group of lead.groups) {
      const fields = group.fields.flatMap((field) => {
        const value = displayValue(field.value);
        return value === null ? [] : [{ label: field.label, value }];
      });
      if (!fields.length) continue;
      if (y + 65 > bottom) newPage();
      text(group.title.toUpperCase(), margin, y, 8, colors.muted);
      y += 15;
      for (let i = 0; i < fields.length; i += 2) {
        const row = fields.slice(i, i + 2).map((field) => {
          doc.fontSize(valueSize);
          return { label: field.label, lines: wrapValue(doc, field.value, columnWidth - cellPadding * 2) };
        });
        let lineOffset = 0;
        const totalLines = Math.max(...row.map((field) => field.lines.length));
        while (lineOffset < totalLines) {
          const availableLines = Math.floor((bottom - y - labelHeight - cellPadding * 2) / lineHeight);
          if (availableLines < 1) { newPage(); continue; }
          const lineCount = Math.min(availableLines, totalLines - lineOffset);
          const height = labelHeight + cellPadding * 2 + lineCount * lineHeight;
          row.forEach((field, index) => {
            // A finished shorter field is not repeated on continuation pages.
            const lines = field.lines.slice(lineOffset, lineOffset + lineCount);
            if (!lines.length) return;
            const x = margin + index * (columnWidth + gap);
            doc.save().roundedRect(x, y, columnWidth, height, 4).fillAndStroke(colors.pale, colors.line).restore();
            text(`${field.label}${lineOffset ? ' (continued)' : ''}`, x + cellPadding, y + cellPadding, labelSize, colors.muted);
            lines.forEach((line, lineIndex) => text(line || ' ', x + cellPadding, y + cellPadding + labelHeight + lineIndex * lineHeight, valueSize, colors.ink));
          });
          y += height + 5;
          lineOffset += lineCount;
          if (lineOffset < totalLines) newPage();
        }
      }
      y += 6;
    }
    doc.moveTo(margin, y).lineTo(margin + width, y).strokeColor(colors.line).stroke();
    y += 17;
  }
}
