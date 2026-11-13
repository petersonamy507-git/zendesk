import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Check } from 'lucide-react'
import { FormFooter, Page, SettingsLayout } from '@/components/layout/Page'
import { Avatar, Button, Checkbox, ConfirmDialog, Dropdown, FormField, Input, Modal, MultiSelect, Notice, Select, StatusBadge, Tag, Textarea, toast, type ColumnDef } from '@/components/ui'
import { api, apiError } from '@/services/api'
import { useAuth } from '@/stores/auth'
import type { Agent, Department } from '@/types'
import { ResourceListPage } from '../components/ResourceListPage'

interface RoleRow {
  id: string
  key: string
  name: string
  description: string | null
  is_system: boolean
  permissions: string[]
}

const useRoles = () => useQuery({ queryKey: ['roles'], queryFn: () => api.get<RoleRow[]>('/roles') })
const useDepartments = () => useQuery({ queryKey: ['departments'], queryFn: () => api.get<{ items: Department[]; total: number; enabled_count: number }>('/departments') })
const useAgents = () => useQuery({ queryKey: ['agents', 'all'], queryFn: () => api.get<{ items: Agent[]; total: number; enabled_count: number }>('/agents', { per_page: 200 }) })

// ------------------------------------------------------------------ Agents
const agentSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  display_name: z.string().trim().optional(),
  email: z.string().trim().email('Enter a valid email'),
  role_id: z.string().min(1, 'Choose a role'),
  department_ids: z.array(z.string()),
  chat_limit: z.string().regex(/^(|[1-9]|1\d|20)$/, 'Between 1 and 20')
    .optional(),
  enabled: z.boolean(),
})
type AgentForm = z.infer<typeof agentSchema>

export function AgentsPage() {
  const navigate = useNavigate()
  const can = useAuth((s) => s.can)
  const me = useAuth((s) => s.me)!
  const depts = useDepartments()
  const roles = useRoles()
  const [dept, setDept] = useState<string>('')
  const [limitModal, setLimitModal] = useState(false)
  const agents = useAgents()
  const add = () => {
    const enabled = agents.data?.enabled_count ?? 0
    if (enabled >= me.account.max_agents) setLimitModal(true)
    else navigate('/settings/agents/new')
  }
  const columns: ColumnDef<Agent>[] = [
    { header: 'Display name', cell: ({ row: { original: a } }) => <span className="inline-flex items-center gap-2"><StatusBadge status={a.enabled ? a.presence : 'offline'} />{a.display_name || a.name}</span> },
    { header: 'Name', accessorKey: 'name' },
    { header: 'Email', accessorKey: 'email' },
    { header: 'Role', cell: ({ row }) => roles.data?.find((r) => r.id === row.original.role.id)?.name ?? row.original.role.name },
    { header: 'Enabled', size: 70, cell: ({ row }) => (row.original.enabled ? <Check size={14} className="text-primary" aria-label="Enabled" /> : <span className="text-fg-secondary">â€”</span>) },
  ]
  return (
    <>
      <ResourceListPage<Agent>
        title="Agents"
        queryKey="agents"
        endpoint="/agents"
        params={{ department_id: dept || undefined, per_page: 200 }}
        columns={columns}
        getRowId={(a) => a.id}
        addLabel="Add agent"
        onAdd={add}
        canManage={can('agents.manage')}
        bulkActions={(ids, done) => <AgentBulkActions ids={ids} done={done} />}
        onRowClick={(a) => navigate(`/settings/agents/${a.id}`)}
        summary={(d) => <span>{d?.enabled_count ?? 0} enabled / {d?.total ?? 0} agent{d?.total === 1 ? '' : 's'}</span>}
        toolbarExtra={
          <Dropdown
            align="end"
            items={[{ id: '', label: 'All departments', onSelect: () => setDept('') }, ...(depts.data?.items ?? []).map((d) => ({ id: d.id, label: d.name, onSelect: () => setDept(d.id) }))]}
            trigger={(p) => <Button {...p} size="sm">{dept ? depts.data?.items.find((d) => d.id === dept)?.name : 'Filter department'} â–¾</Button>}
          />
        }
        empty="Add agents to serve more visitors, respond faster to chats, and improve customer satisfaction."
      />
      <Modal open={limitModal} onClose={() => setLimitModal(false)} title="Account limit reached" size="sm" footer={<Button variant="primary" onClick={() => navigate('/settings/account')}>Adjust plan</Button>}>
        <p className="text-fg-secondary">Your account is currently limited to {me.account.max_agents} agent(s). Increase the number of agents in your plan, or deactivate an agent first.</p>
      </Modal>
    </>
  )
}

type BulkKind = 'limit' | 'role' | 'skills'

/** Bulk actions for selected agents: Set chat limit (1â€“20), Reassign role, Assign skills (up to 5). */
function AgentBulkActions({ ids, done }: { ids: string[]; done: () => void }) {
  const roles = useRoles()
  const me = useAuth((s) => s.me)!
  const [kind, setKind] = useState<BulkKind | null>(null)
  const [limit, setLimit] = useState('')
  const [roleId, setRoleId] = useState('')
  const [skills, setSkills] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const limitErr = !/^([1-9]|1\d|20)$/.test(limit) ? 'Must be between 1 and 20' : undefined
  const close = () => { setKind(null); setLimit(''); setRoleId(''); setSkills([]) }
  const submit = async () => {
    setBusy(true)
    try {
      const body = kind === 'limit' ? { ids, chat_limit: Number(limit) } : kind === 'role' ? { ids, role_id: roleId } : { ids, skills }
      await api.post('/agents/bulk', body)
      toast.success(`Updated ${ids.length} agent${ids.length === 1 ? '' : 's'}`)
      close()
      done()
    } catch (e) {
      toast.error(apiError(e).message)
    } finally {
      setBusy(false)
    }
  }
  const valid = kind === 'limit' ? !limitErr : kind === 'role' ? !!roleId : skills.length > 0
  return (
    <>
      <Button size="sm" onClick={() => setKind('limit')}>Set chat limit</Button>
      <Button size="sm" onClick={() => setKind('role')}>Reassign role</Button>
      <Button size="sm" onClick={() => setKind('skills')}>Assign skills</Button>
      <Modal open={!!kind} onClose={close} size="sm" title={kind === 'limit' ? 'Set chat limit' : kind === 'role' ? 'Reassign role' : 'Assign skills'}
        footer={<Button variant="primary" disabled={!valid} loading={busy} onClick={submit}>{kind === 'limit' ? 'Set' : kind === 'role' ? 'Set' : 'Assign'}</Button>}>
        {kind === 'limit' && (
          <FormField label="Chat limit" error={limit ? limitErr : undefined} hint="Number of chats that each agent is allowed to take. Edit other chat routing settings under Routing â€º Settings.">
            <Input type="number" min={1} max={20} autoFocus value={limit} onChange={(e) => setLimit(e.target.value)} />
          </FormField>
        )}
        {kind === 'role' && (
          <FormField label="Roles" hint="Any member can only have one role at a time.">
            <Select value={roleId} placeholder="Select role" onChange={(e) => setRoleId(e.target.value)} options={(roles.data ?? []).filter((r) => r.key !== 'end_user' && (r.key !== 'owner' || me.user.role.key === 'owner')).map((r) => ({ value: r.id, label: r.name }))} />
          </FormField>
        )}
        {kind === 'skills' && (
          <FormField label="Skills" hint="Identify an agent's capabilities. Assign up to 5 skills to an agent.">
            <MultiSelect label="Skills" creatable options={skills.map((s) => ({ value: s, label: s }))} value={skills} onChange={(v) => (v.length <= 5 ? setSkills(v) : toast.error('You can assign up to 5 skills'))} placeholder="Add skills" />
          </FormField>
        )}
      </Modal>
    </>
  )
}

export function AgentEditPage() {
  const { agentId } = useParams()
  const isNew = agentId === 'new'
  const navigate = useNavigate()
  const qc = useQueryClient()
  const me = useAuth((s) => s.me)!
  const roles = useRoles()
  const depts = useDepartments()
  const agent = useQuery({ queryKey: ['agent', agentId], queryFn: () => api.get<Agent>(`/agents/${agentId}`), enabled: !isNew })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { register, handleSubmit, control, reset, formState } = useForm<AgentForm>({ resolver: zodResolver(agentSchema), defaultValues: { name: '', email: '', role_id: '', department_ids: [], enabled: true, chat_limit: '' } })
  useEffect(() => {
    if (agent.data) reset({ name: agent.data.name, display_name: agent.data.display_name ?? '', email: agent.data.email, role_id: agent.data.role.id, department_ids: agent.data.department_ids, enabled: agent.data.enabled, chat_limit: agent.data.chat_limit ? String(agent.data.chat_limit) : '' })
    else if (isNew && roles.data) reset((v) => ({ ...v, role_id: roles.data.find((r) => r.key === 'agent')?.id ?? '' }))
  }, [agent.data, isNew, roles.data, reset])
  const onSubmit = handleSubmit(async (v) => {
    const body = { ...v, chat_limit: v.chat_limit ? Number(v.chat_limit) : null, display_name: v.display_name || v.name }
    try {
      if (isNew) {
        await api.post('/agents', body)
        toast.success(`Invitation sent to ${v.email}`)
      } else {
        const { email: _e, ...patch } = body
        await api.patch(`/agents/${agentId}`, patch)
        toast.success('Agent updated')
      }
      qc.invalidateQueries({ queryKey: ['agents'] })
      navigate('/settings/agents')
    } catch (e) {
      toast.error(apiError(e).message)
    }
  })
  const remove = async () => {
    try {
      await api.del(`/agents/${agentId}`)
      qc.invalidateQueries({ queryKey: ['agents'] })
      navigate('/settings/agents')
      toast.success('Agent deleted')
    } catch (e) {
      toast.error(apiError(e).message)
    }
  }
  const self = agentId === me.user.id
  return (
    <Page title={isNew ? 'Add agent' : 'Edit agent'} back="/settings/agents">
      <SettingsLayout tips={[{ title: 'Roles', body: 'Administrators can change settings; agents serve chats and tickets. Owners can manage billing.' }, { title: 'Invitations', body: 'New agents receive an email link to set their password. Links expire after 72 hours.' }]}>
        <form onSubmit={onSubmit} noValidate>
          {!isNew && (
            <FormField label="Agent status">
              <Checkbox label="Enable agent" disabled={self} {...register('enabled')} />
            </FormField>
          )}
          <FormField label="Name" error={formState.errors.name?.message}><Input {...register('name')} /></FormField>
          <FormField label="Display name" hint="Shown to visitors in chats"><Input {...register('display_name')} /></FormField>
          <FormField label="Email" error={formState.errors.email?.message}><Input type="email" disabled={!isNew} {...register('email')} /></FormField>
          <FormField label="Role" error={formState.errors.role_id?.message}>
            <Select disabled={self} options={(roles.data ?? []).filter((r) => r.key !== 'end_user' && (r.key !== 'owner' || me.user.role.key === 'owner')).map((r) => ({ value: r.id, label: r.name }))} placeholder="Choose a role" {...register('role_id')} />
          </FormField>
          <FormField label="Departments">
            <Controller control={control} name="department_ids" render={({ field }) => <MultiSelect label="Departments" options={(depts.data?.items ?? []).map((d) => ({ value: d.id, label: d.name }))} value={field.value} onChange={field.onChange} placeholder="No departments" />} />
          </FormField>
          <FormField label="Chat limit" hint="Used when routing applies limits per agent" error={formState.errors.chat_limit?.message}>
            <Input type="number" min={1} max={20} className="w-24" {...register('chat_limit')} />
          </FormField>
          <FormFooter dirty={formState.isDirty || isNew} saving={formState.isSubmitting} submitLabel={isNew ? 'Send invitation' : 'Save changes'} cancelLabel="Cancel" onCancel={() => navigate('/settings/agents')} onDelete={!isNew && !self && agent.data?.role.key !== 'owner' ? () => setConfirmDelete(true) : undefined} />
        </form>
      </SettingsLayout>
      <ConfirmDialog open={confirmDelete} title="Delete agent?" message="The agent loses access immediately. Their past chats stay in History." confirmLabel="Delete agent" danger onConfirm={remove} onCancel={() => setConfirmDelete(false)} />
    </Page>
  )
}

// ------------------------------------------------------------------ Departments
export function DepartmentsPage() {
  const navigate = useNavigate()
  const can = useAuth((s) => s.can)
  const agents = useAgents()
  const name = (id: string) => agents.data?.items.find((a) => a.id === id)
  const columns: ColumnDef<Department>[] = [
    { header: 'Name', accessorKey: 'name' },
    { header: 'Description', cell: ({ row }) => row.original.description ?? '' },
    { header: 'Agents', cell: ({ row }) => <span className="inline-flex gap-1">{row.original.agent_ids.map((id) => <Tag key={id}>{name(id)?.display_name || name(id)?.name || 'â€¦'}</Tag>)}</span> },
    { header: 'Enabled', size: 70, cell: ({ row }) => (row.original.enabled ? <Check size={14} className="text-primary" aria-label="Enabled" /> : 'â€”') },
  ]
  return (
    <ResourceListPage<Department>
      title="Departments"
      queryKey="departments"
      endpoint="/departments"
      columns={columns}
      getRowId={(d) => d.id}
      addLabel="Add department"
      onAdd={() => navigate('/settings/departments/new')}
      onRowClick={(d) => navigate(`/settings/departments/${d.id}`)}
      canManage={can('departments.manage')}
      summary={(d) => <span>{d?.enabled_count ?? 0} enabled / {d?.total ?? 0} departments</span>}
      empty="Use departments to organize your agents into different teams."
    />
  )
}

const deptSchema = z.object({ name: z.string().trim().min(1, 'Name is required'), description: z.string().optional(), enabled: z.boolean(), agent_ids: z.array(z.string()).min(1, 'Select at least 1 active agent to add to this department') })
type DeptForm = z.infer<typeof deptSchema>

export function DepartmentEditPage() {
  const { deptId } = useParams()
  const isNew = deptId === 'new'
  const navigate = useNavigate()
  const qc = useQueryClient()
  const me = useAuth((s) => s.me)!
  const agents = useAgents()
  const list = useDepartments()
  const dept = useQuery({ queryKey: ['department', deptId], queryFn: () => api.get<Department>(`/departments/${deptId}`), enabled: !isNew })
  const [confirm, setConfirm] = useState(false)
  const { register, handleSubmit, control, reset, formState } = useForm<DeptForm>({ resolver: zodResolver(deptSchema), defaultValues: { name: '', description: '', enabled: true, agent_ids: [] } })
  useEffect(() => {
    if (dept.data) reset({ name: dept.data.name, description: dept.data.description ?? '', enabled: dept.data.enabled, agent_ids: dept.data.agent_ids })
  }, [dept.data, reset])
  const onSubmit = handleSubmit(async (v) => {
    try {
      if (isNew) await api.post('/departments', v)
      else await api.patch(`/departments/${deptId}`, v)
      qc.invalidateQueries({ queryKey: ['departments'] })
      toast.success(isNew ? 'Department created' : 'Department updated')
      navigate('/settings/departments')
    } catch (e) {
      toast.error(apiError(e).message)
    }
  })
  const remove = async () => {
    try {
      await api.del(`/departments/${deptId}`)
      qc.invalidateQueries({ queryKey: ['departments'] })
      navigate('/settings/departments')
    } catch (e) {
      toast.error(apiError(e).message)
    }
  }
  return (
    <Page title={isNew ? 'Add department' : 'Edit department'} back="/settings/departments">
      <SettingsLayout tips={[{ title: 'Assign agents to departments', body: 'You can assign agents to the departments you have created (e.g. sales, technical support). Once configured, visitors can direct chat requests towards the appropriate department.' }, { title: 'Enable pre-chat forms', body: 'Visitors can select a department before starting a chat, using the pre-chat form (Widget â€º Forms).' }]}>
        <form onSubmit={onSubmit} noValidate>
          <FormField label="Department status">
            <div>
              <Checkbox label="Enable department" {...register('enabled')} />
              <p className="mt-1 text-xs text-fg-secondary">{list.data?.enabled_count ?? 0} of {me.account.max_departments} Departments used.</p>
            </div>
          </FormField>
          <FormField label="Name" error={formState.errors.name?.message}><Input className="w-[220px]" {...register('name')} /></FormField>
          <FormField label="Description"><Textarea {...register('description')} /></FormField>
          <FormField label="Department agents" error={formState.errors.agent_ids?.message}>
            <Controller control={control} name="agent_ids" render={({ field }) => <MultiSelect label="Department agents" options={(agents.data?.items ?? []).filter((a) => a.enabled).map((a) => ({ value: a.id, label: a.display_name || a.name }))} value={field.value} onChange={field.onChange} placeholder="No agents yet" />} />
          </FormField>
          <FormFooter dirty={formState.isDirty} saving={formState.isSubmitting} submitLabel={isNew ? 'Create department' : 'Save changes'} cancelLabel="Cancel" onCancel={() => navigate('/settings/departments')} onDelete={!isNew ? () => setConfirm(true) : undefined} />
        </form>
      </SettingsLayout>
      <ConfirmDialog open={confirm} title="Delete department?" message="Chats routed to this department go back to the general queue." confirmLabel="Delete" danger onConfirm={remove} onCancel={() => setConfirm(false)} />
    </Page>
  )
}

// ------------------------------------------------------------------ Roles
export function RolesPage() {
  const can = useAuth((s) => s.can)
  const roles = useRoles()
  const perms = useQuery({ queryKey: ['permissions'], queryFn: () => api.get<{ code: string; description: string }[]>('/permissions') })
  const qc = useQueryClient()
  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null)
  const [form, setForm] = useState({ name: '', description: '', permissions: [] as string[] })
  const [confirm, setConfirm] = useState<RoleRow | null>(null)
  const open = (r: RoleRow | 'new') => {
    setEditing(r)
    setForm(r === 'new' ? { name: '', description: '', permissions: [] } : { name: r.name, description: r.description ?? '', permissions: r.permissions })
  }
  const save = async () => {
    try {
      if (editing === 'new') await api.post('/roles', form)
      else if (editing) await api.put(`/roles/${editing.id}`, form)
      qc.invalidateQueries({ queryKey: ['roles'] })
      setEditing(null)
      toast.success('Role saved')
    } catch (e) {
      toast.error(apiError(e).message)
    }
  }
  const remove = async () => {
    if (!confirm) return
    try {
      await api.del(`/roles/${confirm.id}`)
      qc.invalidateQueries({ queryKey: ['roles'] })
      setConfirm(null)
    } catch (e) {
      toast.error(apiError(e).message)
    }
  }
  const readOnly = editing !== 'new' && !!editing?.is_system
  return (
    <Page title="Roles">
      <div className="mb-3 flex items-center gap-2">
        {can('roles.manage') && <Button variant="primary" onClick={() => open('new')}>Create role</Button>}
        <span className="text-sm text-fg-secondary">System roles are fixed. Create custom roles to fine-tune permissions.</span>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-border text-left text-xs font-bold"><th className="h-9 px-2">Role</th><th className="px-2">Description</th><th className="px-2">Permissions</th><th className="px-2">Type</th></tr></thead>
        <tbody>
          {roles.data?.filter((r) => r.key !== 'end_user').map((r) => (
            <tr key={r.id} className="cursor-pointer border-b border-border hover:bg-surface-hover" onClick={() => open(r)}>
              <td className="h-9 px-2 font-bold">{r.name}</td>
              <td className="px-2 text-fg-secondary">{r.description}</td>
              <td className="px-2">{r.permissions.length}</td>
              <td className="px-2">{r.is_system ? 'System' : 'Custom'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Create role' : editing?.name} size="lg"
        footer={readOnly || !can('roles.manage') ? <Button onClick={() => setEditing(null)}>Close</Button> : <>{editing !== 'new' && <Button variant="danger" onClick={() => setConfirm(editing as RoleRow)}>Delete</Button>}<span className="flex-1" /><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" disabled={!form.name.trim()} onClick={save}>Save role</Button></>}>
        {readOnly && <Notice tone="info">System roles can't be changed. Create a custom role instead.</Notice>}
        <FormField label="Name"><Input disabled={readOnly} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
        <FormField label="Description"><Input disabled={readOnly} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></FormField>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
          {perms.data?.map((p) => (
            <Checkbox key={p.code} disabled={readOnly} label={p.description} description={p.code} checked={form.permissions.includes(p.code)} onChange={() => setForm((f) => ({ ...f, permissions: f.permissions.includes(p.code) ? f.permissions.filter((x) => x !== p.code) : [...f.permissions, p.code] }))} />
          ))}
        </div>
      </Modal>
      <ConfirmDialog open={!!confirm} title="Delete role?" message="Roles in use can't be deleted." confirmLabel="Delete" danger onConfirm={remove} onCancel={() => setConfirm(null)} />
    </Page>
  )
}

// ------------------------------------------------------------------ Team (sidebar â€º Team)
export function TeamPage() {
  const { agentId } = useParams()
  const agents = useAgents()
  const roles = useRoles()
  const depts = useDepartments()
  const list = (agents.data?.items ?? []).filter((a) => a.enabled && (!agentId || a.id === agentId))
  return (
    <Page title="Team">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {list.map((a) => (
          <div key={a.id} className="flex items-center gap-3 rounded-md border border-border p-3">
            <Avatar name={a.display_name || a.name} src={a.avatar_url} size={40} status={a.presence} />
            <div className="min-w-0">
              <div className="truncate text-md font-bold">{a.display_name || a.name}</div>
              <div className="truncate text-xs text-fg-secondary">{roles.data?.find((r) => r.id === a.role.id)?.name} Â· {a.presence}</div>
              <div className="mt-1 flex flex-wrap gap-1">{a.department_ids.map((d) => <Tag key={d}>{depts.data?.items.find((x) => x.id === d)?.name}</Tag>)}</div>
            </div>
          </div>
        ))}
      </div>
    </Page>
  )
}

