import { afterEach, describe, expect, it, vi } from 'vitest';

import { detectMainContent, detectMainContentAsync } from '../../src/content/main-content';

describe('detectMainContent', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('prefers semantic article content over navigation and footer text', () => {
    document.body.innerHTML = `
      <nav>${'<a href="#">Navigation link</a>'.repeat(20)}</nav>
      <main id="story">
        <h1>A practical guide to browser translation</h1>
        <p>This article explains how a browser extension can translate readable webpage content.</p>
        <p>It preserves links, styles, and interactions while replacing only visible text nodes.</p>
      </main>
      <footer>${'Footer information '.repeat(20)}</footer>
    `;

    expect(detectMainContent(document)?.root.id).toBe('story');
  });

  it('finds a paragraph-dense fallback without translating the entire body', () => {
    document.body.innerHTML = `
      <div id="story">
        <p>The first paragraph contains enough English content to describe a useful topic.</p>
        <p>The second paragraph adds supporting details and another complete English sentence.</p>
        <p>The final paragraph gives readers a clear conclusion for the article.</p>
      </div>
    `;

    expect(detectMainContent(document)?.root.id).toBe('story');
    expect(detectMainContent(document)?.root).not.toBe(document.body);
  });

  it('does not fall back to body when no credible main content exists', () => {
    document.body.innerHTML = '<nav><a href="#">Home</a><a href="#">Account</a></nav>';
    expect(detectMainContent(document)).toBeUndefined();
  });

  it('time-slices detection for a large document and returns the same semantic root', async () => {
    document.body.innerHTML = `
      <main id="large-story">
        <h1>A large English documentation page</h1>
        ${Array.from(
          { length: 600 },
          (_value, index) =>
            `<p>Paragraph ${index} contains enough English text to exercise time-sliced content scoring.</p>`,
        ).join('')}
      </main>
    `;
    const timeoutSpy = vi.spyOn(window, 'setTimeout');

    const detection = await detectMainContentAsync(document, { yieldEvery: 50 });

    expect(detection?.root.id).toBe('large-story');
    expect(timeoutSpy.mock.calls.length).toBeGreaterThan(10);
  });

  it('abandons time-sliced detection when the page session generation changes', async () => {
    document.body.innerHTML = `
      <main>
        ${Array.from(
          { length: 20 },
          (_value, index) => `<p>Cancellable paragraph ${index} contains English text.</p>`,
        ).join('')}
      </main>
    `;
    let checks = 0;

    await expect(
      detectMainContentAsync(document, {
        yieldEvery: 1,
        shouldContinue: () => {
          checks += 1;
          return checks < 4;
        },
      }),
    ).resolves.toBeUndefined();
  });
});
