'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { createInvitation } from './team-api';
import { DialogShell } from '../common/dialog-shell';

export function InviteEmployeeDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [activationUrl, setActivationUrl] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      const invitation = await createInvitation(email);
      setActivationUrl(invitation.activationUrl);
      await onCreated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '邀请创建失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(activationUrl);
      setMessage('邀请链接已复制');
    } catch {
      setMessage('无法自动复制，请手动选择链接');
    }
  }

  return (
    <DialogShell
      title="邀请员工"
      description="员工接受邀请后将以 L2 身份加入当前岩馆。"
      onClose={onClose}
    >
      {activationUrl ? (
        <div className="invitation-result">
          <span className="result-mark">✓</span>
          <h4>邀请已创建</h4>
          <p>POC 暂不发送公网邮件，请复制这条一次性链接交给员工。</p>
          <input aria-label="邀请链接" readOnly value={activationUrl} />
          <button className="dialog-primary" type="button" onClick={copyLink}>
            复制邀请链接
          </button>
          {message && <p className="dialog-message">{message}</p>}
        </div>
      ) : (
        <form className="dialog-form" onSubmit={submit}>
          <label>
            员工邮箱
            <input
              autoFocus
              required
              type="email"
              placeholder="staff@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <p className="field-help">邀请有效期为 72 小时，同一邮箱只能存在一条待接受邀请。</p>
          {message && <p className="dialog-message is-error">{message}</p>}
          <footer>
            <button className="dialog-secondary" type="button" onClick={onClose}>
              取消
            </button>
            <button className="dialog-primary" disabled={submitting} type="submit">
              {submitting ? '创建中…' : '创建邀请'}
            </button>
          </footer>
        </form>
      )}
    </DialogShell>
  );
}
