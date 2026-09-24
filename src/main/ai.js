// Picks the assistant backend from settings: Claude Code (no API key) or the Anthropic API.
const store = require('./store');
const apiChat = require('./apiChat');
const claudeCode = require('./claudeCode');
const { runTool } = require('./tools');

const backend = () => (store.get().settings.provider === 'api' ? apiChat : claudeCode);

module.exports = {
  chat: (text, emit) => backend().chat(text, emit),
  reset: () => { apiChat.reset(); claudeCode.reset(); },
  stop: () => claudeCode.stop(),
  runTool,
};
