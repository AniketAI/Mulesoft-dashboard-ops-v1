/**
 * mockCpsData.js
 * 
 * This file provides mock data representing typical responses from the CPS (Configuration Property Service).
 * It includes both non-secure properties, secure properties, and binary configuration pointers to test 
 * the UI tabs (Secure, Binaries, Auth) in the Global CPS Manager and individual CPS Manager.
 */

export const mockNonSecureResponse = {
  responses: [
    {
      environment: "uat",
      key: "demo-api-v1",
      properties: {
        "api.host": "https://api.uat.example.com",
        "api.timeout.ms": "5000",
        "api.retry.count": "3",
        "logging.level": "DEBUG",
        "feature.toggle.new_engine": "true",
        
        // This key tells the frontend to fetch the secure group named 'demo-api-v1-secure'
        "cps.secure.properties": "demo-api-v1-secure",
        
        // This key tells the frontend that the following binary keys exist
        "cps.secure.binaries": "keystore.jks, truststore.p12, client-cert.pem"
      }
    }
  ]
};

export const mockSecureResponse = {
  responses: [
    {
      environment: "uat",
      key: "demo-api-v1-secure",
      properties: {
        "api.client_secret": "******************",
        "db.password": "******************",
        "salesforce.token": "******************"
      }
    }
  ]
};

export const mockCsvData = `businessGroup,environment,chVersion,appId,appName,cpsBaseUrl,cpsClientId,cpsClientSecret,cpsEnv,cpsKey
Example BG,uat,ch1,123456,demo-api-v1,https://cps-server-uat.internalapi.sfdcbt.net,mock-client-id,mock-client-secret,uat,demo-api-v1
`;
