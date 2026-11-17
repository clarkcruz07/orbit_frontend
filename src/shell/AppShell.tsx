import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { ChatWidget } from '@/modules/assistant/ChatWidget'
import './shell.css'

const NAV_ID = 'primary-navigation'
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()
  const menuRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const close = useCallback(() => setDrawerOpen(false), [])

  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  // Drawer a11y: move focus in on open, trap Tab inside, Escape closes, and focus goes back to the hamburger on close.
  useEffect(() => {
    if (!drawerOpen) {
      if (wasOpen.current) menuRef.current?.focus()
      wasOpen.current = false
      return
    }
    wasOpen.current = true
    const nav = document.getElementById(NAV_ID)
    nav?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawerOpen(false)
        return
      }
      if (e.key !== 'Tab' || !nav) return
      const items = [...nav.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement
      if (!nav.contains(current)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && current === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && current === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  return (
    <div className={`app-shell${drawerOpen ? ' drawer-open' : ''}`}>
      <Sidebar id={NAV_ID} />
      {drawerOpen ? <div className="drawer-scrim" onClick={close} aria-hidden="true" data-testid="drawer-scrim" /> : null}
      <div className="app-main">
        <Header onMenu={() => setDrawerOpen((v) => !v)} menuOpen={drawerOpen} navId={NAV_ID} menuRef={menuRef} />
        <main className="app-content" id="main">
          <Outlet />
        </main>
      </div>
      <ChatWidget />
    </div>
  )
}
