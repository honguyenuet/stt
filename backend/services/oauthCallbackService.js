async function executeOAuthCallback(action, onFailure) {
  try {
    return await action();
  } catch (error) {
    return await onFailure(error);
  }
}

module.exports = {
  executeOAuthCallback,
};
