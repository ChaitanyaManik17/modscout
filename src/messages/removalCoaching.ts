// src/messages/removalCoaching.ts
// Builds the coaching DM sent when a new member's first post is removed.

interface RemovalCoachingDMOptions {
  username: string;
  subredditName: string;
  postTitle: string;
  removalReason: string;
  topBrokenRules: string[];
}

export function buildRemovalCoachingDM(opts: RemovalCoachingDMOptions): string {
  const { username, subredditName, postTitle, removalReason, topBrokenRules } =
    opts;

  const reasonSection = removalReason
    ? `The removal reason given was:\n\n> ${removalReason}`
    : `The mod team removed it for not meeting the community guidelines.`;

  const rulesSection =
    topBrokenRules.length > 0
      ? topBrokenRules.map((rule) => `• ${rule}`).join('\n')
      : '• Check the sidebar for the full rules.';

  return `Hey u/${username},

Your post **"${postTitle}"** in r/${subredditName} was removed. This happens to almost everyone when they're new — it's not a ban or a strike against you.

${reasonSection}

**The top rules to double-check before reposting:**

${rulesSection}

**Ready to try again?** Just head back to [r/${subredditName}](https://www.reddit.com/r/${subredditName}) and submit a revised version. Most posts that get fixed get approved.

If you think the removal was a mistake, you can [message the mod team](https://www.reddit.com/message/compose?to=/r/${subredditName}) to appeal.

We want to see you post successfully — good luck! 💪

*— r/${subredditName} Mod Team via ModScout*`;
}
