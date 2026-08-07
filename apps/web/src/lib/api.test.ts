import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiBaseUrl, apiRequest, clearApiRequestCache } from './api';

afterEach(() => {
  clearApiRequestCache();
  vi.unstubAllGlobals();
});

describe('apiRequest', () => {
  it('通过同源代理访问后端，避免浏览器跨端口会话问题', () => {
    expect(apiBaseUrl).toBe('/backend');
  });

  it('无请求体时不发送 JSON content-type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await apiRequest<void>('/auth/logout', { method: 'POST' });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/logout'),
      expect.objectContaining({ headers: {} }),
    );
  });

  it('发送 JSON 请求体时自动设置 content-type', async () => {
    const response = new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);
    await apiRequest('/example', { method: 'POST', body: JSON.stringify({ value: 1 }) });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/example'),
      expect.objectContaining({ headers: { 'content-type': 'application/json' } }),
    );
  });

  it('错误信息包含状态码、路径和关联标识', async () => {
    const response = new Response(
      JSON.stringify({ message: '库存查询失败', correlationId: 'trace-123' }),
      { headers: { 'content-type': 'application/json' }, status: 500 },
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(apiRequest('/holds/summary')).rejects.toThrow(
      '库存查询失败（500 /holds/summary · trace-123）',
    );
  });

  it('合并同时发生的相同 GET 请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ count: 3 }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = apiRequest<{ count: number }>('/holds/summary');
    const second = apiRequest<{ count: number }>('/holds/summary');

    await expect(Promise.all([first, second])).resolves.toEqual([{ count: 3 }, { count: 3 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('在有效期内复用 GET 响应，写操作后立即失效', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ count: 1 }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ count: 2 }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/holds/summary', { cacheTtlMs: 30_000 });
    await apiRequest('/holds/summary', { cacheTtlMs: 30_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await apiRequest('/holds/specifications/1', { method: 'PATCH', body: '{}' });
    await apiRequest('/holds/summary', { cacheTtlMs: 30_000 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
