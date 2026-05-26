// src/messages/welcome.ts
// Builds the personalised welcome DM sent to new members.

interface WelcomeDMOptions {
  username: string;
  subredditName: string;
  topBrokenRules: string[];
  customSuffix: string;
}

export function buildWelcomeDM(opts: WelcomeDMOptions): string {
  const { username, subredditName, topBrokenRules, customSuffix } = opts;

  const rulesSection =
    topBrokenRules.length > 0
      ? topBrokenRules
          .map((rule, i) => `**${i + 1}.** ${rule}`)
          .join('\n\n')
      : '_Your mod team has not configured specific rules yet._';

  const suffix = customSuffix
    ? `\n\n---\n${customSuffix}`
    : '\n\nWe hope you enjoy being part of the community. Happy posting! 🎉';

  return `Hey u/${username} — welcome to r/${subredditName}! 👋

We're really glad you joined. Before you make your first post, here are the **${topBrokenRules.length || 'top'} rules new members accidentally break** — knowing these will save you a lot of frustration:

${rulesSection}

**Tip:** Always check the sidebar or pinned posts for the full rules before posting. If your post is removed, don't worry — just read the removal reason and try again.

If you have any questions, feel free to send a modmail to the team at r/${subredditName}.
${suffix}

*— The r/${subredditName} Mod Team (via ModScout)*`;
}
