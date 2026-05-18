import { useVirtualizer } from '@tanstack/react-virtual';
import React, { useEffect, useRef, useState } from 'react';

import { i18nService } from '@/services/i18n';

import { getExtension } from './excelPreprocess';

const t = (key: string) => i18nService.t(key);

interface CellData {
  v: string;
  bgColor?: string;
  fontColor?: string;
  bold?: boolean;
  colSpan?: number;
  rowSpan?: number;
  hidden?: boolean;
}

interface MergeRange {
  sr: number;
  sc: number;
  er: number;
  ec: number;
}

interface SheetData {
  name: string;
  rows: CellData[][];
  colCount: number;
}

interface SheetFallbackRendererProps {
  data: ArrayBuffer;
  fileName: string;
  error?: string | null;
}

const ROW_HEIGHT = 28;
const COL_HEADER_HEIGHT = 28;
const ROW_HEADER_WIDTH = 46;

export const SheetFallbackRenderer: React.FC<SheetFallbackRendererProps> = ({ data, fileName }) => {
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    const parse = async () => {
      try {
        const XLSX = await import('xlsx');
        const ext = getExtension(fileName);
        const workbook = ext === '.csv' || ext === '.tsv'
          ? XLSX.read(new TextDecoder('utf-8').decode(new Uint8Array(data)), {
              type: 'string',
              FS: ext === '.tsv' ? '\t' : undefined,
            })
          : XLSX.read(new Uint8Array(data), { type: 'array', cellStyles: true });

        const parsed: SheetData[] = workbook.SheetNames.map(name => {
          const sheet = workbook.Sheets[name];
          const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
          const colCount = range.e.c - range.s.c + 1;
          const rows: CellData[][] = [];

          for (let r = range.s.r; r <= range.e.r; r++) {
            const row: CellData[] = [];
            for (let c = range.s.c; c <= range.e.c; c++) {
              const addr = XLSX.utils.encode_cell({ r, c });
              const cell = sheet[addr];
              const cellData: CellData = { v: cell ? cell.w ?? String(cell.v ?? '') : '' };
              const style = cell?.s;
              if (style) {
                if (style.fgColor?.rgb) cellData.bgColor = `#${style.fgColor.rgb}`;
                if (style.color?.rgb) cellData.fontColor = `#${style.color.rgb}`;
                if (style.bold) cellData.bold = true;
              }
              row.push(cellData);
            }
            rows.push(row);
          }

          const merges: MergeRange[] = (sheet['!merges'] || []).map((m: { s: { r: number; c: number }; e: { r: number; c: number } }) => ({
            sr: m.s.r - range.s.r,
            sc: m.s.c - range.s.c,
            er: m.e.r - range.s.r,
            ec: m.e.c - range.s.c,
          }));
          applyMerges(rows, merges);

          return { name, rows, colCount };
        });

        if (!cancelled) {
          setSheets(parsed);
          setActiveSheet(0);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };

    parse();
    return () => { cancelled = true; };
  }, [data, fileName]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-red-500">
        {t('artifactDocumentError')}: {error}
      </div>
    );
  }

  if (sheets.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        {t('artifactDocumentLoading')}
      </div>
    );
  }

  const currentSheet = sheets[activeSheet] || sheets[0];
  const colWidth = Math.max(90, Math.min(180, Math.floor(900 / Math.max(currentSheet.colCount, 1))));
  const totalWidth = ROW_HEADER_WIDTH + currentSheet.colCount * colWidth;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white text-[#383a42]">
      {sheets.length > 1 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[#e0e0e0] px-2 py-1">
          {sheets.map((sheet, i) => (
            <button
              key={sheet.name}
              onClick={() => setActiveSheet(i)}
              className={`whitespace-nowrap rounded px-2 py-0.5 text-xs transition-colors ${
                i === activeSheet ? 'bg-[#217346]/10 font-medium text-[#217346]' : 'text-[#666] hover:bg-[#f0f2f5] hover:text-[#383a42]'
              }`}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}

      <div ref={parentRef} className="flex-1 overflow-auto">
        <div style={{ width: totalWidth, minWidth: '100%' }}>
          <ColumnHeaders colCount={currentSheet.colCount} colWidth={colWidth} />
          <VirtualRows rows={currentSheet.rows} parentRef={parentRef} colWidth={colWidth} />
        </div>
      </div>

      <div className="shrink-0 border-t border-[#e0e0e0] px-3 py-1 text-xs text-[#777]">
        {currentSheet.rows.length.toLocaleString()} {t('artifactRowCount')}
      </div>
    </div>
  );
};

function ColumnHeaders({ colCount, colWidth }: { colCount: number; colWidth: number }) {
  return (
    <div className="sticky top-0 z-10 flex border-b border-[#d8d8d8] bg-[#f3f4f6]" style={{ height: COL_HEADER_HEIGHT }}>
      <div className="shrink-0 border-r border-[#d8d8d8]" style={{ width: ROW_HEADER_WIDTH }} />
      {Array.from({ length: colCount }, (_, i) => (
        <div
          key={i}
          className="flex shrink-0 items-center justify-center border-r border-[#d8d8d8] text-[11px] font-medium text-[#666]"
          style={{ width: colWidth }}
        >
          {columnName(i)}
        </div>
      ))}
    </div>
  );
}

const VirtualRows: React.FC<{
  rows: CellData[][];
  parentRef: React.RefObject<HTMLDivElement | null>;
  colWidth: number;
}> = ({ rows, parentRef, colWidth }) => {
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  return (
    <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
      {rowVirtualizer.getVirtualItems().map(virtualRow => {
        const row = rows[virtualRow.index];
        return (
          <div
            key={virtualRow.index}
            className="absolute left-0 top-0 flex border-b border-[#e0e0e0]/70 text-xs"
            style={{ transform: `translateY(${virtualRow.start}px)`, height: ROW_HEIGHT }}
          >
            <div
              className="sticky left-0 z-[1] flex shrink-0 items-center justify-center border-r border-[#d8d8d8] bg-[#f7f7f7] text-[11px] text-[#777]"
              style={{ width: ROW_HEADER_WIDTH }}
            >
              {virtualRow.index + 1}
            </div>
            {row.map((cell, ci) => {
              if (cell.hidden) return null;
              const colSpan = cell.colSpan || 1;
              const rowSpan = cell.rowSpan || 1;
              return (
                <div
                  key={ci}
                  className="flex shrink-0 items-center truncate border-r border-[#e0e0e0]/50 px-2"
                  style={{
                    width: colWidth * colSpan,
                    height: ROW_HEIGHT * rowSpan,
                    backgroundColor: cell.bgColor || undefined,
                    color: cell.fontColor || (cell.bgColor ? contrastingTextColor(cell.bgColor) : undefined),
                    fontWeight: cell.bold ? 700 : undefined,
                  }}
                  title={cell.v}
                >
                  {cell.v}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

function applyMerges(rows: CellData[][], merges: MergeRange[]) {
  for (const m of merges) {
    if (rows[m.sr]?.[m.sc]) {
      rows[m.sr][m.sc].colSpan = m.ec - m.sc + 1;
      rows[m.sr][m.sc].rowSpan = m.er - m.sr + 1;
    }
    for (let r = m.sr; r <= m.er; r++) {
      for (let c = m.sc; c <= m.ec; c++) {
        if (r === m.sr && c === m.sc) continue;
        if (rows[r]?.[c]) rows[r][c].hidden = true;
      }
    }
  }
}

function contrastingTextColor(bgHex: string): string {
  const hex = bgHex.replace('#', '').slice(-6);
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#383a42' : '#ffffff';
}

function columnName(index: number): string {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const mod = (n - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    n = Math.floor((n - mod) / 26);
  }
  return name;
}
