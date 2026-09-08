import * as repo from './repository.js';
export async function getStats() {
  return repo.stats();
}
