'use client'

import * as XLSX from 'xlsx'

export interface ParsedSheet {
  name: string
  rows: any[][]       // 2-D array including header row
  headers: string[]
}

export interface ParsedExcelFile {
  fileName: string
  sheets: ParsedSheet[]
}

/** Parse a File object into sheets of row data */
export async function parseExcelFile(file: File): Promise<ParsedExcelFile> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const sheets: ParsedSheet[] = wb.SheetNames.map(name => {
    const ws = wb.Sheets[name]
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    const headers = (rows[0] ?? []).map(String)
    return { name, rows, headers }
  })
  return { fileName: file.name, sheets }
}

/** Convert the first 50 data rows of a sheet to a compact markdown table for the AI */
export function sheetToMarkdown(sheet: ParsedSheet, maxRows = 50): string {
  if (sheet.rows.length === 0) return '_empty sheet_'
  const header = sheet.rows[0].map(String)
  const dataRows = sheet.rows.slice(1, maxRows + 1)
  const sep = header.map(() => '---')
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...dataRows.map(r => `| ${header.map((_, i) => String(r[i] ?? '')).join(' | ')} |`),
  ]
  if (sheet.rows.length - 1 > maxRows) {
    lines.push(`_… ${sheet.rows.length - 1 - maxRows} more rows_`)
  }
  return lines.join('\n')
}

/** Build the context block that gets appended to the user message */
export function buildExcelContext(files: ParsedExcelFile[]): string {
  if (files.length === 0) return ''
  const parts: string[] = ['---', '### 📊 Attached Excel Data']
  for (const f of files) {
    parts.push(`\n**File: ${f.fileName}**`)
    for (const sheet of f.sheets) {
      parts.push(`\n_Sheet: ${sheet.name}_ (${sheet.rows.length - 1} rows × ${sheet.headers.length} cols)`)
      parts.push(sheetToMarkdown(sheet))
    }
  }
  return parts.join('\n')
}

/** Merge all sheets from all files into a single workbook and trigger a browser download */
export function downloadMergedExcel(files: ParsedExcelFile[], outName = 'merged.xlsx') {
  const wb = XLSX.utils.book_new()
  const usedNames = new Set<string>()

  for (const f of files) {
    const fileBase = f.fileName.replace(/\.[^.]+$/, '').slice(0, 16)
    for (const sheet of f.sheets) {
      // build a unique sheet name ≤ 31 chars (Excel limit)
      let sheetName = `${fileBase}_${sheet.name}`.slice(0, 31)
      let suffix = 2
      while (usedNames.has(sheetName)) {
        sheetName = `${fileBase}_${sheet.name}`.slice(0, 28) + `_${suffix++}`
      }
      usedNames.add(sheetName)
      const ws = XLSX.utils.aoa_to_sheet(sheet.rows)
      XLSX.utils.book_append_sheet(wb, ws, sheetName)
    }
  }

  // Flat "All Data" sheet — stack all sheets vertically with a source column
  const allRows: any[][] = []
  let first = true
  for (const f of files) {
    for (const sheet of f.sheets) {
      if (sheet.rows.length === 0) continue
      const header = sheet.rows[0]
      if (first) {
        allRows.push(['Source File', 'Sheet', ...header])
        first = false
      }
      for (const row of sheet.rows.slice(1)) {
        allRows.push([f.fileName, sheet.name, ...row])
      }
    }
  }
  if (allRows.length > 0) {
    const allWs = XLSX.utils.aoa_to_sheet(allRows)
    XLSX.utils.book_append_sheet(wb, allWs, 'All Data')
  }

  XLSX.writeFile(wb, outName)
}

/** Detect merge intent in the user's message */
export function isMergeRequest(text: string): boolean {
  return /\b(merge|combine|join|ek karo|ek kar|jod|mila)\b/i.test(text)
}
