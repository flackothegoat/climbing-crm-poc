'use client';

import { useState } from 'react';
import { resendInvitation, revokeInvitation, type StaffInvitation } from './team-api';

export function InvitationTable({
  invitations,
  loading,
  onChanged,
}: {
  invitations: StaffInvitation[];
  loading: boolean;
  onChanged: () => Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const [activationUrl, setActivationUrl] = useState('');
  const [busyId, setBusyId] = useState('');
  if (loading) return <p className="table-empty-state">正在加载邀请…</p>;
  if (!invitations.length) return <p className="table-empty-state">还没有邀请记录</p>;

  async function resend(invitation: StaffInvitation): Promise<void> {
    await run(invitation.id, async () => {
      const updated = await resendInvitation(invitation.id);
      setActivationUrl(updated.activationUrl);
      const copied = await copyToClipboard(updated.activationUrl);
      setMessage(
        copied
          ? `已刷新 ${invitation.email} 的邀请，链接已复制`
          : `已刷新 ${invitation.email} 的邀请，请手动复制下方链接`,
      );
    });
  }

  async function revoke(invitation: StaffInvitation): Promise<void> {
    await run(invitation.id, async () => {
      await revokeInvitation(invitation.id);
      setMessage(`已撤销 ${invitation.email} 的邀请`);
    });
  }

  async function run(id: string, action: () => Promise<void>): Promise<void> {
    setBusyId(id);
    setMessage('');
    try {
      await action();
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '邀请操作失败');
    } finally {
      setBusyId('');
    }
  }

  return (
    <>
      {message && <p className="team-feedback">{message}</p>}
      {activationUrl && (
        <div className="team-invite-link">
          <input aria-label="最新邀请链接" readOnly value={activationUrl} />
        </div>
      )}
      <div className="management-table-wrap">
        <table className="management-table invitation-table">
          <thead>
            <tr>
              <th>邮箱</th>
              <th>创建时间</th>
              <th>有效期</th>
              <th>状态</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {invitations.map((invitation) => (
              <tr key={invitation.id}>
                <td>{invitation.email}</td>
                <td>{formatDate(invitation.createdAt)}</td>
                <td>{formatDate(invitation.expiresAt)}</td>
                <td>
                  <InvitationBadge status={invitation.status} />
                </td>
                <td>
                  <InvitationActions
                    invitation={invitation}
                    busy={busyId === invitation.id}
                    onResend={resend}
                    onRevoke={revoke}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function InvitationActions({
  invitation,
  busy,
  onResend,
  onRevoke,
}: {
  invitation: StaffInvitation;
  busy: boolean;
  onResend: (value: StaffInvitation) => void;
  onRevoke: (value: StaffInvitation) => void;
}) {
  if (!['PENDING', 'EXPIRED'].includes(invitation.status))
    return <span className="table-muted">—</span>;
  return (
    <span className="table-actions">
      <button disabled={busy} onClick={() => onResend(invitation)}>
        刷新链接
      </button>
      <button disabled={busy} onClick={() => onRevoke(invitation)}>
        撤销
      </button>
    </span>
  );
}

function InvitationBadge({ status }: Pick<StaffInvitation, 'status'>) {
  const labels = { PENDING: '待接受', ACCEPTED: '已接受', REVOKED: '已撤销', EXPIRED: '已过期' };
  const tone = status === 'ACCEPTED' ? 'success' : status === 'PENDING' ? 'warning' : 'neutral';
  return <span className={`status-badge status-${tone}`}>{labels[status]}</span>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
