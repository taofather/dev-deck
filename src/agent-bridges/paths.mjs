// Folders shared by the agent drivers. Node only (agent-bridge.mjs), never imported by the browser bundle.
import { resolve } from 'node:path';

// The dev-deck itself (this file is src/agent-bridges/paths.mjs).
export const DECK_ROOT = resolve(import.meta.dirname, '../..');
// Sessions run and resume here. Defaults to the folder above dev-deck.
export const AGENT_ROOT = resolve(DECK_ROOT, process.env.AGENT_ROOT || '..');
