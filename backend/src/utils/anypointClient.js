const axios = require('axios');

const ANYPOINT_URL = process.env.ANYPOINT_PLATFORM_URL || 'https://anypoint.mulesoft.com';

const createClient = (token) => {
  return axios.create({
    baseURL: ANYPOINT_URL,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });
};

module.exports = { createClient, ANYPOINT_URL };