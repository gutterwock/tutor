<script>
  import { userId, settings } from '../lib/stores.js';
  import { api } from '../lib/api.js';
  import Markdown from '../components/Markdown.svelte';

  let { questionOnly = false, onback } = $props();

  // ── queue items ───────────────────────────────────────────────────────────
  let items = $state([]);
  // Per-item state: id → { answered, userAnswer, correctness, grading, explanation, consumed }
  let states = $state({});
  let cursor = $state(0);
  let loading = $state(false);
  let queueEmpty = $state(false);
  let sessionDone = $state(false);

  // ── question input controls ───────────────────────────────────────────────
  let singleSel = $state(null);
  let multiSel = $state(new Set());
  let freeText = $state('');
  let exactText = $state('');
  let orderItems = $state([]);

  // ── scroll navigation ─────────────────────────────────────────────────────
  let pageEl = $state(null);
  let navCooldown = false;
  let shakeCard = $state(false);
  let touchStartY = null;

  function getCardEl() { return pageEl?.querySelector('.card') ?? null; }

  // ── session tracking (non-reactive set avoids render loops) ──────────────
  const seen = new Set();
  let shownCount = $state(0);

  const FETCH_BATCH = 10;
  const PREFETCH_AT = 3;

  // ─────────────────────────────────────────────────────────────────────────
  // Derived
  // ─────────────────────────────────────────────────────────────────────────
  let current = $derived(items[cursor] ?? null);
  let currentState = $derived(current ? (states[current.id] ?? mkState()) : null);

  function mkState() {
    return { answered: false, userAnswer: null, correctness: null, grading: false, explanation: null, consumed: false };
  }

  function ensureState(id) {
    if (!states[id]) states[id] = mkState();
    return states[id];
  }

  let breadcrumb = $derived((() => {
    const sid = current?.item_data?.syllabus_id ?? '';
    const parts = sid.split('.');
    if (parts.length >= 3) return [parts[0], parts.slice(0, 2).join('.'), sid].join(' › ');
    return sid;
  })());

  // ── fetch ─────────────────────────────────────────────────────────────────
  async function fetchMore() {
    if (loading || queueEmpty) return;
    const sessionLimit = $settings.session_length;
    if (sessionLimit && shownCount >= sessionLimit) { queueEmpty = true; return; }
    loading = true;
    try {
      const weights = Object.entries($settings.course_weights ?? {})
        .map(([id, w]) => `${id}:${w}`).join(',');
      const params = new URLSearchParams({ user_id: $userId, limit: FETCH_BATCH });
      if (weights) params.set('weights', weights);
      if (questionOnly) params.set('question_only', 'true');
      if (sessionLimit) params.set('session_length', sessionLimit);
      const batch = await api('GET', `/queue?${params}`);
      const disabled = new Set($settings.disabled_courses ?? []);
      const filtered = batch.filter(i => !disabled.has(i.course_id));
      if (filtered.length === 0) queueEmpty = true;
      else items = [...items, ...filtered];
    } catch (e) {
      console.error('fetchMore error', e);
    } finally {
      loading = false;
    }
  }

  // ── init + prefetch ───────────────────────────────────────────────────────
  $effect(() => { fetchMore(); });

  $effect(() => {
    const remaining = items.length - cursor;
    if (!loading && !queueEmpty && remaining <= PREFETCH_AT) fetchMore();
  });

  // ── cursor change: track shown count, reset inputs ────────────────────────
  $effect(() => {
    const item = items[cursor];
    if (!item) return;

    // Count each item once toward session limit
    if (!seen.has(item.id)) {
      seen.add(item.id);
      shownCount++;
    }

    // Reset input controls for unanswered questions
    if (item.item_type === 'question') {
      const s = states[item.id];
      if (!s?.answered) {
        singleSel = null;
        multiSel = new Set();
        freeText = '';
        exactText = '';
        const qt = item.item_data?.question_type;
        if (qt === 'ordering') {
          const opts = item.item_data?.options ?? {};
          orderItems = typeof opts === 'object' && !Array.isArray(opts)
            ? Object.keys(opts)
            : (Array.isArray(opts) ? opts.map((_, i) => String.fromCharCode(97 + i)) : []);
        } else {
          orderItems = [];
        }
      }
    }
  });

  // ── auto-advance gate content ─────────────────────────────────────────────
  $effect(() => {
    const item = items[cursor];
    if (!item || item.item_type !== 'content') return;
    if (item.item_data?.content_type !== 'gate') return;
    const s = states[item.id];
    if (!s?.consumed) advance();
  });

  // ── scroll + touch navigation ─────────────────────────────────────────────
  $effect(() => {
    if (!pageEl) return;

    function onWheel(e) {
      if (!current) return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'textarea' || tag === 'input') return;

      const cardEl = getCardEl();

      if (e.deltaY > 0) {
        if (cardEl) {
          const { scrollTop, scrollHeight, clientHeight } = cardEl;
          if (scrollHeight - scrollTop - clientHeight > 10) return; // card scrolls natively
        }
        e.preventDefault();
        if (navCooldown) return;
        const s = states[current.id];
        if (current.item_type === 'content' || s?.answered) {
          navCooldown = true;
          setTimeout(() => { navCooldown = false; }, 500);
          advance();
        } else {
          if (!shakeCard) { shakeCard = true; setTimeout(() => { shakeCard = false; }, 400); }
        }
      } else if (e.deltaY < 0) {
        if (cardEl && cardEl.scrollTop > 10) return; // card scrolls natively
        if (cursor === 0) return;
        e.preventDefault();
        if (navCooldown) return;
        navCooldown = true;
        setTimeout(() => { navCooldown = false; }, 500);
        retreat();
      }
    }

    function onTouchStart(e) { touchStartY = e.touches[0].clientY; }

    function onTouchEnd(e) {
      if (touchStartY === null || !current) return;
      const dy = touchStartY - e.changedTouches[0].clientY;
      touchStartY = null;
      if (Math.abs(dy) < 60 || navCooldown) return;
      if (dy > 0) {
        const s = states[current.id];
        if (current.item_type === 'content' || s?.answered) {
          navCooldown = true;
          setTimeout(() => { navCooldown = false; }, 500);
          advance();
        } else {
          if (!shakeCard) { shakeCard = true; setTimeout(() => { shakeCard = false; }, 400); }
        }
      } else if (cursor > 0) {
        navCooldown = true;
        setTimeout(() => { navCooldown = false; }, 500);
        retreat();
      }
    }

    pageEl.addEventListener('wheel', onWheel, { passive: false });
    pageEl.addEventListener('touchstart', onTouchStart, { passive: true });
    pageEl.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      pageEl.removeEventListener('wheel', onWheel);
      pageEl.removeEventListener('touchstart', onTouchStart);
      pageEl.removeEventListener('touchend', onTouchEnd);
    };
  });

  function resetCardScroll() { setTimeout(() => { const c = getCardEl(); if (c) c.scrollTop = 0; }, 0); }

  // ── navigation ────────────────────────────────────────────────────────────
  async function advance() {
    const item = current;
    if (!item) return;
    const s = ensureState(item.id);

    if (!s.consumed) {
      states[item.id] = { ...s, consumed: true };
      api('DELETE', `/queue/${item.id}`).catch(e => console.warn('DELETE queue failed', e));
    }

    if (cursor < items.length - 1) {
      cursor++;
      resetCardScroll();
    } else if (queueEmpty) {
      sessionDone = true;
    } else {
      await fetchMore();
      if (cursor < items.length - 1) { cursor++; resetCardScroll(); }
      else sessionDone = true;
    }
  }

  function retreat() { if (cursor > 0) { cursor--; resetCardScroll(); } }

  // ── submit ────────────────────────────────────────────────────────────────
  function canSubmit() {
    if (!current || current.item_type !== 'question') return false;
    const s = states[current.id];
    if (s?.answered || s?.grading) return false;
    const qt = current.item_data?.question_type;
    if (qt === 'singleChoice') return singleSel !== null;
    if (qt === 'multiChoice') return multiSel.size > 0;
    if (qt === 'freeText') return freeText.trim().length > 0;
    if (qt === 'exactMatch') return exactText.trim().length > 0;
    if (qt === 'ordering') return orderItems.length > 0;
    return false;
  }

  async function submitAnswer() {
    if (!canSubmit()) return;
    const item = current;
    const qt = item.item_data?.question_type;

    let userAnswer;
    if (qt === 'singleChoice') userAnswer = singleSel;
    else if (qt === 'multiChoice') userAnswer = [...multiSel];
    else if (qt === 'freeText') userAnswer = freeText.trim();
    else if (qt === 'exactMatch') userAnswer = exactText.trim();
    else if (qt === 'ordering') userAnswer = [...orderItems];

    states[item.id] = { ...ensureState(item.id), grading: true };

    try {
      const submitted = await api('POST', '/responses', {
        question_id: item.item_id,
        user_id: $userId,
        user_answer: userAnswer,
        responded_at: Date.now(),
      });

      let correctness = submitted.correctness ?? null;

      if (qt === 'freeText') {
        try {
          const graded = await api('POST', `/responses/${submitted.id}/grade-ai`, { user_id: $userId });
          correctness = graded.correctness ?? 0;
        } catch (e) {
          console.warn('grade-ai failed', e);
          correctness = 0;
        }
      }

      states[item.id] = {
        ...states[item.id],
        answered: true,
        userAnswer,
        correctness,
        grading: false,
        explanation: item.item_data?.explanation ?? null,
      };
    } catch (e) {
      console.error('submit failed', e);
      states[item.id] = { ...states[item.id], grading: false };
    }
  }

  // ── ordering ──────────────────────────────────────────────────────────────
  let dragIdx = $state(null);

  function dragStart(i) { dragIdx = i; }
  function dragOver(e) { e.preventDefault(); }
  function drop(e, i) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === i) return;
    const arr = [...orderItems];
    const [moved] = arr.splice(dragIdx, 1);
    arr.splice(i, 0, moved);
    orderItems = arr;
    dragIdx = null;
  }

  function moveOrder(from, to) {
    const arr = [...orderItems];
    const [item] = arr.splice(from, 1);
    arr.splice(to, 0, item);
    orderItems = arr;
  }

  // ── keyboard shortcuts ────────────────────────────────────────────────────
  function handleKey(e) {
    if (e.altKey || e.metaKey) return;

    // Session done screen
    if (sessionDone) {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onback(); }
      return;
    }

    if (!current) return;

    const tag = document.activeElement?.tagName?.toLowerCase();
    const inInput    = tag === 'input';
    const inTextarea = tag === 'textarea';

    if (current.item_type === 'content') {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); advance(); }
      else if (e.key === 'ArrowLeft' && cursor > 0) { e.preventDefault(); retreat(); }
      return;
    }

    if (current.item_type === 'question') {
      const s = states[current.id];
      const qt = current.item_data?.question_type;

      if (s?.answered) {
        if ((e.key === ' ' || e.key === 'Enter') && !inTextarea && !inInput) {
          e.preventDefault(); advance();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault(); retreat();
        }
        return;
      }

      if (s?.grading) return;

      if (qt === 'freeText') {
        // Ctrl+Enter submits; plain Enter adds newlines normally
        if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); if (canSubmit()) submitAnswer(); }
        return;
      }

      if (inInput || inTextarea) return;

      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (canSubmit()) submitAnswer(); }
      else if (e.key === 'ArrowLeft' && cursor > 0) { e.preventDefault(); retreat(); }
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  const GRADES = ['Incorrect', 'Mostly wrong', 'Partial', 'Mostly correct', 'Correct'];
  const GRADE_CLASS = ['wrong', 'mostly-wrong', 'partial', 'mostly-right', 'correct'];
  function gradeLabel(c) { return GRADES[c] ?? '—'; }
  function gradeClass(c) { return GRADE_CLASS[c] ?? ''; }
  function dots(c) {
    if (c === null || c === undefined) return '';
    return '●'.repeat(c) + '○'.repeat(4 - c);
  }

  function optionEntries(opts) {
    if (!opts) return [];
    if (Array.isArray(opts)) return opts.map((v, i) => [String.fromCharCode(97 + i), v]);
    return Object.entries(opts);
  }

  function toggleMulti(key) {
    const s = new Set(multiSel);
    s.has(key) ? s.delete(key) : s.add(key);
    multiSel = s;
  }

  // ── summary stats ─────────────────────────────────────────────────────────
  let summaryStats = $derived((() => {
    const questions = items.filter(i => i.item_type === 'question');
    const answered = questions.filter(i => states[i.id]?.answered);
    const scored = answered.filter(i => states[i.id]?.correctness !== null);
    const total = scored.reduce((a, i) => a + (states[i.id]?.correctness ?? 0), 0);
    return { total, max: scored.length * 4, count: answered.length };
  })());

  function correctAnswerText(item) {
    const d = item.item_data;
    const answer = d?.answer;
    if (answer === null || answer === undefined) return null;
    const qt = d?.question_type;
    const entries = optionEntries(d?.options);
    if (qt === 'singleChoice') {
      const found = entries.find(([k]) => String(k) === String(answer));
      return found ? `${found[0]}) ${found[1]}` : String(answer);
    }
    if (qt === 'multiChoice') {
      const answers = Array.isArray(answer) ? answer : [answer];
      return answers.map(a => {
        const f = entries.find(([k]) => String(k) === String(a));
        return f ? `${f[0]}) ${f[1]}` : String(a);
      }).join(', ');
    }
    if (qt === 'ordering') {
      const order = Array.isArray(answer) ? answer : [answer];
      return order.map(a => {
        const f = entries.find(([k]) => String(k) === String(a));
        return f ? f[1] : String(a);
      }).join(' → ');
    }
    if (Array.isArray(answer)) return answer.join(' / ');
    return String(answer);
  }
</script>

<svelte:window onkeydown={handleKey} />

<!-- ── SESSION DONE ────────────────────────────────────────────────────────── -->
{#if sessionDone}
  <div class="page summary-page">
    <header>
      <button class="back" onclick={onback}>← Back</button>
      <h2>{questionOnly ? 'Quiz' : 'Study'} complete</h2>
    </header>

    <div class="summary-score">
      {#if summaryStats.max > 0}
        <div class="score-big">{summaryStats.total}/{summaryStats.max}</div>
        <div class="score-sub">{summaryStats.count} question{summaryStats.count !== 1 ? 's' : ''} answered</div>
      {:else}
        <div class="score-big">Done</div>
        <div class="score-sub">No questions this session</div>
      {/if}
    </div>

    <div class="summary-items">
      {#each items.filter(i => i.item_type === 'question' && states[i.id]?.answered) as item}
        {@const s = states[item.id]}
        {@const c = s.correctness}
        <div class="summary-item">
          <div class="summary-item-header">
            <span class="dots {gradeClass(c)}">{dots(c)}</span>
            <span class="grade-label {gradeClass(c)}">{gradeLabel(c)}</span>
            <span class="qtype">{item.item_data?.question_type}</span>
          </div>
          <div class="summary-q">{item.item_data?.question_text}</div>
          {#if item.item_data?.question_type !== 'freeText'}
            {@const ans = correctAnswerText(item)}
            {#if ans}
              <div class="summary-answer"><span class="answer-label">Answer:</span>{ans}</div>
            {/if}
          {:else if item.item_data?.answer}
            <div class="summary-answer"><span class="answer-label">Example:</span>{item.item_data.answer}</div>
          {/if}
          {#if s.explanation}
            <div class="summary-expl">{s.explanation}</div>
          {/if}
        </div>
      {/each}
    </div>

    <div class="summary-actions">
      <button class="btn-primary" onclick={onback}>Back to home</button>
    </div>
  </div>

<!-- ── LOADING ─────────────────────────────────────────────────────────────── -->
{:else if items.length === 0 && loading}
  <div class="page status-page">
    <button class="back" onclick={onback}>← Back</button>
    <p class="status-msg">Loading…</p>
  </div>

<!-- ── EMPTY ───────────────────────────────────────────────────────────────── -->
{:else if items.length === 0 && queueEmpty}
  <div class="page status-page">
    <button class="back" onclick={onback}>← Back</button>
    <p class="status-msg">Nothing in queue — enroll in a course to get started.</p>
  </div>

<!-- ── STUDY CARD ─────────────────────────────────────────────────────────── -->
{:else if current}
  {@const idata = current.item_data}
  {@const s = currentState ?? mkState()}

  <div class="page study-page" bind:this={pageEl}>
    <div class="topbar">
      <button class="back" onclick={onback}>← Back</button>
      <span class="mode-label">{questionOnly ? 'Quiz' : 'Study'}</span>
      <span class="breadcrumb">{breadcrumb}</span>
      <span class="counter">{cursor + 1}/{items.length}{queueEmpty ? '' : '+'}</span>
    </div>

    <!-- content card -->
    {#if current.item_type === 'content'}
      <div class="card content-card" class:shake={shakeCard}>
        {#if idata?.title}
          <h3 class="card-title">{idata.title}</h3>
        {/if}
        {#if current.is_review}
          <div class="review-badge">Review</div>
        {/if}
        <Markdown content={idata?.body ?? ''} />
        {#if idata?.links?.length}
          <div class="links">
            {#each idata.links as link}
              <a href={link.url} target="_blank" rel="noopener">{link.label ?? link.url}</a>
            {/each}
          </div>
        {/if}
        <div class="card-actions">
          {#if cursor > 0}
            <button class="btn-ghost" onclick={retreat}>← Previous</button>
          {/if}
          <button class="btn-primary" onclick={advance}>Continue →</button>
        </div>
      </div>

    <!-- question card -->
    {:else if current.item_type === 'question'}
      <div class="card question-card" class:shake={shakeCard}>
        {#if current.is_review}
          <div class="review-badge">Review</div>
        {/if}
        <div class="question-text"><Markdown content={idata?.question_text ?? ''} /></div>

        {#if idata?.question_type === 'singleChoice'}
          <div class="options">
            {#each optionEntries(idata.options) as [key, label]}
              <button
                class="option"
                class:selected={singleSel === key}
                class:correct-opt={s.answered && String(idata.answer) === key}
                class:wrong-opt={s.answered && singleSel === key && String(idata.answer) !== key}
                disabled={s.answered}
                onclick={() => { if (!s.answered) singleSel = key; }}
              >
                <span class="opt-key">{key}</span>
                <span class="opt-label">{label}</span>
              </button>
            {/each}
          </div>

        {:else if idata?.question_type === 'multiChoice'}
          <div class="options">
            {#each optionEntries(idata.options) as [key, label]}
              {@const correct = (idata.answer ?? []).map(String).includes(key)}
              <button
                class="option"
                class:selected={multiSel.has(key)}
                class:correct-opt={s.answered && correct}
                class:wrong-opt={s.answered && multiSel.has(key) && !correct}
                disabled={s.answered}
                onclick={() => { if (!s.answered) toggleMulti(key); }}
              >
                <span class="opt-key">{multiSel.has(key) ? '☑' : '☐'}</span>
                <span class="opt-label">{label}</span>
              </button>
            {/each}
          </div>

        {:else if idata?.question_type === 'freeText'}
          <textarea
            class="free-input"
            placeholder="Type your answer…"
            disabled={s.answered || s.grading}
            bind:value={freeText}
          ></textarea>
          {#if !s.answered && !s.grading}
            <span class="kbd-hint">Ctrl+Enter to submit</span>
          {/if}

        {:else if idata?.question_type === 'exactMatch'}
          <input
            class="exact-input"
            type="text"
            placeholder="Type exact answer…"
            disabled={s.answered}
            bind:value={exactText}
            onkeydown={e => { if (e.key === 'Enter' && canSubmit()) { e.preventDefault(); submitAnswer(); } }}
          />

        {:else if idata?.question_type === 'ordering'}
          <div class="order-hint">Drag or use arrows to arrange in correct order</div>
          <div class="order-list">
            {#each orderItems as key, i}
              {@const opts = idata.options}
              {@const label = (typeof opts === 'object' && !Array.isArray(opts)) ? opts[key] : key}
              <div
                class="order-item"
                class:order-disabled={s.answered}
                draggable={!s.answered}
                ondragstart={() => dragStart(i)}
                ondragover={dragOver}
                ondrop={e => drop(e, i)}
              >
                <span class="order-grip">⠿</span>
                <span class="order-num">{i + 1}.</span>
                <span class="order-label">{label}</span>
                {#if !s.answered}
                  <div class="order-arrows">
                    {#if i > 0}
                      <button class="arrow-btn" onclick={() => moveOrder(i, i-1)}>↑</button>
                    {/if}
                    {#if i < orderItems.length - 1}
                      <button class="arrow-btn" onclick={() => moveOrder(i, i+1)}>↓</button>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        <!-- result -->
        {#if s.grading}
          <div class="grading-msg">Grading…</div>
        {:else if s.answered}
          <div class="result result--{gradeClass(s.correctness)}">
            <span class="result-dots">{dots(s.correctness)}</span>
            <span class="result-label">{gradeLabel(s.correctness)}</span>
          </div>
          {#if idata?.question_type === 'freeText' && idata?.answer}
            <div class="expected"><span class="expected-label">Example answer:</span> {idata.answer}</div>
          {/if}
          {#if s.explanation}
            <div class="explanation">{s.explanation}</div>
          {/if}
        {/if}

        <div class="card-actions">
          {#if cursor > 0}
            <button class="btn-ghost" onclick={retreat}>← Previous</button>
          {/if}
          {#if !s.answered && !s.grading}
            <button class="btn-primary" disabled={!canSubmit()} onclick={submitAnswer}>Submit</button>
          {:else if s.answered}
            <button class="btn-primary" onclick={advance} disabled={s.grading}>
              {cursor === items.length - 1 && queueEmpty ? 'Finish' : 'Next →'}
            </button>
          {/if}
        </div>
      </div>
    {/if}

    <div class="progress-bar">
      <div class="progress-fill" style="width: {items.length > 1 ? Math.round((cursor / (items.length - 1)) * 100) : 0}%"></div>
    </div>
  </div>
{/if}

<style>
  .page {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    max-width: 680px;
    margin: 0 auto;
    padding: 0 1.25rem;
  }

  /* topbar */
  .topbar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 0 0.75rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .back {
    background: none; border: none; font: inherit;
    font-size: 0.85rem; color: var(--accent); cursor: pointer;
    padding: 0; white-space: nowrap;
  }
  .back:hover { opacity: 0.75; }

  .breadcrumb {
    flex: 1; font-size: 0.72rem; color: var(--muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  .mode-label {
    font-size: 0.72rem; font-weight: 600; letter-spacing: 0.06em;
    text-transform: uppercase; color: var(--accent); flex-shrink: 0;
  }

  .counter { font-size: 0.72rem; color: var(--muted); white-space: nowrap; flex-shrink: 0; }

  /* progress bar */
  .progress-bar { height: 2px; background: var(--border); margin-top: auto; }
  .progress-fill { height: 100%; background: var(--accent); transition: width 0.3s; }

  /* shake: blocked scroll-forward on unanswered question */
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    20%       { transform: translateX(-6px); }
    40%       { transform: translateX(6px); }
    60%       { transform: translateX(-4px); }
    80%       { transform: translateX(4px); }
  }
  .card.shake { animation: shake 0.35s ease; }

  .study-page { height: 100vh; }

  /* card */
  .card {
    flex: 1; min-height: 0; padding: 1.5rem 0;
    display: flex; flex-direction: column; gap: 1.25rem;
    overflow-y: auto;
  }

  .card-title { font-size: 1.1rem; font-weight: 600; line-height: 1.4; }

  .review-badge {
    display: inline-block; font-size: 0.68rem; font-weight: 600;
    letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--accent); border: 1px solid var(--accent);
    border-radius: var(--radius); padding: 0.12rem 0.45rem; width: fit-content;
  }


  .links { display: flex; flex-direction: column; gap: 0.3rem; }
  .links a { font-size: 0.85rem; color: var(--accent); }

  /* question */
  .question-text { font-size: 1rem; line-height: 1.65; font-weight: 500; }

  /* options */
  .options { display: flex; flex-direction: column; gap: 0.5rem; }

  .option {
    display: flex; align-items: flex-start; gap: 0.75rem;
    width: 100%; text-align: left;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 0.6rem 0.85rem;
    font: inherit; font-size: 0.9rem; color: var(--fg);
    cursor: pointer; transition: border-color 0.12s;
  }
  .option:hover:not(:disabled) { border-color: var(--accent); }
  .option.selected { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--surface)); }
  .option.correct-opt { border-color: #16a34a; background: color-mix(in srgb, #16a34a 10%, var(--surface)); }
  .option.wrong-opt   { border-color: #dc2626; background: color-mix(in srgb, #dc2626 8%, var(--surface)); }
  .option:disabled { cursor: default; }

  .opt-key { font-weight: 600; color: var(--muted); flex-shrink: 0; min-width: 1.1rem; }
  .opt-label { flex: 1; }

  /* inputs */
  .free-input {
    width: 100%; min-height: 6rem;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 0.6rem 0.75rem;
    font: inherit; font-size: 0.9rem; color: var(--fg);
    resize: vertical; outline: none;
  }
  .free-input:focus { border-color: var(--accent); }

  .kbd-hint { font-size: 0.72rem; color: var(--muted); }

  .exact-input {
    width: 100%; background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 0.6rem 0.75rem;
    font: inherit; font-size: 0.9rem; color: var(--fg); outline: none;
  }
  .exact-input:focus { border-color: var(--accent); }

  /* ordering */
  .order-hint { font-size: 0.8rem; color: var(--muted); }

  .order-list { display: flex; flex-direction: column; gap: 0.4rem; }

  .order-item {
    display: flex; align-items: center; gap: 0.5rem;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 0.5rem 0.75rem;
    font-size: 0.9rem; cursor: grab; user-select: none;
  }
  .order-item.order-disabled { cursor: default; }
  .order-grip { color: var(--muted); }
  .order-num { color: var(--muted); font-size: 0.8rem; min-width: 1.4rem; }
  .order-label { flex: 1; }
  .order-arrows { display: flex; flex-direction: column; gap: 1px; }
  .arrow-btn {
    background: none; border: none; font: inherit;
    font-size: 0.75rem; color: var(--muted); cursor: pointer; padding: 0 0.2rem;
  }
  .arrow-btn:hover { color: var(--accent); }

  /* result */
  .result {
    display: flex; align-items: center; gap: 0.6rem;
    padding: 0.6rem 0.85rem; border-radius: var(--radius);
    background: var(--surface); border: 1px solid var(--border);
  }
  .result-dots { letter-spacing: 0.05em; font-size: 0.9rem; }
  .result-label { font-size: 0.9rem; font-weight: 500; }

  .result--correct      { border-color: #16a34a; }
  .result--mostly-right { border-color: #65a30d; }
  .result--partial      { border-color: #d97706; }
  .result--mostly-wrong { border-color: #ea580c; }
  .result--wrong        { border-color: #dc2626; }

  .grading-msg { font-size: 0.9rem; color: var(--muted); }

  .expected {
    font-size: 0.85rem; color: var(--muted); line-height: 1.5;
    padding: 0.5rem 0.85rem; border-left: 2px solid var(--border);
  }
  .expected-label { font-weight: 600; color: var(--fg); }

  .explanation {
    font-size: 0.85rem; color: var(--muted); line-height: 1.5;
    padding: 0.5rem 0.85rem; border-left: 2px solid var(--accent);
  }

  /* actions */
  .card-actions {
    display: flex; gap: 0.75rem; align-items: center;
    margin-top: auto; padding-bottom: 1.5rem;
  }

  .btn-primary {
    background: var(--accent); color: var(--accent-fg); border: none;
    font: inherit; font-size: 0.9rem; font-weight: 600;
    padding: 0.55rem 1.25rem; border-radius: var(--radius); cursor: pointer;
  }
  .btn-primary:hover:not(:disabled) { opacity: 0.85; }
  .btn-primary:disabled { opacity: 0.4; cursor: default; }

  .btn-ghost {
    background: none; border: 1px solid var(--border); font: inherit;
    font-size: 0.9rem; color: var(--fg); padding: 0.55rem 1rem;
    border-radius: var(--radius); cursor: pointer;
  }
  .btn-ghost:hover { border-color: var(--accent); color: var(--accent); }

  /* status */
  .status-page { padding: 2rem 1.25rem; }
  .status-page .back { display: block; margin-bottom: 2rem; }
  .status-msg { color: var(--muted); font-size: 0.95rem; }

  /* summary */
  .summary-page { padding-bottom: 3rem; }

  .summary-page header {
    display: flex; align-items: center; gap: 1rem;
    padding: 1.5rem 0 1.25rem; border-bottom: 1px solid var(--border);
  }
  h2 { font-size: 1.1rem; font-weight: 600; }

  .summary-score { text-align: center; padding: 2rem 0 1.5rem; }
  .score-big { font-size: 2.5rem; font-weight: 700; }
  .score-sub { font-size: 0.9rem; color: var(--muted); margin-top: 0.3rem; }

  .summary-items { display: flex; flex-direction: column; border-top: 1px solid var(--border); }

  .summary-item {
    padding: 1rem 0; border-bottom: 1px solid var(--border);
    display: flex; flex-direction: column; gap: 0.4rem;
  }

  .summary-item-header { display: flex; align-items: center; gap: 0.6rem; }

  .dots        { font-size: 0.85rem; letter-spacing: 0.05em; }
  .grade-label { font-size: 0.85rem; font-weight: 500; }
  .qtype       { font-size: 0.72rem; color: var(--muted); margin-left: auto; }

  .dots.correct, .grade-label.correct           { color: #16a34a; }
  .dots.mostly-right, .grade-label.mostly-right { color: #65a30d; }
  .dots.partial, .grade-label.partial           { color: #d97706; }
  .dots.mostly-wrong, .grade-label.mostly-wrong { color: #ea580c; }
  .dots.wrong, .grade-label.wrong               { color: #dc2626; }

  .summary-q { font-size: 0.9rem; }
  .summary-answer { font-size: 0.85rem; color: var(--muted); }
  .answer-label { font-weight: 600; color: var(--fg); margin-right: 0.3rem; }
  .summary-expl { font-size: 0.8rem; color: var(--muted); padding: 0.35rem 0.75rem; border-left: 2px solid var(--accent); }

  .summary-actions { padding: 2rem 0; display: flex; justify-content: center; }
</style>
