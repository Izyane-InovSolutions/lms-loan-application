import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, Copy, Loader2, Mail, Search, Trash2, UserPlus, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { USER_STATUSES, hasPermission, registeredRoles, roleDescription, roleHas, roleLabel } from '@/config/roles'

// Every staff role in the workspace, custom ones included, as the auth provider loaded them.
const staffRoleKeys = () => registeredRoles().map((role) => role.key)

// Who gets a "reports to" picker: people who bring business in without leading a team (agents).
const takesManager = (role) => roleHas(role, 'applications.assist') && !roleHas(role, 'team.lead')

// Who gets an approval band: anyone who reviews or decides cases.
const hasApprovalBand = (role) => roleHas(role, 'cases.work') || roleHas(role, 'cases.decide')
import { api, toQuery } from '../api'
import { useAuth } from '../auth'
import { EmptyState, Field, FormError, Initials, PageHeader, RoleBadge, StatusText, timeAgo, useToast } from '../components'

export function UsersPage() {
  const { user: viewer } = useAuth()
  const canManage = hasPermission(viewer, 'users.manage')
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [result, setResult] = useState({ status: 'loading', users: [] })
  const [editing, setEditing] = useState(null)
  const [inviteOpen, setInviteOpen] = useState(params.get('invite') === '1' && canManage)
  const [managers, setManagers] = useState([])

  const role = params.get('role') || 'all'
  const status = params.get('status') || 'all'

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params)
    if (!value || value === 'all') next.delete(key)
    else next.set(key, value)
    next.delete('invite')
    setParams(next, { replace: true })
  }

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])

  const load = useCallback(async () => {
    setResult((prev) => ({ ...prev, status: prev.users.length ? 'refreshing' : 'loading' }))
    try {
      const { users } = await api(`/users${toQuery({ role, status, q: debouncedSearch })}`)
      setResult({ status: 'ready', users })
    } catch (error) {
      setResult({ status: 'error', users: [], message: error.message })
    }
  }, [role, status, debouncedSearch])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!canManage) return
    api('/users/managers')
      .then(({ managers: list }) => setManagers(list))
      .catch(() => setManagers([]))
  }, [canManage, result.users.length])

  const counts = useMemo(() => {
    const invited = result.users.filter((user) => user.status === 'invited').length
    return { total: result.users.length, invited }
  }, [result.users])

  const isFiltered = role !== 'all' || status !== 'all' || debouncedSearch

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description={
          canManage
            ? 'Invite staff, set their role and, for agents, the relationship manager they report to.'
            : viewer.scope !== 'all'
              ? 'You and the agents who report to you.'
              : 'Everyone on the staff side of the workspace.'
        }
        actions={
          canManage ? (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus />
              Invite someone
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative md:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            placeholder="Search by name or email"
            aria-label="Search people"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-10 pl-9 text-sm"
          />
        </div>
        <div className="flex gap-3">
          <div className="w-48">
            <Select aria-label="Filter by role" value={role} onChange={(event) => setFilter('role', event.target.value)} className="h-10 text-sm">
              <option value="all">All staff roles</option>
              {staffRoleKeys().map((value) => (
                <option key={value} value={value}>
                  {roleLabel(value)}
                </option>
              ))}
              {canManage ? <option value="customer">Customers</option> : null}
            </Select>
          </div>
          <div className="w-40">
            <Select aria-label="Filter by status" value={status} onChange={(event) => setFilter('status', event.target.value)} className="h-10 text-sm">
              <option value="all">Any status</option>
              {Object.entries(USER_STATUSES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <p className="text-sm text-muted-foreground md:ml-auto" aria-live="polite">
          {result.status === 'ready' || result.status === 'refreshing'
            ? `${counts.total} ${counts.total === 1 ? 'person' : 'people'}${counts.invited ? `, ${counts.invited} invited` : ''}`
            : null}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        {result.status === 'loading' ? (
          <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading people…
          </p>
        ) : result.status === 'error' ? (
          <div className="p-6">
            <FormError message={result.message} />
          </div>
        ) : result.users.length === 0 ? (
          <EmptyState
            icon={Users}
            title={isFiltered ? 'No one matches these filters' : 'No staff yet'}
            action={
              isFiltered ? (
                <Button variant="outline" size="sm" onClick={() => { setSearch(''); setParams({}, { replace: true }) }}>
                  Clear filters
                </Button>
              ) : canManage ? (
                <Button size="sm" onClick={() => setInviteOpen(true)}>
                  <UserPlus />
                  Invite someone
                </Button>
              ) : null
            }
          >
            {isFiltered ? 'Try a different name, role or status.' : 'Invite your first loan officer, relationship manager or agent.'}
          </EmptyState>
        ) : (
          <>
          {/* Phones get a stacked list; the table needs more width than they have. */}
          <ul className="divide-y md:hidden">
            {result.users.map((person) => (
              <li key={person.id} className="flex items-start gap-3 px-4 py-3.5">
                <Initials name={person.name} className="bg-secondary text-secondary-foreground" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div>
                    <p className="truncate text-sm font-medium text-foreground">
                      {person.name}
                      {person.id === viewer.id ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span> : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{person.email}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <RoleBadge role={person.role} />
                    <StatusText status={person.status} />
                    {person.managerName ? <span className="text-xs text-muted-foreground">Reports to {person.managerName}</span> : null}
                  </div>
                </div>
                {canManage && person.role !== 'customer' ? (
                  <Button variant="ghost" size="sm" onClick={() => setEditing(person)}>
                    Edit
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] text-sm">
              <caption className="sr-only">Staff accounts</caption>
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                  <th scope="col" className="px-5 py-3 font-medium">Person</th>
                  <th scope="col" className="px-5 py-3 font-medium">Role</th>
                  <th scope="col" className="px-5 py-3 font-medium">Reports to</th>
                  <th scope="col" className="px-5 py-3 font-medium">Status</th>
                  <th scope="col" className="px-5 py-3 font-medium">Last signed in</th>
                  {canManage ? <th scope="col" className="px-5 py-3"><span className="sr-only">Actions</span></th> : null}
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.users.map((person) => (
                  <tr key={person.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Initials name={person.name} className="bg-secondary text-secondary-foreground" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">
                            {person.name}
                            {person.id === viewer.id ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span> : null}
                            {person.isDemo ? <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">Demo</span> : null}
                            {person.twoFactorEnabled ? <span className="ml-1.5 rounded bg-success/10 px-1.5 py-0.5 text-[11px] font-medium text-success" title="Uses two-step sign-in">2-step</span> : null}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{person.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3"><RoleBadge role={person.role} /></td>
                    <td className="px-5 py-3 text-muted-foreground">{person.managerName || '—'}</td>
                    <td className="px-5 py-3"><StatusText status={person.status} /></td>
                    <td className="px-5 py-3 text-muted-foreground">{person.status === 'invited' ? 'Not yet' : timeAgo(person.lastLoginAt)}</td>
                    {canManage ? (
                      <td className="px-5 py-3 text-right">
                        {person.role !== 'customer' ? (
                          <>
                            {hasPermission(viewer, 'audit.view') ? (
                              <Button variant="ghost" size="sm" asChild>
                                <Link to={`/admin/audit?actor=${person.id}`}>Activity</Link>
                              </Button>
                            ) : null}
                            <Button variant="ghost" size="sm" onClick={() => setEditing(person)}>
                              Edit
                            </Button>
                          </>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {canManage ? (
        <>
          <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} managers={managers} onInvited={load} />
          <EditDialog person={editing} viewer={viewer} managers={managers} onClose={() => setEditing(null)} onSaved={load} />
        </>
      ) : null}
    </div>
  )
}

/** Shown when an email could not be sent, so the admin can pass the link on themselves. */
function ManualLink({ url }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
      <p className="text-foreground">We couldn’t send the email. Copy this link and send it to them directly — it works once.</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1.5 text-xs">{url}</code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => navigator.clipboard.writeText(url).then(() => setCopied(true)).catch(() => {})}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  )
}

const EMPTY_INVITE = { name: '', email: '', role: 'loan_officer', phone: '', managerId: '' }

function InviteDialog({ open, onOpenChange, managers, onInvited }) {
  const notify = useToast()
  const [form, setForm] = useState(EMPTY_INVITE)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [manualUrl, setManualUrl] = useState(null)

  useEffect(() => {
    if (open) {
      setForm(EMPTY_INVITE)
      setError('')
      setManualUrl(null)
    }
  }, [open])

  const update = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const result = await api('/users', {
        method: 'POST',
        body: { ...form, managerId: takesManager(form.role) ? form.managerId || null : null },
      })
      onInvited()
      if (result.emailed) {
        notify(`Invitation sent to ${result.user.email}`)
        onOpenChange(false)
      } else {
        setManualUrl(result.inviteUrl)
      }
    } catch (inviteError) {
      setError(inviteError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite someone</DialogTitle>
          <DialogDescription>They’ll get an email with a link to set their password. The link works for 7 days.</DialogDescription>
        </DialogHeader>
        {manualUrl ? (
          <div className="space-y-4">
            <ManualLink url={manualUrl} />
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <Field id="invite-name" label="Full name">
              <Input id="invite-name" autoFocus value={form.name} onChange={update('name')} />
            </Field>
            <Field id="invite-email" label="Work email">
              <Input id="invite-email" type="email" value={form.email} onChange={update('email')} />
            </Field>
            <Field id="invite-role" label="Role" hint={roleDescription(form.role)}>
              <Select id="invite-role" value={form.role} onChange={update('role')}>
                {staffRoleKeys().map((value) => (
                  <option key={value} value={value}>
                    {roleLabel(value)}
                  </option>
                ))}
              </Select>
            </Field>
            {takesManager(form.role) ? (
              <Field
                id="invite-manager"
                label="Reports to"
                hint={managers.length ? 'Their relationship manager sees the applications they bring in.' : 'Invite a relationship manager first to assign one.'}
              >
                <Select id="invite-manager" value={form.managerId} onChange={update('managerId')}>
                  <option value="">No relationship manager yet</option>
                  {managers.map((manager) => (
                    <option key={manager.id} value={manager.id}>
                      {manager.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field id="invite-phone" label="Phone (optional)">
              <Input id="invite-phone" type="tel" autoComplete="off" value={form.phone} onChange={update('phone')} />
            </Field>
            <FormError message={error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !form.name.trim() || !form.email.trim()}>
                {submitting ? <Loader2 className="animate-spin" /> : <Mail />}
                Send invitation
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function EditDialog({ person, viewer, managers, onClose, onSaved }) {
  const notify = useToast()
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [sendingLink, setSendingLink] = useState(false)
  const [manualUrl, setManualUrl] = useState(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    if (person) {
      setConfirmingDelete(false)
      setForm({
        name: person.name,
        phone: person.phone || '',
        role: person.role,
        managerId: person.managerId || '',
        approvalMin: person.approvalMin ?? 0,
        approvalMax: person.approvalMax ?? '',
      })
      setError('')
      setManualUrl(null)
    }
  }, [person])

  if (!person || !form) return null
  const isSelf = person.id === viewer.id
  const update = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))

  const save = async (changes, message) => {
    setError('')
    setSaving(true)
    try {
      await api(`/users/${person.id}`, { method: 'PATCH', body: changes })
      onSaved()
      notify(message)
      onClose()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    save(
      {
        name: form.name,
        phone: form.phone,
        role: form.role,
        managerId: takesManager(form.role) ? form.managerId || null : null,
        approvalMin: form.approvalMin,
        approvalMax: form.approvalMax,
      },
      'Changes saved'
    )
  }

  const remove = async () => {
    setError('')
    setSaving(true)
    try {
      await api(`/users/${person.id}`, { method: 'DELETE' })
      onSaved()
      notify(`${person.name}’s account has been deleted`)
      onClose()
    } catch (deleteError) {
      setError(deleteError.message)
      setConfirmingDelete(false)
    } finally {
      setSaving(false)
    }
  }

  const sendLink = async () => {
    setError('')
    setSendingLink(true)
    try {
      const result = await api(`/users/${person.id}/password-link`, { method: 'POST' })
      if (result.emailed) {
        notify(result.purpose === 'invite' ? 'Invitation sent again' : 'Password reset link sent')
      } else if (result.inviteUrl) {
        setManualUrl(result.inviteUrl)
      } else {
        // Reset links only ever go to the person's own mailbox, so there is nothing to copy.
        setError('The reset link couldn’t be emailed. Check the email settings, or ask them to use “Forgot password” once email works.')
      }
    } catch (linkError) {
      setError(linkError.message)
    } finally {
      setSendingLink(false)
    }
  }

  const managerChoices = managers.filter((manager) => manager.id !== person.id)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{person.name}</DialogTitle>
          <DialogDescription>{person.email}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field id="edit-name" label="Full name">
            <Input id="edit-name" value={form.name} onChange={update('name')} />
          </Field>
          <Field id="edit-role" label="Role" hint={isSelf ? 'You can’t change your own role.' : roleDescription(form.role)}>
            <Select id="edit-role" value={form.role} onChange={update('role')} disabled={isSelf}>
              {staffRoleKeys().map((value) => (
                <option key={value} value={value}>
                  {roleLabel(value)}
                </option>
              ))}
            </Select>
          </Field>
          {takesManager(form.role) ? (
            <Field id="edit-manager" label="Reports to">
              <Select id="edit-manager" value={form.managerId} onChange={update('managerId')}>
                <option value="">No relationship manager</option>
                {managerChoices.map((manager) => (
                  <option key={manager.id} value={manager.id}>
                    {manager.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field id="edit-phone" label="Phone">
            <Input id="edit-phone" type="tel" value={form.phone} onChange={update('phone')} />
          </Field>
          {hasApprovalBand(form.role) ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="edit-approval-min" label="Minimum approval amount (K)" hint="Applications outside this band cannot be assigned to this person or approved by them.">
                <Input id="edit-approval-min" type="number" min="0" step="1" value={form.approvalMin} onChange={update('approvalMin')} />
              </Field>
              <Field id="edit-approval-max" label="Maximum approval amount (K)" hint="Leave blank for no upper limit.">
                <Input id="edit-approval-max" type="number" min="0" step="1" value={form.approvalMax} onChange={update('approvalMax')} />
              </Field>
            </div>
          ) : null}

          {manualUrl ? <ManualLink url={manualUrl} /> : null}
          <FormError message={error} />

          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            {person.status !== 'disabled' ? (
              <Button type="button" variant="outline" size="sm" onClick={sendLink} disabled={sendingLink}>
                {sendingLink ? <Loader2 className="animate-spin" /> : <Mail />}
                {person.status === 'invited' ? 'Resend invitation' : 'Send password reset'}
              </Button>
            ) : null}
            {!isSelf && person.twoFactorEnabled ? (
              <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => save({ resetTwoFactor: true }, `${person.name} can set up two-step sign-in again`)}>
                Reset two-step sign-in
              </Button>
            ) : null}
            {!isSelf ? (
              person.status === 'disabled' ? (
                <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => save({ status: 'active' }, `${person.name} can sign in again`)}>
                  Enable account
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={saving}
                  onClick={() => save({ status: 'disabled' }, `${person.name} has been signed out and can no longer sign in`)}
                >
                  Disable account
                </Button>
              )
            ) : null}
            {!isSelf && !confirmingDelete ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={saving}
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 />
                Delete account
              </Button>
            ) : null}
          </div>

          {confirmingDelete ? (
            <div role="alertdialog" aria-labelledby="delete-title" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
              <p id="delete-title" className="font-semibold text-foreground">
                Delete {person.name}’s account?
              </p>
              <p className="mt-1 text-muted-foreground">
                They’re signed out and can never sign in again, and their email, phone and password are erased (the email can be invited again). Cases and decisions they were part of keep their name, so the records still say who did what. This can’t be undone.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setConfirmingDelete(false)} disabled={saving}>
                  Keep the account
                </Button>
                <Button type="button" variant="destructive" size="sm" onClick={remove} disabled={saving}>
                  {saving ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  Delete account
                </Button>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || form.name.trim().length < 2}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
