import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'

import { STAFF_SHEET, buildStaffTemplate, staffCsvFromWorkbook } from '../src/admin/staffListFile.js'
import { parseStaffCsv } from '../src/config/partners.js'

/** Writes a workbook to .xlsx bytes and opens it again, as an upload would. */
const roundTrip = async (workbook) => {
  const reopened = new ExcelJS.Workbook()
  await reopened.xlsx.load(await workbook.xlsx.writeBuffer())
  return reopened
}

describe('staff list as an Excel file', () => {
  it('gives a template whose blank sheet uploads nobody, with text columns', async () => {
    const workbook = await roundTrip(buildStaffTemplate(ExcelJS, 'Ministry of Education'))
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([STAFF_SHEET, 'Instructions'])
    const sheet = workbook.getWorksheet(STAFF_SHEET)
    expect(sheet.getColumn(2).numFmt).toBe('@')
    // Only the header row: the instructions' example NRC is never read.
    expect(parseStaffCsv(staffCsvFromWorkbook(workbook))).toEqual({ rows: [], errors: [], missingHeader: false })
  })

  it('reads a filled-in template: leading zeros, commas in names, rich text, skipped blank rows', async () => {
    const template = buildStaffTemplate(ExcelJS, '')
    const sheet = template.getWorksheet(STAFF_SHEET)
    sheet.addRow(['123456/78/9', '00123', 'Banda, Ada'])
    sheet.addRow([])
    sheet.addRow([{ richText: [{ text: '234567/89/1' }] }, 'E-2', 'Mutale "MC" Chanda'])
    sheet.addRow(['not-an-nrc', 'E-3', 'Nobody'])
    const { rows, errors } = parseStaffCsv(staffCsvFromWorkbook(await roundTrip(template)))
    expect(rows).toEqual([
      { nrc: '123456/78/9', employeeNumber: '00123', name: 'Banda, Ada' },
      { nrc: '234567/89/1', employeeNumber: 'E-2', name: 'Mutale "MC" Chanda' },
    ])
    expect(errors).toHaveLength(1)
  })

  it('reads a sheet of its own making too: the first sheet, any header spelling', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Sheet1')
    sheet.addRow(['Man Number', 'Full Name', 'NRC'])
    sheet.addRow([4521, 'Ada Banda', '123456/78/9'])
    const { rows } = parseStaffCsv(staffCsvFromWorkbook(await roundTrip(workbook)))
    expect(rows).toEqual([{ nrc: '123456/78/9', employeeNumber: '4521', name: 'Ada Banda' }])
  })
})
