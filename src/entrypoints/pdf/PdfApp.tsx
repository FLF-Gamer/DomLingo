import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { assertPdfBytes, fetchPdf, MAX_PDF_BYTES, pdfSourceUrl } from '../../pdf/source';
import { placeTranslation, type Rect } from '../../pdf/region';
import { PdfSelectionTranslation, type PdfTranslationState } from '../../pdf/selection-translation';
import { PdfPage } from './PdfPage';

GlobalWorkerOptions.workerSrc = workerUrl;

export function PdfApp() {
  const [source, setSource] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get('source') ?? '',
  );
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [filename, setFilename] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [sourceText, setSourceText] = useState('');
  const [result, setResult] = useState<PdfTranslationState | null>(null);
  const [placement, setPlacement] = useState<Rect | null>(null);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const measuredWidth = useRef(0);
  const loadRef = useRef<{ controller: AbortController; task?: PDFDocumentLoadingTask } | null>(
    null,
  );
  const translator = useRef<PdfSelectionTranslation | null>(null);
  if (translator.current === null)
    translator.current = new PdfSelectionTranslation(
      (message) => chrome.runtime.sendMessage(message),
      setResult,
    );

  const clearSelection = useCallback(() => {
    translator.current?.cancel();
    setSelection(null);
    setResult(null);
    setSourceText('');
    setCopied(false);
  }, []);

  const reposition = useCallback(() => {
    if (!selection || !scrollRef.current) return;
    const page = scrollRef.current.querySelector('.pdf-page');
    if (!page) return;
    const bounds = scrollRef.current.getBoundingClientRect();
    const origin = page.getBoundingClientRect();
    const selected = {
      ...selection,
      left: origin.left + selection.left,
      top: origin.top + selection.top,
    };
    setPlacement(placeTranslation(selected, bounds));
  }, [selection]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const observer = new ResizeObserver(() => {
      if (measuredWidth.current && measuredWidth.current !== scroll.clientWidth) clearSelection();
      measuredWidth.current = scroll.clientWidth;
      setWidth(scroll.clientWidth);
      reposition();
    });
    observer.observe(scroll);
    scroll.addEventListener('scroll', reposition);
    window.addEventListener('resize', reposition);
    reposition();
    return () => {
      observer.disconnect();
      scroll.removeEventListener('scroll', reposition);
      window.removeEventListener('resize', reposition);
    };
  }, [reposition, clearSelection]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearSelection();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [clearSelection]);

  useEffect(
    () => () => {
      translator.current?.cancel();
      loadRef.current?.controller.abort();
      void loadRef.current?.task?.destroy();
    },
    [],
  );

  const load = async (read: (signal: AbortSignal) => Promise<Uint8Array>, name: string) => {
    loadRef.current?.controller.abort();
    const previous = loadRef.current?.task;
    const operation: NonNullable<typeof loadRef.current> = { controller: new AbortController() };
    loadRef.current = operation;
    clearSelection();
    setDocument(null);
    setLoading(true);
    setError('');
    setFilename(name);
    try {
      await previous?.destroy();
      const data = await read(operation.controller.signal);
      if (loadRef.current !== operation) return;
      assertPdfBytes(data);
      operation.task = getDocument({
        data,
        useWasm: false,
        wasmUrl: chrome.runtime.getURL('pdf-assets/wasm/'),
        cMapUrl: chrome.runtime.getURL('pdf-assets/cmaps/'),
        cMapPacked: true,
        standardFontDataUrl: chrome.runtime.getURL('pdf-assets/standard_fonts/'),
        enableXfa: false,
      });
      const pdf = await operation.task.promise;
      if (loadRef.current !== operation) {
        await operation.task.destroy();
        return;
      }
      setPageNumber(1);
      setZoom(1);
      setDocument(pdf);
    } catch (reason) {
      if (loadRef.current !== operation || operation.controller.signal.aborted) return;
      setError(
        reason instanceof Error && reason.name === 'PasswordException'
          ? '这份 PDF 需要密码。请先在本地解锁，再选择文件。'
          : reason instanceof Error
            ? reason.message
            : '无法打开 PDF，请检查文件或链接。',
      );
    } finally {
      if (loadRef.current === operation) setLoading(false);
    }
  };

  const openRemote = async () => {
    const url = pdfSourceUrl(source.trim());
    if (!url) {
      setError('请输入 HTTPS PDF 链接，或选择本地 PDF 文件。');
      return;
    }
    try {
      const origin = `${url.protocol}//${url.hostname}/*`;
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) {
        setError('需要授权读取这个 PDF 所在的网站，也可以选择本地文件。');
        return;
      }
      await load(
        (signal) => fetchPdf(url, signal),
        decodeURIComponent(url.pathname.split('/').pop() || 'PDF 文档'),
      );
    } catch {
      setError('无法读取在线 PDF。请先下载文件，再使用“选择 PDF”。');
    }
  };

  const select = (region: Rect, text: string) => {
    setSelection(region);
    setSourceText(text);
    setCopied(false);
    void translator.current?.translate(text);
  };

  const changePage = (value: number) => {
    if (!document || !Number.isInteger(value)) return;
    clearSelection();
    setPageNumber(Math.max(1, Math.min(document.numPages, value)));
    scrollRef.current?.scrollTo({ top: 0, left: 0 });
  };

  const docked = result !== null && placement === null;
  return (
    <main className="pdf-app">
      <header className="reader-header">
        <div className="reader-brand">
          <img src="/icons/icon-48.png" alt="" width={32} height={32} />
          <div>
            <strong>PDF 框选翻译</strong>
            <span>DomLingo · 原页译</span>
          </div>
        </div>
        <div className="file-actions">
          <label className="button" htmlFor="pdf-file">
            选择 PDF
          </label>
          <input
            id="pdf-file"
            className="file-input"
            type="file"
            accept=".pdf,application/pdf"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (!file) return;
              if (file.size > MAX_PDF_BYTES) {
                setError('PDF 超过 50 MB，请选择较小的文件。');
                return;
              }
              void load(async () => new Uint8Array(await file.arrayBuffer()), file.name);
            }}
          />
          <button type="button" onClick={() => void chrome.runtime.openOptionsPage()}>
            模型设置
          </button>
        </div>
      </header>
      <div className="reader-toolbar">
        <div className="document-name" title={filename}>
          {filename || '未打开文件'}
        </div>
        {document && (
          <div className="page-controls">
            <button
              type="button"
              aria-label="上一页"
              disabled={pageNumber <= 1}
              onClick={() => changePage(pageNumber - 1)}
            >
              ‹
            </button>
            <label>
              第{' '}
              <input
                aria-label="页码"
                type="number"
                min={1}
                max={document.numPages}
                value={pageNumber}
                onChange={(event) => changePage(Number(event.target.value))}
              />{' '}
              / {document.numPages} 页
            </label>
            <button
              type="button"
              aria-label="下一页"
              disabled={pageNumber >= document.numPages}
              onClick={() => changePage(pageNumber + 1)}
            >
              ›
            </button>
            <select
              aria-label="缩放"
              value={zoom}
              onChange={(event) => {
                clearSelection();
                setZoom(Number(event.target.value));
              }}
            >
              <option value={0.75}>75%</option>
              <option value={1}>适合宽度</option>
              <option value={1.25}>125%</option>
              <option value={1.5}>150%</option>
              <option value={2}>200%</option>
            </select>
          </div>
        )}
      </div>
      {error && (
        <div className="reader-error" role="alert">
          {error}
          <button type="button" aria-label="关闭提示" onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}
      <div className="reader-body">
        <div className="reader-scroll" ref={scrollRef}>
          {document ? (
            <PdfPage
              document={document}
              pageNumber={pageNumber}
              width={width}
              zoom={zoom}
              selection={selection}
              onSelect={select}
              onClear={clearSelection}
              onError={setError}
            />
          ) : (
            <section className="empty-reader">
              <div className="pdf-symbol">PDF</div>
              <h1>{loading ? '正在打开 PDF…' : '打开 PDF'}</h1>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void openRemote();
                }}
              >
                <label htmlFor="pdf-source">在线 PDF 链接</label>
                <div className="source-input">
                  <input
                    id="pdf-source"
                    type="url"
                    value={source}
                    onChange={(event) => setSource(event.target.value)}
                    placeholder="https://example.com/document.pdf"
                  />
                  <button className="primary" type="submit" disabled={loading || !source.trim()}>
                    打开 PDF
                  </button>
                </div>
              </form>
              <p className="file-hint">最大 50 MB，暂不支持扫描件。</p>
            </section>
          )}
        </div>
        {result && (
          <section
            className={`translation-card ${docked ? 'translation-card--docked' : ''}`}
            aria-label="选区译文"
            style={
              placement
                ? {
                    left: placement.left,
                    top: placement.top,
                    width: placement.width,
                    height: placement.height,
                  }
                : undefined
            }
          >
            <header>
              <div>
                <strong>选区译文</strong>
                <span>
                  {result.phase === 'translating'
                    ? result.message
                    : result.phase === 'stopped'
                      ? '已停止'
                      : result.phase === 'error'
                        ? '翻译未完成'
                        : '简体中文'}
                </span>
              </div>
              <button type="button" aria-label="关闭译文" onClick={clearSelection}>
                ×
              </button>
            </header>
            <div className="translation-content" aria-live="polite">
              {result.text && <p>{result.text}</p>}
              {result.phase === 'error' && <p className="translation-error">{result.message}</p>}
              {!result.text && result.phase === 'translating' && (
                <p className="muted">正在翻译框选的文字…</p>
              )}
              {!result.text && result.phase === 'stopped' && (
                <p className="muted">翻译已停止，可以重试或重新框选。</p>
              )}
            </div>
            <footer>
              {result.phase === 'translating' ? (
                <button
                  type="button"
                  onClick={() => {
                    translator.current?.cancel();
                    setResult({ ...result, phase: 'stopped', message: '已停止' });
                  }}
                >
                  停止
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!sourceText}
                  onClick={() => void translator.current?.translate(sourceText)}
                >
                  重新翻译
                </button>
              )}
              <button
                type="button"
                disabled={!result.text}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(result.text)
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
              >
                {copied ? '已复制' : '复制译文'}
              </button>
            </footer>
          </section>
        )}
      </div>
      {document && <div className="reader-hint">拖动框选文字 · Esc 关闭译文</div>}
    </main>
  );
}
