// Synthetic, fictional upload fixtures for the Documents and HR Requests real-backend specs.
// Every file is built in memory (no real documents, no files on disk). Each builder takes a `marker` so two files of
// the same type have different bytes and a download can be proven to be exactly the file that was uploaded.

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const JPEG_1X1 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='

export const MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

/** A tiny PDF (magic bytes + a marker comment; the service checks type, not rendering). `padKb` makes it larger. */
export function pdf(marker = 'fixture', padKb = 0) {
  const body = `%PDF-1.4\n% ${marker}\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`
  const pad = padKb ? `% ${'x'.repeat(padKb * 1024)}\n` : ''
  return Buffer.from(body + pad, 'latin1')
}

export const png = () => Buffer.from(PNG_1X1, 'base64')
export const jpeg = () => Buffer.from(JPEG_1X1, 'base64')

// ---- a minimal "stored" ZIP writer (docx/xlsx are zip containers)
function crc32(buf) {
  let c
  let crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

function zip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, text] of entries) {
    const nameBuf = Buffer.from(name)
    const data = Buffer.from(text)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += local.length + nameBuf.length + data.length
  }
  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBuf, end])
}

const CONTENT_TYPES = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'

export const docx = (marker = 'fixture') =>
  zip([
    ['[Content_Types].xml', CONTENT_TYPES],
    ['word/document.xml', `<w:document><w:body><w:p><w:r><w:t>${marker}</w:t></w:r></w:p></w:body></w:document>`],
  ])

export const xlsx = (marker = 'fixture') =>
  zip([
    ['[Content_Types].xml', CONTENT_TYPES],
    ['xl/workbook.xml', `<workbook><!-- ${marker} --></workbook>`],
  ])

/** Bytes that are none of the allowed types (a Windows executable header), whatever the file is called. */
export const notAllowed = () => Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 1)])

/** A payload for Playwright's setInputFiles. */
export const upload = (name, buffer, mimeType) => ({ name, mimeType, buffer })
export const asPdf = (name, marker, padKb) => upload(name, pdf(marker, padKb), MIME.pdf)

// date helpers: calendar dates relative to the machine's today (the checks leave wide margins around the 30-day edge)
const pad = (n) => String(n).padStart(2, '0')
export function isoDaysFromToday(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

