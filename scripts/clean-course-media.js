const fs = require('fs');
const path = require('path');
const { isJunkMediaUrl } = require('./media-utils');

const coursePath = path.resolve(process.argv[2] || 'public/data/course.json');
const course = JSON.parse(fs.readFileSync(coursePath, 'utf8'));
let removed = 0;

for (const section of course.sections) {
  for (const mock of section.mocks || []) {
    for (const attempt of mock.attempts || []) {
      for (const question of attempt.questions || []) {
        const before = (question.images || []).length;
        question.images = (question.images || []).filter((src) => !isJunkMediaUrl(src));
        removed += before - question.images.length;
      }
    }
  }
}

fs.writeFileSync(coursePath, `${JSON.stringify(course, null, 2)}\n`, 'utf8');
console.log(`Removed ${removed} junk image reference(s) from ${coursePath}`);
