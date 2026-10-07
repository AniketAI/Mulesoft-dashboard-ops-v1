const { db, DB_PATH } = require('./dependencyDatabase');
const {
  initializeDependencySchema,
} = require('./dependencySchema');

try {
  initializeDependencySchema();

  const tables = db
    .prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `)
    .all();

  console.log('\nDependency database initialized successfully.');
  console.log(`Database: ${DB_PATH}`);

  console.log('\nTables:');

  for (const table of tables) {
    console.log(`- ${table.name}`);
  }

  const expectedTables = [
    'applications',
    'cache_metadata',
    'dependencies',
    'endpoints',
    'environments',
    'properties',
  ];

  const actualTables = tables.map(
    (table) => table.name
  );

  const missingTables = expectedTables.filter(
    (table) => !actualTables.includes(table)
  );

  if (missingTables.length > 0) {
    console.error(
      '\nMissing tables:',
      missingTables
    );

    process.exitCode = 1;
  } else {
    console.log(
      '\nAll expected tables are present.'
    );
  }
} catch (error) {
  console.error(
    '\nDependency database initialization failed:'
  );

  console.error(error);

  process.exitCode = 1;
} finally {
  db.close();
}