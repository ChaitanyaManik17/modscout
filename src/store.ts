// src/store.ts
// Typed helpers around Devvit KVStore so the rest of the app never touches raw strings.

import { KVStore } from '@devvit/public-api';
import {
  MemberRecord,
  SubredditConfig,
  SubredditStats,
  Keys,
} from './types.js';

// ── Default values ────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: SubredditConfig = {
  welcomeEnabled: true,
  coachingEnabled: true,
  removalDmEnabled: true,
  topBrokenRules: [
    'Read the subreddit rules before posting.',
    'Use the correct post flair.',
    'Search before posting to avoid duplicates.',
  ],
  customWelcomeSuffix: '',
};

export const DEFAULT_STATS: SubredditStats = {
  totalNewMembers: 0,
  successfulFirstPosts: 0,
  removedFirstPosts: 0,
  repostsAfterCoaching: 0,
};

// ── Member helpers ────────────────────────────────────────────────────────────

export async function getMember(
  kv: KVStore,
  username: string
): Promise<MemberRecord | null> {
  try {
    const raw = await kv.get(Keys.member(username));
    return raw ? (JSON.parse(raw as string) as MemberRecord) : null;
  } catch {
    return null;
  }
}

export async function setMember(
  kv: KVStore,
  record: MemberRecord
): Promise<void> {
  await kv.put(Keys.member(record.username), JSON.stringify(record));
}

export async function createMember(
  kv: KVStore,
  username: string
): Promise<MemberRecord> {
  const record: MemberRecord = {
    username,
    joinedAt: Date.now(),
    welcomeSentAt: null,
    firstPostAt: null,
    firstPostId: null,
    firstPostSuccess: false,
    removalCoachingSentAt: null,
    repostAttemptAt: null,
  };
  await setMember(kv, record);
  return record;
}

// ── Config helpers ────────────────────────────────────────────────────────────

export async function getConfig(kv: KVStore): Promise<SubredditConfig> {
  try {
    const raw = await kv.get(Keys.config());
    return raw ? (JSON.parse(raw as string) as SubredditConfig) : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function setConfig(
  kv: KVStore,
  config: SubredditConfig
): Promise<void> {
  await kv.put(Keys.config(), JSON.stringify(config));
}

// ── Stats helpers ─────────────────────────────────────────────────────────────

export async function getStats(kv: KVStore): Promise<SubredditStats> {
  try {
    const raw = await kv.get(Keys.stats());
    return raw ? (JSON.parse(raw as string) as SubredditStats) : DEFAULT_STATS;
  } catch {
    return DEFAULT_STATS;
  }
}

export async function incrementStat(
  kv: KVStore,
  field: keyof SubredditStats
): Promise<void> {
  const stats = await getStats(kv);
  stats[field] = (stats[field] as number) + 1;
  await kv.put(Keys.stats(), JSON.stringify(stats));
}

// ── Pending posters set (members who joined but haven't posted) ───────────────

export async function addPendingPoster(
  kv: KVStore,
  username: string
): Promise<void> {
  const raw = await kv.get(Keys.pendingPosters());
  const set: string[] = raw ? JSON.parse(raw as string) : [];
  if (!set.includes(username)) {
    set.push(username);
    // Keep the list bounded — store only the most recent 50 pending posters
    const bounded = set.slice(-50);
    await kv.put(Keys.pendingPosters(), JSON.stringify(bounded));
  }
}

export async function removePendingPoster(
  kv: KVStore,
  username: string
): Promise<void> {
  const raw = await kv.get(Keys.pendingPosters());
  if (!raw) return;
  const set: string[] = JSON.parse(raw as string);
  const filtered = set.filter((u) => u !== username);
  await kv.put(Keys.pendingPosters(), JSON.stringify(filtered));
}

export async function getPendingPosters(kv: KVStore): Promise<string[]> {
  const raw = await kv.get(Keys.pendingPosters());
  return raw ? (JSON.parse(raw as string) as string[]) : [];
}
