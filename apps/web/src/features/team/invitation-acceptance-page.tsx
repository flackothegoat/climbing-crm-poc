'use client';

import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/api';

interface InvitationPreview {
  email: string;
  organization: { id: string; name: string };
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
}

export function InvitationAcceptancePage({ token }: { token: string }) {
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiRequest<InvitationPreview>(`/auth/invitations/${encodeURIComponent(token)}`)
      .then(setPreview)
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : '邀请加载失败'),
      );
  }, [token]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      await apiRequest(`/auth/invitations/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        body: JSON.stringify({ displayName, password }),
      });
      window.location.assign('/dashboard');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '接受邀请失败');
      setSubmitting(false);
    }
  }

  return (
    <main className="invite-page">
      <section className="invite-brand-panel">
        <span className="brand-mark">↗</span>
        <p className="eyebrow">CLIMBING CRM · TEAM</p>
        <h1>
          加入团队，
          <br />
          让每次运营变更都有迹可循。
        </h1>
        <p>你的账号会加入指定岩馆，并获得 L2 员工权限。</p>
      </section>
      <section className="invite-form-panel">
        <div className="invite-card">
          <p className="eyebrow">员工邀请</p>
          <h2>{preview?.organization.name ?? '正在读取邀请…'}</h2>
          {preview && <p className="invite-target">邀请邮箱：{preview.email}</p>}
          {preview && preview.status !== 'PENDING' ? (
            <InvitationUnavailable status={preview.status} />
          ) : (
            <form className="auth-form" onSubmit={submit}>
              <label>
                姓名
                <input
                  required
                  minLength={2}
                  maxLength={50}
                  placeholder="用于团队协作与审计记录"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
              <label>
                登录密码
                <input
                  required
                  minLength={12}
                  maxLength={128}
                  type="password"
                  placeholder="至少 12 位"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <p className="invite-help">
                如果该邮箱已经注册，请输入原账号密码；新账号将使用此密码完成创建。
              </p>
              {message && <p className="form-message">{message}</p>}
              <button className="primary-button" disabled={!preview || submitting} type="submit">
                {submitting ? '正在加入…' : '接受邀请并进入看板'}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}

function InvitationUnavailable({ status }: Pick<InvitationPreview, 'status'>) {
  const messages = {
    ACCEPTED: '该邀请已经被接受，请直接登录。',
    REVOKED: '该邀请已被管理员撤销。',
    EXPIRED: '该邀请已过期，请联系管理员刷新链接。',
    PENDING: '',
  };
  return <p className="invitation-unavailable">{messages[status]}</p>;
}
