// src/triggers/onMemberJoin.ts
// Fires when a new user subscribes to the subreddit.
// Sends a personalised welcome DM and records the member in KVStore.

import { TriggerContext } from '@devvit/public-api';
import { createMember, addPendingPoster, getConfig, incrementStat } from '../store.js';
import { buildWelcomeDM } from '../messages/welcome.js';

export async function handleNewMember(
  event: { author?: { name?: string } },
  ctx: TriggerContext
): Promise<void> {
  const { kvStore, reddit } = ctx;

  const username = event.author?.name;
  if (!username || username === '[deleted]') return;

  const config = await getConfig(kvStore);

  // Record the new member
  await createMember(kvStore, username);
  await addPendingPoster(kvStore, username);
  await incrementStat(kvStore, 'totalNewMembers');

  if (!config.welcomeEnabled) return;

  try {
    const subreddit = await reddit.getCurrentSubreddit();
    const subject = `Welcome to r/${subreddit.name}! 🎉 A quick guide before you post`;
    const body = buildWelcomeDM({
      username,
      subredditName: subreddit.name,
      topBrokenRules: config.topBrokenRules,
      customSuffix: config.customWelcomeSuffix,
    });

    await reddit.sendPrivateMessage({
      to: username,
      subject,
      text: body,
    });

    // Mark welcome as sent
    const memberRaw = await kvStore.get(`member:${username}`);
    if (memberRaw) {
      const member = JSON.parse(memberRaw as string);
      member.welcomeSentAt = Date.now();
      await kvStore.put(`member:${username}`, JSON.stringify(member));
    }

    console.log(`[ModScout] Welcome DM sent to u/${username}`);
  } catch (err) {
    // Don't crash the trigger if DM fails (user may have DMs disabled)
    console.error(`[ModScout] Failed to send welcome DM to u/${username}:`, err);
  }
}
