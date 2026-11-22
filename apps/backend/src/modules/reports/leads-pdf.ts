export interface PdfField { label: string; value: string | Date | null | undefined }
export interface PdfLead { code: string; groups: Array<{ title: string; fields: PdfField[] }> }

const margin = 40;
const gap = 22;
const valueSize = 9;
const lineHeight = 12;
const headingHeight = 15;
const leadGap = 8;

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
 * Read down the left column, then the right. Short leads stay together where
 * possible; a long lead continues with its code repeated at the next column.
 */
export function renderLeadsPdf(doc: PDFKit.PDFDocument, leads: PdfLead[], offset: number, hasMore: boolean): void {
  const width = doc.page.width - margin * 2;
  const columnWidth = (width - gap) / 2;
  const bottom = doc.page.height - margin;
  const columnTop = margin + 48;
  const normal = require.resolve('@expo-google-fonts/noto-sans-devanagari/400Regular/NotoSansDevanagari_400Regular.ttf');
  const bold = require.resolve('@expo-google-fonts/noto-sans-devanagari/700Bold/NotoSansDevanagari_700Bold.ttf');
  doc.registerFont('lead-regular', normal).registerFont('lead-bold', bold);
  let column = 0;
  let y = columnTop;
  let currentLead = '';
  const x = () => margin + column * (columnWidth + gap);
  const text = (value: string, left: number, top: number, size: number, font: string) => {
    doc.font(font).fontSize(size).fillColor('#111827').text(value, left, top, { lineBreak: false });
  };
  const pageHeading = () => {
    text('KotaLabs CRM - Lead export', margin, margin, 13, 'lead-bold');
    const count = `Records ${offset + (leads.length ? 1 : 0)}-${offset + leads.length}`;
    text(count, margin, margin + 20, 9, 'lead-regular');
    if (hasMore) text('More records available in the next export batch', margin + 180, margin + 20, 9, 'lead-regular');
    doc.save().strokeColor('#d1d5db').lineWidth(0.5)
      .moveTo(margin + columnWidth + gap / 2, columnTop)
      .lineTo(margin + columnWidth + gap / 2, bottom).stroke().restore();
  };
  const nextColumn = () => {
    if (column === 0) column = 1;
    else { doc.addPage(); column = 0; pageHeading(); }
    y = columnTop;
  };
  const leadHeading = (continued = false) => {
    text(`${currentLead}${continued ? ' (continued)' : ''}`, x(), y, 10, 'lead-bold');
    y += headingHeight;
  };
  pageHeading();
  if (!leads.length) text('No leads match these filters.', x(), y, 9, 'lead-regular');

  for (const lead of leads) {
    currentLead = lead.code;
    doc.font('lead-regular').fontSize(valueSize);
    const lines = lead.groups.flatMap((group) => group.fields.flatMap((field) => {
      const value = displayValue(field.value);
      return value === null ? [] : wrapValue(doc, `${field.label}: ${value}`, columnWidth);
    }));
    const required = headingHeight + lines.length * lineHeight;
    const capacity = bottom - columnTop;
    // Keep a short lead together rather than orphaning its heading. Long leads
    // can span columns, so no entered text is truncated.
    if ((required <= capacity && y + required > bottom) || y + headingHeight + lineHeight > bottom) nextColumn();
    leadHeading();
    for (const line of lines) {
      if (y + lineHeight > bottom) { nextColumn(); leadHeading(true); }
      text(line || ' ', x(), y, valueSize, 'lead-regular');
      y += lineHeight;
    }
    y += leadGap;
  }
}
