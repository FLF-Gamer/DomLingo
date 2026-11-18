export const MAX_PDF_BYTES = 50 * 1024 * 1024;

export function pdfSourceUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (url.username || url.password) return undefined;
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
    )
      return undefined;
    return url;
  } catch {
    return undefined;
  }
}

export function looksLikePdfUrl(value: string): boolean {
  try {
    return /\.pdf$/i.test(decodeURIComponent(new URL(value).pathname));
  } catch {
    return false;
  }
}

export function assertPdfBytes(data: Uint8Array): void {
  if (data.length > MAX_PDF_BYTES) throw new Error('PDF 超过 50 MB，请选择较小的文件。');
  if (!new TextDecoder().decode(data.subarray(0, 1024)).includes('%PDF-')) {
    throw new Error('没有读取到 PDF 文件。若链接需要登录，请先下载，再选择本地 PDF。');
  }
}

export async function fetchPdf(url: URL, signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(url.href, {
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok)
    throw new Error(`无法打开 PDF（HTTP ${response.status}）。可先下载后选择本地文件。`);
  if (Number(response.headers.get('content-length')) > MAX_PDF_BYTES) {
    throw new Error('PDF 超过 50 MB，请选择较小的文件。');
  }
  if (!response.body) throw new Error('PDF 内容为空。');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PDF_BYTES) throw new Error('PDF 超过 50 MB，请选择较小的文件。');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  assertPdfBytes(data);
  return data;
}
