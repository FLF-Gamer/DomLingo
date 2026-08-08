import type {
  CancelSessionMessage,
  PageTranslationStatus,
  TranslateBatchMessage,
  TranslateBatchResponse,
} from '../messaging/protocol';
import { buildTranslationBatches, mapWithConcurrency } from '../translation/batching';
import { detectMainContent } from './main-content';
import {
  applyTranslations,
  collectPageSourcesAsync,
  restoreOriginals,
  type SourceRecord,
} from './source-collector';

export interface TranslationSessionOptions {
  batchCharacterLimit: number;
  concurrency: number;
}

const IDLE_STATUS: PageTranslationStatus = {
  state: 'idle',
  total: 0,
  translated: 0,
  failed: 0,
  message: '尚未开始翻译。',
};

export class PageTranslationSession {
  private status: PageTranslationStatus = { ...IDLE_STATUS };
  private root: HTMLElement | undefined;
  private records: SourceRecord[] = [];
  private sessionId = '';
  private generation = 0;

  constructor(
    private readonly document: Document,
    private readonly onStatusChange: (status: PageTranslationStatus) => void = () => undefined,
  ) {}

  getStatus(): PageTranslationStatus {
    return { ...this.status };
  }

  private setStatus(status: PageTranslationStatus): void {
    this.status = status;
    this.onStatusChange(this.getStatus());
  }

  start(options: TranslationSessionOptions): void {
    if (this.status.state === 'scanning' || this.status.state === 'translating') return;
    if (this.records.some((record) => record.appliedValue !== undefined)) {
      this.setStatus({
        ...this.status,
        state: 'completed',
        message: '当前页面已经翻译，可先恢复原文。',
      });
      return;
    }

    const expectedGeneration = this.generation + 1;
    void this.run(options).catch(() => {
      if (this.generation !== expectedGeneration) return;
      this.setStatus({
        ...this.status,
        state: 'error',
        message: '翻译过程中发生错误，页面中已完成的内容保持不变。',
      });
    });
  }

  stop(): PageTranslationStatus {
    if (this.status.state !== 'scanning' && this.status.state !== 'translating') {
      return this.getStatus();
    }

    const cancelledSessionId = this.sessionId;
    this.generation += 1;
    this.setStatus({
      ...this.status,
      state: 'stopped',
      message: '已停止翻译，已完成的译文仍保留在页面中。',
    });
    if (cancelledSessionId) this.cancelBackgroundSession(cancelledSessionId);
    return this.getStatus();
  }

  restore(): PageTranslationStatus {
    const cancelledSessionId = this.sessionId;
    this.generation += 1;
    if (cancelledSessionId) this.cancelBackgroundSession(cancelledSessionId);

    if (this.root) restoreOriginals(this.root, this.records);
    this.root = undefined;
    this.records = [];
    this.sessionId = '';
    this.setStatus({ ...IDLE_STATUS, message: '已恢复本次会话修改的原文。' });
    return this.getStatus();
  }

  private cancelBackgroundSession(sessionId: string): void {
    const message: CancelSessionMessage = { version: 1, type: 'CANCEL_SESSION', sessionId };
    void chrome.runtime.sendMessage(message).catch(() => undefined);
  }

  private async run(options: TranslationSessionOptions): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    this.sessionId = crypto.randomUUID();
    this.setStatus({ ...IDLE_STATUS, state: 'scanning', message: '正在识别网页正文…' });

    const detection = detectMainContent(this.document);
    if (!detection) {
      this.setStatus({
        ...IDLE_STATUS,
        state: 'error',
        message: '未识别到正文区域，本页未进行任何修改。',
      });
      return;
    }

    const collected = await collectPageSourcesAsync(detection.root, this.sessionId);
    if (generation !== this.generation) return;
    if (collected.records.length === 0) {
      this.setStatus({
        ...IDLE_STATUS,
        state: 'error',
        message: '正文中没有找到可翻译的英文内容。',
      });
      return;
    }

    this.root = detection.root;
    this.records = collected.records;
    const batches = buildTranslationBatches(collected.blocks, options.batchCharacterLimit);
    this.setStatus({
      state: 'translating',
      total: collected.records.length,
      translated: 0,
      failed: 0,
      message: `正在翻译 0 / ${collected.records.length}…`,
    });

    let lastError = '';
    const accumulatedTranslations = new Map<string, string>();
    const processedSegmentIds = new Set<string>();
    await mapWithConcurrency(batches, options.concurrency, async (blocks, batchIndex) => {
      if (generation !== this.generation || !this.root) return;

      const message: TranslateBatchMessage = {
        version: 1,
        type: 'TRANSLATE_BATCH',
        payload: {
          requestId: `${this.sessionId}:request:${batchIndex + 1}`,
          sessionId: this.sessionId,
          generation,
          blocks,
        },
      };

      let response: TranslateBatchResponse;
      try {
        response = (await chrome.runtime.sendMessage(message)) as TranslateBatchResponse;
      } catch {
        response = {
          ok: false,
          code: 'NETWORK_ERROR',
          message: '无法连接扩展后台，请重新加载扩展后再试。',
        };
      }

      if (generation !== this.generation || !this.root) return;
      for (const block of blocks) {
        for (const segment of block.segments) processedSegmentIds.add(segment.id);
      }

      if (!response?.ok) {
        lastError = response?.message ?? '模型服务没有返回有效结果。';
      } else {
        for (const translation of response.result.translations) {
          accumulatedTranslations.set(translation.id, translation.text);
        }
        applyTranslations(this.root, this.records, accumulatedTranslations);
      }

      const translatedRecordCount = this.records.filter(
        (record) => record.appliedValue !== undefined,
      ).length;
      this.status.translated = translatedRecordCount;
      this.status.failed = this.records.filter(
        (record) =>
          record.appliedValue === undefined &&
          record.segments.every((segment) => processedSegmentIds.has(segment.id)),
      ).length;

      this.setStatus({
        ...this.status,
        message: `正在翻译 ${this.status.translated} / ${this.status.total}…`,
      });
    });

    if (generation !== this.generation) return;
    this.status.failed = this.status.total - this.status.translated;
    const finalState = this.status.translated > 0 ? 'completed' : 'error';
    this.setStatus({
      ...this.status,
      state: finalState,
      message:
        finalState === 'completed'
          ? `翻译完成：成功 ${this.status.translated}，失败 ${this.status.failed}。`
          : lastError || '没有节点翻译成功，页面保持原文。',
    });
  }
}
