'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { DialogShell } from '../common/dialog-shell';
import { updateMember, type MemberStatus, type TeamMember } from './team-api';

export function MemberEditorDialog({
  member,
  onClose,
  onSaved,
}: {
  member: TeamMember;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(member.displayName);
  const [jobTitle, setJobTitle] = useState(member.jobTitle ?? '');
  const [responsibility, setResponsibility] = useState(member.responsibility ?? '');
  const [status, setStatus] = useState<MemberStatus>(member.status);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      await updateMember(member.id, {
        displayName,
        jobTitle: jobTitle || null,
        responsibility: responsibility || null,
        status,
      });
      await onSaved();
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '员工资料保存失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogShell
      title={`管理 ${member.displayName}`}
      description="停用员工会立即使其现有登录会话失效，但保留全部操作记录。"
      onClose={onClose}
    >
      <form className="dialog-form" onSubmit={submit}>
        <div className="dialog-field-grid">
          <label>
            姓名
            <input
              required
              minLength={2}
              maxLength={50}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label>
            岗位
            <input
              maxLength={50}
              placeholder="例如：定线员"
              value={jobTitle}
              onChange={(event) => setJobTitle(event.target.value)}
            />
          </label>
        </div>
        <label>
          主要职责
          <textarea
            maxLength={200}
            placeholder="例如：线路设计与岩点维护"
            value={responsibility}
            onChange={(event) => setResponsibility(event.target.value)}
          />
        </label>
        <label>
          在职状态
          <select
            disabled={member.role === 'L1_ADMIN'}
            value={status}
            onChange={(event) => setStatus(event.target.value as MemberStatus)}
          >
            <option value="ACTIVE">在岗</option>
            <option value="DISABLED">已停用</option>
          </select>
        </label>
        {member.role === 'L1_ADMIN' && <p className="field-help">L1 管理员不可停用。</p>}
        {message && <p className="dialog-message is-error">{message}</p>}
        <footer>
          <button className="dialog-secondary" type="button" onClick={onClose}>
            取消
          </button>
          <button className="dialog-primary" disabled={submitting} type="submit">
            {submitting ? '保存中…' : '保存修改'}
          </button>
        </footer>
      </form>
    </DialogShell>
  );
}
