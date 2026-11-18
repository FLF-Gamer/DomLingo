import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfPanelApp } from '../../src/entrypoints/sidepanel/PdfPanelApp';
import type { PdfPanelCommand, PdfPanelState, PdfPanelUpdate } from '../../src/pdf/panel-protocol';

function event<Args extends unknown[]>() {
  const listeners = new Set<(...args: Args) => void>();
  return {
    listeners,
    addListener: vi.fn((listener: (...args: Args) => void) => listeners.add(listener)),
    removeListener: vi.fn((listener: (...args: Args) => void) => listeners.delete(listener)),
    emit: (...args: Args) => {
      for (const listener of [...listeners]) listener(...args);
    },
  };
}

function setup() {
  let disconnected = false;
  const onActivated = event<[info: { tabId: number; windowId: number }]>();
  const onMessage = event<[update: PdfPanelUpdate]>();
  const onDisconnect = event<[]>();
  const postMessage = vi.fn<(message: PdfPanelCommand) => void>(() => {
    if (disconnected) throw new Error('Attempting to use a disconnected port object');
  });
  const port = {
    onMessage,
    onDisconnect,
    postMessage,
    disconnect: vi.fn(() => {
      disconnected = true;
    }),
  };
  const browser = {
    runtime: {
      connect: vi.fn(() => port),
      openOptionsPage: vi.fn(async () => undefined),
      lastError: undefined,
    },
    windows: { getCurrent: vi.fn(async () => ({ id: 7 })) },
    tabs: {
      onActivated,
      query: vi.fn(async () => [{ id: 42 }]),
    },
  };
  vi.stubGlobal('chrome', browser);
  return {
    browser,
    port,
    onActivated,
    onMessage,
    onDisconnect,
    postMessage,
    disconnect(notify = true) {
      disconnected = true;
      if (notify) onDisconnect.emit();
    },
  };
}

const completed: PdfPanelState = {
  selectionId: 'selection-1',
  sourceText: 'The selected sentence.',
  phase: 'completed',
  text: '已经完成的译文。',
  message: '翻译完成',
  revision: 1,
};

async function renderPanel() {
  const result = render(<PdfPanelApp />);
  await act(async () => undefined);
  return result;
}

describe('PDF panel connection lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('cleans up listeners and heartbeats on disconnection while retaining the translation', async () => {
    const mock = setup();
    await renderPanel();
    expect(mock.postMessage).toHaveBeenCalledWith({ type: 'WATCH', tabId: 42 });
    act(() => mock.onMessage.emit({ tabId: 42, state: completed }));
    act(() => mock.disconnect());
    expect(mock.onActivated.listeners.size).toBe(0);
    expect(mock.onMessage.listeners.size).toBe(0);
    expect(mock.onDisconnect.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.getByLabelText('译文正文')).toHaveTextContent(completed.text);
    expect(screen.getByRole('status')).toHaveTextContent('扩展连接已断开');
    expect(screen.getByRole('button', { name: '重新翻译' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '复制译文' })).toBeEnabled();
  });

  it('ignores an already queued tab activation after the port disconnects', async () => {
    const mock = setup();
    await renderPanel();
    const queued = [...mock.onActivated.listeners][0]!;
    act(() => mock.disconnect());
    expect(() => act(() => queued({ tabId: 43, windowId: 7 }))).not.toThrow();
    expect(mock.postMessage).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('扩展连接已断开');
  });

  it.each(['activation', 'heartbeat'] as const)(
    'handles a disconnected port before Chrome delivers onDisconnect during %s',
    async (trigger) => {
      const mock = setup();
      await renderPanel();
      mock.disconnect(false);
      expect(() =>
        act(() => {
          if (trigger === 'activation') mock.onActivated.emit({ tabId: 43, windowId: 7 });
          else vi.advanceTimersByTime(20_000);
        }),
      ).not.toThrow();
      expect(screen.getByRole('status')).toHaveTextContent('扩展连接已断开');
      expect(mock.onActivated.listeners.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([
    ['STOP', 'translating', '停止翻译'],
    ['RETRY', 'completed', '重新翻译'],
  ] as const)('handles a disconnect race when sending %s', async (type, phase, label) => {
    const mock = setup();
    await renderPanel();
    act(() => mock.onMessage.emit({ tabId: 42, state: { ...completed, phase } }));
    mock.disconnect(false);
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(mock.postMessage).toHaveBeenLastCalledWith({ type, selectionId: completed.selectionId });
    expect(screen.getByRole('status')).toHaveTextContent('扩展连接已断开');
    expect(screen.getByRole('button', { name: label })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(mock.postMessage).toHaveBeenCalledTimes(2);
  });

  it.each(['disconnect', 'unmount'] as const)(
    'ignores a delayed initial tab query after %s',
    async (trigger) => {
      const mock = setup();
      let resolve: (tabs: { id: number }[]) => void = () => undefined;
      mock.browser.tabs.query.mockImplementation(
        () =>
          new Promise((receive) => {
            resolve = receive;
          }),
      );
      const view = await renderPanel();
      if (trigger === 'disconnect') act(() => mock.disconnect());
      else view.unmount();
      await act(async () => resolve([{ id: 42 }]));
      expect(mock.postMessage).not.toHaveBeenCalled();
      expect(mock.onActivated.listeners.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('does not let a delayed initial query replace a newer active tab', async () => {
    const mock = setup();
    let resolve: (tabs: { id: number }[]) => void = () => undefined;
    mock.browser.tabs.query.mockImplementation(
      () =>
        new Promise((receive) => {
          resolve = receive;
        }),
    );
    await renderPanel();
    act(() => mock.onActivated.emit({ tabId: 43, windowId: 7 }));
    await act(async () => resolve([{ id: 42 }]));
    expect(mock.postMessage.mock.calls).toEqual([[{ type: 'WATCH', tabId: 43 }]]);
  });

  it.each(['connect', 'getCurrent', 'query'] as const)(
    'handles an unavailable extension context during %s',
    async (operation) => {
      const mock = setup();
      if (operation === 'connect')
        mock.browser.runtime.connect.mockImplementation(() => {
          throw new Error('Extension context invalidated.');
        });
      else if (operation === 'getCurrent')
        mock.browser.windows.getCurrent.mockRejectedValue(
          new Error('Extension context invalidated.'),
        );
      else mock.browser.tabs.query.mockRejectedValue(new Error('Extension context invalidated.'));
      await renderPanel();
      expect(screen.getByRole('status')).toHaveTextContent('扩展连接已断开');
      expect(mock.onActivated.listeners.size).toBe(0);
      expect(mock.postMessage).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('ignores queued messages after disconnection instead of clearing the connection notice', async () => {
    const mock = setup();
    await renderPanel();
    act(() => mock.onMessage.emit({ tabId: 42, state: completed }));
    const queued = [...mock.onMessage.listeners][0]!;
    act(() => mock.disconnect());
    act(() => queued({ tabId: 42, state: { ...completed, text: '过期译文', revision: 2 } }));
    expect(screen.getByLabelText('译文正文')).toHaveTextContent(completed.text);
    expect(screen.getByRole('status')).toHaveTextContent('扩展连接已断开');
  });

  it('handles invalidated Chrome APIs while releasing connection resources', async () => {
    const mock = setup();
    const view = await renderPanel();
    mock.onActivated.removeListener.mockImplementation(() => {
      throw new Error('Extension context invalidated.');
    });
    mock.port.disconnect.mockImplementation(() => {
      throw new Error('Extension context invalidated.');
    });
    expect(() => view.unmount()).not.toThrow();
    expect(mock.onMessage.removeListener).toHaveBeenCalledOnce();
    expect(mock.onDisconnect.removeListener).toHaveBeenCalledOnce();
    expect(mock.port.disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles settings errors without an unhandled rejection', async () => {
    const mock = setup();
    await renderPanel();
    mock.browser.runtime.openOptionsPage.mockRejectedValue(
      new Error('Extension context invalidated.'),
    );
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '模型设置' })));
    expect(screen.getByRole('status')).toHaveTextContent('扩展连接已断开');
  });

  it('watches only this window and keeps healthy heartbeats and commands working', async () => {
    const mock = setup();
    await renderPanel();
    act(() => mock.onActivated.emit({ tabId: 99, windowId: 8 }));
    expect(mock.postMessage).toHaveBeenCalledTimes(1);
    act(() => mock.onActivated.emit({ tabId: 43, windowId: 7 }));
    act(() => mock.onMessage.emit({ tabId: 43, state: completed }));
    fireEvent.click(screen.getByRole('button', { name: '重新翻译' }));
    expect(mock.postMessage).toHaveBeenLastCalledWith({
      type: 'RETRY',
      selectionId: completed.selectionId,
    });
    act(() => vi.advanceTimersByTime(20_000));
    expect(mock.postMessage).toHaveBeenLastCalledWith({ type: 'WATCH', tabId: 43 });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
