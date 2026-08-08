import type { PageTranslationStatus } from '../messaging/protocol';

export interface ProgressOverlayActions {
  onStop: () => void;
  onRestore: () => void;
}

export class TranslationProgressOverlay {
  private host: HTMLDivElement | undefined;
  private statusElement: HTMLElement | undefined;
  private detailElement: HTMLElement | undefined;
  private progressElement: HTMLElement | undefined;
  private stopButton: HTMLButtonElement | undefined;
  private restoreButton: HTMLButtonElement | undefined;

  constructor(
    private readonly document: Document,
    private readonly actions: ProgressOverlayActions,
  ) {}

  update(status: PageTranslationStatus): void {
    if (status.state === 'idle') {
      this.remove();
      return;
    }

    this.ensureMounted();
    if (
      !this.statusElement ||
      !this.detailElement ||
      !this.progressElement ||
      !this.stopButton ||
      !this.restoreButton
    ) {
      return;
    }

    const isTranslating = status.state === 'scanning' || status.state === 'translating';
    const stateLabel: Record<PageTranslationStatus['state'], string> = {
      idle: '准备就绪',
      scanning: '正在识别正文',
      translating: '正在翻译',
      completed: '翻译完成',
      stopped: '翻译已停止',
      error: '翻译遇到问题',
    };
    const progress = status.total > 0 ? Math.round((status.translated / status.total) * 100) : 0;

    this.statusElement.textContent = stateLabel[status.state];
    this.detailElement.textContent = status.message;
    this.progressElement.style.width = `${Math.max(0, Math.min(progress, 100))}%`;
    this.stopButton.hidden = !isTranslating;
    this.restoreButton.hidden = status.translated === 0;
  }

  remove(): void {
    this.host?.remove();
    this.host = undefined;
    this.statusElement = undefined;
    this.detailElement = undefined;
    this.progressElement = undefined;
    this.stopButton = undefined;
    this.restoreButton = undefined;
  }

  private ensureMounted(): void {
    if (this.host?.isConnected) return;

    const host = this.document.createElement('div');
    host.dataset.domlingoOverlay = 'true';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = this.document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .panel { position: fixed; z-index: 2147483647; right: 20px; bottom: 20px; width: min(340px, calc(100vw - 40px)); padding: 14px; border: 1px solid rgba(79, 70, 229, 0.2); border-radius: 14px; color: #172033; background: #fff; box-shadow: 0 16px 42px rgba(16, 24, 40, 0.22); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      strong { display: block; margin-bottom: 4px; font-size: 14px; }
      p { margin: 0; color: #667085; font-size: 12px; line-height: 1.5; }
      .track { height: 4px; margin: 12px 0; overflow: hidden; border-radius: 999px; background: #eef2ff; }
      .progress { width: 0; height: 100%; border-radius: inherit; background: #4f46e5; transition: width 180ms ease; }
      .actions { display: flex; gap: 8px; justify-content: flex-end; }
      button { min-height: 32px; padding: 0 11px; border: 1px solid #d0d5dd; border-radius: 8px; color: #344054; background: #fff; cursor: pointer; font: 600 12px/1 Inter, ui-sans-serif, system-ui, sans-serif; }
      button[data-action="stop"] { border-color: #fda29b; color: #b42318; }
      button:focus-visible { outline: 3px solid #c7d2fe; outline-offset: 2px; }
      button[hidden] { display: none; }
    `;

    const panel = this.document.createElement('section');
    panel.className = 'panel';
    panel.setAttribute('aria-live', 'polite');
    panel.setAttribute('aria-label', 'DomLingo 翻译进度');
    const statusElement = this.document.createElement('strong');
    const detailElement = this.document.createElement('p');
    const track = this.document.createElement('div');
    track.className = 'track';
    track.setAttribute('aria-hidden', 'true');
    const progressElement = this.document.createElement('div');
    progressElement.className = 'progress';
    track.append(progressElement);

    const actions = this.document.createElement('div');
    actions.className = 'actions';
    const restoreButton = this.document.createElement('button');
    restoreButton.type = 'button';
    restoreButton.dataset.action = 'restore';
    restoreButton.textContent = '恢复原文';
    const stopButton = this.document.createElement('button');
    stopButton.type = 'button';
    stopButton.dataset.action = 'stop';
    stopButton.textContent = '停止翻译';
    actions.append(restoreButton, stopButton);
    panel.append(statusElement, detailElement, track, actions);
    shadow.append(style, panel);

    this.statusElement = statusElement;
    this.detailElement = detailElement;
    this.progressElement = progressElement;
    this.stopButton = stopButton;
    this.restoreButton = restoreButton;
    stopButton.addEventListener('click', this.actions.onStop);
    restoreButton.addEventListener('click', this.actions.onRestore);

    this.document.documentElement.append(host);
    this.host = host;
  }
}
