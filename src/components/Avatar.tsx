const PALETTES: [string, string][] = [
  ['#6d5ae6', '#2f86f0'],
  ['#e0793a', '#f2b705'],
  ['#1fa355', '#2f86f0'],
  ['#c2410c', '#e0793a'],
  ['#7c3aed', '#c026d3'],
  ['#0e7490', '#2f86f0'],
]

function hash(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return h
}

/** Initials avatar (no photos anywhere). */
export function Avatar({ name, initials, size = 46 }: { name: string; initials: string; size?: number }) {
  const [from, to] = PALETTES[hash(name) % PALETTES.length]
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.34),
        background: `linear-gradient(135deg, ${from}, ${to})`,
      }}
    >
      {initials}
    </span>
  )
}
