import { richBlocks, type Inline } from './richtext'

function Pieces({ pieces }: { pieces: Inline[] }) {
  return (
    <>
      {pieces.map((p, k) => (p.bold ? <strong key={k}>{p.text}</strong> : <span key={k}>{p.text}</span>))}
    </>
  )
}

/** Draws the Markdown subset (see richtext.ts) as React elements. Never HTML: whatever was typed is shown as text. */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {richBlocks(text).map((b, i) => {
        if (b.type === 'ul') {
          return (
            <ul key={i} className="or-list">
              {b.items.map((item, j) => (
                <li key={j}>
                  <Pieces pieces={item} />
                </li>
              ))}
            </ul>
          )
        }
        if (b.type === 'ol') {
          return (
            <ol key={i} className="or-list" start={b.start}>
              {b.items.map((item, j) => (
                <li key={j}>
                  <Pieces pieces={item} />
                </li>
              ))}
            </ol>
          )
        }
        return (
          <p key={i} className="or-p">
            {b.lines.map((line, j) => (
              <span key={j}>
                {j > 0 ? <br /> : null}
                <Pieces pieces={line} />
              </span>
            ))}
          </p>
        )
      })}
    </>
  )
}
