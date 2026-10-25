// League rules helpers (v34). Pure functions, no DOM globals, so the mock test can load them in Node.
// The rules text itself comes from the server (GET /api/league-rules, built from server/scoring.js),
// so these helpers only store the seen flag and draw it.

export const RULES_SEEN_KEY = 'stakeless.rulesSeen';

// Per-league acknowledgement, stored as { [code]: true } in localStorage.
function readSeenMap(storage) {
  try {
    const v = JSON.parse(storage.getItem(RULES_SEEN_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch (e) { return {}; }
}

export function hasSeenRules(code, storage) {
  return !!readSeenMap(storage)[String(code)];
}

export function markRulesSeen(code, storage) {
  const map = readSeenMap(storage);
  map[String(code)] = true;
  storage.setItem(RULES_SEEN_KEY, JSON.stringify(map));
}

// Markup for the rules body (used by both the popup and the Settings card). `esc` is the app's HTML escaper.
export function rulesBodyHTML(rules, esc) {
  const items = rules.items.map((it) => `
    <div class="rule-item">
      <h4>${esc(it.heading)}</h4>
      <p>${esc(it.text)}</p>
    </div>`).join('');
  return `<p class="rules-intro">${esc(rules.intro)}</p>${items}<p class="rules-fun">${esc(rules.footer)}</p>`;
}
