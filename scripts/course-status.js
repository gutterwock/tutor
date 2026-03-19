#!/usr/bin/env node
/**
 * Report on course generation progress in courseData/.
 *
 * For each course directory, reads syllabus.md to count expected subtopics,
 * then counts how many {subtopic-id}.md files have been generated.
 *
 * Usage:
 *   node scripts/course-status.js              # all courses
 *   node scripts/course-status.js <course-id>  # one course
 *
 * Options:
 *   --data-dir <path>  Path to courseData directory (default: ../courseData relative to script)
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Config (arg parsing must run before COURSE_DATA_DIR is used)
// ---------------------------------------------------------------------------

const _allArgs = process.argv.slice(2);
let _courseDataDir = path.resolve(__dirname, "../courseData");

for (let i = 0; i < _allArgs.length; i++) {
  if (_allArgs[i] === "--data-dir") {
    _courseDataDir = path.resolve(_allArgs[++i]);
  }
}

const COURSE_DATA_DIR = _courseDataDir;

// ---------------------------------------------------------------------------
// Parse syllabus.md to extract subtopic IDs
// ---------------------------------------------------------------------------

function parseSyllabusSubtopics(syllabusPath) {
  const text = fs.readFileSync(syllabusPath, "utf8");
  const subtopics = [];
  for (const line of text.split("\n")) {
    // Subtopic IDs appear on lines like: id: course-id.1.2
    const match = line.match(/^id:\s+(\S+)$/);
    if (match) {
      const id = match[1];
      // Subtopic IDs have two dots (e.g. stats-time-series-foundations.1.2)
      // Course IDs have zero dots, topic IDs have one dot
      if ((id.match(/\./g) || []).length === 2) {
        subtopics.push(id);
      }
    }
  }
  return subtopics;
}

// ---------------------------------------------------------------------------
// Course discovery helpers
// ---------------------------------------------------------------------------

function isCourseDir(dirPath) {
  return (
    fs.existsSync(path.join(dirPath, "syllabus.md")) ||
    fs.existsSync(path.join(dirPath, "syllabus.json"))
  );
}

/**
 * Discover all courses under COURSE_DATA_DIR.
 * Returns [{ courseDir, courseId, displayName }].
 */
function discoverAllCourses() {
  const courses = [];
  const entries = fs
    .readdirSync(COURSE_DATA_DIR)
    .filter((e) => !e.startsWith(".") && fs.statSync(path.join(COURSE_DATA_DIR, e)).isDirectory());

  for (const entry of entries) {
    const entryDir = path.join(COURSE_DATA_DIR, entry);
    if (isCourseDir(entryDir)) {
      courses.push({ courseDir: entryDir, courseId: entry, displayName: entry });
    } else {
      const subEntries = fs
        .readdirSync(entryDir)
        .filter(
          (e) => !e.startsWith(".") && fs.statSync(path.join(entryDir, e)).isDirectory()
        );
      for (const sub of subEntries) {
        const subDir = path.join(entryDir, sub);
        if (isCourseDir(subDir)) {
          courses.push({ courseDir: subDir, courseId: sub, displayName: `${entry}/${sub}` });
        }
      }
    }
  }

  return courses;
}

/**
 * Resolve a CLI reference to course objects.
 *   "course-id"       → direct course
 *   "group/course-id" → nested course
 *   "group"           → all courses in that group
 */
function resolveRef(ref) {
  if (ref.includes("/")) {
    const [group, courseId] = ref.split("/");
    const courseDir = path.join(COURSE_DATA_DIR, group, courseId);
    if (!fs.existsSync(courseDir)) return [];
    return [{ courseDir, courseId, displayName: ref }];
  }

  const directDir = path.join(COURSE_DATA_DIR, ref);
  if (!fs.existsSync(directDir)) return [];

  if (isCourseDir(directDir)) {
    return [{ courseDir: directDir, courseId: ref, displayName: ref }];
  }

  // Group
  const subEntries = fs
    .readdirSync(directDir)
    .filter((e) => !e.startsWith(".") && fs.statSync(path.join(directDir, e)).isDirectory());
  return subEntries
    .map((sub) => ({
      courseDir: path.join(directDir, sub),
      courseId: sub,
      displayName: `${ref}/${sub}`,
    }))
    .filter((c) => isCourseDir(c.courseDir));
}

// ---------------------------------------------------------------------------
// Get generated subtopic files (excludes syllabus.md and converted/)
// ---------------------------------------------------------------------------

function getGeneratedSubtopics(courseDir, courseId) {
  const files = fs.readdirSync(courseDir);
  return files.filter((f) => {
    if (!f.endsWith(".md")) return false;
    if (f === "syllabus.md") return false;
    // Must start with the course ID and have two dots
    const name = f.replace(/\.md$/, "");
    return name.startsWith(courseId + ".") && (name.match(/\./g) || []).length === 2;
  }).map((f) => f.replace(/\.md$/, ""));
}

// ---------------------------------------------------------------------------
// Format a progress bar
// ---------------------------------------------------------------------------

function progressBar(done, total, width = 20) {
  if (total === 0) return "[" + " ".repeat(width) + "]";
  const filled = Math.round((done / total) * width);
  return "[" + "█".repeat(filled) + "░".repeat(width - filled) + "]";
}

// ---------------------------------------------------------------------------
// Report for one course
// ---------------------------------------------------------------------------

function reportCourse(courseDir, courseId, displayName) {
  const syllabusPath = path.join(courseDir, "syllabus.md");

  if (!fs.existsSync(syllabusPath)) {
    console.log(`  ${displayName}`);
    console.log(`    ⚠️  No syllabus.md found\n`);
    return;
  }

  const expected = parseSyllabusSubtopics(syllabusPath);
  const generated = getGeneratedSubtopics(courseDir, courseId);
  const generatedSet = new Set(generated);

  const done = expected.filter((id) => generatedSet.has(id)).length;
  const total = expected.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const bar = progressBar(done, total);

  const status = done === total && total > 0 ? "✅" : done === 0 ? "⬜" : "🔄";

  console.log(`  ${status} ${displayName}`);
  console.log(`     ${bar} ${done}/${total} subtopics (${pct}%)`);

  // Show missing subtopics if partially done
  if (done > 0 && done < total) {
    const missing = expected.filter((id) => !generatedSet.has(id));
    // Group missing by topic
    const byTopic = {};
    for (const id of missing) {
      const parts = id.split(".");
      const topicKey = parts.slice(0, -1).join(".");
      if (!byTopic[topicKey]) byTopic[topicKey] = [];
      byTopic[topicKey].push(id);
    }
    for (const [topic, ids] of Object.entries(byTopic)) {
      console.log(`     Missing in ${topic}: ${ids.map((id) => id.split(".").pop()).join(", ")}`);
    }
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = _allArgs.filter((a, i) => {
  if (a === "--data-dir") return false;
  if (i > 0 && _allArgs[i - 1] === "--data-dir") return false;
  return !a.startsWith("--");
});

if (!fs.existsSync(COURSE_DATA_DIR)) {
  console.error(`courseData/ not found at ${COURSE_DATA_DIR}`);
  process.exit(1);
}

const courses = args.length > 0
  ? args.flatMap((ref) => resolveRef(ref))
  : discoverAllCourses().sort((a, b) => a.displayName.localeCompare(b.displayName));

console.log(`\nCourse generation status — ${new Date().toLocaleDateString()}\n`);

let totalDone = 0;
let totalExpected = 0;

for (const { courseDir, courseId, displayName } of courses) {
  const syllabusPath = path.join(courseDir, "syllabus.md");
  if (fs.existsSync(syllabusPath)) {
    const expected = parseSyllabusSubtopics(syllabusPath);
    const generated = getGeneratedSubtopics(courseDir, courseId);
    const generatedSet = new Set(generated);
    totalDone += expected.filter((id) => generatedSet.has(id)).length;
    totalExpected += expected.length;
  }
  reportCourse(courseDir, courseId, displayName);
}

if (courses.length > 1) {
  const pct = totalExpected > 0 ? Math.round((totalDone / totalExpected) * 100) : 0;
  console.log(`Total: ${totalDone}/${totalExpected} subtopics across ${courses.length} courses (${pct}%)\n`);
}
