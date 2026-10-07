const {
  saveDiscoveredApplications,
} = require('./dependencyRepository');

const {
  db,
} = require('./dependencyDatabase');

try {
  const testApplications = [
    {
      id: 'dm-test-app-001',
      name: 'xapi-test-order-v1',
      type: 'XAPI',
      deploymentType: 'CloudHub 2.0',
      bgId: 'dm-test-bg-001',
      envId: 'dm-test-env-001',
      environment: 'DM-Test-UAT',
    },
    {
      id: 'dm-test-app-002',
      name: 'papi-test-order-v1',
      type: 'PAPI',
      deploymentType: 'CloudHub 2.0',
      bgId: 'dm-test-bg-001',
      envId: 'dm-test-env-001',
      environment: 'DM-Test-UAT',
    },
  ];

  const result =
    saveDiscoveredApplications(
      testApplications
    );

  console.log(
    '\nRepository test result:'
  );

  console.log(result);

  const environments = db
    .prepare(`
      SELECT
        id,
        bg_id,
        env_id,
        environment_name,
        environment_type
      FROM environments
      WHERE bg_id = 'dm-test-bg-001'
      ORDER BY id
    `)
    .all();

  const applications = db
    .prepare(`
      SELECT
        id,
        external_id,
        name,
        type,
        deployment_type,
        bg_id,
        env_id,
        environment_name
      FROM applications
      WHERE bg_id = 'dm-test-bg-001'
      ORDER BY id
    `)
    .all();

  console.log('\nTest environments:');
  console.table(environments);

  console.log('\nTest applications:');
  console.table(applications);

  if (
    result.saved !==
    testApplications.length
  ) {
    throw new Error(
      'Not all test applications were saved'
    );
  }

  console.log(
    '\nDM-2.1 repository test PASSED.'
  );
} catch (error) {
  console.error(
    '\nDM-2.1 repository test FAILED:'
  );

  console.error(error);

  process.exitCode = 1;
} finally {
  db.close();
}