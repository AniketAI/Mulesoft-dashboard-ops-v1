/**
 * Shared HTTP response helpers.
 *
 * Every route that proxies Anypoint Platform API calls uses the same catch-block
 * pattern.  Centralising it here ensures consistent error shapes across all
 * endpoints and makes the route handlers easier to read.
 */

/**
 * Send a standardised error response for a failed Anypoint proxy call.
 *
 * Behaviour:
 *  - Uses the upstream HTTP status when available, otherwise 500.
 *  - Uses the upstream error message when available, otherwise `fallbackMessage`.
 *  - Writes a console.error line so the log always shows what failed.
 *
 * @param {import('express').Response} res
 * @param {Error & { response?: { status?: number, data?: any } }} error
 * @param {string} fallbackMessage  Human-readable fallback shown to the client.
 */
const sendProxyError = (res, error, fallbackMessage) => {
  const status = error.response?.status || 500;
  const message = error.response?.data?.message || fallbackMessage;
  console.error(fallbackMessage + ':', error.response?.data || error.message);
  res.status(status).json({ error: message });
};

module.exports = { sendProxyError };