<script>
  import { userId } from '../lib/stores.js';
  import MotifSwitcher from '../components/MotifSwitcher.svelte';

  let { ongo } = $props();

  let editingId = $state(false);
  let idDraft = $state('');

  function startEdit() {
    idDraft = $userId;
    editingId = true;
  }

  function saveId() {
    const v = idDraft.trim();
    if (v) $userId = v;
    editingId = false;
  }

  const menu = [
    { label: 'Study',          to: 'study',    opts: {} },
    { label: 'Quiz',           to: 'study',    opts: { questionOnly: true } },
    { label: 'Manage courses', to: 'manage',   opts: {} },
    { label: 'Settings',       to: 'settings', opts: {} },
  ];
</script>

<div class="home">
  <header>
    <h1 class="brand">drip</h1>
    <MotifSwitcher />
  </header>

  <div class="user-row">
    {#if editingId}
      <form onsubmit={e => { e.preventDefault(); saveId(); }} class="id-form">
        <input bind:value={idDraft} class="id-input" spellcheck="false" autocomplete="off" />
        <button type="submit" class="link-btn">save</button>
        <button type="button" class="link-btn muted" onclick={() => editingId = false}>cancel</button>
      </form>
    {:else}
      <button class="user-chip" onclick={startEdit}>
        user: {$userId.slice(0, 8)}…
      </button>
    {/if}
  </div>

  <nav>
    {#each menu as item}
      <button class="menu-item" onclick={() => ongo({ to: item.to, ...item.opts })}>
        <span>{item.label}</span>
        <span class="arrow">›</span>
      </button>
    {/each}
  </nav>
</div>

<style>
  .home {
    max-width: 600px;
    margin: 0 auto;
    padding: 0 1.25rem;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.5rem 0 1.25rem;
    border-bottom: 1px solid var(--border);
  }

  .brand {
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--fg);
  }

  .user-row {
    display: flex;
    align-items: center;
    min-height: 2.75rem;
    border-bottom: 1px solid var(--border);
  }

  .user-chip {
    background: none;
    border: none;
    font: inherit;
    font-size: 0.8rem;
    color: var(--muted);
    cursor: pointer;
    padding: 0;
  }
  .user-chip:hover { color: var(--fg); }

  .id-form {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
  }

  .id-input {
    flex: 1;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.3rem 0.6rem;
    font: inherit;
    font-size: 0.8rem;
    color: var(--fg);
    outline: none;
    min-width: 0;
  }
  .id-input:focus { border-color: var(--accent); }

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

  nav {
    display: flex;
    flex-direction: column;
    margin-top: 0.25rem;
  }

  .menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 0;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border);
    font: inherit;
    font-size: 1.05rem;
    color: var(--fg);
    cursor: pointer;
    text-align: left;
  }
  .menu-item:hover {
    background: var(--item-hover);
    padding-left: 0.5rem;
    padding-right: 0.5rem;
    margin: 0 -0.5rem;
  }

  .arrow {
    color: var(--muted);
    font-size: 1.1rem;
  }
</style>
