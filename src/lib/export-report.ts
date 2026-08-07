// Generic CSV/XLSX/PDF export for a tabular report - used by
// RelativeStrengthPanel's two sections (Ranking, Resumen). Kept
// format-agnostic (column defs + rows in, a downloaded file out) so both
// sections reuse the exact same code instead of duplicating per-format
// logic per section.

export type ExportColumn<T> = {
  header: string;
  value: (row: T) => string | number | null;
  // Heat tint for XLSX cell fill / a light background hint - omitted
  // entirely for columns with no polarity (e.g. Ticker, Nombre).
  heat?: (row: T) => 'positive' | 'negative' | 'neutral' | null;
  // PNG data URL (data:image/png;base64,...) rendered in place of `value`
  // for PDF/XLSX only - CSV has no way to embed an image, so it falls back
  // to whatever `value` returns for that column (usually '').
  image?: (row: T) => string | null;
};

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously right after click() races the browser's actual
  // read of the blob behind this object URL - for anything but a tiny file,
  // that can cancel the download entirely. Give it a beat first.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function exportCsv<T>(filename: string, columns: ExportColumn<T>[], rows: T[]) {
  const lines = [
    columns.map(c => csvEscape(c.header)).join(','),
    ...rows.map(row => columns.map(c => csvEscape(String(c.value(row) ?? 'ND'))).join(','))
  ];
  // ﻿ BOM: makes Excel on Windows detect UTF-8 instead of misreading
  // accented Spanish labels (Día, Período) as Latin-1.
  triggerDownload(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), filename);
}

const HEAT_FILL: Record<'positive' | 'negative' | 'neutral', string> = {
  positive: 'FFD1F2DD', // light green
  negative: 'FFF9D6E0', // light red/pink
  neutral: 'FFFFFFFF'
};

async function exportXlsx<T>(filename: string, title: string, columns: ExportColumn<T>[], rows: T[]) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EXPOSURE Dashboard';
  workbook.created = new Date();

  // Excel worksheet names ban * ? : \ / [ ] and cap out at 31 chars - our
  // report titles use "—" and "/" freely (e.g. "Ranking / Rotación"), so
  // both need stripping before use as a sheet name.
  const sheetName = title.replace(/[*?:\\/[\]]/g, '-').slice(0, 31);
  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = columns.map(c => ({
    header: c.header,
    key: c.header,
    // Rough auto-width: longest of header/typical value, clamped to a
    // sane range - exceljs has no true auto-fit, this approximates it.
    // Image columns get a fixed wider width instead, sized for the chart.
    width: c.image ? 20 : Math.min(28, Math.max(10, c.header.length + 4))
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E2340' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const hasImageColumn = columns.some(c => c.image);

  for (const row of rows) {
    const values = columns.map(c => (c.image ? '' : c.value(row)));
    const excelRow = sheet.addRow(values);
    if (hasImageColumn) excelRow.height = 34;
    columns.forEach((c, i) => {
      const cell = excelRow.getCell(i + 1);
      const heat = c.heat?.(row);
      if (heat) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAT_FILL[heat] } };
      const imgDataUrl = c.image?.(row);
      if (imgDataUrl) {
        const base64 = imgDataUrl.slice(imgDataUrl.indexOf(',') + 1);
        const imageId = workbook.addImage({ base64, extension: 'png' });
        sheet.addImage(imageId, {
          tl: { col: i, row: excelRow.number - 1 },
          ext: { width: 120, height: 38 },
          editAs: 'oneCell'
        });
      }
    });
  }

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  const buffer = await workbook.xlsx.writeBuffer();
  triggerDownload(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}

async function exportPdf<T>(filename: string, title: string, subtitle: string, columns: ExportColumn<T>[], rows: T[]) {
  const { default: jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  // Landscape + small font: fits every column (up to 9 in Resumen) on one
  // page width without wrapping/truncating values, per "lo más completamente
  // visible posible".
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFontSize(14);
  doc.text(title, 28, 28);
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(subtitle, 28, 42);

  // Image columns need a tall-enough row to actually show the chart -
  // autoTable otherwise sizes rows from their (empty) text content alone.
  const imageColIndexes = columns.reduce<number[]>((acc, c, i) => (c.image ? [...acc, i] : acc), []);
  const chartAspect = 180 / 56; // matches renderSparklinePng's fixed canvas size

  autoTable(doc, {
    startY: 54,
    head: [columns.map(c => c.header)],
    body: rows.map(row => columns.map(c => (c.image ? '' : String(c.value(row) ?? 'ND')))),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [30, 35, 64], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 246, 250] },
    columnStyles: Object.fromEntries(imageColIndexes.map(i => [i, { cellWidth: 46, minCellHeight: 24 }])),
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const col = columns[data.column.index];
      const row = rows[data.row.index];
      // autoTable re-invokes cell hooks for the continuation of a row split
      // across a page break, reusing the same row.index - guard rather than
      // assume rows[index] is always in range.
      if (!row) return;
      const heat = col.heat?.(row);
      if (heat === 'positive') data.cell.styles.fillColor = [209, 242, 221];
      else if (heat === 'negative') data.cell.styles.fillColor = [249, 214, 224];
    },
    didDrawCell: (data) => {
      if (data.section !== 'body') return;
      const col = columns[data.column.index];
      if (!col.image) return;
      const row = rows[data.row.index];
      if (!row) return;
      const img = col.image(row);
      if (!img) return;
      const padding = 3;
      let w = data.cell.width - padding * 2;
      let h = w / chartAspect;
      const maxH = data.cell.height - padding * 2;
      if (h > maxH) {
        h = maxH;
        w = h * chartAspect;
      }
      const x = data.cell.x + (data.cell.width - w) / 2;
      const y = data.cell.y + (data.cell.height - h) / 2;
      doc.addImage(img, 'PNG', x, y, w, h);
    },
    margin: { left: 20, right: 20 },
    // Repeats the header row on every page - a 60-row ranking spans several
    // pages in landscape A4, and losing the column labels mid-report would
    // defeat the "visible" requirement.
    showHead: 'everyPage'
  });

  doc.save(filename);
}

export async function exportReport<T>(
  format: ExportFormat,
  baseFilename: string,
  title: string,
  subtitle: string,
  columns: ExportColumn<T>[],
  rows: T[]
): Promise<void> {
  if (format === 'csv') return exportCsv(`${baseFilename}.csv`, columns, rows);
  if (format === 'xlsx') return exportXlsx(`${baseFilename}.xlsx`, title, columns, rows);
  return exportPdf(`${baseFilename}.pdf`, title, subtitle, columns, rows);
}
