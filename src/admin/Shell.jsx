import React, { Suspense, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Loader2, LogOut, Menu, Moon, Sun, X } from 'lucide-react'

import { Logo } from '@/components/brand/Logo'
import { cn } from '@/lib/utils'
import { ROLES, roleLabel } from '@/config/roles'
import { useAuth } from './auth'
import { navFor } from './navigation'
import { useWorkspaceTheme } from './theme'
import { Initials, PageErrorBoundary, ROLE_TONES, useToast } from './components'
import { NotificationBell } from './NotificationBell'

/**
 * The staff workspace frame: a navy sidebar carrying the navigation and the signed-in
 * person, and the page on a cool canvas beside it. Below lg the sidebar becomes a
 * drawer opened from a slim top bar.
 */
export function Shell() {
  const { user, demoEnabled } = useAuth()
  const { theme, toggle } = useWorkspaceTheme()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  // Close the drawer after navigating.
  useEffect(() => setDrawerOpen(false), [location.pathname])

  useEffect(() => {
    if (!drawerOpen) return undefined
    const onKey = (event) => event.key === 'Escape' && setDrawerOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  return (
    <div className="min-h-screen bg-[hsl(210_33%_96%)] text-foreground dark:bg-background">
      <a
        href="#workspace-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow-lift"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 lg:block">
        <Sidebar user={user} demoEnabled={demoEnabled} theme={theme} onToggleTheme={toggle} />
      </aside>

      {/* Mobile top bar and drawer */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-[hsl(205_65%_14%)] px-4 text-white lg:hidden">
        <Link to="/admin" className="flex items-center gap-2.5 font-semibold">
          <Logo size="sm" showWordmark={false} />
          Loan workspace
        </Link>
        <div className="flex items-center gap-1">
          <NotificationBell />
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="rounded-md p-2 text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
          >
            <Menu className="size-5" />
          </button>
        </div>
      </div>

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-lift">
            <Sidebar user={user} demoEnabled={demoEnabled} theme={theme} onToggleTheme={toggle} />
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="absolute right-3 top-4 rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
              aria-label="Close navigation"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>
      ) : null}

      <main id="workspace-main" className="lg:pl-64">
        <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          <PageErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={<Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />}>
              <Outlet />
            </Suspense>
          </PageErrorBoundary>
        </div>
      </main>
    </div>
  )
}

function Sidebar({ user, demoEnabled, theme, onToggleTheme }) {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const sections = navFor(user.role)

  const handleSignOut = async () => {
    await signOut()
    navigate('/admin/login', { replace: true })
  }

  return (
    <div className="flex h-full flex-col bg-[hsl(205_65%_14%)] text-white dark:border-r dark:border-white/10 dark:bg-[hsl(210_45%_9%)]">
      <div className="flex items-center justify-between gap-2 pb-6 pl-5 pr-3 pt-5">
        <Link to="/admin" className="flex items-center gap-3 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
          <Logo size="sm" showWordmark={false} />
          <span className="leading-tight">
            <span className="block text-[0.95rem] font-semibold">Loan workspace</span>
            <span className="block text-xs text-white/55">iZyane origination</span>
          </span>
        </Link>
        <span className="hidden lg:block">
          <NotificationBell />
        </span>
      </div>

      <nav aria-label="Workspace" className="flex-1 space-y-6 overflow-y-auto px-3">
        {sections.map((section) => (
          <div key={section.label}>
            <p className="px-3 pb-1.5 text-xs font-medium text-white/45">{section.label}</p>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
                        isActive ? 'bg-white/[0.12] text-white' : 'text-white/70 hover:bg-white/[0.06] hover:text-white'
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {/* The active page is marked with a rocket-red rule — the one place red appears at rest. */}
                        <span
                          aria-hidden="true"
                          className={cn('absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-brand transition-opacity', isActive ? 'opacity-100' : 'opacity-0')}
                        />
                        <item.icon className="size-4 shrink-0" aria-hidden="true" />
                        {item.label}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {demoEnabled ? <DemoSwitcher currentRole={user.role} /> : null}

      <div className="border-t border-white/10 p-3">
        <Link to="/admin/profile" className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60" title="Your profile and security">
          <Initials name={user.name} className="bg-white/15 text-white" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-white/55">{roleLabel(user.role)}</p>
          </div>
        </Link>
        <div className="mt-1 flex gap-1">
          <button
            type="button"
            onClick={onToggleTheme}
            className="flex flex-1 items-center justify-center gap-2 rounded-md px-2 py-2 text-xs font-medium text-white/70 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            {theme === 'dark' ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex flex-1 items-center justify-center gap-2 rounded-md px-2 py-2 text-xs font-medium text-white/70 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}

const DEMO_ORDER = ['admin', 'loan_officer', 'sales_manager', 'rm', 'dsa']

/**
 * Only in demo mode: switch the signed-in role in place, so a walkthrough can show what
 * each person sees without signing out and back in.
 */
function DemoSwitcher({ currentRole }) {
  const { signInAsDemo } = useAuth()
  const notify = useToast()
  const navigate = useNavigate()
  const [pending, setPending] = useState(null)

  const switchTo = async (role) => {
    if (role === currentRole || pending) return
    setPending(role)
    try {
      await signInAsDemo(role)
      navigate('/admin')
      notify(`Now viewing as ${roleLabel(role).toLowerCase()}`)
    } catch (error) {
      notify(error.message, { tone: 'error' })
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="mx-3 mb-3 rounded-lg bg-white/[0.06] p-3">
      <p className="text-xs font-medium text-white/60">Viewing as</p>
      <div className="mt-2 flex flex-wrap gap-1" role="radiogroup" aria-label="Demo role">
        {DEMO_ORDER.map((role) => {
          const active = role === currentRole
          return (
            <button
              key={role}
              type="button"
              role="radio"
              aria-checked={active}
              title={ROLES[role].description}
              onClick={() => switchTo(role)}
              disabled={Boolean(pending)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-60',
                active ? 'bg-white text-[hsl(205_65%_14%)]' : 'text-white/75 hover:bg-white/10 hover:text-white'
              )}
            >
              {/* The admin hue is the sidebar's own navy, so it gets a light ring to stay visible. */}
              <span className={cn('size-1.5 rounded-full', ROLE_TONES[role].dot, role === 'admin' && 'ring-1 ring-white/70')} aria-hidden="true" />
              {pending === role ? 'Switching…' : shortRole(role)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const SHORT_ROLE = { admin: 'Admin', loan_officer: 'Officer', sales_manager: 'Sales', rm: 'RM', dsa: 'DSA' }
const shortRole = (role) => SHORT_ROLE[role] || roleLabel(role)
