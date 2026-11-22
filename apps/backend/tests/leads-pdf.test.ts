import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import { renderLeadsPdf, type PdfLead } from '../src/modules/reports/leads-pdf';

async function pdf(leads: PdfLead[], offset = 0, hasMore = false): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.font(require.resolve('@expo-google-fonts/noto-sans-devanagari/400Regular/NotoSansDevanagari_400Regular.ttf'));
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => { doc.on('end', resolve); doc.on('error', reject); });
  renderLeadsPdf(doc, leads, offset, hasMore);
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

async function pages(buffer: Buffer) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  const result: Array<Array<{ str: string; x: number; y: number }>> = [];
  for (let i = 1; i <= document.numPages; i++) {
    const page = await document.getPage(i);
    const content = await page.getTextContent();
    result.push(content.items.flatMap((item) => 'str' in item && item.str.trim()
      ? [{ str: item.str, x: item.transform[4]!, y: item.transform[5]! }] : []));
  }
  await document.destroy();
  return result;
}

const baseLead: PdfLead = {
  code: 'MMB-000001',
  groups: [
    { title: 'Customer', fields: [
      { label: 'Customer name', value: 'Ramesh Kumar' },
      { label: 'Phone', value: '+91 98765 43210' },
      { label: 'Email', value: null },
      { label: 'Alternate phone', value: '' },
      { label: 'City', value: '  ' },
    ] },
    { title: 'Lead details', fields: [{ label: 'Status', value: 'NEW' }, { label: 'Source', value: 'PHONE CALL' }] },
    { title: 'Dates', fields: [{ label: 'Created', value: new Date('2026-11-21T20:00:00Z') }] },
  ],
};

describe('lead PDF layout', () => {
  it('prints only populated fields in two columns with readable IST dates', async () => {
    const result = await pages(await pdf([baseLead]));
    const content = result[0]!;
    const all = content.map((item) => item.str).join(' ');
    expect(all).toContain('MMB-000001');
    expect(all).toContain('Ramesh Kumar');
    expect(all).toContain('Phone');
    expect(all).not.toContain('Email');
    expect(all).not.toContain('Alternate phone');
    expect(all).not.toContain('City');
    expect(all).toContain('22 Nov 2026');
    expect(all).toContain('IST');
    const name = content.find((item) => item.str === 'Customer name')!;
    const phone = content.find((item) => item.str === 'Phone')!;
    expect(phone.x - name.x).toBeGreaterThan(150);
    expect(phone.y).toBeCloseTo(name.y, 1);
  });

  it('keeps long fields and multiple leads within page bounds without losing their endings', async () => {
    const note = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    const longLead: PdfLead = { code: 'MMB-000002', groups: [{ title: 'Details', fields: [
      { label: 'Notes', value: note }, { label: 'Requirement', value: 'One more detail' },
    ] }] };
    const result = await pages(await pdf([longLead, baseLead], 5, true));
    expect(result.length).toBeGreaterThan(1);
    const all = result.flat().map((item) => item.str).join(' ');
    expect(all).toContain('word0');
    expect(all).toContain('word399');
    expect(all).toContain('MMB-000002');
    expect(all).toContain('MMB-000001');
    expect(all).toContain('continued');
    expect(all).toContain('More records available');
    for (const page of result) for (const item of page) {
      expect(item.x).toBeGreaterThanOrEqual(39);
      expect(item.x).toBeLessThan(556);
      expect(item.y).toBeGreaterThan(35);
      expect(item.y).toBeLessThan(803);
    }
  });

  it('wraps long unbroken content and supports Hindi names', async () => {
    const value = 'X'.repeat(1500) + 'ENDMARKER';
    const lead: PdfLead = { code: 'MMB-000003', groups: [{ title: 'Customer', fields: [
      { label: 'Customer name', value: 'रमेश कुमार' }, { label: 'Notes', value },
    ] }] };
    const result = await pages(await pdf([lead]));
    const text = result.flat().map((item) => item.str).join(' ');
    expect(text).toContain('रमेश');
    expect(text).toContain('ENDMARKER');
    expect(result.flat().filter((item) => item.str.startsWith('X')).map((item) => item.str).join('').match(/X/g)).toHaveLength(1500);
  });

  it('renders an empty export clearly', async () => {
    const result = await pages(await pdf([]));
    expect(result.flat().map((item) => item.str).join(' ')).toContain('No leads match these filters.');
  });
});
