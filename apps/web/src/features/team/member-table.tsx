import type { TeamMember } from './team-api';

export function MemberTable({
  canManage,
  loading,
  members,
  onEdit,
}: {
  canManage: boolean;
  loading: boolean;
  members: TeamMember[];
  onEdit: (member: TeamMember) => void;
}) {
  if (loading) return <TableState message="正在加载员工…" />;
  if (!members.length) return <TableState message="暂无员工记录" />;
  return (
    <div className="management-table-wrap">
      <table className="management-table team-table">
        <thead>
          <tr>
            <th>员工</th>
            <th>权限</th>
            <th>岗位 / 职责</th>
            <th>最近活跃</th>
            <th>状态</th>
            {canManage && <th aria-label="操作" />}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id}>
              <td>
                <MemberIdentity member={member} />
              </td>
              <td>{roleLabel(member.role)}</td>
              <td>
                <span className="table-primary">{member.jobTitle ?? '未设置岗位'}</span>
                <small>{member.responsibility ?? '暂未填写职责'}</small>
              </td>
              <td>{formatDate(member.lastActiveAt)}</td>
              <td>
                <MemberStatus status={member.status} />
              </td>
              {canManage && (
                <td>
                  <button className="table-action" onClick={() => onEdit(member)}>
                    管理
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemberIdentity({ member }: { member: TeamMember }) {
  return (
    <span className="member-identity">
      <i>{member.displayName.slice(0, 1).toUpperCase()}</i>
      <span>
        <b>
          {member.displayName}
          {member.isCurrent ? '（我）' : ''}
        </b>
        {member.email && <small>{member.email}</small>}
      </span>
    </span>
  );
}

function MemberStatus({ status }: Pick<TeamMember, 'status'>) {
  return (
    <span className={`status-badge ${status === 'ACTIVE' ? 'status-success' : 'status-neutral'}`}>
      {status === 'ACTIVE' ? '在岗' : '已停用'}
    </span>
  );
}

function TableState({ message }: { message: string }) {
  return <p className="table-empty-state">{message}</p>;
}

function roleLabel(role: TeamMember['role']): string {
  return role === 'L1_ADMIN' ? 'L1 管理员' : 'L2 员工';
}

function formatDate(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value))
    : '暂无记录';
}
