import farcaster from './farcaster.js';
import twitter from './twitter.js';
import linkedin from './linkedin.js';
import threads from './threads.js';
import instagram from './instagram.js';

const adapters = {
  farcaster,
  twitter,
  linkedin,
  threads,
  instagram,
};

export function getAdapter(type) {
  const adapter = adapters[type];
  if (!adapter) throw new Error(`Unknown platform type: ${type}`);
  return adapter;
}

export function getAllAdapters() {
  return { ...adapters };
}

export function getSupportedTypes() {
  return Object.keys(adapters);
}
