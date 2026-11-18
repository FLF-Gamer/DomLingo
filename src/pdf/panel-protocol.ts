import type { PdfTranslationState } from './selection-translation';

export interface PdfPanelState {
  selectionId: string;
  sourceText: string;
  phase: PdfTranslationState['phase'] | 'idle';
  text: string;
  message: string;
  revision: number;
}

export type PdfPanelCommand =
  { type: 'WATCH'; tabId: number } | { type: 'STOP' | 'RETRY'; selectionId: string };

export interface PdfPanelUpdate {
  tabId: number;
  state: PdfPanelState | null;
}

export const PDF_PANEL_PORT = 'domlingo-pdf-panel';
export const PDF_SELECTION_HINT = '在 PDF 中选中文字，再右键选择“DomLingo：AI 翻译”。';

export function isPdfPanelCommand(value: unknown): value is PdfPanelCommand {
  if (typeof value !== 'object' || value === null) return false;
  const command = value as Partial<PdfPanelCommand>;
  if (command.type === 'WATCH')
    return Number.isInteger(command.tabId) && (command.tabId ?? -1) >= 0;
  return (
    (command.type === 'STOP' || command.type === 'RETRY') &&
    typeof command.selectionId === 'string' &&
    command.selectionId.length > 0 &&
    command.selectionId.length <= 128
  );
}
