export const apiBaseUrl = '/backend';

interface ApiErrorPayload {
  code?: string;
  correlationId?: string;
  message?: string;
}

interface ApiRequestOptions extends RequestInit {
  cacheTtlMs?: number;
}

interface CachedResponse {
  expiresAt: number;
  value: unknown;
}

const cachedGetResponses = new Map<string, CachedResponse>();
const inFlightGetRequests = new Map<string, Promise<unknown>>();
let requestCacheGeneration = 0;

export async function apiRequestBlob(path: string): Promise<Blob> {
  const response = await fetch(`${apiBaseUrl}${path}`, { credentials: 'include' });
  if (response.ok) return response.blob();
  throw new Error(await getErrorMessage(response, path));
}

export interface SessionPayload {
  account?: { id: string; email: string };
  membership?: { id: string; displayName: string | null };
  organization: { id: string; name: string };
  role: 'L1_ADMIN' | 'L2_ADMIN';
  expiresAt: string;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { cacheTtlMs = 0, ...requestOptions } = options;
  const method = (requestOptions.method ?? 'GET').toUpperCase();
  const hasBody = requestOptions.body !== undefined && requestOptions.body !== null;
  const usesFormData = typeof FormData !== 'undefined' && requestOptions.body instanceof FormData;
  const cacheableGet = method === 'GET' && !hasBody && !requestOptions.signal;

  if (cacheableGet) {
    const cached = cachedGetResponses.get(path);
    if (cached && cached.expiresAt > Date.now()) return cached.value as T;
    if (cached) cachedGetResponses.delete(path);

    const inFlight = inFlightGetRequests.get(path);
    if (inFlight) return inFlight as Promise<T>;
  } else {
    clearApiRequestCache();
  }

  const request = performApiRequest<T>(path, requestOptions, hasBody, usesFormData);
  if (!cacheableGet) return request;

  const cacheGeneration = requestCacheGeneration;
  inFlightGetRequests.set(path, request);
  try {
    const value = await request;
    if (cacheTtlMs > 0 && cacheGeneration === requestCacheGeneration) {
      cachedGetResponses.set(path, { expiresAt: Date.now() + cacheTtlMs, value });
    }
    return value;
  } finally {
    if (inFlightGetRequests.get(path) === request) inFlightGetRequests.delete(path);
  }
}

export function clearApiRequestCache(): void {
  requestCacheGeneration += 1;
  cachedGetResponses.clear();
  inFlightGetRequests.clear();
}

async function performApiRequest<T>(
  path: string,
  options: RequestInit,
  hasBody: boolean,
  usesFormData: boolean,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(hasBody && !usesFormData ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  if (response.ok) return (await response.json()) as T;
  throw new Error(await getErrorMessage(response, path));
}

async function getErrorMessage(response: Response, path: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
  const reason = payload?.message ?? response.statusText ?? '请求未能完成';
  const trace = payload?.correlationId ? ` · ${payload.correlationId}` : '';
  return `${reason}（${response.status} ${path}${trace}）`;
}
