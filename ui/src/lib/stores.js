import { writable } from 'svelte/store';

function persist(key, defaultFn) {
  const stored = localStorage.getItem(key);
  const initial = stored !== null ? JSON.parse(stored) : defaultFn();
  const store = writable(initial);
  store.subscribe(v => localStorage.setItem(key, JSON.stringify(v)));
  return store;
}

function randomUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export const userId   = persist('drip_user_id', () => (crypto.randomUUID?.() ?? randomUUID()));
export const motif    = persist('drip_motif',   () => 'feed');
export const settings = persist('drip_settings', () => ({
  interleave_courses:   true,
  interleave_subtopics: true,
  session_length:       null,   // null = unlimited
  disabled_courses:     [],
  course_weights:       {},
}));
