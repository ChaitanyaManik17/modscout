// src/triggers/onPostCreate.ts
// Fires on every new post submission.
// For new members (account age < 30 days OR tracked in KVStore):
//   - Removes them from the "pending posters" list
//   - Adds a friendly mod-comment with a rule checklist
//   - Records their first post

import { TriggerContext } from '@devvit/public-api';
import {
  getMember,
  setMember,
  removePendingPoster,
  getConfig,
} from '../store.js';
import { buildChecklistComment } from '../messages/checklist.js';

// Account age threshold in milliseconds (30 days)
const NEW_MEMBER_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export async function handlePostCreate(
  event: {
    post?: { id?: string; title?: string; authorName?: string };
    author?: { name?: string; createdAt?: number };
  },
  ctx: TriggerContext
): Promise<void> {
  const { kvStore, reddit } = ctx;

  const username = event.author?.name ?? event.post?.authorName;
  const postId = event.post?.id;

  if (!username || username === '[deleted]' || !postId) return;

  const config = await getConfig(kvStore);

  // Check if this user is a tracked new member
  let member = await getMember(kvStore, username);

  // Also catch new members we haven't seen via subscription event
  // (Reddit doesn't always fire subscription events reliably)
  if (!member && event.author?.createdAt) {
    const accountAge = Date.now() - event.author.createdAt * 1000;
    if (accountAge < NEW_MEMBER_WINDOW_MS) {
      // Treat as a new member
      member = {
        username,
        joinedAt: event.author.createdAt * 1000,
        welcomeSentAt: null,
        firstPostAt: null,
        firstPostId: null,
        firstPostSuccess: false,
        removalCoachingSentAt: null,
        repostAttemptAt: null,
      };
    }
  }

  if (!member) return; // Not a new member we're tracking

  // Only act on their FIRST post
  const isFirstPost = member.firstPostAt === null;

  // Mark the first post regardless
  if (isFirstPost) {
    member.firstPostAt = Date.now();
    member.firstPostId = postId;
    member.firstPostSuccess = true; // Optimistically true until removed
    await setMember(kvStore, member);
    await removePendingPoster(kvStore, username);
  } else if (
    member.removalCoachingSentAt !== null &&
    member.repostAttemptAt === null
  ) {
    // This is a repost after coaching — mark it
    member.repostAttemptAt = Date.now();
    await setMember(kvStore, member);

    // Update stats
    const statsRaw = await kvStore.get('stats:v1');
    if (statsRaw) {
      const stats = JSON.parse(statsRaw as string);
      stats.repostsAfterCoaching = (stats.repostsAfterCoaching || 0) + 1;
      await kvStore.put('stats:v1', JSON.stringify(stats));
    }
  }

  if (!isFirstPost || !config.coachingEnabled) return;

  // Post a friendly checklist comment on the new member's first post
  try {
    const subreddit = await reddit.getCurrentSubreddit();
    const commentBody = buildChecklistComment({
      username,
      subredditName: subreddit.name,
      topBrokenRules: config.topBrokenRules,
    });

    const comment = await reddit.submitComment({
      id: `t3_${postId}`,
      text: commentBody,
    });

    // Distinguish the comment so it stands out as official
    await comment.distinguish(true);

    console.log(`[ModScout] Checklist comment posted on first post by u/${username}`);
  } catch (err) {
    console.error(`[ModScout] Failed to post checklist comment for u/${username}:`, err);
  }
}
