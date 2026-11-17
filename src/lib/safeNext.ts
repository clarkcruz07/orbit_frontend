/**
 * `?next=` after sign-in is honoured only for a same-origin relative path.
 * Anything else (absolute URL, protocol-relative, backslash tricks, control
 * characters, the login page itself) falls back to the supplied default.
 */
export function safeNextPath(value: string | null | undefined, fallback = '/'): string {
  if (typeof value !== 'string') return fallback
  const raw = value.trim()
  if (!raw || raw.length > 2000) return fallback
  if (!raw.startsWith('/')) return fallback
  // "//host" and "/\host" are treated as network paths by browsers.
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback
  // Control characters (tab/newline are stripped by URL parsers and enable "/\t/host") and backslashes.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback
  if (/^\/login(?:[/?#]|$)/i.test(raw)) return fallback
  try {
    const parsed = new URL(raw, 'http://people.invalid')
    if (parsed.origin !== 'http://people.invalid') return fallback
    return parsed.pathname + parsed.search + parsed.hash
  } catch {
    return fallback
  }
}
