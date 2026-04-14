// ============================================================
// Auth & Tenant
// ============================================================
export type Role = 'ADMIN' | 'OPERATOR';

export interface UserDto {
  id: string;
  nome: string;
  email: string;
  role: Role;
  avatar_url?: string;
  tenant_id: string;
  created_at: string;
}

export interface TenantDto {
  id: string;
  nome: string;
  created_at: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
}

export interface LoginRequest {
  email: string;
  senha: string;
}

export interface LoginResponse {
  accessToken: string;
  user?: UserDto;
}

// ============================================================
// Instance
// ============================================================
export type InstanceStatus = 'connected' | 'disconnected' | 'connecting' | 'banned' | 'cooldown';

export type WarmupPhase =
  | 'ACTIVATION'
  | 'BUILDING'
  | 'ACCELERATION'
  | 'STABILIZATION'
  | 'PRODUCTION'
  | 'FULL_CAPACITY';

export interface InstanceDto {
  id: string;
  nome: string;
  telefone?: string;
  status: InstanceStatus;
  health_score: number;
  daily_limit: number;
  daily_sent: number;
  warmup_phase: WarmupPhase;
  warmup_completed: boolean;
  warmup_day: number;
  reply_rate_7d: number;
  cooldown_until?: string;
  tenant_id: string;
  created_at: string;
}

// ============================================================
// Contact & Lists
// ============================================================
export type ContactEngagement = 'UNKNOWN' | 'COLD' | 'WARM' | 'HOT' | 'BLOCKED';

export interface ContactDto {
  id: string;
  nome?: string;
  telefone: string;
  tags: string[];
  whatsapp_valid?: boolean;
  engagement: ContactEngagement;
  last_contacted?: string;
  times_contacted: number;
  times_replied: number;
  tenant_id: string;
  created_at: string;
}

export interface ContactListDto {
  id: string;
  nome: string;
  descricao?: string;
  total_count: number;
  valid_count: number;
  tenant_id: string;
  created_at: string;
}

// ============================================================
// Template
// ============================================================
export type MessageType = 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT';

export interface TemplateDto {
  id: string;
  nome: string;
  type: MessageType;
  content: string;
  media_url?: string;
  has_spin: boolean;
  has_optout: boolean;
  tenant_id: string;
  created_at: string;
}

// ============================================================
// Campaign
// ============================================================
export type CampaignStatus =
  | 'DRAFT'
  | 'VALIDATING'
  | 'SCHEDULED'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

export interface CampaignDto {
  id: string;
  nome: string;
  status: CampaignStatus;
  contact_list_id: string;
  template_id: string;
  delay_min: number;
  delay_max: number;
  scheduled_at?: string;
  started_at?: string;
  finished_at?: string;
  total_contacts: number;
  total_valid: number;
  total_sent: number;
  total_delivered: number;
  total_read: number;
  total_replied: number;
  total_failed: number;
  total_blocked: number;
  total_optout: number;
  tenant_id: string;
  created_at: string;
}

// ============================================================
// Dispatch
// ============================================================
export type DispatchStatus =
  | 'PENDING'
  | 'VALIDATING'
  | 'QUEUED'
  | 'SENDING'
  | 'SENT'
  | 'DELIVERED'
  | 'READ'
  | 'REPLIED'
  | 'FAILED'
  | 'SKIPPED'
  | 'BLOCKED'
  | 'OPTOUT';

export interface DispatchDto {
  id: string;
  campaign_id: string;
  contact_id: string;
  instance_name?: string;
  status: DispatchStatus;
  error?: string;
  attempts: number;
  sent_at?: string;
  delivered_at?: string;
  read_at?: string;
  created_at: string;
}
