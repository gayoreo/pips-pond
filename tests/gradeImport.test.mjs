import test from 'node:test';
import assert from 'node:assert/strict';
import { previewGradeCsv } from '../js/views/gradeImport.js';
import { courseGrade } from '../js/core/grades.js';

function course(grades = []) {
  return {
    id: 'german',
    code: 'GERM 1100',
    name: 'German I',
    grading: {
      groups: [
        { id: 'lecture', name: 'Lecture', weight: 100, mode: 'points',
          categories: [{ id: 'hw', name: 'Daily homework', total: 100 }] },
        { id: 'lab', name: 'Lab', weight: 0, mode: 'points', categories: [] },
      ],
    },
    grades,
  };
}

test('blank Earned imports as pending, while 0 remains a graded zero', () => {
  const csv = 'Course,Category,Assignment,Earned,Possible\n' +
    'GERM 1100,Daily homework,Homework 1,0,10\n' +
    'GERM 1100,Daily homework,Homework 2,,10';
  const rows = previewGradeCsv(course(), csv);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(x => x.reason), ['', '']);
  assert.equal(rows[0].status, 'graded');
  assert.equal(rows[0].earned, 0);
  assert.equal(rows[1].status, 'pending');
  assert.equal(rows[1].earned, '');
  assert.equal(rows[1].possible, 10);
  assert.equal(rows[1].catId, 'hw');
});

test('optional Status column handles Not graded yet and Graded', () => {
  const csv = 'Category,Assignment,Earned,Possible,Status\n' +
    'Daily homework,Homework 3,,10,Not graded yet\n' +
    'Daily homework,Homework 4,8,10,Graded';
  const rows = previewGradeCsv(course(), csv);
  assert.deepEqual(rows.map(x => x.status), ['pending', 'graded']);
  assert.deepEqual(rows.map(x => x.reason), ['', '']);
});

test('Earned column can be omitted for a CSV containing only ungraded assignments', () => {
  const row = previewGradeCsv(course(),
    'Category,Assignment,Possible\nDaily homework,Homework 5,20')[0];
  assert.equal(row.status, 'pending');
  assert.equal(row.earned, '');
  assert.equal(row.possible, 20);
  assert.equal(row.reason, '');
});

test('explicit Graded requires a score, and pending cannot discard a filled score', () => {
  const rows = previewGradeCsv(course(),
    'Category,Assignment,Earned,Possible,Status\n' +
    'Daily homework,Homework 1,,10,Graded\n' +
    'Daily homework,Homework 2,9,10,Pending');
  assert.equal(rows[0].reason, 'Invalid earned score');
  assert.match(rows[1].reason, /Leave Earned blank/);
});

test('bad scores and points possible do not become valid imported assignments', () => {
  const rows = previewGradeCsv(course(),
    'Category,Assignment,Earned,Possible\n' +
    'Daily homework,Homework 1,-2,10\n' +
    'Daily homework,Homework 2,5,0\n' +
    'Daily homework,Homework 3,,');
  assert.ok(rows.every(x => x.reason));
});

test('existing grades and duplicate names remain protected', () => {
  const existing = [{ id: 'old', name: 'Homework 1', catId: 'hw', earned: 8, possible: 10, status: 'graded' }];
  const rows = previewGradeCsv(course(existing),
    'Category,Assignment,Earned,Possible\n' +
    'Daily homework,Homework 1,,10\n' +
    'Daily homework,Homework 2,,10\n' +
    'Daily homework,Homework 2,9,10');
  assert.equal(rows[0].reason, 'Already exists');
  assert.equal(rows[1].reason, '');
  assert.equal(rows[2].reason, 'Already exists');
});

test('other courses and missing grading categories are skipped', () => {
  const rows = previewGradeCsv(course(),
    'Course,Category,Assignment,Earned,Possible\n' +
    'CHEM 1450,Daily homework,Quiz 1,,10\n' +
    'GERM 1100,Nonexistent,Quiz 2,,10');
  assert.equal(rows[0].reason, 'Other course');
  assert.equal(rows[1].reason, 'Category not found');
});

test('quoted commas in assignment names import correctly', () => {
  const row = previewGradeCsv(course(),
    'Category,Assignment,Earned,Possible\nDaily homework,"Quiz 1, part A",,15')[0];
  assert.equal(row.name, 'Quiz 1, part A');
  assert.equal(row.status, 'pending');
  assert.equal(row.reason, '');
});

test('pending work is excluded from the current grade calculation', () => {
  const rows = previewGradeCsv(course(),
    'Category,Assignment,Earned,Possible\n' +
    'Daily homework,Homework 1,8,10\n' +
    'Daily homework,Homework 2,,10');
  const grades = rows.map((r, i) => ({
    id: String(i), name: r.name, catId: r.catId, earned: r.earned,
    possible: r.possible, status: r.status,
  }));
  assert.equal(courseGrade(course(grades)).pct, 80);
});
