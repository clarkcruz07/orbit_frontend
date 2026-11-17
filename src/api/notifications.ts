/** In-app notifications API (SPEC_ADDENDUM_2 section 2). Only the caller's own, newest first. No e-mail/push/Teams. */
import { api } from './client'

export interface AppNotification {
  notification_id: string
  kind: string
  title: string
  body: string
  /** In-app path such as /reimbursements/{id}; validated before use. */
  link: string | null
  created_at: string
  read: boolean
}

export interface NotificationList {
  items: AppNotification[]
  unread_count: number
}

export function normaliseNotifications(raw: unknown): NotificationList {
  const r = (raw ?? {}) as Record<string, unknown>
  const items: AppNotification[] = (Array.isArray(r.items) ? r.items : [])
    .map((x) => {
      const n = (x ?? {}) as Record<string, unknown>
      return {
        notification_id: String(n.notification_id ?? ''),
        kind: typeof n.kind === 'string' ? n.kind : '',
        title: typeof n.title === 'string' ? n.title : '',
        body: typeof n.body === 'string' ? n.body : '',
        link: typeof n.link === 'string' && n.link ? n.link : null,
        created_at: typeof n.created_at === 'string' ? n.created_at : '',
        read: n.read === true,
      }
    })
    .filter((n) => n.notification_id)
  const unread = typeof r.unread_count === 'number' && Number.isFinite(r.unread_count) ? Math.max(0, Math.floor(r.unread_count)) : items.filter((i) => !i.read).length
  return { items, unread_count: unread }
}

export const notificationsApi = {
  list: (limit = 30, unreadOnly = false) =>
    api.get<unknown>('/notifications', { params: { limit, unread_only: unreadOnly } }).then((r) => normaliseNotifications(r.data)),
  markRead: (id: string) => api.post(`/notifications/${encodeURIComponent(id)}/read`),
  markAllRead: () => api.post('/notifications/read-all'),
}
