// Not MongoDB: Array.prototype.find must NOT be reported.
const items = [{ id: 1, name: 'a' }];

function findItem(id) {
  return items.find((i) => i.id === id);
}

module.exports = { findItem };
