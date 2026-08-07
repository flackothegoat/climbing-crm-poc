'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AuthenticatedSession } from '../../lib/server-session';
import { getInvitations, getMembers, type StaffInvitation, type TeamMember } from './team-api';

export function useTeamData(role: AuthenticatedSession['role']) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<StaffInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [memberData, invitationData] = await Promise.all([
        getMembers(),
        role === 'L1_ADMIN' ? getInvitations() : Promise.resolve([]),
      ]);
      setMembers(memberData);
      setInvitations(invitationData);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '员工数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { members, invitations, loading, error, refresh };
}
