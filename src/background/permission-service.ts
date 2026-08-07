import { validateProviderEndpoint } from '../providers/endpoint';

export type PermissionRequestResult =
  { ok: true; permissionPattern: string } | { ok: false; message: string };

export interface GrantedEndpointPermission {
  pattern: string;
  origin: string;
}

function toGrantedEndpointPermission(pattern: string): GrantedEndpointPermission | undefined {
  if (!pattern.endsWith('/*')) return undefined;

  try {
    const endpoint = new URL(pattern.slice(0, -1));
    const isAllowedProtocol =
      endpoint.protocol === 'https:' ||
      (endpoint.protocol === 'http:' &&
        (endpoint.hostname === 'localhost' || endpoint.hostname === '127.0.0.1'));

    if (
      !isAllowedProtocol ||
      endpoint.hostname.includes('*') ||
      endpoint.pathname !== '/' ||
      endpoint.search ||
      endpoint.hash
    ) {
      return undefined;
    }

    return { pattern, origin: endpoint.origin };
  } catch {
    return undefined;
  }
}

export async function requestEndpointPermission(
  endpoint: string,
): Promise<PermissionRequestResult> {
  const validation = validateProviderEndpoint(endpoint);
  if (!validation.ok) return { ok: false, message: validation.message };

  const permission = { origins: [validation.permissionPattern] };
  const alreadyGranted = await chrome.permissions.contains(permission);
  const granted = alreadyGranted || (await chrome.permissions.request(permission));

  if (!granted) {
    return {
      ok: false,
      message: `未获得 ${new URL(validation.endpoint).hostname} 的访问权限，无法测试连接。`,
    };
  }

  return { ok: true, permissionPattern: validation.permissionPattern };
}

export async function listGrantedEndpointPermissions(): Promise<GrantedEndpointPermission[]> {
  const permissions = await chrome.permissions.getAll();
  return (permissions.origins ?? [])
    .map(toGrantedEndpointPermission)
    .filter((permission): permission is GrantedEndpointPermission => Boolean(permission))
    .sort((left, right) => left.origin.localeCompare(right.origin));
}

export async function revokeEndpointPermission(pattern: string): Promise<boolean> {
  if (!toGrantedEndpointPermission(pattern)) return false;
  return chrome.permissions.remove({ origins: [pattern] });
}
