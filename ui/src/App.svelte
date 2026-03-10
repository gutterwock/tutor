<script>
  import { motif } from './lib/stores.js';
  import Home from './views/Home.svelte';
  import Study from './views/Study.svelte';
  import ManageCourses from './views/ManageCourses.svelte';
  import Settings from './views/Settings.svelte';

  let view = $state('home');
  let questionOnly = $state(false);

  function go(detail) {
    questionOnly = detail.questionOnly ?? false;
    view = detail.to;
  }
</script>

<div class="root" data-motif={$motif}>
  {#if view === 'home'}
    <Home ongo={go} />
  {:else if view === 'study'}
    <Study {questionOnly} onback={() => view = 'home'} />
  {:else if view === 'manage'}
    <ManageCourses onback={() => view = 'home'} />
  {:else if view === 'settings'}
    <Settings onback={() => view = 'home'} />
  {/if}
</div>

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) { background: var(--bg); }

  :global([data-motif="feed"]) {
    --bg:         #f9fafb;
    --surface:    #ffffff;
    --fg:         #111827;
    --muted:      #6b7280;
    --border:     #e5e7eb;
    --accent:     #2563eb;
    --accent-fg:  #ffffff;
    --font:       system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --radius:     8px;
    --item-hover: #f3f4f6;
  }

  :global([data-motif="flashcard"]) {
    --bg:         #ffffff;
    --surface:    #ffffff;
    --fg:         #000000;
    --muted:      #555555;
    --border:     #e0e0e0;
    --accent:     #000000;
    --accent-fg:  #ffffff;
    --font:       system-ui, sans-serif;
    --radius:     14px;
    --item-hover: #f5f5f5;
  }

  :global([data-motif="terminal"]) {
    --bg:         #0d1117;
    --surface:    #161b22;
    --fg:         #e6edf3;
    --muted:      #7d8590;
    --border:     #30363d;
    --accent:     #58a6ff;
    --accent-fg:  #0d1117;
    --font:       'Courier New', Courier, monospace;
    --radius:     0px;
    --item-hover: #21262d;
  }

  :global([data-motif="noir"]) {
    --bg:         #000000;
    --surface:    #0a0a0a;
    --fg:         #f0f0f0;
    --muted:      #888888;
    --border:     #2a2a2a;
    --accent:     #f0f0f0;
    --accent-fg:  #000000;
    --font:       'Georgia', Times, serif;
    --radius:     0px;
    --item-hover: #111111;
  }

  :global([data-motif="lovecraft"]) {
    --bg:         #f2ece0;
    --surface:    #ede5d0;
    --fg:         #2c1a0e;
    --muted:      #7a5c40;
    --border:     #c8a87a;
    --accent:     #5c2d0a;
    --accent-fg:  #f2ece0;
    --font:       'Palatino Linotype', Palatino, Georgia, serif;
    --radius:     2px;
    --item-hover: #e8dcc8;
  }

  .root {
    min-height: 100vh;
    background: var(--bg);
    color: var(--fg);
    font-family: var(--font);
  }
</style>
