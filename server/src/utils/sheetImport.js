const path = require('path');
const ExcelJS = require('exceljs');

/**
 * 表格数据统一解析：xlsx 用 exceljs（SheetJS/xlsx 已知漏洞且无修复版，已弃用），csv 内置解析。
 * 返回 [{表头: 值}] 数组。
 */
async function parseSheetRows(buffer, originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  if (ext === '.csv') return parseCsvRows(buffer);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) return [];

  const headers = {};
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const name = String(cell.value ?? '').trim();
    if (name) headers[colNumber] = name;
  });

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj = {};
    for (const [colNumber, name] of Object.entries(headers)) {
      const cell = row.getCell(Number(colNumber));
      obj[name] = cell.value;
    }
    rows.push(obj);
  });
  return rows;
}

/** 简易 CSV 解析：支持引号包裹与引号转义，兼容 BOM */
function parseCsvRows(buffer) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const parseLine = (line) => {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    return cells;
  };
  const header = parseLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = parseLine(line);
    const obj = {};
    header.forEach((name, idx) => { if (name) obj[name] = cells[idx]; });
    return obj;
  });
}

module.exports = { parseSheetRows, parseCsvRows };
