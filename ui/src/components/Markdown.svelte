<script>
  import { marked } from 'marked';
  import mermaid from 'mermaid';
  import { motif } from '../lib/stores.js';

  let { content = '' } = $props();

  let container = $state(null);

  const MERMAID_THEMES = {
    feed:      'neutral',
    flashcard: 'default',
    terminal:  'dark',
    noir:      'dark',
    lovecraft: 'neutral',
  };

  let html = $derived((() => {
    try { return marked.parse(content ?? ''); }
    catch { return `<pre>${content}</pre>`; }
  })());

  let renderCount = $state(0);

  $effect(() => {
    // track html changes to re-trigger mermaid
    void html;
    renderCount++;
  });

  $effect(() => {
    void renderCount;
    if (!container) return;

    const theme = MERMAID_THEMES[$motif] ?? 'neutral';
    mermaid.initialize({ startOnLoad: false, theme });

    const blocks = container.querySelectorAll('pre code.language-mermaid');
    let idx = 0;
    for (const block of blocks) {
      const pre = block.parentElement;
      const code = block.textContent ?? '';
      const id = `mermaid-${Date.now()}-${idx++}`;
      mermaid.render(id, code)
        .then(({ svg }) => {
          const div = document.createElement('div');
          div.className = 'mermaid-wrap';
          div.innerHTML = svg;
          pre.replaceWith(div);
        })
        .catch(err => {
          console.warn('mermaid render failed:', err);
        });
    }
  });
</script>

<div bind:this={container} class="markdown">
  {@html html}
</div>

<style>
  .markdown { line-height: 1.75; font-size: 0.95rem; }

  /* headings */
  .markdown :global(h1),
  .markdown :global(h2),
  .markdown :global(h3),
  .markdown :global(h4) {
    font-weight: 600;
    line-height: 1.3;
    margin: 1.25em 0 0.5em;
  }
  .markdown :global(h1) { font-size: 1.35rem; }
  .markdown :global(h2) { font-size: 1.15rem; }
  .markdown :global(h3) { font-size: 1rem; }
  .markdown :global(h4) { font-size: 0.95rem; }

  /* paragraph */
  .markdown :global(p) { margin: 0.75em 0; }
  .markdown :global(p:first-child) { margin-top: 0; }

  /* lists */
  .markdown :global(ul),
  .markdown :global(ol) {
    padding-left: 1.5rem;
    margin: 0.6em 0;
  }
  .markdown :global(li) { margin: 0.25em 0; }
  .markdown :global(li > ul),
  .markdown :global(li > ol) { margin: 0.15em 0; }

  /* inline code */
  .markdown :global(code) {
    font-family: 'Courier New', Courier, monospace;
    font-size: 0.87em;
    background: color-mix(in srgb, var(--border) 60%, transparent);
    padding: 0.1em 0.35em;
    border-radius: 3px;
  }

  /* code block */
  .markdown :global(pre) {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.9rem 1rem;
    overflow-x: auto;
    margin: 0.75em 0;
  }
  .markdown :global(pre code) {
    background: none;
    padding: 0;
    font-size: 0.85rem;
  }

  /* blockquote */
  .markdown :global(blockquote) {
    border-left: 3px solid var(--accent);
    padding: 0.1em 0 0.1em 1rem;
    color: var(--muted);
    margin: 0.75em 0;
  }

  /* table */
  .markdown :global(table) {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.88rem;
    margin: 0.75em 0;
  }
  .markdown :global(th),
  .markdown :global(td) {
    border: 1px solid var(--border);
    padding: 0.4rem 0.7rem;
    text-align: left;
  }
  .markdown :global(th) {
    background: var(--surface);
    font-weight: 600;
  }

  /* horizontal rule */
  .markdown :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 1.25em 0;
  }

  /* links */
  .markdown :global(a) { color: var(--accent); }
  .markdown :global(a:hover) { opacity: 0.8; }

  /* strong / em */
  .markdown :global(strong) { font-weight: 600; }
  .markdown :global(em) { font-style: italic; }

  /* mermaid diagram wrapper */
  .markdown :global(.mermaid-wrap) {
    margin: 0.75em 0;
    overflow-x: auto;
    text-align: center;
  }
  .markdown :global(.mermaid-wrap svg) {
    max-width: 100%;
    height: auto;
  }
</style>
