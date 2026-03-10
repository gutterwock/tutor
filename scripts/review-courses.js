#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Course content validator
 * Checks markdown course files for structural, logical, and content errors
 * Usage:
 *   node scripts/review-courses.js                    # all courses
 *   node scripts/review-courses.js spanish-a1-core    # one course
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
            options: {},
            answers: [],
            answer: null,
            explanation: null,
          };
        }
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

      // Warn if freeText has no explanation
      if (q.type === 'freeText' && !q.explanation) {
        this.warnings.push(`${qLabel}: freeText question should have an explanation for grading reference`);
      }
    });
  }

  checkTags() {
    // Check for duplicate questions (same options and answer)
    const seen = new Map();
    this.questions.forEach((q, idx) => {
      const answerKey = q.type === 'exactMatch' ? JSON.stringify([...q.answers].sort()) : q.answer;
      const key = JSON.stringify([q.type, q.options, answerKey]);
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

function reviewCourse(courseId) {
  const courseDir = path.join(__dirname, '../courseData', courseId);
  if (!fs.existsSync(courseDir)) {
    console.error(`Course not found: ${courseId}`);
    process.exit(1);
  }

  const files = fs.readdirSync(courseDir).filter(f => f.endsWith('.md') && f !== 'syllabus.md');
  let totalErrors = 0;
  let totalWarnings = 0;

  console.log(`\n📚 Reviewing course: ${courseId}\n`);

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
  const courseDataDir = path.join(__dirname, '../courseData');
  const courses = fs.readdirSync(courseDataDir).filter(f => {
    const stat = fs.statSync(path.join(courseDataDir, f));
    return stat.isDirectory() && !f.startsWith('.');
  });

  let totalErrors = 0;
  let totalWarnings = 0;

  console.log(`\n📚 Reviewing all courses (${courses.length})\n`);

  courses.forEach(course => {
    const courseDir = path.join(courseDataDir, course);
    const files = fs.readdirSync(courseDir).filter(f => f.endsWith('.md') && f !== 'syllabus.md');

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

// CLI
const courseId = process.argv[2];

if (!courseId) {
  const success = reviewAllCourses();
  process.exit(success ? 0 : 1);
} else {
  const success = reviewCourse(courseId);
  process.exit(success ? 0 : 1);
}
