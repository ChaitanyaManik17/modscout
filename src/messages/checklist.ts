// src/messages/checklist.ts
// Builds the distinguished comment posted on a new member's first post.

interface ChecklistCommentOptions {
  username: string;
  subredditName: string;
  topBrokenRules: string[];
}

export function buildChecklistComment(opts: ChecklistCommentOptions): string {
  const { username, subredditName, topBrokenRules } = opts;

  const checklist =
    topBrokenRules.length > 0
      ? topBrokenRules
          .map((rule) => `- ☐ ${rule}`)
          .join('\n')
      : '- ☐ Read the subreddit rules before posting.';

  return `👋 **Welcome to your first post, u/${username}!**

*This is an automated reminder from the r/${subredditName} mod team.*

Before this post goes live, here's a quick checklist of the **most common reasons posts get removed**. If you've already checked these off, you're good — no action needed!

${checklist}

If your post gets removed, don't panic — you'll receive a message explaining why and how to fix it. Most issues are easy to sort out.

Questions? [Send us a modmail](https://www.reddit.com/message/compose?to=/r/${subredditName}).

*— r/${subredditName} Mod Team via ModScout*`;
}
