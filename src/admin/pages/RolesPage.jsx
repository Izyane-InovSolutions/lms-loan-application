import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Lock, Plus, RotateCcw, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { PERMISSION_GROUPS, SCOPES } from '@/config/roles'
import { api } from '../api'
import { useAuth } from '../auth'
import { Field, FormError, PageHeader, Panel, roleTone, useToast } from '../components'

/**
 * Team → Roles: what each role may do and which applications its members see. Built-in
 * roles can be changed and reset; admins add their own. Any role but the administrator can
 * be deleted once nobody holds it and the workflow doesn't name it; a deleted built-in role
 * can be brought back. The server applies a change to everyone holding the role on their
 * next request.
 */
export function RolesPage() {
  const { refresh } = useAuth()
  const notify = useToast()
  const [state, setState] = useState({ status: 'loading', roles: [], removed: [] })
  const [restoring, setRestoring] = useState(null)
  const [selectedKey, setSelectedKey] = useState('sales_manager')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      const { roles, removed = [] } = await api('/roles')
      setState({ status: 'ready', roles, removed })
      return roles
    } catch (error) {
      setState({ status: 'error', roles: [], removed: [], message: error.message })
      return []
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Everyone's labels and the signed-in person's own permissions follow the change.
  const afterChange = async (message, nextKey) => {
    await Promise.all([load(), refresh()])
    if (nextKey) setSelectedKey(nextKey)
    notify(message)
  }

  const selected = state.roles.find((role) => role.key === selectedKey) || state.roles[0]

  const restore = async (role) => {
    setRestoring(role.key)
    try {
      await api(`/roles/${role.key}/restore`, { method: 'POST' })
      await afterChange(`${role.label} is back, with its default permissions`, role.key)
    } catch (error) {
      notify(error.message)
    } finally {
      setRestoring(null)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roles"
        description="What each role can do, and which applications its members see. A change applies straight away to everyone with that role."
        actions={
          <Button onClick={() => setCreating(true)} disabled={state.status !== 'ready'}>
            <Plus />
            New role
          </Button>
        }
      />
      {state.status === 'loading' ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading roles…
        </p>
      ) : state.status === 'error' ? (
        <FormError message={state.message} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label="Roles" className="space-y-1">
            {state.roles.map((role) => (
              <button
                key={role.key}
                type="button"
                onClick={() => setSelectedKey(role.key)}
                aria-current={selected?.key === role.key ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected?.key === role.key ? 'bg-card shadow-sm ring-1 ring-border' : 'hover:bg-card/60'
                )}
              >
                <span className={cn('size-2 shrink-0 rounded-full', roleTone(role.key).dot)} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">{role.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {role.members ?? 0} {role.members === 1 ? 'person' : 'people'}
                    {!role.builtIn ? ', custom' : role.customized ? ', changed' : ''}
                  </span>
                </span>
                {role.locked ? <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Fixed" /> : null}
              </button>
            ))}
            {state.removed.length ? (
              <div className="mt-4 border-t pt-4">
                <p className="px-3 text-xs font-medium text-muted-foreground">Deleted roles</p>
                <ul className="mt-1 space-y-1">
                  {state.removed.map((role) => (
                    <li key={role.key} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate text-muted-foreground line-through decoration-muted-foreground/50">{role.label}</span>
                      <Button variant="ghost" size="sm" onClick={() => restore(role)} disabled={Boolean(restoring)} aria-label={`Bring back ${role.label}`}>
                        {restoring === role.key ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                        Restore
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </nav>
          {selected ? <RoleEditor key={selected.key} role={selected} onChanged={afterChange} /> : null}
        </div>
      )}
      <NewRoleDialog open={creating} onOpenChange={setCreating} roles={state.roles} onCreated={(role) => afterChange(`${role.label} added`, role.key)} />
    </div>
  )
}

const sameSet = (a, b) => a.length === b.length && a.every((item) => b.includes(item))

function RoleEditor({ role, onChanged }) {
  const [form, setForm] = useState(() => ({ label: role.label, description: role.description || '', scope: role.scope, permissions: role.permissions }))
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const dirty =
    form.label !== role.label || form.description !== (role.description || '') || form.scope !== role.scope || !sameSet(form.permissions, role.permissions)

  const toggle = (key) =>
    setForm((prev) => ({ ...prev, permissions: prev.permissions.includes(key) ? prev.permissions.filter((entry) => entry !== key) : [...prev.permissions, key] }))

  const run = async (kind, request, message) => {
    setBusy(kind)
    setError('')
    try {
      await request()
      await onChanged(message)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(null)
    }
  }

  const save = () => run('save', () => api(`/roles/${role.key}`, { method: 'PATCH', body: form }), `${form.label} saved`)
  const reset = () => run('reset', () => api(`/roles/${role.key}/reset`, { method: 'POST' }), `${role.label} is back to its defaults`)
  const remove = () =>
    run(
      'delete',
      async () => {
        await api(`/roles/${role.key}`, { method: 'DELETE' })
        setConfirmDelete(false)
      },
      `${role.label} deleted`
    )

  const locked = role.locked

  return (
    <Panel
      title={role.label}
      description={
        locked
          ? 'Administrators always have every permission and see every application, so the workspace can never be locked out of its own settings.'
          : role.builtIn
            ? 'A built-in role. You can rename it and change what it can do; “Reset” brings back the defaults.'
            : 'A role added for this workspace.'
      }
    >
      <div className="space-y-6">
        {!locked ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="role-label" label="Name">
              <Input id="role-label" value={form.label} maxLength={60} onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))} />
            </Field>
            <Field id="role-description" label="Description" hint="Shown when someone is given this role.">
              <Input
                id="role-description"
                value={form.description}
                maxLength={300}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              />
            </Field>
          </div>
        ) : null}

        <fieldset>
          <legend className="text-sm font-semibold text-foreground">Applications they see</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {Object.entries(SCOPES).map(([value, scope]) => (
              <label
                key={value}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm',
                  form.scope === value && 'border-primary ring-1 ring-primary',
                  locked && 'cursor-default opacity-70'
                )}
              >
                <input
                  type="radio"
                  name={`scope-${role.key}`}
                  value={value}
                  checked={form.scope === value}
                  disabled={locked}
                  onChange={() => setForm((prev) => ({ ...prev, scope: value }))}
                  className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
                />
                <span>
                  <span className="block font-medium text-foreground">{scope.label}</span>
                  {scope.description ? <span className="mt-0.5 block text-xs text-muted-foreground">{scope.description}</span> : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {PERMISSION_GROUPS.map((group) => (
          <fieldset key={group.label}>
            <legend className="text-sm font-semibold text-foreground">{group.label}</legend>
            <div className="mt-2 divide-y rounded-lg border">
              {group.permissions.map((permission) => (
                <label key={permission.key} className={cn('flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm', locked && 'cursor-default')}>
                  <input
                    type="checkbox"
                    checked={form.permissions.includes(permission.key)}
                    disabled={locked}
                    onChange={() => toggle(permission.key)}
                    className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
                  />
                  <span>
                    <span className="block text-foreground">{permission.label}</span>
                    {permission.description ? <span className="mt-0.5 block text-xs text-muted-foreground">{permission.description}</span> : null}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        <FormError message={error} />

        {!locked ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            <div className="flex gap-2">
              {role.builtIn && role.customized ? (
                <Button variant="ghost" size="sm" onClick={reset} disabled={Boolean(busy)}>
                  {busy === 'reset' ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                  Reset to defaults
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)} disabled={Boolean(busy)}>
                <Trash2 />
                Delete role
              </Button>
            </div>
            <Button size="sm" onClick={save} disabled={!dirty || Boolean(busy) || form.label.trim().length < 2}>
              {busy === 'save' ? <Loader2 className="animate-spin" /> : null}
              Save
            </Button>
          </div>
        ) : null}
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {role.label}?</DialogTitle>
            <DialogDescription>
              {role.members
                ? `${role.members} ${role.members === 1 ? 'person has' : 'people have'} this role. Give them another role in Team first.`
                : role.builtIn
                  ? 'Nobody has this role. It disappears from Team and the workflow editor; you can restore it later under Deleted roles, with its default permissions.'
                  : 'Nobody has this role, so nothing else changes.'}
            </DialogDescription>
          </DialogHeader>
          {/* Why the server refused, e.g. the workflow still names the role. */}
          <FormError message={confirmDelete ? error : ''} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={remove} disabled={Boolean(busy) || Boolean(role.members)}>
              {busy === 'delete' ? <Loader2 className="animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}

function NewRoleDialog({ open, onOpenChange, roles, onCreated }) {
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [from, setFrom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setLabel('')
      setDescription('')
      setFrom('')
      setError('')
    }
  }, [open])

  const template = useMemo(() => roles.find((role) => role.key === from), [roles, from])

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { role } = await api('/roles', {
        method: 'POST',
        body: { label, description, scope: template?.scope || 'own', permissions: template?.permissions || [] },
      })
      onOpenChange(false)
      await onCreated(role)
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New role</DialogTitle>
          <DialogDescription>Start from an existing role to copy what it can do, then adjust it.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Field id="new-role-label" label="Name">
            <Input id="new-role-label" value={label} maxLength={60} onChange={(event) => setLabel(event.target.value)} placeholder="For example: Credit analyst" />
          </Field>
          <Field id="new-role-description" label="Description">
            <Input id="new-role-description" value={description} maxLength={300} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Field id="new-role-from" label="Start from">
            <Select id="new-role-from" value={from} onChange={(event) => setFrom(event.target.value)}>
              <option value="">Nothing (no permissions, own applications only)</option>
              {roles.map((role) => (
                <option key={role.key} value={role.key}>
                  {role.label}
                </option>
              ))}
            </Select>
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || label.trim().length < 2}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              Add role
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
