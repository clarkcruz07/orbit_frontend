/**
 * Pure editing helpers for the Knowledge Base text editor. The editor is a plain textarea; these functions turn the text and the selection
 * into new text and a new selection, applying the restricted Markdown subset (**bold**, "- " bullets, "1. " numbering). No DOM, no HTML.
 */
export interface EditState {
  text: string
  /** Selection start and end (caret when equal), as textarea offsets. */
  start: number
  end: number
}

const BOLD = '**'
const BULLET_MARK = '- '
const BULLET_LINE = /^(\s*)[-*•]\s+/
const NUMBER_LINE = /^(\s*)\d{1,4}[.)]\s+/

/** Wraps the selection in **...** (or removes the stars when it is already bold). With no selection it opens an empty pair and puts the caret inside. */
export function toggleBold(s: EditState): EditState {
  const { text, start, end } = s
  const before = text.slice(0, start)
  const sel = text.slice(start, end)
  const after = text.slice(end)
  if (start === end) {
    // caret inside an empty pair: remove it
    if (before.endsWith(BOLD) && after.startsWith(BOLD)) {
      const t = before.slice(0, -2) + after.slice(2)
      return { text: t, start: start - 2, end: start - 2 }
    }
    return { text: `${before}${BOLD}${BOLD}${after}`, start: start + 2, end: start + 2 }
  }
  // stars just outside the selection
  if (before.endsWith(BOLD) && after.startsWith(BOLD)) {
    return { text: before.slice(0, -2) + sel + after.slice(2), start: start - 2, end: end - 2 }
  }
  // stars inside the selection
  if (sel.length >= 4 && sel.startsWith(BOLD) && sel.endsWith(BOLD)) {
    const inner = sel.slice(2, -2)
    return { text: before + inner + after, start, end: start + inner.length }
  }
  return { text: `${before}${BOLD}${sel}${BOLD}${after}`, start: start + 2, end: end + 2 }
}

type ListKind = 'ul' | 'ol'

const stripMarker = (line: string): string => line.replace(BULLET_LINE, '$1').replace(NUMBER_LINE, '$1')
const hasMarker = (line: string, kind: ListKind): boolean => (kind === 'ul' ? BULLET_LINE.test(line) : NUMBER_LINE.test(line))

/** The whole lines the selection touches: [from, to) offsets. A selection ending right after a line break does not take the next line. */
function lineRange(text: string, start: number, end: number): [number, number] {
  const from = text.lastIndexOf('\n', start - 1) + 1
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end
  const nl = text.indexOf('\n', last)
  return [from, nl === -1 ? text.length : nl]
}

/**
 * Turns the selected lines into a bulleted or numbered list, or back into plain lines when they already are that list.
 * Blank lines are left alone; numbering counts the non-blank lines from 1.
 */
export function toggleList(s: EditState, kind: ListKind): EditState {
  const { text, start, end } = s
  const [from, to] = lineRange(text, start, end)
  const lines = text.slice(from, to).split('\n')
  const filled = lines.filter((l) => l.trim().length > 0)
  const target = filled.length === 0 ? lines : filled
  const allList = target.length > 0 && target.every((l) => hasMarker(l, kind))
  let n = 0
  const out = lines.map((line) => {
    if (line.trim().length === 0 && filled.length > 0) return line
    const plain = stripMarker(line)
    if (allList) return plain
    n += 1
    const indent = /^\s*/.exec(plain)?.[0] ?? ''
    const body = plain.slice(indent.length)
    return `${indent}${kind === 'ul' ? BULLET_MARK : `${n}. `}${body}`
  })
  const block = out.join('\n')
  const next = text.slice(0, from) + block + text.slice(to)
  if (start === end) {
    const caret = from + block.length // a single line: caret at its end
    return { text: next, start: caret, end: caret }
  }
  return { text: next, start: from, end: from + block.length }
}

const LIST_ITEM = /^(\s*)(?:([-*•])|(\d{1,4})[.)])\s+(.*)$/

/**
 * Enter inside a list item continues the list (the next bullet or the next number); Enter on an empty item ends the list.
 * Returns null when the caret is not in a list item, so the browser's normal Enter runs.
 */
export function handleEnter(s: EditState): EditState | null {
  const { text, start, end } = s
  if (start !== end) return null
  const from = text.lastIndexOf('\n', start - 1) + 1
  const nl = text.indexOf('\n', start)
  const to = nl === -1 ? text.length : nl
  const line = text.slice(from, to)
  const m = LIST_ITEM.exec(line)
  if (!m) return null
  const indent = m[1]
  const marker = m[2] ? `${m[2] === '•' ? '-' : m[2]} ` : `${m[3]}. `
  const markerEnd = from + line.length - m[4].length // offset where the item text starts
  if (start < markerEnd) return null // caret inside the marker: leave it to the browser
  if (m[4].trim().length === 0) {
    // empty item: end the list (the line becomes empty)
    return { text: text.slice(0, from) + text.slice(to), start: from, end: from }
  }
  const nextMarker = m[3] ? `${Number(m[3]) + 1}. ` : marker
  const insert = `\n${indent}${nextMarker}`
  const caret = start + insert.length
  return { text: text.slice(0, start) + insert + text.slice(start), start: caret, end: caret }
}

/** True when the line holding the caret is a list item of this kind (for the toolbar state). */
export function activeList(s: EditState): ListKind | null {
  const from = s.text.lastIndexOf('\n', s.start - 1) + 1
  const nl = s.text.indexOf('\n', s.start)
  const line = s.text.slice(from, nl === -1 ? s.text.length : nl)
  if (BULLET_LINE.test(line)) return 'ul'
  if (NUMBER_LINE.test(line)) return 'ol'
  return null
}
