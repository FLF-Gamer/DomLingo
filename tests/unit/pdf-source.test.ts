import { describe, expect, it } from 'vitest';
import { assertPdfBytes, looksLikePdfUrl, pdfSourceUrl } from '../../src/pdf/source';

describe('PDF sources', () => {
  it('accepts HTTPS and local test servers without accepting executable or credential URLs', () => {
    expect(pdfSourceUrl('https://example.com/download?id=1')?.hostname).toBe('example.com');
    expect(pdfSourceUrl('http://localhost:8080/example.pdf')).toBeDefined();
    for (const value of [
      'javascript:alert(1)',
      'data:application/pdf,x',
      'https://user:secret@example.com/a.pdf',
      'file:///a.pdf',
    ]) {
      expect(pdfSourceUrl(value)).toBeUndefined();
    }
  });
  it('uses the pathname rather than query text as a URL hint', () => {
    expect(looksLikePdfUrl('https://example.com/FILE.PDF?download=1#page=2')).toBe(true);
    expect(looksLikePdfUrl('https://example.com/article?name=document.pdf')).toBe(false);
  });
  it('rejects an HTML login response masquerading as a PDF URL', () => {
    expect(() => assertPdfBytes(new TextEncoder().encode('<html>Login</html>'))).toThrow(
      '没有读取到 PDF',
    );
    expect(() => assertPdfBytes(new TextEncoder().encode('%PDF-1.4\n'))).not.toThrow();
  });
});
