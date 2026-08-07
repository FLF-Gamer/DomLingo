import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  listGrantedEndpointPermissions,
  requestEndpointPermission,
  revokeEndpointPermission,
} from '../../src/background/permission-service';

const contains = vi.fn();
const getAll = vi.fn();
const remove = vi.fn();
const request = vi.fn();

describe('permission service', () => {
  beforeEach(() => {
    contains.mockReset();
    getAll.mockReset();
    remove.mockReset();
    request.mockReset();
    vi.stubGlobal('chrome', { permissions: { contains, getAll, remove, request } });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('does not request an endpoint origin that is already granted', async () => {
    contains.mockResolvedValue(true);

    await expect(
      requestEndpointPermission('https://api.example.com/v1/chat/completions'),
    ).resolves.toEqual({
      ok: true,
      permissionPattern: 'https://api.example.com/*',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('returns a stable message when the user rejects a permission request', async () => {
    contains.mockResolvedValue(false);
    request.mockResolvedValue(false);

    await expect(
      requestEndpointPermission('https://api.example.com/v1/chat/completions'),
    ).resolves.toEqual({
      ok: false,
      message: '未获得 api.example.com 的访问权限，无法测试连接。',
    });
  });

  it('lists only precise endpoint permissions managed by DomLingo', async () => {
    getAll.mockResolvedValue({
      origins: [
        'https://api.example.com/*',
        'http://localhost/*',
        'http://insecure.example.com/*',
        'https://*/*',
      ],
    });

    await expect(listGrantedEndpointPermissions()).resolves.toEqual([
      { pattern: 'http://localhost/*', origin: 'http://localhost' },
      { pattern: 'https://api.example.com/*', origin: 'https://api.example.com' },
    ]);
  });

  it('refuses to revoke origins outside the managed endpoint rules', async () => {
    await expect(revokeEndpointPermission('https://*/*')).resolves.toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it('revokes an exact granted endpoint origin', async () => {
    remove.mockResolvedValue(true);

    await expect(revokeEndpointPermission('https://api.example.com/*')).resolves.toBe(true);
    expect(remove).toHaveBeenCalledWith({ origins: ['https://api.example.com/*'] });
  });
});
