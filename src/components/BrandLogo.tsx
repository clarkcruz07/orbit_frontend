import './BrandLogo.css'

/**
 * Bluedge People lockup, recreated as inline SVG + text so it works on both the dark sidebar
 * ("light" variant) and the white login card ("dark" variant). The wordmark uses a handwriting
 * font stack available on the OS; it falls back to cursive.
 */
export function BrandLogo({ variant = 'light', size = 'md' }: { variant?: 'light' | 'dark'; size?: 'md' | 'lg' }) {
  return (
    <div className={`brand-logo brand-logo-${variant} brand-logo-${size}`} role="img" aria-label="Bluedge People">
      <svg className="brand-logo-mark" viewBox="0 0 140 62" aria-hidden="true" focusable="false">
        <text x="4" y="35" className="brand-logo-word">
          bluedge
        </text>
        <path d="M6 47 C 38 36, 92 36, 134 46" fill="none" stroke="#2f86f0" strokeWidth="4" strokeLinecap="round" />
        <path d="M14 55 C 46 46, 92 46, 128 54" fill="none" stroke="#ffc928" strokeWidth="4" strokeLinecap="round" />
      </svg>
      <span className="brand-logo-divider" aria-hidden="true" />
      <span className="brand-logo-people" aria-hidden="true">
        People
      </span>
    </div>
  )
}
