/** Pure notification helpers (no DOM, no network). */
import type { AppNotification, NotificationList } from '@/api/notifications'
import { safeNextPath } from './safeNext'

/** Poll the list this often while the tab is visible (also on window focus / becoming visible). */
export const POLL_INTERVAL_MS = 60_000

/** Accessible name for the bell: the count only when something is unread. */
export function bellLabel(unread: number): string {
  return unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'
}

/** Only same-origin in-app paths are followed; anything else is treated as "no link". */
export function safeLink(link: string | null | undefined): string | null {
  if (!link) return null
  const path = safeNextPath(link, '')
  return path || null
}

export function markReadLocal(list: NotificationList, id: string): NotificationList {
  let changed = false
  const items = list.items.map((n) => {
    if (n.notification_id === id && !n.read) {
      changed = true
      return { ...n, read: true }
    }
    return n
  })
  return changed ? { items, unread_count: Math.max(0, list.unread_count - 1) } : list
}

export function markAllReadLocal(list: NotificationList): NotificationList {
  return { items: list.items.map((n) => (n.read ? n : { ...n, read: true })), unread_count: 0 }
}

export function unreadItems(items: readonly AppNotification[]): AppNotification[] {
  return items.filter((n) => !n.read)
}

/** Polling pauses while the tab is hidden. */
export function shouldPoll(visibility: DocumentVisibilityState | string): boolean {
  return visibility === 'visible'
}
