// src/types.ts
// Shared data shapes stored in Devvit KVStore

export interface MemberRecord {
  username: string;
  joinedAt: number;           // unix timestamp ms
  welcomeSentAt: number | null;
  firstPostAt: number | null;
  firstPostId: string | null;
  firstPostSuccess: boolean;  // true = live, false = removed on first attempt
  removalCoachingSentAt: number | null;
  repostAttemptAt: number | null;
}

export interface SubredditConfig {
  welcomeEnabled: boolean;
  coachingEnabled: boolean;
  removalDmEnabled: boolean;
  // Mods pick their top-3 most-broken rules (plain text, set from dashboard)
  topBrokenRules: string[];
  // Optional custom welcome message suffix
  customWelcomeSuffix: string;
}

export interface SubredditStats {
  totalNewMembers: number;      // tracked since install
  successfulFirstPosts: number; // first post NOT removed
  removedFirstPosts: number;    // first post removed
  repostsAfterCoaching: number; // user reposted after DM coaching
}

// KVStore key helpers — keeps keys consistent and collision-free
export const Keys = {
  member: (username: string) => `member:${username}`,
  config: () => `config:v1`,
  stats: () => `stats:v1`,
  // set of usernames that joined but haven't posted yet (for dashboard)
  pendingPosters: () => `pending_posters:v1`,
};
