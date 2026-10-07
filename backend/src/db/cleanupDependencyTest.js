const { db } = require('./dependencyDatabase');

try {
  const result = db.transaction(() => {
    db.prepare(`
      DELETE FROM applications
      WHERE bg_id = 'dm-test-bg-001'
    `).run();

    db.prepare(`
      DELETE FROM environments
      WHERE bg_id = 'dm-test-bg-001'
    `).run();
  })();

  console.log('Dependency test data cleaned successfully.');
} catch (error) {
  console.error(
    'Failed to clean dependency test data:',
    error
  );

  process.exitCode = 1;
} finally {
  db.close();
}