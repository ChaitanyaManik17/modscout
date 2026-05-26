// src/triggers/onPostRemove.ts
// Fires when a post is removed by a moderator or automod.
// If it's a tracked new member's first post: send a coaching DM
// explaining exactly why it was removed and how to repost correctly.

import { TriggerContext } from '@devvit/public-api';
import { getMember, setMember, getConfig, incrementStat } from '../store.js';
import { buildRemovalCoachingDM } from '../messages/removalCoaching.js';

export async function handlePostRemove(
  event: {
    post?: {
      id?: string;
      title?: string;
      authorName?: string;
      removedBy?: string;
    };
    targetPost?: {
      id?: string;
      title?: string;
      authorName?: string;
    };
    moderatorAction?: {
      actionType?: string;
      details?: string;
    };
  },
  ctx: TriggerContext
): Promise<void> {
  const { kvStore, reddit } = ctx;

  const post = event.post ?? event.targetPost;
  const username = post?.authorName;
  const postId = post?.id;
  const removalReason = event.moderatorAction?.details ?? '';

  if (!username || username === '[deleted]' || !postId) return;

  const member = await getMember(kvStore, username);
  if (!member) return; // Not a tracked new member

  // Only send coaching DM for their first post
  if (member.firstPostId !== postId && member.firstPostAt !== null) {
    // This is not their first post — skip
    return;
  }

  const config = await getConfig(kvStore);

  // Mark first post as not successful
  member.firstPostSuccess = false;
  await setMember(kvStore, member);
  await incrementStat(kvStore, 'removedFirstPosts');

  if (!config.removalDmEnabled) return;

  // Don't double-send
  if (member.removalCoachingSentAt !== null) return;

  try {
    const subreddit = await reddit.getCurrentSubreddit();
    const subject = `Your post in r/${subreddit.name} was removed — here's how to fix it`;
    const body = buildRemovalCoachingDM({
      username,
      subredditName: subreddit.name,
      postTitle: post?.title ?? 'your post',
      removalReason,
      topBrokenRules: config.topBrokenRules,
    });

    await reddit.sendPrivateMessage({
      to: username,
      subject,
      text: body,
    });

    // Record that coaching was sent
    member.removalCoachingSentAt = Date.now();
    await setMember(kvStore, member);

    console.log(`[ModScout] Removal coaching DM sent to u/${username}`);
  } catch (err) {
    console.error(
      `[ModScout] Failed to send removal coaching DM to u/${username}:`,
      err
    );
  }
}
