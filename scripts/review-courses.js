#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Course content validator
 * Checks markdown course files for structural, logical, and content errors
 * Usage:
 *   node scripts/review-courses.js                    # all courses
 *   node scripts/review-courses.js spanish-a1-core    # one course
 *
 * Options:
 *   --data-dir <path>  Path to courseData directory (default: ../courseData relative to script)
 */

const VALID_PHASES = ['phase:atomic', 'phase:complex', 'phase:integration'];
const VALID_QUESTION_TYPES = ['singleChoice', 'multiChoice', 'ordering', 'exactMatch', 'freeText'];
const VALID_DIFFICULTIES = [0, 1, 2, 3, 4];

class CourseValidator {
  constructor(filePath) {
    this.filePath = filePath;
    this.fileName = path.basename(filePath);
    this.content = fs.readFileSync(filePath, 'utf-8');
    this.lines = this.content.split('\n');
    this.errors = [];
    this.warnings = [];
  }

  validate() {
    this.parseQuestions();
    this.checkStructure();
    this.checkQuestions();
    this.checkTags();
    return { errors: this.errors, warnings: this.warnings };
  }

  parseQuestions() {
    this.questions = [];
    let current = null;

    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      const lineNum = i + 1;

      if (line.startsWith('### question ')) {
        if (current) this.questions.push(current);
        const match = line.match(/### question (\w+).*?difficulty:(\d+)/);
        if (match) {
          current = {
            type: match[1],
            difficulty: parseInt(match[2]),
            lineStart: lineNum,
            tags: [],
            questionTextLines: [],
            options: {},
            answers: [],
            answer: null,
            explanation: null,
          };
        }
      } else if (/^## (?!#)/.test(line)) {
        // Content block heading — terminate current question to prevent its tags:
        // line from overwriting the question's tags.
        if (current) this.questions.push(current);
        current = null;
      } else if (current) {
        if (line.startsWith('tags:')) {
          current.tags = line.replace('tags:', '').trim().split(',').map(t => t.trim());
        } else if (line.startsWith('answer:')) {
          const val = line.replace('answer:', '').trim();
          current.answers.push(val);
          current.answer = val; // last answer for compat; first for exactMatch checked separately
        } else if (line.startsWith('explanation:')) {
          current.explanation = line.replace('explanation:', '').trim();
        } else if (line.match(/^[a-z]:/) && !line.startsWith('answer:')) {
          // Only treat as option if it's a single letter followed by colon (before answer key)
          const [key, val] = line.split(':', 2);
          if (key.length === 1 && key.match(/^[a-z]$/)) {
            current.options[key] = val.trim();
          }
        } else if (!line.startsWith('show_with_content:') && line.trim() !== '') {
          current.questionTextLines.push(line);
        }
      }
    }
    if (current) this.questions.push(current);
  }

  checkStructure() {
    // Check for required fields in each question
    this.questions.forEach((q, idx) => {
      if (!q.type || !VALID_QUESTION_TYPES.includes(q.type)) {
        this.errors.push(`Q${idx + 1} (line ${q.lineStart}): Invalid question type "${q.type}"`);
      }
      if (!VALID_DIFFICULTIES.includes(q.difficulty)) {
        this.errors.push(`Q${idx + 1} (line ${q.lineStart}): Invalid difficulty "${q.difficulty}"`);
      }
      if (q.answer === null) {
        this.errors.push(`Q${idx + 1} (line ${q.lineStart}): Missing answer key`);
      }
      // exactMatch and freeText don't need a-d options
      const needsOptions = ['singleChoice', 'multiChoice', 'ordering'].includes(q.type);
      if (needsOptions && Object.keys(q.options).length === 0) {
        this.errors.push(`Q${idx + 1} (line ${q.lineStart}): No answer options found`);
      }
    });
  }

  checkQuestions() {
    this.questions.forEach((q, idx) => {
      const qNum = idx + 1;
      const qLabel = `Q${qNum} (line ${q.lineStart})`;

      // For singleChoice/multiChoice/ordering, use first answer (they only have one)
      const primaryAnswer = q.answers[0] ?? q.answer;

      // Check answer key matches available options (not for exactMatch/freeText which have free text answers)
      if (q.type === 'singleChoice') {
        if (!q.options[primaryAnswer]) {
          this.errors.push(
            `${qLabel}: Answer key "${primaryAnswer}" not in options. Available: ${Object.keys(q.options).join(', ')}`
          );
        }
      } else if (q.type === 'multiChoice') {
        const answerKeys = primaryAnswer.split('');
        const validKeys = Object.keys(q.options);
        answerKeys.forEach(key => {
          if (!validKeys.includes(key)) {
            this.errors.push(
              `${qLabel}: Answer contains invalid option "${key}". Available: ${validKeys.join(', ')}`
            );
          }
        });
        // Check for duplicate answers
        if (new Set(answerKeys).size !== answerKeys.length) {
          this.errors.push(`${qLabel}: Answer contains duplicate options`);
        }
      } else if (q.type === 'ordering') {
        const answerKeys = primaryAnswer.split('');
        const validKeys = Object.keys(q.options);
        if (answerKeys.length !== validKeys.length) {
          this.errors.push(
            `${qLabel}: Ordering answer has ${answerKeys.length} items but ${validKeys.length} options given`
          );
        }
        answerKeys.forEach(key => {
          if (!validKeys.includes(key)) {
            this.errors.push(
              `${qLabel}: Answer contains invalid option "${key}". Available: ${validKeys.join(', ')}`
            );
          }
        });
        // Check all options are used exactly once
        if (new Set(answerKeys).size !== answerKeys.length) {
          this.errors.push(`${qLabel}: Answer contains duplicate options`);
        }
      }

      // Warn if no phase tag
      const hasPhaseTag = q.tags.some(t => VALID_PHASES.includes(t));
      if (!hasPhaseTag) {
        this.warnings.push(`${qLabel}: Missing phase tag (phase:atomic, phase:complex, or phase:integration)`);
      }
    });
  }

  checkTags() {
    // Check for duplicate questions (same options and answer)
    const seen = new Map();
    this.questions.forEach((q, idx) => {
      const answerKey = q.type === 'exactMatch' ? JSON.stringify([...q.answers].sort()) : q.answer;
      const questionText = (q.questionTextLines ?? []).join(' ');
      const key = JSON.stringify([q.type, q.options, answerKey, questionText]);
      if (seen.has(key)) {
        this.warnings.push(
          `Q${idx + 1} (line ${q.lineStart}): Appears to be a duplicate of Q${seen.get(key) + 1}`
        );
      } else {
        seen.set(key, idx);
      }
    });
  }
}

function reviewFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const validator = new CourseValidator(filePath);
  const { errors, warnings } = validator.validate();

  console.log(`\n📋 ${path.basename(filePath)}`);
  console.log(`   ${validator.questions.length} questions found\n`);

  if (errors.length > 0) {
    console.log(`❌ ERRORS (${errors.length}):`);
    errors.forEach(e => console.log(`   • ${e}`));
  }

  if (warnings.length > 0) {
    console.log(`⚠️  WARNINGS (${warnings.length}):`);
    warnings.forEach(w => console.log(`   • ${w}`));
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log(`✅ No issues found`);
  }

  return { errors, warnings, validator };
}

let COURSE_DATA_DIR = path.join(__dirname, '../courseData');

function isCourseDir(dirPath) {
  return fs.existsSync(path.join(dirPath, 'syllabus.md')) ||
         fs.existsSync(path.join(dirPath, 'syllabus.json'));
}

function discoverAllCourses() {
  const courses = [];
  const entries = fs.readdirSync(COURSE_DATA_DIR)
    .filter(e => !e.startsWith('.') && fs.statSync(path.join(COURSE_DATA_DIR, e)).isDirectory());
  for (const entry of entries) {
    const entryDir = path.join(COURSE_DATA_DIR, entry);
    if (isCourseDir(entryDir)) {
      courses.push({ courseDir: entryDir, displayName: entry });
    } else {
      fs.readdirSync(entryDir)
        .filter(e => !e.startsWith('.') && fs.statSync(path.join(entryDir, e)).isDirectory())
        .forEach(sub => {
          const subDir = path.join(entryDir, sub);
          if (isCourseDir(subDir)) {
            courses.push({ courseDir: subDir, displayName: `${entry}/${sub}` });
          }
        });
    }
  }
  return courses;
}

function resolveRef(ref) {
  if (ref.includes('/')) {
    const courseDir = path.join(COURSE_DATA_DIR, ref);
    if (!fs.existsSync(courseDir)) return null;
    return { courseDir, displayName: ref };
  }
  const directDir = path.join(COURSE_DATA_DIR, ref);
  if (!fs.existsSync(directDir)) return null;
  if (isCourseDir(directDir)) return { courseDir: directDir, displayName: ref };
  // group — return all courses under it
  return null; // groups not supported for single-course review
}

function reviewCourse(courseDir, displayName) {
  const files = fs.readdirSync(courseDir)
    .filter(f => f.endsWith('.md') && f !== 'syllabus.md' && f !== 'program.md');
  let totalErrors = 0;
  let totalWarnings = 0;

  console.log(`\n📚 Reviewing course: ${displayName}\n`);

  files.forEach(file => {
    const filePath = path.join(courseDir, file);
    const { errors, warnings } = reviewFile(filePath);
    totalErrors += errors.length;
    totalWarnings += warnings.length;
  });

  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 Summary: ${totalErrors} errors, ${totalWarnings} warnings`);
  console.log(`${'='.repeat(50)}\n`);

  return totalErrors === 0;
}

function reviewAllCourses() {
  const courses = discoverAllCourses();
  let totalErrors = 0;
  let totalWarnings = 0;

  console.log(`\n📚 Reviewing all courses (${courses.length})\n`);

  courses.forEach(({ courseDir, displayName }) => {
    const files = fs.readdirSync(courseDir)
      .filter(f => f.endsWith('.md') && f !== 'syllabus.md' && f !== 'program.md');

    files.forEach(file => {
      const filePath = path.join(courseDir, file);
      const { errors, warnings } = reviewFile(filePath);
      totalErrors += errors.length;
      totalWarnings += warnings.length;
    });
  });

  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 Overall: ${totalErrors} errors, ${totalWarnings} warnings across ${courses.length} courses`);
  console.log(`${'='.repeat(50)}\n`);

  return totalErrors === 0;
}

// CLI — parse --data-dir then dispatch
const _allArgs = process.argv.slice(2);
const courseArgs = [];

for (let i = 0; i < _allArgs.length; i++) {
  if (_allArgs[i] === '--data-dir') {
    COURSE_DATA_DIR = path.resolve(_allArgs[++i]);
  } else {
    courseArgs.push(_allArgs[i]);
  }
}

const arg = courseArgs[0];

if (!arg) {
  const success = reviewAllCourses();
  process.exit(success ? 0 : 1);
} else {
  const resolved = resolveRef(arg);
  if (!resolved) {
    console.error(`Course not found: ${arg}`);
    process.exit(1);
  }
  const success = reviewCourse(resolved.courseDir, resolved.displayName);
  process.exit(success ? 0 : 1);
}
