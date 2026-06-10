'use client'

import {
  buildExcelContext,
  downloadMergedExcel,
  isMergeRequest,
  parseExcelFile,
  type ParsedExcelFile,
} from '@/lib/excel-utils'

export type AttachmentKind = 'excel' | 'pdf' | 'image'

export interface ParsedChatAttachment {
  id: string
  fileName: string
  kind: AttachmentKind
  excel?: ParsedExcelFile
  pdfText?: string
  imageDataUrl?: string
  imageMime?: string
}

const EXCEL_EXT = /\.(xlsx|xls|csv)$/i
const PDF_EXT = /\.pdf$/i
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i
const MAX_PDF_PAGES = 25
const MAX_PDF_CHARS = 48_000
const MAX_IMAGE_BYTES = 4 * 1024 * 1024

export function getAttachmentKind(file: File): AttachmentKind | null {
  const name = file.name.toLowerCase()
  const mime = (file.type || '').toLowerCase()
  if (EXCEL_EXT.test(name) || mime.includes('spreadsheet') || mime === 'text/csv') return 'excel'
  if (PDF_EXT.test(name) || mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('image/') || IMAGE_EXT.test(name)) return 'image'
  return null
}

export function isMergeRequestText(text: string): boolean {
  return isMergeRequest(text)
}

export { downloadMergedExcel }

export function getExcelAttachments(attachments: ParsedChatAttachment[]): ParsedExcelFile[] {
  return attachments.filter(a => a.kind === 'excel' && a.excel).map(a => a.excel!)
}

async function parsePdfFile(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`
  }
  const buf = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buf }).promise
  const pageCount = Math.min(doc.numPages, MAX_PDF_PAGES)
  const parts: string[] = []
  let total = 0
  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const text = content.items
      .map(item => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) {
      parts.push(`**Page ${i}**\n${text}`)
      total += text.length
      if (total >= MAX_PDF_CHARS) break
    }
  }
  if (doc.numPages > MAX_PDF_PAGES) {
    parts.push(`_… ${doc.numPages - MAX_PDF_PAGES} more page(s) not included_`)
  }
  return parts.join('\n\n').slice(0, MAX_PDF_CHARS) || '_No extractable text in PDF_'
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'))
    reader.readAsDataURL(file)
  })
}

async function fileToResizedDataUrl(file: File): Promise<{ dataUrl: string; mime: string }> {
  if (file.size <= MAX_IMAGE_BYTES && !/heic|heif/i.test(file.name)) {
    const dataUrl = await readFileAsDataUrl(file)
    const mime = dataUrl.match(/^data:([^;]+);/)?.[1] || file.type || 'image/png'
    return { dataUrl, mime }
  }

  const bitmap = await createImageBitmap(file)
  const maxDim = 1280
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not process image')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  return { dataUrl, mime: 'image/jpeg' }
}

export async function parseChatAttachment(file: File, id: string): Promise<ParsedChatAttachment | null> {
  const kind = getAttachmentKind(file)
  if (!kind) return null

  if (kind === 'excel') {
    const excel = await parseExcelFile(file)
    return { id, fileName: file.name, kind, excel: { ...excel, fileName: file.name } }
  }

  if (kind === 'pdf') {
    const pdfText = await parsePdfFile(file)
    return { id, fileName: file.name, kind, pdfText }
  }

  const { dataUrl, mime } = await fileToResizedDataUrl(file)
  return { id, fileName: file.name, kind, imageDataUrl: dataUrl, imageMime: mime }
}

export function buildAttachmentContext(attachments: ParsedChatAttachment[]): string {
  if (attachments.length === 0) return ''

  const excelFiles = getExcelAttachments(attachments)
  const parts: string[] = []

  if (excelFiles.length > 0) {
    parts.push(buildExcelContext(excelFiles))
  }

  for (const a of attachments) {
    if (a.kind === 'pdf' && a.pdfText) {
      parts.push('---', `### Attached PDF: ${a.fileName}`, a.pdfText)
    }
    if (a.kind === 'image' && a.imageDataUrl) {
      parts.push(
        '---',
        `### Attached image: ${a.fileName}`,
        `MIME: ${a.imageMime || 'image'}`,
        'If you can interpret images, use the data below. Otherwise ask the user to describe the image.',
        `![${a.fileName}](${a.imageDataUrl})`
      )
    }
  }

  return parts.filter(Boolean).join('\n')
}

export function defaultPromptForAttachments(attachments: ParsedChatAttachment[]): string {
  const kinds = new Set(attachments.map(a => a.kind))
  if (kinds.size === 1) {
    if (kinds.has('excel')) return 'Analyse the attached spreadsheet data and summarise key insights.'
    if (kinds.has('pdf')) return 'Analyse the attached PDF and summarise key points.'
    if (kinds.has('image')) return 'Analyse the attached image and describe what you see.'
  }
  return 'Analyse the attached files and summarise key insights.'
}
