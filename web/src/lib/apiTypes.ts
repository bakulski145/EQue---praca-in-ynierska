export type Role = 'ADMIN' | 'OPERATOR';
export type TicketStatus = 'WAITING' | 'SERVING' | 'COMPLETED' | 'CANCELLED';

export interface TokenResponse {
  access_token: string;
  token_type: string;
  id: string;
  role: Role;
  full_name: string;
}

export interface MeResponse {
  id: string;
  username: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  location_ids: number[];
}

export interface TabletInLocation {
  id: number;
  name: string;
  is_active: boolean;
}

export interface LocationResponse {
  id: number;
  name: string;
  description: string | null;
  category: string;
  is_active: boolean;
  tablet: TabletInLocation | null;
  user_ids: string[];
}

export interface TabletResponse {
  id: number;
  name: string;
  location_id: number | null;
  is_active: boolean;
  last_seen_at: string | null;
  online: boolean;
}

export interface UserResponse {
  id: string;
  username: string;
  full_name: string;
  position: string | null;
  role: Role;
  is_active: boolean;
  location_ids: number[];
}

export interface TicketResponse {
  id: string;
  ticket_code: string;
  status: TicketStatus;
  location_id: number;
  joined_at: string;
  called_at: string | null;
  served_at: string | null;
  customer_name: string | null;
  appointment_time: string | null;
  served_by_user_id: string | null;
}

export interface QueueResponse {
  location_id: number;
  waiting: TicketResponse[];
  serving: TicketResponse | null;
}
