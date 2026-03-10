<script>
  import { userId, settings } from '../lib/stores.js';
  import { api } from '../lib/api.js';

  let { onback } = $props();

  // ── sub-view state ────────────────────────────────────────────────────────
  let subview = $state('list');   // 'list' | 'detail' | 'enroll'
  let selectedCourse = $state(null);  // { id, name } from enrollments list

  // ── list view ─────────────────────────────────────────────────────────────
  let enrolled  = $state([]);
  let progresses = $state({});   // course_id → { completed, total }
  let loadingList = $state(true);
  let listError = $state('');

  async function loadList() {
    loadingList = true;
    listError = '';
    try {
      enrolled = await api('GET', `/enrollments?user_id=${$userId}`);
      const results = await Promise.all(
        enrolled.map(c =>
          api('GET', `/course-progress?user_id=${$userId}&course_id=${encodeURIComponent(c.id)}`)
            .catch(() => ({ completed: 0, total: 0 }))
        )
      );
      progresses = Object.fromEntries(enrolled.map((c, i) => [c.id, results[i]]));
    } catch (e) {
      listError = e.message;
    }
    loadingList = false;
  }

  // ── course detail view ────────────────────────────────────────────────────
  let courseProgress = $state(null);   // { completed, total, topics }
  let loadingDetail  = $state(false);
  let weightDraft    = $state('');
  let editingWeight  = $state(false);
  let confirmUnenroll = $state(false);
  let actionMsg      = $state('');

  async function openDetail(course) {
    selectedCourse = course;
    subview = 'detail';
    loadingDetail = true;
    actionMsg = '';
    confirmUnenroll = false;
    editingWeight = false;
    try {
      courseProgress = await api('GET', `/course-progress?user_id=${$userId}&course_id=${encodeURIComponent(course.id)}`);
    } catch (e) {
      courseProgress = null;
    }
    loadingDetail = false;
  }

  function isPaused(courseId) {
    return $settings.disabled_courses.includes(courseId);
  }

  function togglePause(courseId) {
    settings.update(s => {
      const idx = s.disabled_courses.indexOf(courseId);
      const next = [...s.disabled_courses];
      if (idx >= 0) next.splice(idx, 1); else next.push(courseId);
      return { ...s, disabled_courses: next };
    });
    actionMsg = isPaused(courseId) ? 'Course paused.' : 'Course resumed.';
  }

  function startEditWeight(courseId) {
    weightDraft = ($settings.course_weights[courseId] ?? 1).toString();
    editingWeight = true;
  }

  function saveWeight(courseId) {
    const w = parseInt(weightDraft, 10);
    if (!isNaN(w) && w >= 1 && w <= 5) {
      settings.update(s => {
        const weights = { ...s.course_weights };
        if (w === 1) delete weights[courseId]; else weights[courseId] = w;
        return { ...s, course_weights: weights };
      });
      actionMsg = `Weight set to ${w}×.`;
    }
    editingWeight = false;
  }

  async function doUnenroll(courseId, courseName) {
    await api('DELETE', '/syllabus/enroll', { user_id: $userId, course_id: courseId });
    settings.update(s => {
      const dc = s.disabled_courses.filter(id => id !== courseId);
      const cw = { ...s.course_weights };
      delete cw[courseId];
      return { ...s, disabled_courses: dc, course_weights: cw };
    });
    confirmUnenroll = false;
    subview = 'list';
    await loadList();
  }

  // ── enroll view ───────────────────────────────────────────────────────────
  let allCourses    = $state([]);
  let enrolling     = $state({});   // course_id → 'loading' | 'done' | ''
  let loadingCourses = $state(false);

  async function openEnroll() {
    subview = 'enroll';
    loadingCourses = true;
    try {
      allCourses = await api('GET', '/syllabus');
    } catch {}
    loadingCourses = false;
  }

  function isEnrolled(courseId) {
    return enrolled.some(e => e.id === courseId);
  }

  async function enroll(course) {
    enrolling = { ...enrolling, [course.id]: 'loading' };
    try {
      await api('POST', '/syllabus/enroll', { user_id: $userId, course_id: course.id });
      enrolling = { ...enrolling, [course.id]: 'done' };
      await loadList();
    } catch {
      enrolling = { ...enrolling, [course.id]: '' };
    }
  }

  // ── progress bar ──────────────────────────────────────────────────────────
  function bar(completed, total, width = 16) {
    if (!total) return '░'.repeat(width);
    const filled = Math.round((completed / total) * width);
    return '▓'.repeat(filled) + '░'.repeat(width - filled);
  }

  // ── init ──────────────────────────────────────────────────────────────────
  loadList();
</script>

<!-- ── List ─────────────────────────────────────────────────────────────── -->
{#if subview === 'list'}
<div class="page">
  <header>
    <button class="back" onclick={onback}>← Back</button>
    <h2>Manage courses</h2>
  </header>

  {#if loadingList}
    <p class="muted pad">Loading…</p>
  {:else if listError}
    <p class="error pad">{listError}</p>
  {:else if enrolled.length === 0}
    <p class="muted pad">Not enrolled in any courses yet.</p>
  {:else}
    <div class="rows">
      {#each enrolled as course}
        {@const prog = progresses[course.id] ?? { completed: 0, total: 0 }}
        {@const paused = isPaused(course.id)}
        <button class="course-row" onclick={() => openDetail(course)}>
          <div class="course-info">
            <span class="course-name">{course.name}</span>
            <span class="course-bar">{bar(prog.completed, prog.total)}  {prog.completed}/{prog.total}</span>
          </div>
          <span class="badge" class:paused>{paused ? 'paused' : 'active'}</span>
        </button>
      {/each}
    </div>
  {/if}

  <button class="enroll-btn" onclick={openEnroll}>+ Enroll in a new course</button>
</div>

<!-- ── Detail ────────────────────────────────────────────────────────────── -->
{:else if subview === 'detail'}
<div class="page">
  <header>
    <button class="back" onclick={() => { subview = 'list'; actionMsg = ''; }}>← Back</button>
    <h2>{selectedCourse.name}</h2>
  </header>

  {#if loadingDetail}
    <p class="muted pad">Loading…</p>
  {:else if courseProgress}
    <p class="progress-summary pad">{courseProgress.completed} / {courseProgress.total} subtopics complete</p>

    <div class="topic-tree">
      {#each courseProgress.topics as topic}
        <div class="topic-block">
          <div class="topic-name">{topic.name}</div>
          {#each topic.subtopics as sub}
            <div class="subtopic-row" data-status={sub.status}>
              <span class="sub-icon">
                {#if sub.status === 'completed'}✓{:else if sub.status === 'active'}→{:else}&nbsp;{/if}
              </span>
              <span class="sub-name">{sub.name}</span>
            </div>
          {/each}
        </div>
      {/each}
    </div>
  {/if}

  <!-- Actions -->
  <div class="actions">
    {#if actionMsg}
      <p class="action-msg">{actionMsg}</p>
    {/if}

    <button class="action-btn" onclick={() => { togglePause(selectedCourse.id); }}>
      {isPaused(selectedCourse.id) ? 'Resume course' : 'Pause course'}
    </button>

    {#if editingWeight}
      <form onsubmit={e => { e.preventDefault(); saveWeight(selectedCourse.id); }} class="weight-form">
        <label class="weight-label">Weight (1–5)</label>
        <input bind:value={weightDraft} class="num-input" type="number" min="1" max="5" />
        <button type="submit" class="link-btn">save</button>
        <button type="button" class="link-btn muted" onclick={() => editingWeight = false}>cancel</button>
      </form>
    {:else}
      <button class="action-btn secondary" onclick={() => startEditWeight(selectedCourse.id)}>
        Set weight  <span class="dim">(currently {$settings.course_weights[selectedCourse.id] ?? 1}×)</span>
      </button>
    {/if}

    {#if confirmUnenroll}
      <div class="confirm-box">
        <p>Unenroll from <strong>{selectedCourse.name}</strong>? This cannot be undone.</p>
        <div class="confirm-btns">
          <button class="action-btn danger" onclick={() => doUnenroll(selectedCourse.id, selectedCourse.name)}>
            Yes, unenroll
          </button>
          <button class="action-btn secondary" onclick={() => confirmUnenroll = false}>Cancel</button>
        </div>
      </div>
    {:else}
      <button class="action-btn danger-outline" onclick={() => confirmUnenroll = true}>
        Unenroll
      </button>
    {/if}
  </div>
</div>

<!-- ── Enroll ─────────────────────────────────────────────────────────────── -->
{:else if subview === 'enroll'}
<div class="page">
  <header>
    <button class="back" onclick={() => subview = 'list'}>← Back</button>
    <h2>Enroll in a course</h2>
  </header>

  {#if loadingCourses}
    <p class="muted pad">Loading…</p>
  {:else if allCourses.filter(c => c.level === 'course').length === 0}
    <p class="muted pad">No courses available on this server.</p>
  {:else}
    <div class="rows">
      {#each allCourses.filter(c => c.level === 'course') as course}
        {@const already = isEnrolled(course.id)}
        {@const state = enrolling[course.id]}
        <div class="course-row enroll-row">
          <div class="course-info">
            <span class="course-name">{course.name}</span>
            {#if course.description}
              <span class="course-desc">{course.description}</span>
            {/if}
          </div>
          {#if already || state === 'done'}
            <span class="badge enrolled">enrolled</span>
          {:else}
            <button
              class="enroll-course-btn"
              disabled={state === 'loading'}
              onclick={() => enroll(course)}
            >
              {state === 'loading' ? '…' : 'Enroll'}
            </button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
{/if}

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

  h2 { font-size: 1.1rem; font-weight: 600; }

  .pad { padding: 1rem 0; }
  .muted { color: var(--muted); font-size: 0.9rem; }
  .error { color: #dc2626; font-size: 0.9rem; }

  /* ── Rows ── */
  .rows { display: flex; flex-direction: column; }

  .course-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.9rem 0;
    border-bottom: 1px solid var(--border);
    background: none;
    border-left: none;
    border-right: none;
    border-top: none;
    font: inherit;
    color: var(--fg);
    cursor: pointer;
    text-align: left;
    width: 100%;
  }
  .course-row:hover { background: var(--item-hover); padding-left: 0.5rem; padding-right: 0.5rem; margin: 0 -0.5rem; width: calc(100% + 1rem); }

  .enroll-row { cursor: default; }
  .enroll-row:hover { background: none; padding-left: 0; padding-right: 0; margin: 0; width: 100%; }

  .course-info { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
  .course-name { font-size: 0.95rem; font-weight: 500; }
  .course-bar  { font-size: 0.75rem; color: var(--muted); font-family: monospace; }
  .course-desc { font-size: 0.78rem; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .badge {
    flex-shrink: 0;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 0.2rem 0.5rem;
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
  }
  .badge.paused {
    background: color-mix(in srgb, var(--muted) 15%, transparent);
    color: var(--muted);
  }
  .badge.enrolled {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
  }

  .enroll-btn {
    margin-top: 1.25rem;
    background: none;
    border: 1px dashed var(--border);
    font: inherit;
    font-size: 0.9rem;
    color: var(--accent);
    cursor: pointer;
    padding: 0.75rem 1rem;
    border-radius: var(--radius);
    width: 100%;
    text-align: center;
  }
  .enroll-btn:hover { background: var(--item-hover); }

  /* ── Detail: topic tree ── */
  .progress-summary { color: var(--muted); font-size: 0.85rem; }

  .topic-tree { margin-top: 0.5rem; }

  .topic-block { margin-bottom: 0.75rem; }

  .topic-name {
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    padding: 0.5rem 0 0.25rem;
    border-top: 1px solid var(--border);
  }

  .subtopic-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.3rem 0;
    font-size: 0.9rem;
  }
  .subtopic-row[data-status="locked"] { color: var(--muted); }
  .subtopic-row[data-status="completed"] { color: var(--fg); }
  .subtopic-row[data-status="active"] { color: var(--fg); font-weight: 500; }

  .sub-icon { width: 1rem; text-align: center; flex-shrink: 0; color: var(--accent); }
  .subtopic-row[data-status="locked"] .sub-icon { color: var(--muted); }

  /* ── Detail: actions ── */
  .actions { margin-top: 1.5rem; display: flex; flex-direction: column; gap: 0.6rem; padding-bottom: 2rem; }

  .action-msg { font-size: 0.82rem; color: var(--accent); margin: 0; }

  .action-btn {
    background: var(--accent);
    color: var(--accent-fg);
    border: none;
    font: inherit;
    font-size: 0.9rem;
    padding: 0.65rem 1rem;
    border-radius: var(--radius);
    cursor: pointer;
    text-align: left;
  }
  .action-btn:hover { opacity: 0.85; }

  .action-btn.secondary {
    background: var(--item-hover);
    color: var(--fg);
    border: 1px solid var(--border);
  }

  .action-btn.danger { background: #dc2626; color: #fff; }

  .action-btn.danger-outline {
    background: none;
    color: #dc2626;
    border: 1px solid #dc2626;
  }
  .action-btn.danger-outline:hover { background: color-mix(in srgb, #dc2626 10%, transparent); }

  .dim { font-weight: 400; color: var(--muted); font-size: 0.82rem; }

  .weight-form {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0;
  }
  .weight-label { font-size: 0.85rem; color: var(--muted); }

  .num-input {
    width: 4rem;
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
  }
  .link-btn.muted { color: var(--muted); }
  .link-btn:hover { opacity: 0.75; }

  .confirm-box {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .confirm-box p { font-size: 0.9rem; margin: 0; }
  .confirm-btns { display: flex; gap: 0.5rem; }

  .enroll-course-btn {
    flex-shrink: 0;
    background: var(--accent);
    color: var(--accent-fg);
    border: none;
    font: inherit;
    font-size: 0.85rem;
    padding: 0.35rem 0.85rem;
    border-radius: var(--radius);
    cursor: pointer;
  }
  .enroll-course-btn:disabled { opacity: 0.5; cursor: default; }
  .enroll-course-btn:not(:disabled):hover { opacity: 0.85; }
</style>
