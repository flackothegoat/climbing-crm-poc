import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import type { SessionPayload } from './api';

export interface AuthenticatedSession extends SessionPayload {
  account: { id: string; email: string };
  membership: { id: string; displayName: string | null };
}

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3101/api';

export const requireSession = cache(async function requireSession(): Promise<AuthenticatedSession> {
  const cookieHeader = (await cookies()).toString();
  const response = await fetch(`${apiBaseUrl}/auth/session`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  }).catch(() => null);
  if (!response?.ok) redirect('/');
  return (await response.json()) as AuthenticatedSession;
});
