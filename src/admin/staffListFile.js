import { STAFF_CSV_COLUMNS } from '@/config/partners'

/*
 * A partner's staff list as a file: the Excel template to fill in, and reading an upload
 * (Excel or CSV) into the CSV text the server reads (POST /admin/partners/:id/staff,
 * parseStaffCsv). ExcelJS is loaded only when an admin downloads or uploads a spreadsheet,
 * so applicants never download it.
 */

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const STAFF_SHEET = 'Staff list'
const INSTRUCTIONS_SHEET = 'Instructions'

const loadExcel = async () => (await import('exceljs')).default

export const isSpreadsheet = (file) => file?.type === XLSX_TYPE || /\.xlsx$/i.test(file?.name || '')

/** The text a cell shows, whatever ExcelJS holds for it: rich text, a formula's result, a link, a date. */
const cellText = (value) => {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('')
    if ('result' in value) return cellText(value.result)
    if ('text' in value) return cellText(value.text)
    return ''
  }
  return String(value)
}

const csvCell = (text) => (/[",;\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text)

/**
 * The staff sheet of a workbook as CSV text: the sheet called "Staff list", else the first
 * that isn't the instructions. Empty rows are left out.
 */
export const staffCsvFromWorkbook = (workbook) => {
  const sheet = workbook.getWorksheet(STAFF_SHEET) || workbook.worksheets.find((entry) => entry.name !== INSTRUCTIONS_SHEET)
  if (!sheet) return ''
  const lines = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const width = Math.max(row.cellCount, STAFF_CSV_COLUMNS.length)
    const cells = Array.from({ length: width }, (_, index) => cellText(row.getCell(index + 1).value).trim())
    if (cells.some(Boolean)) lines.push(cells.map(csvCell).join(','))
  })
  return lines.join('\n')
}

/** The staff list template: a "Staff list" sheet with the columns as text, and the instructions beside it. */
export const buildStaffTemplate = (ExcelJS, partnerName) => {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Loan Workspace'
  const sheet = workbook.addWorksheet(STAFF_SHEET, { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = [
    { header: 'nrc', key: 'nrc', width: 18 },
    { header: 'employee_number', key: 'employee_number', width: 20 },
    { header: 'name', key: 'name', width: 34 },
  ]
  // Text, so Excel keeps an employee number's leading zeros and never turns an NRC into a number.
  sheet.columns.forEach((column) => {
    column.numFmt = '@'
  })
  const header = sheet.getRow(1)
  header.font = { bold: true }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF4' } }

  const help = workbook.addWorksheet(INSTRUCTIONS_SHEET)
  help.getColumn(1).width = 100
  const lines = [
    [`Staff list${partnerName ? ` for ${partnerName}` : ''}`, { bold: true, size: 14 }],
    [''],
    ['Fill in the "Staff list" sheet: one person per row, from row 2.'],
    ['nrc (required): the NRC as printed, e.g. 123456/78/9.'],
    ['employee_number (optional): their staff or man number.'],
    ['name (optional): their full name.'],
    [''],
    ['Rows without a valid NRC are skipped, and a repeated NRC is counted once.'],
    ['Upload this file (.xlsx) or a CSV with the same columns. Each upload replaces the last list.'],
    ['This sheet is never read, so nothing here is uploaded.'],
  ]
  lines.forEach(([text, font], index) => {
    const cell = help.getCell(index + 1, 1)
    cell.value = text
    if (font) cell.font = font
  })
  return workbook
}

/** Saves the template as staff-list-<partner>.xlsx. */
export const downloadStaffTemplate = async (partner) => {
  const ExcelJS = await loadExcel()
  const buffer = await buildStaffTemplate(ExcelJS, partner.name).xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buffer], { type: XLSX_TYPE }))
  const link = document.createElement('a')
  link.href = url
  link.download = `staff-list-${partner.id || 'partner'}.xlsx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** An uploaded staff list (Excel or CSV) as the CSV text the server reads. */
export const readStaffFile = async (file) => {
  if (/\.xls$/i.test(file.name || '')) throw new Error('That is an older Excel file (.xls). Save it as .xlsx or CSV, then upload it again.')
  if (!isSpreadsheet(file)) return file.text()
  const ExcelJS = await loadExcel()
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(await file.arrayBuffer())
  } catch {
    throw new Error('That spreadsheet couldn’t be opened. Save it again as .xlsx or CSV, then upload it.')
  }
  return staffCsvFromWorkbook(workbook)
}
