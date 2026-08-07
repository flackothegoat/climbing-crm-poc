import { apiRequest } from '../../lib/api';

export type MemberStatus = 'ACTIVE' | 'DISABLED';
export type MembershipRole = 'L1_ADMIN' | 'L2_ADMIN';
export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

export interface TeamMember {
  id: string;
  displayName: string;
  email: string | null;
  role: MembershipRole;
  status: MemberStatus;
  jobTitle: string | null;
  responsibility: string | null;
  joinedAt: string;
  lastActiveAt: string | null;
  isCurrent: boolean;
}

export interface StaffInvitation {
  id: string;
  email: string;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
}

export interface InvitationWithLink extends StaffInvitation {
  activationUrl: string;
}

export interface MemberUpdate {
  displayName?: string;
  jobTitle?: string | null;
  responsibility?: string | null;
  status?: MemberStatus;
}

export const getMembers = () => apiRequest<TeamMember[]>('/team/members', { cacheTtlMs: 30_000 });
export const getInvitations = () =>
  apiRequest<StaffInvitation[]>('/team/invitations', { cacheTtlMs: 30_000 });

export function createInvitation(email: string) {
  return apiRequest<InvitationWithLink>('/team/invitations', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function resendInvitation(id: string) {
  return apiRequest<InvitationWithLink>(`/team/invitations/${id}/resend`, { method: 'POST' });
}

export function revokeInvitation(id: string) {
  return apiRequest<void>(`/team/invitations/${id}/revoke`, { method: 'POST' });
}

export function updateMember(id: string, update: MemberUpdate) {
  return apiRequest<TeamMember>(`/team/members/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(update),
  });
}
