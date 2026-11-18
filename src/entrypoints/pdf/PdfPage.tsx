import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import { extractRegionText, rectangle, type Rect } from '../../pdf/region';

interface PdfPageProps {
  document: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  zoom: number;
  selection: Rect | null;
  onSelect(region: Rect, text: string): void;
  onClear(): void;
  onError(message: string): void;
}

export function PdfPage({
  document,
  pageNumber,
  width,
  zoom,
  selection,
  onSelect,
  onClear,
  onError,
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState({ width: 600, height: 800 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = layerRef.current;
    if (!canvas || !container || width < 1) return;
    let disposed = false;
    let render: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    setReady(false);
    setDraft(null);
    drag.current = null;
    container.replaceChildren();
    void (async () => {
      const page = await document.getPage(pageNumber);
      if (disposed) return;
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: Math.max(0.1, Math.min(1.5, (width - 48) / natural.width)) * zoom,
      });
      const outputScale = Math.min(
        window.devicePixelRatio || 1,
        2,
        Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
      );
      setSize({ width: viewport.width, height: viewport.height });
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      container.style.setProperty('--total-scale-factor', String(viewport.scale));
      render = page.render({ canvas, viewport, transform: [outputScale, 0, 0, outputScale, 0, 0] });
      const textReady = page.getTextContent().then(async (content) => {
        if (disposed) return;
        textLayer = new TextLayer({ textContentSource: content, container, viewport });
        await textLayer.render();
      });
      await Promise.all([render.promise, textReady]);
      if (!disposed) setReady(true);
    })().catch((error: unknown) => {
      if (!disposed)
        onError(
          error instanceof Error
            ? `页面无法显示：${error.message}`
            : '页面无法显示，请重新打开 PDF。',
        );
    });
    return () => {
      disposed = true;
      render?.cancel();
      textLayer?.cancel();
    };
  }, [document, pageNumber, width, zoom, onError]);

  const point = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(size.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(size.height, event.clientY - bounds.top)),
    };
  };
  const selected = draft ?? selection;

  return (
    <div className="pdf-page" style={size} data-ready={ready}>
      <canvas ref={canvasRef} style={size} aria-label={`PDF 第 ${pageNumber} 页`} />
      <div className="textLayer" ref={layerRef} style={size} />
      <div
        className="region-picker"
        role="group"
        aria-label="在 PDF 页面拖动框选文字"
        onPointerDown={(event) => {
          if (!ready || event.button !== 0 || !event.isPrimary) return;
          event.preventDefault();
          onClear();
          const start = point(event);
          drag.current = { ...start, pointerId: event.pointerId };
          setDraft({ left: start.x, top: start.y, width: 0, height: 0 });
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current || drag.current.pointerId !== event.pointerId) return;
          const end = point(event);
          setDraft(rectangle(drag.current.x, drag.current.y, end.x, end.y));
        }}
        onPointerUp={(event) => {
          if (!drag.current || drag.current.pointerId !== event.pointerId) return;
          const end = point(event);
          const region = rectangle(drag.current.x, drag.current.y, end.x, end.y);
          drag.current = null;
          setDraft(null);
          event.currentTarget.releasePointerCapture(event.pointerId);
          if (region.width < 6 || region.height < 6 || !layerRef.current) return;
          const pageBounds = event.currentTarget.getBoundingClientRect();
          const text = extractRegionText(layerRef.current, {
            ...region,
            left: pageBounds.left + region.left,
            top: pageBounds.top + region.top,
          });
          onSelect(region, text);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDraft(null);
        }}
      >
        {selected && (
          <div className="selected-region" style={selected} data-testid="selected-region" />
        )}
      </div>
      {!ready && (
        <div className="page-loading" role="status">
          正在显示页面…
        </div>
      )}
    </div>
  );
}
