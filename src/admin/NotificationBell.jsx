import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck } from 'lucide-react'

import { cn } from '@/lib/utils'
import { api } from './api'
import { timeAgo } from './components'

const POLL_MS = 60 * 1000

/** The bell: unread count, and the latest notifications in a panel. Polls once a minute. */
export function NotificationBell({ tone = 'dark' }) {
  const navigate = useNavigate()
  const [data, setData] = useState({ notifications: [], unread: 0 })
  const [open, setOpen] = useState(false)
  const panel = useRef(null)

  const load = useCallback(() => api('/notifications').then(setData).catch(() => {}), [])

  useEffect(() => {
    load()
    const timer = setInterval(load, POLL_MS)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  useEffect(() => {
    if (!open) return undefined
    const close = (event) => {
      if (event.key === 'Escape' || (event.type === 'mousedown' && panel.current && !panel.current.contains(event.target))) setOpen(false)
    }
    document.addEventListener('keydown', close)
    document.addEventListener('mousedown', close)
    return () => {
      document.removeEventListener('keydown', close)
      document.removeEventListener('mousedown', close)
    }
  }, [open])

  const openItem = async (item) => {
    setOpen(false)
    if (!item.readAt) api('/notifications/read', { method: 'POST', body: { ids: [item.id] } }).then(load).catch(() => {})
    if (item.applicationId) navigate(`/admin/applications/${item.applicationId}`)
  }

  const readAll = async () => {
    const { unread } = await api('/notifications/read', { method: 'POST', body: { all: true } })
    setData((prev) => ({ ...prev, unread, notifications: prev.notifications.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })) }))
  }

  return (
    <div className="relative" ref={panel}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={data.unread ? `Notifications, ${data.unread} unread` : 'Notifications'}
        className={cn(
          'relative rounded-md p-2 focus-visible:outline-none focus-visible:ring-2',
          tone === 'dark' ? 'text-white/75 hover:bg-white/10 hover:text-white focus-visible:ring-white/60' : 'text-muted-foreground hover:bg-muted focus-visible:ring-ring'
        )}
      >
        <Bell className="size-5" aria-hidden="true" />
        {data.unread ? (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold leading-none text-white">
            {data.unread > 9 ? '9+' : data.unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lift lg:left-auto lg:right-auto">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            {data.unread ? (
              <button type="button" onClick={readAll} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <CheckCheck className="size-3.5" aria-hidden="true" />
                Mark all read
              </button>
            ) : null}
          </div>
          {data.notifications.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing yet. New applications and cases that need you show up here.</p>
          ) : (
            <ul className="max-h-96 divide-y overflow-y-auto">
              {data.notifications.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => openItem(item)} className={cn('flex w-full gap-3 px-4 py-3 text-left hover:bg-muted/50', !item.readAt && 'bg-primary/[0.04]')}>
                    <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', item.readAt ? 'bg-transparent' : 'bg-brand')} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block text-sm text-foreground">{item.title}</span>
                      {item.body ? <span className="block truncate text-xs text-muted-foreground">{item.body}</span> : null}
                      <span className="block text-[11px] text-muted-foreground">{timeAgo(item.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
