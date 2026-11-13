// Shared API contracts (mirrors backend Pydantic schemas).
import type { PresenceStatus } from '@/components/ui'

export interface Role {
  id: string
  key: string
  name: string
}

export interface User {
  id: string
  email: string
  name: string
  display_name: string | null
  tagline: string | null
  avatar_url: string | null
  role: Role
  enabled: boolean
  presence: Exclude<PresenceStatus, 'offline'>
  chat_limit: number | null
  skills: string[]
  mfa_enabled: boolean
  email_verified_at: string | null
  last_login_at: string | null
  created_at: string
}

export interface Agent extends User {
  department_ids: string[]
}

export interface Account {
  id: string
  name: string
  subdomain: string
  timezone: string
  plan: string
  max_agents: number
  max_departments: number
  max_triggers: number
}

export interface Me {
  user: User
  account: Account
  permissions: string[]
  preferences: Record<string, any>
}

export type ChatState = 'proactive' | 'incoming' | 'active' | 'ended' | 'missed'

export interface Chat {
  id: string
  kind: 'chat' | 'offline'
  state: ChatState
  outcome: 'completed' | 'dropped' | 'missed' | 'unresponsive' | null
  visitor_id: string
  visitor_name: string | null
  visitor_display_id: string | null
  visitor_email: string | null
  department_id: string | null
  assignee_id: string | null
  participant_ids: string[]
  initiated_by: 'visitor' | 'agent' | 'trigger'
  question: string | null
  started_at: string
  accepted_at: string | null
  ended_at: string | null
  rating: 'good' | 'bad' | null
  rating_comment: string | null
  tags: string[]
  message_count: number
  preview: string | null
  unread: boolean
  triggered: boolean
  ticket_id: string | null
  agent_name?: string | null
}

export interface ChatMessage {
  id: string
  chat_id: string
  seq: number
  client_id: string | null
  sender_type: 'visitor' | 'agent' | 'system' | 'trigger'
  sender_id: string | null
  sender_name: string | null
  kind: 'text' | 'event' | 'file' | 'note' | 'options'
  body: string | null
  options: string[] | null
  attachment_id: string | null
  created_at: string
  delivered_at: string | null
  read_at: string | null
  /** client-only: optimistic send state */
  pending?: boolean
  failed?: boolean
}

export interface LiveVisitor {
  id: string
  display_id: string
  name: string
  email: string | null
  phone: string | null
  tags: string[]
  visits: number
  chats: number
  simulated: boolean
  session_id: string | null
  online_seconds: number
  current_url: string | null
  current_title: string | null
  page_count: number
  country_code: string | null
  country_name: string | null
  city: string | null
  browser: string | null
  platform: string | null
  device: string | null
  referrer: string | null
  search_engine: string | null
  search_terms: string | null
  department_id: string | null
  triggered: boolean
  note: string | null
  chatting: boolean
  serving_agent_ids: string[]
  activity?: string
  status?: 'incoming' | 'assigned' | 'clicked' | 'served' | 'triggered' | 'active' | 'idle'
  group?: string
  chat_id?: string | null
}

export interface VisitorDetail extends LiveVisitor {
  notes: string | null
  banned: boolean
  ip: string | null
  user_agent: string | null
  region: string | null
  path: { url: string; title: string; at: string }[]
  past_chats: Chat[]
  online: boolean
}

export interface Department {
  id: string
  name: string
  description: string | null
  enabled: boolean
  agent_ids: string[]
}

export interface Shortcut {
  id: string
  name: string
  message: string
  options: string[]
  tags: string[]
  department_id: string | null
  owner_id: string | null
}

export interface Condition {
  field: string
  operator: string
  value: unknown
}

export interface TriggerAction {
  type: string
  value: unknown
  name?: string | null
}

export interface Trigger {
  id: string
  name: string
  description: string | null
  enabled: boolean
  event: string
  match: 'all' | 'any'
  conditions: Condition[]
  actions: TriggerAction[]
  fire_once_per_visitor: boolean
}

export interface Banned {
  id: string
  visitor_id: string | null
  ip: string | null
  label: string
  reason: string | null
  created_at: string
}
