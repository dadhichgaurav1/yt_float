// Runs in the page's own world (contextIsolation off) in the sign-in window only.
// Firefox has no navigator.userAgentData; hide Chromium's so it matches the Firefox UA.
Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined, configurable: true });
