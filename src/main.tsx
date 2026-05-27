import { Devvit, useState, useAsync } from '@devvit/public-api';

Devvit.configure({
  redditAPI: true,
  kvStore: true,
  scheduler: true,
});

Devvit.addSettings([
  {
    name: 'welcomeEnabled',
    label: 'Send welcome DM to new members',
    type: 'boolean',
    defaultValue: true,
    scope: 'installation',
  },
  {
    name: 'coachingEnabled',
    label: 'Show checklist comment on first post',
    type: 'boolean',
    defaultValue: true,
    scope: 'installation',
  },
  {
    name: 'removalDmEnabled',
    label: 'Send coaching DM when first post is removed',
    type: 'boolean',
    defaultValue: true,
    scope: 'installation',
  },
]);

Devvit.addTrigger({
  event: 'PostSubmit',
  onEvent: async (event, ctx) => {
    const { kvStore, reddit } = ctx;
    const username = event.post?.authorName;
    const postId = event.post?.id;
    if (!username || !postId || username === '[deleted]') return;

    const memberRaw = await kvStore.get(`member:${username}`);
    let isNewMember = !!memberRaw;

    if (!isNewMember && event.author?.createdAt) {
      const ageMs = Date.now() - (event.author.createdAt * 1000);
      isNewMember = ageMs < 30 * 24 * 60 * 60 * 1000;
      if (isNewMember) {
        const record = {
          username, joinedAt: event.author.createdAt * 1000,
          welcomeSentAt: null, firstPostAt: null, firstPostId: null,
          firstPostSuccess: false, removalCoachingSentAt: null, repostAttemptAt: null,
        };
        await kvStore.put(`member:${username}`, JSON.stringify(record));
        const pendingRaw = await kvStore.get('pending_posters:v1');
        const pending: string[] = pendingRaw ? JSON.parse(pendingRaw as string) : [];
        if (!pending.includes(username)) {
          pending.push(username);
          await kvStore.put('pending_posters:v1', JSON.stringify(pending.slice(-50)));
        }
        const statsRaw = await kvStore.get('stats:v1');
        const stats = statsRaw ? JSON.parse(statsRaw as string) : { totalNewMembers: 0, successfulFirstPosts: 0, removedFirstPosts: 0, repostsAfterCoaching: 0 };
        stats.totalNewMembers = (stats.totalNewMembers || 0) + 1;
        await kvStore.put('stats:v1', JSON.stringify(stats));
      }
    }

    if (!isNewMember) return;
    const raw = memberRaw ? JSON.parse(memberRaw as string) : null;
    if (raw?.firstPostAt) return;

    const updated = raw || { username, joinedAt: Date.now(), welcomeSentAt: null, firstPostId: null, firstPostSuccess: false, removalCoachingSentAt: null, repostAttemptAt: null };
    updated.firstPostAt = Date.now();
    updated.firstPostId = postId;
    updated.firstPostSuccess = true;
    await kvStore.put(`member:${username}`, JSON.stringify(updated));

    const pendingRaw2 = await kvStore.get('pending_posters:v1');
    if (pendingRaw2) {
      const pending2: string[] = JSON.parse(pendingRaw2 as string);
      await kvStore.put('pending_posters:v1', JSON.stringify(pending2.filter((u: string) => u !== username)));
    }

    const statsRaw2 = await kvStore.get('stats:v1');
    const stats2 = statsRaw2 ? JSON.parse(statsRaw2 as string) : { totalNewMembers: 0, successfulFirstPosts: 0, removedFirstPosts: 0, repostsAfterCoaching: 0 };
    stats2.successfulFirstPosts = (stats2.successfulFirstPosts || 0) + 1;
    await kvStore.put('stats:v1', JSON.stringify(stats2));

    const configRaw = await kvStore.get('config:v1');
    const config = configRaw ? JSON.parse(configRaw as string) : null;
    if (config?.coachingEnabled === false) return;

    try {
      const subreddit = await reddit.getCurrentSubreddit();
      const rules: string[] = config?.topBrokenRules || ['Read the subreddit rules.', 'Use the correct flair.', 'Search before posting.'];
      const checklist = rules.map((r: string) => `- ☐ ${r}`).join('\n');
      const comment = await reddit.submitComment({
        id: `t3_${postId}`,
        text: `👋 **Welcome to your first post, u/${username}!**\n\n*Quick checklist from the mod team:*\n\n${checklist}\n\n*If your post gets removed, you will receive a message explaining why. — ModScout*`,
      });
      await comment.distinguish(true);
    } catch (e) {
      console.error('[ModScout] Checklist comment failed:', e);
    }
  },
});

Devvit.addTrigger({
  event: 'PostDelete',
  onEvent: async (event, ctx) => {
    const { kvStore, reddit } = ctx;
    const username = event.post?.authorName;
    const postId = event.post?.id;
    if (!username || !postId || username === '[deleted]') return;

    const memberRaw = await kvStore.get(`member:${username}`);
    if (!memberRaw) return;
    const member = JSON.parse(memberRaw as string);
    if (member.firstPostId !== postId) return;
    if (member.removalCoachingSentAt) return;

    member.firstPostSuccess = false;
    await kvStore.put(`member:${username}`, JSON.stringify(member));

    const statsRaw = await kvStore.get('stats:v1');
    const stats = statsRaw ? JSON.parse(statsRaw as string) : { totalNewMembers: 0, successfulFirstPosts: 0, removedFirstPosts: 0, repostsAfterCoaching: 0 };
    stats.successfulFirstPosts = Math.max(0, (stats.successfulFirstPosts || 1) - 1);
    stats.removedFirstPosts = (stats.removedFirstPosts || 0) + 1;
    await kvStore.put('stats:v1', JSON.stringify(stats));

    const configRaw = await kvStore.get('config:v1');
    const config = configRaw ? JSON.parse(configRaw as string) : null;
    if (config?.removalDmEnabled === false) return;

    try {
      const subreddit = await reddit.getCurrentSubreddit();
      const rules: string[] = config?.topBrokenRules || ['Read the subreddit rules.', 'Use the correct flair.', 'Search before posting.'];
      const rulesList = rules.map((r: string) => `• ${r}`).join('\n');
      await reddit.sendPrivateMessage({
        to: username,
        subject: `Your post in r/${subreddit.name} was removed — here is how to fix it`,
        text: `Hey u/${username},\n\nYour post in r/${subreddit.name} was removed. This is not a ban — just fix the issue and repost.\n\n**Check these rules:**\n\n${rulesList}\n\nQuestions? [Message the mod team](https://www.reddit.com/message/compose?to=/r/${subreddit.name}).\n\n*— ModScout*`,
      });
      member.removalCoachingSentAt = Date.now();
      await kvStore.put(`member:${username}`, JSON.stringify(member));
    } catch (e) {
      console.error('[ModScout] Removal DM failed:', e);
    }
  },
});

Devvit.addSchedulerJob({
  name: 'modscout_daily_cleanup',
  onRun: async (_event, ctx) => {
    const { kvStore } = ctx;
    const raw = await kvStore.get('pending_posters:v1');
    if (!raw) return;
    const pending: string[] = JSON.parse(raw as string);
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const stillPending: string[] = [];
    for (const username of pending) {
      const memberRaw = await kvStore.get(`member:${username}`);
      if (!memberRaw) continue;
      const member = JSON.parse(memberRaw as string);
      if (member.joinedAt > cutoff) stillPending.push(username);
    }
    await kvStore.put('pending_posters:v1', JSON.stringify(stillPending));
  },
});

const configForm = Devvit.createForm(
  {
    title: 'ModScout Configuration',
    fields: [
      { name: 'welcomeEnabled', label: 'Send welcome DM to new members', type: 'boolean', defaultValue: true },
      { name: 'coachingEnabled', label: 'Show checklist comment on first post', type: 'boolean', defaultValue: true },
      { name: 'removalDmEnabled', label: 'Send coaching DM when first post is removed', type: 'boolean', defaultValue: true },
      { name: 'rule1', label: 'Most-broken rule #1', type: 'string', defaultValue: 'Read the subreddit rules before posting.' },
      { name: 'rule2', label: 'Most-broken rule #2', type: 'string', defaultValue: 'Use the correct post flair.' },
      { name: 'rule3', label: 'Most-broken rule #3', type: 'string', defaultValue: 'Search before posting to avoid duplicates.' },
      { name: 'customWelcomeSuffix', label: 'Custom welcome message (optional)', type: 'string', defaultValue: '' },
    ],
  },
  async (values, ctx) => {
    const config = {
      welcomeEnabled: Boolean(values.welcomeEnabled),
      coachingEnabled: Boolean(values.coachingEnabled),
      removalDmEnabled: Boolean(values.removalDmEnabled),
      topBrokenRules: [
        String(values.rule1 || ''),
        String(values.rule2 || ''),
        String(values.rule3 || ''),
      ].filter(Boolean),
      customWelcomeSuffix: String(values.customWelcomeSuffix || ''),
    };
    await ctx.kvStore.put('config:v1', JSON.stringify(config));
    ctx.ui.showToast({ text: 'ModScout settings saved!', appearance: 'success' });
  }
);

Devvit.addMenuItem({
  label: '⚙️ ModScout Settings',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, ctx) => {
    ctx.ui.showForm(configForm);
  },
});

Devvit.addMenuItem({
  label: '📊 ModScout Dashboard',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, ctx) => {
    const { reddit, ui } = ctx;
    const subreddit = await reddit.getCurrentSubreddit();
    const post = await reddit.submitPost({
      title: '📊 ModScout — New Member Health Dashboard',
      subredditName: subreddit.name,
      preview: (
        <vstack alignment="center middle" grow>
          <text size="large" weight="bold">📊 ModScout</text>
          <text size="small" color="neutral-content-weak">Loading dashboard...</text>
        </vstack>
      ),
    });
    ui.showToast({ text: 'Dashboard created!', appearance: 'success' });
    ui.navigateTo(post);
  },
});

Devvit.addCustomPostType({
  name: 'ModScout Dashboard',
  description: 'Live new-member health dashboard',
  height: 'tall',
  render: (ctx) => {

    const { data: stats, loading: statsLoading, error: statsError } = useAsync(async () => {
      const raw = await ctx.kvStore.get('stats:v1');
      return raw
        ? JSON.parse(raw as string)
        : { totalNewMembers: 0, successfulFirstPosts: 0, removedFirstPosts: 0, repostsAfterCoaching: 0 };
    });

    const { data: pending, loading: pendingLoading } = useAsync(async () => {
      const raw = await ctx.kvStore.get('pending_posters:v1');
      return raw ? (JSON.parse(raw as string) as string[]) : [];
    });

    if (statsLoading || pendingLoading) {
      return (
        <vstack alignment="center middle" grow backgroundColor="neutral-background">
          <text size="xlarge" weight="bold">📊 ModScout</text>
          <spacer size="small" />
          <text color="neutral-content-weak">Loading stats...</text>
        </vstack>
      );
    }

    if (statsError) {
      return (
        <vstack alignment="center middle" grow backgroundColor="neutral-background">
          <text size="large" weight="bold">📊 ModScout</text>
          <spacer size="small" />
          <text color="neutral-content-weak">Could not load stats. Try refreshing.</text>
        </vstack>
      );
    }

    const total: number = stats?.totalNewMembers ?? 0;
    const success: number = stats?.successfulFirstPosts ?? 0;
    const removed: number = stats?.removedFirstPosts ?? 0;
    const reposted: number = stats?.repostsAfterCoaching ?? 0;
    const pendingList: string[] = pending ?? [];

    const successRate = total > 0 ? `${Math.round((success / total) * 100)}%` : '0%';
    const removalRate = total > 0 ? `${Math.round((removed / total) * 100)}%` : '0%';
    const repostRate = removed > 0 ? `${Math.round((reposted / removed) * 100)}%` : '0%';

    return (
      <vstack grow padding="medium" gap="medium" backgroundColor="neutral-background">

        <hstack alignment="middle">
          <text size="xlarge" weight="bold">📊 ModScout Dashboard</text>
          <spacer grow />
          <text size="xsmall" color="neutral-content-weak">Mod-only</text>
        </hstack>

        <hstack gap="small" grow>
          <vstack grow alignment="center middle" backgroundColor="neutral-background-strong" cornerRadius="medium" padding="small" gap="xsmall">
            <text size="xlarge" weight="bold">{String(total)}</text>
            <text size="xsmall" color="neutral-content-weak">New Members</text>
          </vstack>
          <vstack grow alignment="center middle" backgroundColor="neutral-background-strong" cornerRadius="medium" padding="small" gap="xsmall">
            <text size="xlarge" weight="bold">{successRate}</text>
            <text size="xsmall" color="neutral-content-weak">Success Rate</text>
          </vstack>
          <vstack grow alignment="center middle" backgroundColor="neutral-background-strong" cornerRadius="medium" padding="small" gap="xsmall">
            <text size="xlarge" weight="bold">{removalRate}</text>
            <text size="xsmall" color="neutral-content-weak">Removal Rate</text>
          </vstack>
          <vstack grow alignment="center middle" backgroundColor="neutral-background-strong" cornerRadius="medium" padding="small" gap="xsmall">
            <text size="xlarge" weight="bold">{repostRate}</text>
            <text size="xsmall" color="neutral-content-weak">Reposted</text>
          </vstack>
        </hstack>

        <vstack backgroundColor="neutral-background-strong" cornerRadius="medium" padding="small" gap="small" grow>
          <hstack alignment="middle">
            <text weight="bold">⏳ Haven't Posted Yet</text>
            <spacer grow />
            <text size="xsmall" color="neutral-content-weak">{String(pendingList.length)} members</text>
          </hstack>
          {pendingList.length === 0 ? (
            <text color="neutral-content-weak">🎉 All new members have posted!</text>
          ) : (
            <vstack gap="xsmall">
              {pendingList.slice(0, 6).map((u: string) => (
                <hstack key={u} backgroundColor="neutral-background" cornerRadius="small" padding="xsmall" gap="small" alignment="middle">
                  <text size="small">👤 u/{u}</text>
                </hstack>
              ))}
              {pendingList.length > 6 && (
                <text size="xsmall" color="neutral-content-weak">+ {String(pendingList.length - 6)} more</text>
              )}
            </vstack>
          )}
        </vstack>

        <text size="xsmall" color="neutral-content-weak" alignment="center">
          ModScout · Tracks new members since install
        </text>

      </vstack>
    );
  },
});

export default Devvit;
