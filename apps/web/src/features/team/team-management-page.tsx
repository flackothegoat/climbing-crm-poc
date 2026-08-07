'use client';

import { useState } from 'react';
import type { AuthenticatedSession } from '../../lib/server-session';
import { DashboardIcon } from '../dashboard/dashboard-icons';
import { PageHeading, SectionCard, StatGrid } from '../dashboard/page-components';
import { InviteEmployeeDialog } from './invite-employee-dialog';
import { InvitationTable } from './invitation-table';
import { MemberEditorDialog } from './member-editor-dialog';
import { MemberTable } from './member-table';
import type { TeamMember } from './team-api';
import { useTeamData } from './use-team-data';

export function TeamManagementPage({ session }: { session: AuthenticatedSession }) {
  const data = useTeamData(session.role);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const canManage = session.role === 'L1_ADMIN';
  const stats = buildStats(data.members, data.invitations.length);

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="核心模块 · 人员与权限"
        title="员工管理"
        description="通过邮箱邀请员工加入岩馆，维护岗位与在职状态，并为每一次资产操作保留明确身份。"
        aside={
          canManage ? (
            <button className="page-action page-action-active" onClick={() => setInviteOpen(true)}>
              <DashboardIcon name="team" />
              邀请员工
            </button>
          ) : undefined
        }
      />
      <StatGrid items={stats} />
      {data.error && <p className="team-feedback is-error">{data.error}</p>}
      <SectionCard
        title="员工目录"
        description={
          canManage ? 'L1 可以维护员工资料和在职状态。' : '员工之间仅共享协作所需的基础资料。'
        }
        className="table-card"
      >
        <MemberTable
          canManage={canManage}
          loading={data.loading}
          members={data.members}
          onEdit={setEditingMember}
        />
      </SectionCard>
      {canManage && (
        <SectionCard
          title="邀请记录"
          description="邀请链接为一次性凭据；过期后可以刷新链接，未接受前也可以撤销。"
          className="table-card"
        >
          <InvitationTable
            invitations={data.invitations}
            loading={data.loading}
            onChanged={data.refresh}
          />
        </SectionCard>
      )}
      {inviteOpen && (
        <InviteEmployeeDialog onClose={() => setInviteOpen(false)} onCreated={data.refresh} />
      )}
      {editingMember && (
        <MemberEditorDialog
          member={editingMember}
          onClose={() => setEditingMember(null)}
          onSaved={data.refresh}
        />
      )}
    </div>
  );
}

function buildStats(members: TeamMember[], invitationCount: number) {
  const activeStaff = members.filter(
    (member) => member.role === 'L2_ADMIN' && member.status === 'ACTIVE',
  ).length;
  const disabled = members.filter((member) => member.status === 'DISABLED').length;
  return [
    { label: '在岗员工', value: String(activeStaff), detail: 'L2 员工', tone: 'accent' as const },
    {
      label: '管理员',
      value: String(members.filter((member) => member.role === 'L1_ADMIN').length),
      detail: 'L1 管理员',
    },
    { label: '邀请记录', value: String(invitationCount), detail: '包含历史状态' },
    { label: '已停用', value: String(disabled), detail: '保留操作历史', tone: 'warning' as const },
  ];
}
