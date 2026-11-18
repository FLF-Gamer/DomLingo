import type {
  CancelSessionMessage,
  TranslateBatchMessage,
  TranslateBatchResponse,
} from '../messaging/protocol';
import { splitPdfSelection, type PdfSelectionChunk } from './selection-chunks';

export interface PdfTranslationState {
  phase: 'translating' | 'completed' | 'stopped' | 'error';
  text: string;
  message: string;
}

type SendMessage = (message: TranslateBatchMessage | CancelSessionMessage) => Promise<unknown>;

export class PdfSelectionTranslation {
  private current: string | undefined;

  constructor(
    private readonly send: SendMessage,
    private readonly update: (state: PdfTranslationState) => void,
  ) {}

  cancel(): void {
    const sessionId = this.current;
    this.current = undefined;
    if (sessionId)
      void this.send({ version: 1, type: 'CANCEL_SESSION', sessionId }).catch(() => undefined);
  }

  async translate(text: string): Promise<void> {
    this.cancel();
    if (!text.trim()) {
      this.update({
        phase: 'error',
        text: '',
        message: '这个区域没有可提取的文字。扫描件和图片暂不支持，请选择带文字层的 PDF。',
      });
      return;
    }
    let chunks: PdfSelectionChunk[];
    try {
      chunks = splitPdfSelection(text);
    } catch (error) {
      this.update({
        phase: 'error',
        text: '',
        message: error instanceof Error ? error.message : '无法处理选区，请缩小选区。',
      });
      return;
    }
    const sessionId = `pdf-${crypto.randomUUID()}`;
    this.current = sessionId;
    let translatedText = '';
    this.update({ phase: 'translating', text: '', message: '正在翻译选区…' });
    try {
      for (const [index, chunk] of chunks.entries()) {
        if (this.current !== sessionId) return;
        const segmentId =
          chunks.length === 1 ? 'pdf-selection-text' : `pdf-selection-text-${index}`;
        const response = (await this.send({
          version: 1,
          type: 'TRANSLATE_BATCH',
          payload: {
            sessionId,
            requestId: `${sessionId}-${index}`,
            generation: 0,
            blocks: [
              {
                id: 'pdf-selection',
                context: '',
                segments: [{ id: segmentId, text: chunk.text }],
              },
            ],
          },
        })) as TranslateBatchResponse | undefined;
        if (this.current !== sessionId) return;
        if (!response?.ok)
          throw new Error(
            response && 'message' in response
              ? response.message
              : '扩展后台没有响应，请重新加载扩展。',
          );
        if (response.result.failedIds.length)
          throw new Error('模型没有返回完整译文，请重试或缩小选区。');
        const translated = response.result.translations.find((item) => item.id === segmentId)?.text;
        if (!translated?.trim()) throw new Error('模型没有返回完整译文，请重试。');
        if (index === 0) translatedText = translated;
        else {
          const before = translatedText.trimEnd();
          const after = translated.trimStart();
          const separator = chunk.paragraphBreakBefore
            ? '\n\n'
            : /[\x21-\x7e]$/u.test(before) && /^[\x21-\x7e]/u.test(after)
              ? ' '
              : '';
          translatedText = before + separator + after;
        }
        const completed = index === chunks.length - 1;
        this.update({
          phase: completed ? 'completed' : 'translating',
          text: translatedText,
          message: completed ? '翻译完成' : `正在翻译 ${index + 1}/${chunks.length}…`,
        });
      }
    } catch (error) {
      if (this.current !== sessionId) return;
      this.update({
        phase: 'error',
        text: translatedText,
        message: error instanceof Error ? error.message : '翻译失败，请重试。',
      });
    } finally {
      if (this.current === sessionId) this.current = undefined;
    }
  }
}
