// Pure helper for rename propagation: merges live league names (from the status call) into the
// saved list. Returns the new list and the codes whose name changed. No DOM, so it can be tested in Node.
export function applyLiveNames(saved, liveByCode) {
  const changedCodes = [];
  const list = saved.map((x) => {
    const name = liveByCode[x.code];
    if (name && name !== x.name) { changedCodes.push(x.code); return { ...x, name }; }
    return x;
  });
  return { list, changedCodes };
}
