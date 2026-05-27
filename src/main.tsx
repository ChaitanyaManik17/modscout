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

// ── Welcome DM on new subscriber ─────────────────────────────────────────────
// Reddit fires AppInstall / AppUpgrade, not a clean subscribe trigger.
// Most reliable way: send welcome DM inside PostSubmit when we first
// detect a new member AND they have no welcomeSentAt recorded yet.

async function sendWelcomeDM(username: string, subredditName: string, rules: string[], customSuffix: string, kvStore: any, reddit: any) {
  const ruleLines = rules.map((r: string, i: number) => `${i + 1}. ${r}`).join('\n');
  const suffix = customSuffix || 'We hope you enjoy being part of the community. Happy posting!';
  await reddit.sendPrivateMessage({
    to: username,
    subject: `Welcome to r/${subredditName}! A quick guide before you post`,
    text: `Hey u/${username} — welcome to r/${subredditName}! 👋\n\nBefore you make your first post, here are the **top rules new members accidentally break:**\n\n${ruleLines}\n\n**Tip:** Always check the sidebar before posting. If your post is removed, you'll receive a message explaining why and how to fix it.\n\nQuestions? [Message the mod team](https://www.reddit.com/message/compose?to=/r/${subredditName}) anytime.\n\n${suffix}\n\n*— The r/${subredditName} Mod Team via ModScout*`,
  });
}

// ── PostSubmit trigger ────────────────────────────────────────────────────────
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

    // Send welcome DM if not sent yet
    if (!raw?.welcomeSentAt) {
      const configRaw = await kvStore.get('config:v1');
      const config = configRaw ? JSON.parse(configRaw as string) : null;
      if (config?.welcomeEnabled !== false) {
        try {
          const subreddit = await reddit.getCurrentSubreddit();
          const rules: string[] = config?.topBrokenRules || ['Read the subreddit rules before posting.', 'Use the correct post flair.', 'Search before posting to avoid duplicates.'];
          await sendWelcomeDM(username, subreddit.name, rules, config?.customWelcomeSuffix || '', kvStore, reddit);
          const updatedRaw = await kvStore.get(`member:${username}`);
          const updated = updatedRaw ? JSON.parse(updatedRaw as string) : {};
          updated.welcomeSentAt = Date.now();
          await kvStore.put(`member:${username}`, JSON.stringify(updated));
          console.log(`[ModScout] Welcome DM sent to u/${username}`);
        } catch (e) {
          console.error(`[ModScout] Welcome DM failed for u/${username}:`, e);
        }
      }
    }

    if (raw?.firstPostAt) return;

    const updated2 = raw || { username, joinedAt: Date.now(), welcomeSentAt: null, firstPostId: null, firstPostSuccess: false, removalCoachingSentAt: null };
    updated2.firstPostAt = Date.now();
    updated2.firstPostId = postId;
    updated2.firstPostSuccess = true;
    await kvStore.put(`member:${username}`, JSON.stringify(updated2));

    const pendingRaw2 = await kvStore.get('pending_posters:v1');
    if (pendingRaw2) {
      const p2: string[] = JSON.parse(pendingRaw2 as string);
      await kvStore.put('pending_posters:v1', JSON.stringify(p2.filter((u: string) => u !== username)));
    }
    const statsRaw2 = await kvStore.get('stats:v1');
    const stats2 = statsRaw2 ? JSON.parse(statsRaw2 as string) : { totalNewMembers: 0, successfulFirstPosts: 0, removedFirstPosts: 0, repostsAfterCoaching: 0 };
    stats2.successfulFirstPosts = (stats2.successfulFirstPosts || 0) + 1;
    await kvStore.put('stats:v1', JSON.stringify(stats2));

    const configRaw2 = await kvStore.get('config:v1');
    const config2 = configRaw2 ? JSON.parse(configRaw2 as string) : null;
    if (config2?.coachingEnabled === false) return;

    try {
      const subreddit = await reddit.getCurrentSubreddit();
      const rules: string[] = config2?.topBrokenRules || ['Read the subreddit rules before posting.', 'Use the correct post flair.', 'Search before posting to avoid duplicates.'];
      const checklist = rules.map((r: string) => `- ☐ ${r}`).join('\n');
      const comment = await reddit.submitComment({
        id: `t3_${postId}`,
        text: `👋 **Welcome to your first post in r/${subreddit.name}, u/${username}!**\n\n*This is an automated message from the mod team.*\n\n**Quick rule checklist:**\n\n${checklist}\n\nIf your post gets removed, you will receive a private message explaining exactly why and how to fix it.\n\n*Questions? [Message the mod team](https://www.reddit.com/message/compose?to=/r/${subreddit.name}) anytime. — ModScout*`,
      });
      await comment.distinguish(true);
    } catch (e) {
      console.error('[ModScout] Checklist comment failed:', e);
    }
  },
});

// ── PostDelete trigger ────────────────────────────────────────────────────────
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
        text: `Hey u/${username},\n\nYour post in r/${subreddit.name} was removed. This is not a ban — it happens to almost everyone when they are new.\n\n**Check these before reposting:**\n\n${rulesList}\n\nFix the issue and repost — most corrected posts get approved!\n\nThink it was a mistake? [Message the mod team](https://www.reddit.com/message/compose?to=/r/${subreddit.name}).\n\n*— r/${subreddit.name} Mod Team via ModScout*`,
      });
      member.removalCoachingSentAt = Date.now();
      await kvStore.put(`member:${username}`, JSON.stringify(member));
    } catch (e) {
      console.error('[ModScout] Removal DM failed:', e);
    }
  },
});

// ── Scheduler ─────────────────────────────────────────────────────────────────
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

// ── Config form ───────────────────────────────────────────────────────────────
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
      { name: 'customWelcomeSuffix', label: 'Custom welcome message closing (optional)', type: 'string', defaultValue: '' },
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
    ctx.ui.showToast({ text: 'ModScout settings saved!', appearance: 'success' });
  }
);

// ── Menu items ────────────────────────────────────────────────────────────────
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
        <vstack alignment="center middle" grow>
          <text size="large" weight="bold">📊 ModScout</text>
          <text size="small" color="neutral-content-weak">Loading...</text>
        </vstack>
      ),
    });
    ui.showToast({ text: 'Dashboard created!', appearance: 'success' });
    ui.navigateTo(post);
  },
});

// ── Seed test data menu item (mod only) ───────────────────────────────────────
Devvit.addMenuItem({
  label: '🧪 ModScout: Load Test Data',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, ctx) => {
    const { kvStore, ui } = ctx;
    const testStats = {
      totalNewMembers: 12,
      successfulFirstPosts: 7,
      removedFirstPosts: 3,
      repostsAfterCoaching: 2,
    };
    const testPending = ['new_user_alex', 'reddit_newbie_99', 'firsttimer_2026'];
    await kvStore.put('stats:v1', JSON.stringify(testStats));
    await kvStore.put('pending_posters:v1', JSON.stringify(testPending));
    // Seed member records for pending users
    for (const u of testPending) {
      await kvStore.put(`member:${u}`, JSON.stringify({
        username: u, joinedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
        welcomeSentAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
        firstPostAt: null, firstPostId: null,
        firstPostSuccess: false, removalCoachingSentAt: null,
      }));
    }
    ui.showToast({ text: '✅ Test data loaded! Refresh your dashboard.', appearance: 'success' });
  },
});

// ── Clear test data menu item ─────────────────────────────────────────────────
Devvit.addMenuItem({
  label: '🗑️ ModScout: Reset Data',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, ctx) => {
    const { kvStore, ui } = ctx;
    await kvStore.put('stats:v1', JSON.stringify({ totalNewMembers: 0, successfulFirstPosts: 0, removedFirstPosts: 0, repostsAfterCoaching: 0 }));
    await kvStore.put('pending_posters:v1', JSON.stringify([]));
    ui.showToast({ text: 'Data reset to zero.', appearance: 'success' });
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
      return raw
        ? JSON.parse(raw as string)
        : { totalNewMembers: 0, successfulFirstPosts: 0, removedFirstPosts: 0, repostsAfterCoaching: 0 };
    }, { depends: tick });

    const { data: pending, loading: pl } = useAsync(async () => {
      const raw = await ctx.kvStore.get('pending_posters:v1');
      return raw ? (JSON.parse(raw as string) as string[]) : ([] as string[]);
    }, { depends: tick });

    const { data: config, loading: cl } = useAsync(async () => {
      const raw = await ctx.kvStore.get('config:v1');
      return raw ? JSON.parse(raw as string) : { welcomeEnabled: true, coachingEnabled: true, removalDmEnabled: true };
    }, { depends: tick });

    if (sl || pl || cl) {
      return (
        <vstack alignment="center middle" grow>
          <text size="large" weight="bold">📊 ModScout</text>
          <spacer size="small" />
          <text size="small" color="neutral-content-weak">Loading...</text>
        </vstack>
      );
    }

    const total: number = stats?.totalNewMembers ?? 0;
    const success: number = stats?.successfulFirstPosts ?? 0;
    const removed: number = stats?.removedFirstPosts ?? 0;
    const reposted: number = stats?.repostsAfterCoaching ?? 0;
    const pendingList: string[] = pending ?? [];
    const pct = (a: number, b: number) => b > 0 ? `${Math.round((a / b) * 100)}%` : '—';
    const wOn: boolean = config?.welcomeEnabled ?? true;
    const cOn: boolean = config?.coachingEnabled ?? true;
    const rOn: boolean = config?.removalDmEnabled ?? true;

    return (
      <vstack grow padding="medium" gap="medium">

        {/* Header */}
        <hstack alignment="middle">
          <vstack grow>
            <text size="large" weight="bold">ModScout Dashboard</text>
            <text size="xsmall" color="neutral-content-weak">New member health · tap Refresh for latest</text>
          </vstack>
          <button size="small" appearance="bordered" onPress={() => setTick(t => t + 1)}>
            Refresh
          </button>
        </hstack>

        {/* Stats */}
        <hstack gap="small">
          <vstack grow alignment="center middle" backgroundColor="neutral-background-strong" cornerRadius="medium" padding="small" gap="xsmall">
            <text size="xxlarge" weight="bold">{String(total)}</text>
            <text size="xsmall" color="neutral-content-weak">Members</text>
          </vstack>
          <vstack grow alignment="center middle" backgroundColor="neutral-background-strong" cornerRadius="medium" padding="small" gap="xsmall">
            <text size="xxlarge" weight="bold" color="success-plain">{pct(success, total)}</text>
            <text size="xsmall" color="neutral-content-weak">Posted OK</text>
          </vstack>
          <vstack grow alignment="center middle" backgroundColor="neutral-background-strong" cornerRadius="medium" padding="small" gap="xsmall">
            <text size="xxlarge" weight="bold" color="danger-plain">{pct(removed, total)}</text>
            <text size="xsmall" color="neutral-content-weak">Removed</text>
          </vstack>
          <vstack grow alignment="center middle" backgroundColor="neutral-background-strong" cornerRadius="medium" padding="small" gap="xsmall">
            <text size="xxlarge" weight="bold" color="caution-plain">{pct(reposted, removed)}</text>
            <text size="xsmall" color="neutral-content-weak">Reposted</text>
          </vstack>
        </hstack>

        {/* Feature pills */}
        <hstack gap="small" alignment="middle">
          <vstack grow alignment="center middle" backgroundColor={wOn ? 'success-background' : 'neutral-background-strong'} cornerRadius="medium" padding="xsmall">
            <text size="xsmall" color={wOn ? 'success-plain' : 'neutral-content-weak'} weight="bold">{wOn ? '✓' : '○'} Welcome DM</text>
          </vstack>
          <vstack grow alignment="center middle" backgroundColor={cOn ? 'success-background' : 'neutral-background-strong'} cornerRadius="medium" padding="xsmall">
            <text size="xsmall" color={cOn ? 'success-plain' : 'neutral-content-weak'} weight="bold">{cOn ? '✓' : '○'} Checklist</text>
          </vstack>
          <vstack grow alignment="center middle" backgroundColor={rOn ? 'success-background' : 'neutral-background-strong'} cornerRadius="medium" padding="xsmall">
            <text size="xsmall" color={rOn ? 'success-plain' : 'neutral-content-weak'} weight="bold">{rOn ? '✓' : '○'} Removal DM</text>
          </vstack>
        </hstack>

        {/* Pending list */}
        <vstack grow backgroundColor="neutral-background-strong" cornerRadius="medium" padding="medium" gap="small">
          <hstack alignment="middle">
            <text weight="bold" size="small">Waiting to post</text>
            <spacer grow />
            <text size="xsmall" color="neutral-content-weak">{String(pendingList.length)} users</text>
          </hstack>
          {pendingList.length === 0 ? (
            <vstack grow alignment="center middle" gap="xsmall">
              <text size="large">🎉</text>
              <text size="small" color="neutral-content-weak">All new members have posted!</text>
            </vstack>
          ) : (
            <vstack gap="xsmall">
              {pendingList.slice(0, 5).map((u: string) => (
                <hstack key={u} backgroundColor="neutral-background" cornerRadius="small" padding="small" alignment="middle" gap="small">
                  <text size="small" weight="bold" grow>u/{u}</text>
                  <text size="xsmall" color="neutral-content-weak">no post yet</text>
                </hstack>
              ))}
              {pendingList.length > 5 && (
                <text size="xsmall" color="neutral-content-weak" alignment="center">+ {String(pendingList.length - 5)} more</text>
              )}
            </vstack>
          )}
        </vstack>

        <text size="xsmall" color="neutral-content-weak" alignment="center">
          ModScout · mod-only
        </text>
      </vstack>
    );
  },
});

export default Devvit;
