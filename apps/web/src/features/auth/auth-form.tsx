'use client';

import { type FormEvent, useState } from 'react';
import { apiRequest, type SessionPayload } from '../../lib/api';

type AuthMode = 'login' | 'register';

export function AuthForm() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await apiRequest<SessionPayload>(endpointFor(mode), requestFor(event.currentTarget, mode));
      window.location.assign('/dashboard');
    } catch (error) {
      setMessage(toUserMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-card">
      <AuthHeader mode={mode} />
      <form className="auth-form" onSubmit={submit}>
        {mode === 'register' && <WorkspaceField />}
        <CredentialsFields mode={mode} />
        {message && (
          <p className="form-message" role="alert">
            {message}
          </p>
        )}
        <button className="primary-button" disabled={busy} type="submit">
          {busy ? '处理中…' : mode === 'login' ? '登录' : '创建账号'}
        </button>
      </form>
      <ModeSwitch mode={mode} onChange={setMode} />
    </div>
  );
}

function AuthHeader({ mode }: { mode: AuthMode }) {
  return (
    <header className="auth-header">
      <p className="eyebrow">CLIMBING CRM</p>
      <h1>{mode === 'login' ? '欢迎回来' : '创建岩馆工作区'}</h1>
      <p>{mode === 'login' ? '使用你的邮箱账号继续。' : '首位注册用户将成为 L1 管理员。'}</p>
    </header>
  );
}

function WorkspaceField() {
  return (
    <label>
      岩馆名称
      <input
        name="organizationName"
        required
        minLength={2}
        maxLength={80}
        placeholder="例如：Peak Climbing"
        autoComplete="organization"
      />
    </label>
  );
}

function CredentialsFields({ mode }: { mode: AuthMode }) {
  return (
    <>
      <label>
        邮箱
        <input
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          autoComplete="email"
        />
      </label>
      <label>
        密码
        <input
          name="password"
          type="password"
          required
          minLength={mode === 'register' ? 12 : 1}
          placeholder={mode === 'register' ? '至少 12 位' : '输入密码'}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        />
      </label>
    </>
  );
}

function ModeSwitch({ mode, onChange }: { mode: AuthMode; onChange: (mode: AuthMode) => void }) {
  const nextMode: AuthMode = mode === 'login' ? 'register' : 'login';
  return (
    <p className="mode-switch">
      {mode === 'login' ? '还没有账号？' : '已经有账号？'}{' '}
      <button type="button" onClick={() => onChange(nextMode)}>
        {mode === 'login' ? '去注册' : '去登录'}
      </button>
    </p>
  );
}

function endpointFor(mode: AuthMode): string {
  return mode === 'login' ? '/auth/login' : '/auth/register';
}

function requestFor(form: HTMLFormElement, mode: AuthMode): RequestInit {
  const values = new FormData(form);
  const body = {
    email: String(values.get('email') ?? ''),
    password: String(values.get('password') ?? ''),
  };
  return {
    method: 'POST',
    body: JSON.stringify(
      mode === 'register'
        ? { ...body, organizationName: String(values.get('organizationName') ?? '') }
        : body,
    ),
  };
}

function toUserMessage(error: unknown): string {
  if (error instanceof TypeError) return '无法连接 API 服务，请确认 API 已启动。';
  return error instanceof Error ? error.message : '请求未能完成，请稍后重试';
}
