const assert = require('node:assert/strict');
const test = require('node:test');

const {
  executeOAuthCallback,
} = require('../services/oauthCallbackService');

test('OAuth callback handles an asynchronous account rejection', async () => {
  const accountError = new Error('Tài khoản đã bị khóa.');
  accountError.oauthCode = 'account_blocked';
  let handledCode = '';

  const result = await executeOAuthCallback(
    async () => {
      throw accountError;
    },
    async (error) => {
      handledCode = error.oauthCode;
      return 'redirected';
    },
  );

  assert.equal(result, 'redirected');
  assert.equal(handledCode, 'account_blocked');
});

test('OAuth callback returns a successful login result unchanged', async () => {
  const result = await executeOAuthCallback(
    async () => 'logged-in',
    async () => 'failed',
  );

  assert.equal(result, 'logged-in');
});

test('OAuth callback exposes a failure-handler rejection to Express', async () => {
  const callbackError = new Error('OAuth callback failed.');
  const handlerError = new Error('Failure redirect failed.');

  await assert.rejects(
    executeOAuthCallback(
      async () => {
        throw callbackError;
      },
      async () => {
        throw handlerError;
      },
    ),
    handlerError,
  );
});
