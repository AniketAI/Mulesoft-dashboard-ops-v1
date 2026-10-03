export const MOCK_USER = {
  id: 'demo-user-001',
  username: 'demo.user',
  firstName: 'Demo',
  lastName: 'User',
  email: 'demo@example.com',
  organization: { id: 'demo-org-001', name: 'Demo Organization' }
};

export const MOCK_ENVIRONMENTS = [
  { id: 'env-prod-001', name: 'Production', type: 'production', isProduction: true },
  { id: 'env-staging-001', name: 'Staging', type: 'sandbox', isProduction: false },
  { id: 'env-dev-001', name: 'Development', type: 'sandbox', isProduction: false },
  { id: 'env-qa-001', name: 'QA', type: 'sandbox', isProduction: false }
];

export const MOCK_APPS = [
  {
    id: 'app-001', name: 'customer-api-v2', status: 'RUNNING',
    environment: { id: 'env-prod-001', name: 'Production', type: 'production' },
    deploymentType: 'CloudHub 2.0', muleVersion: '4.6.1',
    lastModifiedDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'app-002', name: 'order-process-sapi', status: 'RUNNING',
    environment: { id: 'env-prod-001', name: 'Production', type: 'production' },
    deploymentType: 'CloudHub 2.0', muleVersion: '4.6.1',
    lastModifiedDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'app-003', name: 'salesforce-sync-papi', status: 'RUNNING',
    environment: { id: 'env-prod-001', name: 'Production', type: 'production' },
    deploymentType: 'CloudHub 1.0', muleVersion: '4.5.0',
    lastModifiedDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'app-004', name: 'payment-gateway-eapi', status: 'FAILED',
    environment: { id: 'env-prod-001', name: 'Production', type: 'production' },
    deploymentType: 'CloudHub 2.0', muleVersion: '4.6.0',
    lastModifiedDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'app-005', name: 'inventory-api', status: 'RUNNING',
    environment: { id: 'env-staging-001', name: 'Staging', type: 'sandbox' },
    deploymentType: 'CloudHub 2.0', muleVersion: '4.6.1',
    lastModifiedDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'app-006', name: 'notification-service', status: 'STOPPED',
    environment: { id: 'env-staging-001', name: 'Staging', type: 'sandbox' },
    deploymentType: 'CloudHub 1.0', muleVersion: '4.5.0',
    lastModifiedDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'app-007', name: 'erp-integration-sapi', status: 'RUNNING',
    environment: { id: 'env-dev-001', name: 'Development', type: 'sandbox' },
    deploymentType: 'CloudHub 2.0', muleVersion: '4.6.1',
    lastModifiedDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'app-008', name: 'reporting-batch-job', status: 'DEPLOYING',
    environment: { id: 'env-dev-001', name: 'Development', type: 'sandbox' },
    deploymentType: 'CloudHub 2.0', muleVersion: '4.6.1',
    lastModifiedDate: new Date(Date.now() - 30 * 60 * 1000).toISOString()
  }
];

export const MOCK_EXCHANGE_SUMMARY = {
  'rest-api': 12,
  'soap-api': 3,
  'http-api': 5,
  'mule-application': 8,
  'mule-plugin': 4,
  template: 6,
  example: 9
};

export const MOCK_BUSINESS_GROUPS = [
  {
    id: 'demo-org-001', name: 'Demo Organization', domain: 'demo-org',
    type: 'master', parentId: null,
    subOrganizationIds: ['bg-001', 'bg-002'],
    createdAt: '2023-01-15T10:00:00Z'
  },
  {
    id: 'bg-001', name: 'Digital Commerce', domain: 'digital-commerce',
    type: 'businessGroup', parentId: 'demo-org-001',
    subOrganizationIds: [],
    createdAt: '2023-02-10T10:00:00Z'
  },
  {
    id: 'bg-002', name: 'Enterprise IT', domain: 'enterprise-it',
    type: 'businessGroup', parentId: 'demo-org-001',
    subOrganizationIds: ['bg-003'],
    createdAt: '2023-03-05T10:00:00Z'
  },
  {
    id: 'bg-003', name: 'Platform Team', domain: 'platform-team',
    type: 'businessGroup', parentId: 'bg-002',
    subOrganizationIds: [],
    createdAt: '2023-04-20T10:00:00Z'
  }
];

export const MOCK_MEMBERS = [
  { id: 'u1', username: 'john.smith', firstName: 'John', lastName: 'Smith', email: 'john@example.com' },
  { id: 'u2', username: 'sarah.jones', firstName: 'Sarah', lastName: 'Jones', email: 'sarah@example.com' },
  { id: 'u3', username: 'mike.chen', firstName: 'Mike', lastName: 'Chen', email: 'mike@example.com' },
  { id: 'u4', username: 'lisa.patel', firstName: 'Lisa', lastName: 'Patel', email: 'lisa@example.com' }
];

export const MOCK_APIS = [
  {
    id: 'api-001', assetId: 'customer-api', assetVersion: '2.0.1', groupId: 'demo-org-001',
    status: 'active', productVersion: 'v2',
    endpoint: { uri: 'https://prod.example.com/customer/v2', proxyUri: 'https://proxy.example.com/customer/v2' }
  },
  {
    id: 'api-002', assetId: 'order-process-api', assetVersion: '1.3.0', groupId: 'demo-org-001',
    status: 'active', productVersion: 'v1',
    endpoint: { uri: 'https://prod.example.com/orders/v1', proxyUri: 'https://proxy.example.com/orders/v1' }
  },
  {
    id: 'api-003', assetId: 'payment-gateway-api', assetVersion: '3.0.0', groupId: 'demo-org-001',
    status: 'active', productVersion: 'v3',
    endpoint: { uri: 'https://prod.example.com/payments/v3', proxyUri: null }
  },
  {
    id: 'api-004', assetId: 'inventory-api', assetVersion: '1.0.5', groupId: 'bg-001',
    status: 'inactive', productVersion: 'v1',
    endpoint: { uri: 'https://staging.example.com/inventory/v1', proxyUri: null }
  }
];

export const MOCK_POLICIES = [
  {
    id: 'p1',
    template: { name: 'Rate Limiting', version: '1.3.0' },
    disabled: false
  },
  {
    id: 'p2',
    template: { name: 'JWT Validation', version: '1.2.1' },
    disabled: false
  },
  {
    id: 'p3',
    template: { name: 'IP Allowlist', version: '1.1.0' },
    disabled: true
  }
];

export const MOCK_EXCHANGE_ASSETS = [
  {
    groupId: 'demo-org-001', assetId: 'customer-api', name: 'Customer API', type: 'rest-api',
    version: '2.0.1', status: 'published',
    description: 'REST API for managing customer data including profiles, addresses, and preferences.',
    createdBy: { username: 'john.smith' },
    createdAt: '2024-01-10T10:00:00Z', updatedAt: '2024-06-15T10:00:00Z',
    labels: ['customer', 'experience-api']
  },
  {
    groupId: 'demo-org-001', assetId: 'order-process-api', name: 'Order Processing API', type: 'rest-api',
    version: '1.3.0', status: 'published',
    description: 'Process and manage orders end-to-end including creation, tracking, and fulfillment.',
    createdBy: { username: 'sarah.jones' },
    createdAt: '2024-02-05T10:00:00Z', updatedAt: '2024-07-01T10:00:00Z',
    labels: ['orders', 'process-api']
  },
  {
    groupId: 'demo-org-001', assetId: 'salesforce-connector-custom', name: 'Custom Salesforce Connector',
    type: 'mule-plugin', version: '1.0.2', status: 'published',
    description: 'Custom MuleSoft connector for Salesforce with extended authentication support.',
    createdBy: { username: 'mike.chen' },
    createdAt: '2024-03-12T10:00:00Z', updatedAt: '2024-05-20T10:00:00Z',
    labels: ['salesforce', 'connector']
  },
  {
    groupId: 'demo-org-001', assetId: 'erp-integration-template', name: 'ERP Integration Template',
    type: 'template', version: '2.1.0', status: 'published',
    description: 'Accelerator template for SAP/Oracle ERP integrations with pre-built transformations.',
    createdBy: { username: 'lisa.patel' },
    createdAt: '2024-04-18T10:00:00Z', updatedAt: '2024-04-18T10:00:00Z',
    labels: ['erp', 'sap', 'template']
  },
  {
    groupId: 'demo-org-001', assetId: 'payment-gateway-api', name: 'Payment Gateway API', type: 'rest-api',
    version: '3.0.0', status: 'published',
    description: 'Secure payment processing API supporting multiple gateways.',
    createdBy: { username: 'john.smith' },
    createdAt: '2023-11-01T10:00:00Z', updatedAt: '2024-08-01T10:00:00Z',
    labels: ['payments', 'finance']
  },
  {
    groupId: 'demo-org-001', assetId: 'legacy-soap-service', name: 'Legacy SOAP Service', type: 'soap-api',
    version: '1.0.0', status: 'published',
    description: 'WSDL-based SOAP service wrapper for legacy ERP system.',
    createdBy: { username: 'mike.chen' },
    createdAt: '2023-06-15T10:00:00Z', updatedAt: '2023-06-15T10:00:00Z',
    labels: ['soap', 'legacy']
  }
];

export const MOCK_APP_DETAIL = {
  id: 'demo-app-detail',
  name: 'customer-api-v2',
  status: 'RUNNING',
  target: {
    region: 'us-east-1',
    deploymentSettings: {
      runtimeVersion: '4.6.1',
      updateStrategy: { replicas: 2 },
      environmentVars: {
        'ENV': 'production',
        'LOG_LEVEL': 'INFO',
        'API_TIMEOUT': '30000'
      }
    }
  },
  properties: {
    'salesforce.username': 'sf-user@example.com',
    'salesforce.instance': 'https://example.my.salesforce.com',
    'db.host': 'prod-db.example.com',
    'db.port': '5432'
  },
  lastModifiedDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
};