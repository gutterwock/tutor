<script>
  import { motif } from '../lib/stores.js';

  const motifs = [
    { id: 'feed',      label: 'Feed' },
    { id: 'flashcard', label: 'Flashcard' },
    { id: 'terminal',  label: 'Terminal' },
    { id: 'noir',      label: 'Noir' },
    { id: 'lovecraft', label: 'Lovecraft' },
  ];

  let open = $state(false);

  function select(id) {
    $motif = id;
    open = false;
  }
</script>

<svelte:window onkeydown={e => e.key === 'Escape' && (open = false)} />

<div class="switcher">
  <button class="icon-btn" onclick={() => open = !open} title="Change motif" aria-label="Change motif">◈</button>

  {#if open}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="backdrop" onclick={() => open = false}></div>
    <ul class="dropdown">
      {#each motifs as m}
        <li>
          <button class="option" class:active={$motif === m.id} onclick={() => select(m.id)}>
            {m.label}
            {#if $motif === m.id}<span class="check">✓</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .switcher { position: relative; }

  .icon-btn {
    background: none;
    border: none;
    font-size: 1.1rem;
    color: var(--muted);
    cursor: pointer;
    padding: 0.25rem;
    line-height: 1;
  }
  .icon-btn:hover { color: var(--fg); }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
  }

  .dropdown {
    position: absolute;
    right: 0;
    top: calc(100% + 0.4rem);
    z-index: 20;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    min-width: 120px;
    list-style: none;
    padding: 0.25rem 0;
    box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  }

  .option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0.5rem 0.85rem;
    background: none;
    border: none;
    font: inherit;
    font-size: 0.875rem;
    color: var(--fg);
    cursor: pointer;
    text-align: left;
  }
  .option:hover { background: var(--item-hover); }
  .option.active { color: var(--accent); }

  .check { color: var(--accent); font-size: 0.75rem; }
</style>
