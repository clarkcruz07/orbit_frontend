import { useEffect, useState } from 'react'
import { spriteState } from './logic'

/** True when the person asked their system for less motion. Read once and kept in step with the setting. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false))
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return reduced
}

/**
 * The Bluedge Orbit mascot, drawn from one sprite sheet with two frames (public/orbit/orbit-sprite.png):
 * frame 0 = mouth closed (chat off), frame 1 = mouth open (chat on). While `talking` the two frames flap in an uneven rhythm.
 */
export function OrbitMascot({ open, talking, size = 64, testId = 'orbit-mascot' }: { open: boolean; talking: boolean; size?: number; testId?: string }) {
  const reduced = usePrefersReducedMotion()
  const s = spriteState({ open, talking, reducedMotion: reduced })
  return (
    <span
      className={`orbit-mascot${s.animate ? ' orbit-talking' : ''}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={open ? 'Bluedge Orbit, ready to chat' : 'Bluedge Orbit'}
      data-testid={testId}
      data-state={open ? 'open' : 'closed'}
      data-frame={s.frame}
      data-talking={s.animate ? 'true' : 'false'}
    />
  )
}
