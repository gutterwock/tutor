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
 */

const fs = require("fs");
const path = require("path");

const COURSE_DATA_DIR = path.resolve(__dirname, "../courseData");

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

function reportCourse(courseId) {
  const courseDir = path.join(COURSE_DATA_DIR, courseId);
  const syllabusPath = path.join(courseDir, "syllabus.md");

  if (!fs.existsSync(syllabusPath)) {
    console.log(`  ${courseId}`);
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

  console.log(`  ${status} ${courseId}`);
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

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));

if (!fs.existsSync(COURSE_DATA_DIR)) {
  console.error(`courseData/ not found at ${COURSE_DATA_DIR}`);
  process.exit(1);
}

const allCourses = fs
  .readdirSync(COURSE_DATA_DIR)
  .filter((f) => fs.statSync(path.join(COURSE_DATA_DIR, f)).isDirectory())
  .filter((f) => f !== "converted")
  .sort();

const courses = args.length > 0 ? args : allCourses;

console.log(`\nCourse generation status — ${new Date().toLocaleDateString()}\n`);

let totalDone = 0;
let totalExpected = 0;

for (const courseId of courses) {
  const courseDir = path.join(COURSE_DATA_DIR, courseId);
  if (!fs.existsSync(courseDir)) {
    console.log(`  ⚠️  ${courseId} — directory not found\n`);
    continue;
  }
  const syllabusPath = path.join(courseDir, "syllabus.md");
  if (fs.existsSync(syllabusPath)) {
    const expected = parseSyllabusSubtopics(syllabusPath);
    const generated = getGeneratedSubtopics(courseDir, courseId);
    const generatedSet = new Set(generated);
    totalDone += expected.filter((id) => generatedSet.has(id)).length;
    totalExpected += expected.length;
  }
  reportCourse(courseId);
}

if (courses.length > 1) {
  const pct = totalExpected > 0 ? Math.round((totalDone / totalExpected) * 100) : 0;
  console.log(`Total: ${totalDone}/${totalExpected} subtopics across ${courses.length} courses (${pct}%)\n`);
}
