// Remembers when we last switched LaunchDarkly contexts, so the flag-change
// listener can tell "a flag was changed in LaunchDarkly" apart from
// "we signed in as someone else and they get different variations".
let lastIdentifyAt = 0;
export const markIdentify = () => { lastIdentifyAt = Date.now(); };
export const recentlyIdentified = (ms = 2000) => Date.now() - lastIdentifyAt < ms;
