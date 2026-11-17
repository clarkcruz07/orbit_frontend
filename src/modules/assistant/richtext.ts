/**
 * The restricted Markdown subset used for chat answers and Knowledge Base text: paragraphs (single line breaks kept), **bold**,
 * "- " bullet lists and "1. " numbered lists. Parsed into plain data and drawn as React elements, so markup, links and scripts typed by
 * anyone stay literal text. Shared by the chat bubbles and the Knowledge Base editor preview.
 */
export interface Inline {
  text: string
  bold: boolean
}

export type Block =
  | { type: 'p'; lines: Inline[][] }
  | { type: 'ul'; items: Inline[][] }
  | { type: 'ol'; start: number; items: Inline[][] }

/** `**bold**` into inline pieces; anything else is plain text (never HTML). An unmatched ** stays as typed. */
export function inlines(line: string): Inline[] {
  const out: Inline[] = []
  const re = /\*\*([^*]+)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), bold: false })
    out.push({ text: m[1], bold: true })
    last = m.index + m[0].length
  }
  if (last < line.length) out.push({ text: line.slice(last), bold: false })
  return out.length ? out : [{ text: '', bold: false }]
}

const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*(\d{1,4})[.)]\s+(.*)$/

/** Paragraphs (blank line separated, single line breaks kept), "- " bullet lists and "1. " numbered lists. */
export function richBlocks(textIn: string): Block[] {
  const blocks: Block[] = []
  for (const raw of textIn.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      blocks.push({ type: 'p', lines: [] }) // a paragraph break marker, dropped below
      continue
    }
    const bullet = BULLET.exec(line)
    const numbered = bullet ? null : NUMBERED.exec(line)
    const last = blocks[blocks.length - 1]
    if (bullet) {
      if (last && last.type === 'ul') last.items.push(inlines(bullet[1]))
      else blocks.push({ type: 'ul', items: [inlines(bullet[1])] })
    } else if (numbered) {
      if (last && last.type === 'ol') last.items.push(inlines(numbered[2]))
      else blocks.push({ type: 'ol', start: Number(numbered[1]), items: [inlines(numbered[2])] })
    } else if (last && last.type === 'p') {
      last.lines.push(inlines(line)) // same paragraph, or the empty one a blank line opened
    } else {
      blocks.push({ type: 'p', lines: [inlines(line)] })
    }
  }
  return blocks.filter((b) => (b.type === 'p' ? b.lines.length > 0 : b.items.length > 0))
}
