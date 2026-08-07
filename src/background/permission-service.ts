import { validateProviderEndpoint } from '../providers/endpoint';

export type PermissionRequestResult =
  { ok: true; permissionPattern: string } | { ok: false; message: string };

export async function requestEndpointPermission(
  endpoint: string,
): Promise<PermissionRequestResult> {
  const validation = validateProviderEndpoint(endpoint);
  if (!validation.ok) return { ok: false, message: validation.message };

  const granted = await chrome.permissions.request({
    origins: [validation.permissionPattern],
  });

  if (!granted) {
    return {
      ok: false,
      message: `未获得 ${new URL(validation.endpoint).hostname} 的访问权限，无法测试连接。`,
    };
  }

  return { ok: true, permissionPattern: validation.permissionPattern };
}
