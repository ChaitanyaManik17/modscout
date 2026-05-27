import { Devvit, useState, useAsync } from '@devvit/public-api';

Devvit.configure({
  redditAPI: true,
  kvStore: true,
  scheduler: true,
});

Devvit.addSettings([
  { name: 'welcomeEnabled', label: 'Send welcome DM to new members', type: 'boolean', defaultValue: true, scope: 'installation' },
  { name: 'coachingEnabled', label: 'Show checklist comment on first post', type: 'boolean', defaultValue: true, scope: 'installation' },
  { name: 'removalDmEnabled', label: 'Send coaching DM when first post is removed', type: 'boolean', defaultValue: true, scope: 'installation' },
]);

// ── Triggers ──────────────────────────────────────────────────────────────────

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
        await kvStore.put(`member:${username}`, JSON.stringify({
          username, joinedAt: event.author.createdAt * 1000,
          welcomeSentAt: null, firstPostAt: null, firstPostId: null,
          firstPostSuccess: false, removalCoachingSentAt: null,
        }));
        const pendingRaw = await kvStore.get('pending_posters:v1');
        const pending: string[] = pendingRaw ? JSON.parse(pendingRaw as string) : [];
        if (!pending.includes(username)) {
          pending.push(username);
          await kvStore.put('pending_posters:v1', JSON.stringify(pending.slice(-100)));
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

    const updated = raw || { username, joinedAt: Date.now(), welcomeSentAt: null, firstPostId: null, firstPostSuccess: false, removalCoachingSentAt: null };
    updated.firstPostAt = Date.now();
    updated.firstPostId = postId;
    updated.firstPostSuccess = true;
    await kvStore.put(`member:${username}`, JSON.stringify(updated));

    const pendingRaw2 = await kvStore.get('pending_posters:v1');
    if (pendingRaw2) {
      const p2: string[] = JSON.parse(pendingRaw2 as string);
      await kvStore.put('pending_posters:v1', JSON.stringify(p2.filter((u: string) => u !== username)));
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
      const rules: string[] = config?.topBrokenRules || ['Read the subreddit rules before posting.', 'Use the correct post flair.', 'Search before posting to avoid duplicates.'];
      const checklist = rules.map((r: string) => `- ☐ ${r}`).join('\n');
      const comment = await reddit.submitComment({
        id: `t3_${postId}`,
        text: `👋 **Welcome to your first post in r/${subreddit.name}, u/${username}!**\n\n*This is an automated message from the mod team.*\n\n**Quick rule checklist — tick these off before your post goes live:**\n\n${checklist}\n\n✅ If you've checked all of these, you're good to go!\n❌ If your post gets removed, you'll receive a private message explaining exactly why and how to fix it.\n\n*Questions? [Message the mod team](https://www.reddit.com/message/compose?to=/r/${subreddit.name}) anytime. — ModScout*`,
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
    const statsRaw = await kvStore.get('stats:v1');
    const stats = statsRaw ? JSON.parse(statsRaw as string) : { totalNewMembers: 0, successfulFirstPosts: 0, removedFirstPosts: 0, repostsAfterCoaching: 0 };
    stats.successfulFirstPosts = Math.max(0, (stats.successfulFirstPosts || 1) - 1);
    stats.removedFirstPosts = (stats.removedFirstPosts || 0) + 1;
    await kvStore.put('stats:v1', JSON.stringify(stats));

    const configRaw = await kvStore.get('config:v1');
    const config = configRaw ? JSON.parse(configRaw as string) : null;
    if (config?.removalDmEnabled === false) {
      await kvStore.put(`member:${username}`, JSON.stringify(member));
      return;
    }

    try {
      const subreddit = await reddit.getCurrentSubreddit();
      const rules: string[] = config?.topBrokenRules || ['Read the subreddit rules before posting.', 'Use the correct post flair.', 'Search before posting to avoid duplicates.'];
      const rulesList = rules.map((r: string) => `• ${r}`).join('\n');
      await reddit.sendPrivateMessage({
        to: username,
        subject: `Your post in r/${subreddit.name} was removed — here is how to fix it`,
        text: `Hey u/${username},\n\nYour post **"${event.post?.title || 'your post'}"** in r/${subreddit.name} was removed.\n\n**Don't worry — this is not a ban.** It happens to almost everyone when they are new. Here is what to check before reposting:\n\n${rulesList}\n\n**Ready to repost?** Just head to r/${subreddit.name}, fix the issue, and submit again. Most corrected posts get approved!\n\nThink the removal was a mistake? [Message the mod team](https://www.reddit.com/message/compose?to=/r/${subreddit.name}) to appeal.\n\nGood luck — we want to see you post successfully! 💪\n\n*— r/${subreddit.name} Mod Team via ModScout*`,
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
      topBrokenRules: [String(values.rule1 || ''), String(values.rule2 || ''), String(values.rule3 || '')].filter(Boolean),
      customWelcomeSuffix: String(values.customWelcomeSuffix || ''),
    };
    await ctx.kvStore.put('config:v1', JSON.stringify(config));
    ctx.ui.showToast({ text: '✅ ModScout settings saved!', appearance: 'success' });
  }
);

Devvit.addMenuItem({
  label: '⚙️ ModScout Settings',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, ctx) => { ctx.ui.showForm(configForm); },
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
        <vstack alignment="center middle" grow backgroundColor="neutral-background">
          <text size="xlarge" weight="bold">📊 ModScout</text>
          <spacer size="small" />
          <text color="neutral-content-weak">Loading dashboard...</text>
        </vstack>
      ),
    });
    ui.showToast({ text: '📊 Dashboard created!', appearance: 'success' });
    ui.navigateTo(post);
  },
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

Devvit.addCustomPostType({
  name: 'ModScout Dashboard',
  description: 'Live new-member health dashboard',
  height: 'tall',
  render: (ctx) => {
    const [tick, setTick] = useState(0);

    const { data: stats, loading: sl } = useAsync(async () => {
      const raw = await ctx.kvStore.get('stats:v1');
      return raw ? JSON.parse(raw as string) : { totalNewMembers: 0, successfulFirstPosts: 0, removedFirstPosts: 0, repostsAfterCoaching: 0 };
    }, { depends: tick });

    const { data: pending, loading: pl } = useAsync(async () => {
      const raw = await ctx.kvStore.get('pending_posters:v1');
      return raw ? (JSON.parse(raw as string) as string[]) : ([] as string[]);
    }, { depends: tick });

    const { data: config, loading: cl } = useAsync(async () => {
      const raw = await ctx.kvStore.get('config:v1');
      return raw ? JSON.parse(raw as string) : { welcomeEnabled: true, coachingEnabled: true, removalDmEnabled: true };
    }, { depends: tick });

    const isLoading = sl || pl || cl;

    if (isLoading) {
      return (
        <vstack alignment="center middle" grow backgroundColor="neutral-background">
          <text size="xlarge" weight="bold">📊 ModScout</text>
          <spacer size="small"/>
          <text color="neutral-content-weak">Fetching latest data...</text>
        </vstack>
      );
    }

    const total: number = stats?.totalNewMembers ?? 0;
    const success: number = stats?.successfulFirstPosts ?? 0;
    const removed: number = stats?.removedFirstPosts ?? 0;
    const reposted: number = stats?.repostsAfterCoaching ?? 0;
    const pendingList: string[] = pending ?? [];

    const successRate = total > 0 ? `${Math.round((success / total) * 100)}%` : 'N/A';
    const removalRate = total > 0 ? `${Math.round((removed / total) * 100)}%` : 'N/A';
    const repostRate = removed > 0 ? `${Math.round((reposted / removed) * 100)}%` : 'N/A';

    const wOn: boolean = config?.welcomeEnabled ?? true;
    const cOn: boolean = config?.coachingEnabled ?? true;
    const rOn: boolean = config?.removalDmEnabled ?? true;

    return (
      <vstack grow padding="medium" gap="small" backgroundColor="neutral-background">

        {/* ── Header ── */}
        <hstack alignment="middle" gap="small">
          <vstack grow>
            <text size="xlarge" weight="bold">📊 ModScout</text>
            <text size="xsmall" color="neutral-content-weak">New Member Health Dashboard</text>
          </vstack>
          <button
            size="small"
            appearance="secondary"
            onPress={() => setTick((t) => t + 1)}
          >
            🔄 Refresh
          </button>
        </hstack>

        {/* ── Stat cards ── */}
        <hstack gap="small">
          <vstack
            grow alignment="center middle"
            backgroundColor="upvote-background"
            cornerRadius="large"
            padding="medium"
            gap="xsmall"
          >
            <text size="xxlarge" weight="bold" color="upvote">{String(total)}</text>
            <text size="xsmall" color="neutral-content-weak" alignment="center">New Members</text>
          </vstack>

          <vstack
            grow alignment="center middle"
            backgroundColor="success-background"
            cornerRadius="large"
            padding="medium"
            gap="xsmall"
          >
            <text size="xxlarge" weight="bold" color="success-plain">{successRate}</text>
            <text size="xsmall" color="neutral-content-weak" alignment="center">Posted ✅</text>
          </vstack>

          <vstack
            grow alignment="center middle"
            backgroundColor="danger-background"
            cornerRadius="large"
            padding="medium"
            gap="xsmall"
          >
            <text size="xxlarge" weight="bold" color="danger-plain">{removalRate}</text>
            <text size="xsmall" color="neutral-content-weak" alignment="center">Removed ❌</text>
          </vstack>

          <vstack
            grow alignment="center middle"
            backgroundColor="caution-background"
            cornerRadius="large"
            padding="medium"
            gap="xsmall"
          >
            <text size="xxlarge" weight="bold" color="caution-plain">{repostRate}</text>
            <text size="xsmall" color="neutral-content-weak" alignment="center">Reposted 🔁</text>
          </vstack>
        </hstack>

        {/* ── Feature status ── */}
        <hstack
          backgroundColor="neutral-background-strong"
          cornerRadius="large"
          padding="small"
          gap="medium"
          alignment="middle"
        >
          <text size="xsmall" weight="bold" color="neutral-content">Features:</text>
          <hstack gap="xsmall" alignment="middle">
            <text size="xsmall">{wOn ? '🟢' : '🔴'}</text>
            <text size="xsmall" color="neutral-content">Welcome DM</text>
          </hstack>
          <hstack gap="xsmall" alignment="middle">
            <text size="xsmall">{cOn ? '🟢' : '🔴'}</text>
            <text size="xsmall" color="neutral-content">Checklist</text>
          </hstack>
          <hstack gap="xsmall" alignment="middle">
            <text size="xsmall">{rOn ? '🟢' : '🔴'}</text>
            <text size="xsmall" color="neutral-content">Removal DM</text>
          </hstack>
        </hstack>

        {/* ── Pending posters ── */}
        <vstack
          backgroundColor="neutral-background-strong"
          cornerRadius="large"
          padding="medium"
          gap="small"
          grow
        >
          <hstack alignment="middle">
            <text weight="bold" size="medium">⏳ Haven't Posted Yet</text>
            <spacer grow />
            <text
              size="xsmall"
              color="neutral-content-weak"
            >
              {String(pendingList.length)} member{pendingList.length !== 1 ? 's' : ''}
            </text>
          </hstack>

          {pendingList.length === 0 ? (
            <vstack alignment="center middle" grow gap="xsmall">
              <text size="large">🎉</text>
              <text color="neutral-content-weak" size="small">All new members have posted!</text>
            </vstack>
          ) : (
            <vstack gap="xsmall">
              {pendingList.slice(0, 5).map((u: string) => (
                <hstack
                  key={u}
                  backgroundColor="neutral-background"
                  cornerRadius="medium"
                  padding="small"
                  gap="small"
                  alignment="middle"
                >
                  <text size="medium">👤</text>
                  <vstack grow>
                    <text size="small" weight="bold">u/{u}</text>
                    <text size="xsmall" color="neutral-content-weak">Joined · hasn't posted yet</text>
                  </vstack>
                  <text size="xsmall" color="caution-plain">Reach out →</text>
                </hstack>
              ))}
              {pendingList.length > 5 && (
                <text size="xsmall" color="neutral-content-weak" alignment="center">
                  + {String(pendingList.length - 5)} more members
                </text>
              )}
            </vstack>
          )}
        </vstack>

        {/* ── Footer ── */}
        <text size="xsmall" color="neutral-content-weak" alignment="center">
          ModScout · Auto-tracks new members since install · Mod-only view
        </text>

      </vstack>
    );
  },
});

export default Devvit;
