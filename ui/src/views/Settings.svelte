<script>
  import { settings } from '../lib/stores.js';

  let { onback } = $props();

  function toggle(key) {
    settings.update(s => ({ ...s, [key]: !s[key] }));
  }

  let sessionInput = $state('');
  let editingSession = $state(false);

  function startEditSession() {
    sessionInput = $settings.session_length?.toString() ?? '';
    editingSession = true;
  }

  function saveSession() {
    const n = parseInt(sessionInput, 10);
    settings.update(s => ({ ...s, session_length: (!isNaN(n) && n > 0) ? n : null }));
    editingSession = false;
  }
</script>

<div class="page">
  <header>
    <button class="back" onclick={onback}>← Back</button>
    <h2>Settings</h2>
  </header>

  <div class="rows">
    <div class="row">
      <div class="row-label">
        <span class="row-name">Interleave courses</span>
        <span class="row-desc">Mix subtopics from all enrolled courses in one session</span>
      </div>
      <button class="toggle" class:on={$settings.interleave_courses} onclick={() => toggle('interleave_courses')}>
        {$settings.interleave_courses ? 'ON' : 'OFF'}
      </button>
    </div>

    <div class="row">
      <div class="row-label">
        <span class="row-name">Interleave subtopics</span>
        <span class="row-desc">Study all active subtopics per session vs. one at a time</span>
      </div>
      <button class="toggle" class:on={$settings.interleave_subtopics} onclick={() => toggle('interleave_subtopics')}>
        {$settings.interleave_subtopics ? 'ON' : 'OFF'}
      </button>
    </div>

    <div class="row">
      <div class="row-label">
        <span class="row-name">Session length</span>
        <span class="row-desc">Max items shown per session</span>
      </div>
      {#if editingSession}
        <form onsubmit={e => { e.preventDefault(); saveSession(); }} class="inline-form">
          <input
            bind:value={sessionInput}
            class="num-input"
            type="number"
            min="1"
            placeholder="0 = unlimited"
          />
          <button type="submit" class="link-btn">save</button>
          <button type="button" class="link-btn muted" onclick={() => editingSession = false}>cancel</button>
        </form>
      {:else}
        <button class="value-btn" onclick={startEditSession}>
          {$settings.session_length ? $settings.session_length + ' items' : 'unlimited'}
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .page {
    max-width: 600px;
    margin: 0 auto;
    padding: 0 1.25rem;
  }

  header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.5rem 0 1.25rem;
    border-bottom: 1px solid var(--border);
  }

  .back {
    background: none;
    border: none;
    font: inherit;
    font-size: 0.9rem;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    white-space: nowrap;
  }
  .back:hover { opacity: 0.75; }

  h2 {
    font-size: 1.1rem;
    font-weight: 600;
  }

  .rows { display: flex; flex-direction: column; }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 0;
    border-bottom: 1px solid var(--border);
  }

  .row-label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }

  .row-name { font-size: 0.95rem; }

  .row-desc {
    font-size: 0.78rem;
    color: var(--muted);
    line-height: 1.3;
  }

  .toggle {
    flex-shrink: 0;
    background: var(--border);
    border: none;
    font: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--muted);
    cursor: pointer;
    padding: 0.3rem 0.7rem;
    border-radius: var(--radius);
    min-width: 3.5rem;
    text-align: center;
  }
  .toggle.on {
    background: var(--accent);
    color: var(--accent-fg);
  }

  .value-btn {
    flex-shrink: 0;
    background: none;
    border: 1px solid var(--border);
    font: inherit;
    font-size: 0.85rem;
    color: var(--fg);
    cursor: pointer;
    padding: 0.3rem 0.7rem;
    border-radius: var(--radius);
    white-space: nowrap;
  }
  .value-btn:hover { border-color: var(--accent); }

  .inline-form {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .num-input {
    width: 5rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.3rem 0.5rem;
    font: inherit;
    font-size: 0.85rem;
    color: var(--fg);
    outline: none;
  }
  .num-input:focus { border-color: var(--accent); }

  .link-btn {
    background: none;
    border: none;
    font: inherit;
    font-size: 0.8rem;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    white-space: nowrap;
  }
  .link-btn.muted { color: var(--muted); }
  .link-btn:hover { opacity: 0.75; }
</style>
