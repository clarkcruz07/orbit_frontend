import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, BellOff, CheckCheck } from 'lucide-react'
import { notificationsApi, type NotificationList } from '@/api/notifications'
import { relativeTime } from '@/lib/dates'
import { POLL_INTERVAL_MS, bellLabel, markAllReadLocal, markReadLocal, safeLink, shouldPoll } from '@/lib/notificationsLogic'

/**
 * Header bell: real in-app notifications. The unread dot appears ONLY when the server says unread_count > 0.
 * Polls every 60 s while the tab is visible, and refreshes on window focus / when the tab becomes visible again.
 */
export function NotificationBell() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<NotificationList | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  const anchorRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const seq = useRef(0)

  const refresh = useCallback(() => {
    const mine = ++seq.current
    notificationsApi
      .list()
      .then((l) => {
        if (mine !== seq.current) return // a newer response (or a local update) already won
        setList(l)
        setLoadError(null)
        setNow(new Date())
      })
      .catch(() => {
        if (mine !== seq.current) return
        setLoadError("Notifications couldn't be loaded.")
      })
  }, [])

  // Initial load, 60 s polling while visible, and refresh on focus / visibility.
  useEffect(() => {
    refresh()
    const tick = window.setInterval(() => {
      if (shouldPoll(document.visibilityState)) refresh()
    }, POLL_INTERVAL_MS)
    const onFocus = () => refresh()
    const onVisible = () => {
      if (shouldPoll(document.visibilityState)) refresh()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(tick)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  // Dismiss on outside click / Escape (Escape returns focus to the bell).
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function toggle() {
    setOpen((v) => {
      if (!v) {
        setNow(new Date())
        refresh()
      }
      return !v
    })
  }

  function markOne(id: string): Promise<void> {
    seq.current++ // drop any in-flight list response that predates this change
    setActionError(null)
    setList((l) => (l ? markReadLocal(l, id) : l))
    return notificationsApi
      .markRead(id)
      .then(() => undefined)
      .catch(() => {
        setActionError("That notification couldn't be marked as read.")
        refresh()
      })
  }

  function openItem(id: string, link: string | null) {
    const target = safeLink(link)
    void markOne(id)
    setOpen(false)
    if (target) navigate(target)
  }

  function markAll() {
    seq.current++
    setActionError(null)
    setList((l) => (l ? markAllReadLocal(l) : l))
    notificationsApi.markAllRead().catch(() => {
      setActionError("Notifications couldn't be marked as read.")
      refresh()
    })
  }

  const unread = list?.unread_count ?? 0
  const items = list?.items ?? []

  return (
    <div className="popover-anchor bell-anchor" ref={anchorRef}>
      <button
        ref={buttonRef}
        type="button"
        className="topbar-bell"
        aria-label={bellLabel(unread)}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
        data-testid="bell"
        data-unread={unread}
      >
        <Bell size={24} strokeWidth={1.7} aria-hidden="true" />
        {unread > 0 ? <span className="bell-dot" data-testid="bell-dot" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div className="popover popover-bell" role="dialog" aria-label="Notifications" data-testid="bell-popover">
          <div className="bell-head">
            <strong>Notifications</strong>
            {unread > 0 ? (
              <button type="button" className="bell-markall" onClick={markAll} data-testid="mark-all-read">
                <CheckCheck size={15} aria-hidden="true" /> Mark all as read
              </button>
            ) : null}
          </div>
          {actionError ? (
            <p className="bell-error" role="alert" data-testid="bell-action-error">
              {actionError}
            </p>
          ) : null}
          {list === null && loadError ? (
            <div className="bell-empty" data-testid="bell-error">
              <p className="bell-error" role="alert">
                {loadError}
              </p>
              <button type="button" className="bell-retry" onClick={refresh}>
                Try again
              </button>
            </div>
          ) : list === null ? (
            <p className="bell-empty" role="status" data-testid="bell-loading">
              Loading...
            </p>
          ) : items.length === 0 ? (
            <div className="bell-empty" data-testid="bell-empty">
              <BellOff size={22} aria-hidden="true" />
              <p>You&apos;re all caught up. New updates about your requests will show here.</p>
            </div>
          ) : (
            <ul className="bell-list" data-testid="bell-list">
              {items.map((n) => {
                const link = safeLink(n.link)
                return (
                  <li key={n.notification_id}>
                    <button
                      type="button"
                      className={`bell-item${n.read ? '' : ' unread'}`}
                      onClick={() => openItem(n.notification_id, n.link)}
                      data-testid="bell-item"
                      data-read={n.read ? 'true' : 'false'}
                      title={link ? undefined : 'This notification has no page to open'}
                    >
                      <span className="bell-item-dot" aria-hidden="true" />
                      <span className="bell-item-text">
                        <span className="bell-item-title">{n.title}</span>
                        {n.body ? <span className="bell-item-body">{n.body}</span> : null}
                        <span className="bell-item-time">{relativeTime(n.created_at, now)}</span>
                      </span>
                      {n.read ? null : <span className="sr-only">Unread</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {list !== null && loadError ? <p className="bell-error">{loadError}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
