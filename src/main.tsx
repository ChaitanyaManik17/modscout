import { Devvit } from '@devvit/public-api';
import { getStats, getConfig, getPendingPosters } from './store.js';

Devvit.configure({
  redditAPI: true,
  kvStore: true,
  scheduler: true,
});

// ── Settings ──────────────────────────────────────────────────────────────────

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

// ── Triggers ──────────────────────────────────────────────────────────────────

Devvit.addTrigger({
  event: 'PostSubmit',
  onEvent: async (event, ctx) => {
    const { kvStore, reddit } = ctx;
    const username = event.post?.authorName;
    const postId = event.post?.id;
    if (!username || !postId || username === '[deleted]') return;

    // Check if new member (tracked or account under 30 days)
    const memberRaw = await kvStore.get(`member:${username}`);
    let isNewMember = !!memberRaw;

    if (!isNewMember && event.author?.createdAt) {
      const ageMs = Date.now() - (event.author.createdAt * 1000);
      isNewMember = ageMs < 30 * 24 * 60 * 60 * 1000;
      if (isNewMember) {
        // Record them
        const record = {
          username, joinedAt: event.author.createdAt * 1000,
          welcomeSentAt: null, firstPostAt: null, firstPostId: null,
          firstPostSuccess: false, removalCoachingSentAt: null, repostAttemptAt: null,
        };
        await kvStore.put(`member:${username}`, JSON.stringify(record));
      }
    }

    if (!isNewMember) return;

    const raw = memberRaw ? JSON.parse(memberRaw as string) : null;
    if (raw?.firstPostAt) return; // already posted before

    // Mark first post
    const updated = raw || {};
    updated.firstPostAt = Date.now();
    updated.firstPostId = postId;
    updated.firstPostSuccess = true;
    await kvStore.put(`member:${username}`, JSON.stringify(updated));

    // Remove from pending
    const pendingRaw = await kvStore.get('pending_posters:v1');
    if (pendingRaw) {
      const pending: string[] = JSON.parse(pendingRaw as string);
      await kvStore.put('pending_posters:v1', JSON.stringify(pending.filter(u => u !== username)));
    }

    // Update stats
    const statsRaw = await kvStore.get('stats:v1');
    const stats = statsRaw ? JSON.parse(statsRaw as string) : { totalNewMembers: 0, successfulFirstPosts: 0, removedFirstPosts: 0, repostsAfterCoaching: 0 };
    stats.successfulFirstPosts = (stats.successfulFirstPosts || 0) + 1;
    await kvStore.put('stats:v1', JSON.stringify(stats));

    // Get config
    const configRaw = await kvStore.get('config:v1');
    const config = configRaw ? JSON.parse(configRaw as string) : null;
    if (config?.coachingEnabled === false) return;

    // Post checklist comment
    try {
      const subreddit = await reddit.getCurrentSubreddit();
      const rules = config?.topBrokenRules || ['Read the subreddit rules.', 'Use the correct flair.', 'Search before posting.'];
      const checklist = rules.map((r: string) => `- ☐ ${r}`).join('\n');
      const comment = await reddit.submitComment({
        id: `t3_${postId}`,
        text: `👋 **Welcome to your first post, u/${username}!**\n\n*Quick checklist from the r/${subreddit.name} mod team:*\n\n${checklist}\n\n*If your post gets removed, you'll receive a message explaining why and how to fix it. — ModScout*`,
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
    if (member.firstPostId !== postId) return; // not their first post
    if (member.removalCoachingSentAt) return; // already sent

    // Mark removed
    member.firstPostSuccess = false;
    await kvStore.put(`member:${username}`, JSON.stringify(member));

    // Update stats
    const statsRaw = await kvStore.get('stats:v1');
    const stats = statsRaw ? JSON.parse(statsRaw as string) : { totalNewMembers: 0, successfulFirstPosts: 0, removedFirstPosts: 0, repostsAfterCoaching: 0 };
    stats.successfulFirstPosts = Math.max(0, (stats.successfulFirstPosts || 1) - 1);
    stats.removedFirstPosts = (stats.removedFirstPosts || 0) + 1;
    await kvStore.put('stats:v1', JSON.stringify(stats));

    // Get config
    const configRaw = await kvStore.get('config:v1');
    const config = configRaw ? JSON.parse(configRaw as string) : null;
    if (config?.removalDmEnabled === false) return;

    try {
      const subreddit = await reddit.getCurrentSubreddit();
      const rules = config?.topBrokenRules || ['Read the subreddit rules.', 'Use the correct flair.', 'Search before posting.'];
      const rulesList = rules.map((r: string) => `• ${r}`).join('\n');
      await reddit.sendPrivateMessage({
        to: username,
        subject: `Your post in r/${subreddit.name} was removed — here's how to fix it`,
        text: `Hey u/${username},\n\nYour post in r/${subreddit.name} was removed. This happens to almost everyone when they're new — it's not a ban.\n\n**Check these rules before reposting:**\n\n${rulesList}\n\nJust fix the issue and repost — most posts that get fixed get approved!\n\nQuestions? [Message the mod team](https://www.reddit.com/message/compose?to=/r/${subreddit.name}).\n\n*— r/${subreddit.name} Mod Team via ModScout*`,
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
    ctx.ui.showToast({ text: 'ModScout settings saved!', appearance: 'success' });
  }
);

// ── Menu items ────────────────────────────────────────────────────────────────

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
          <text size="large" weight="bold">📊 Loading ModScout…</text>
        </vstack>
      ),
    });
    ui.showToast({ text: 'Dashboard created!', appearance: 'success' });
    ui.navigateTo(post);
  },
});

// ── Dashboard custom post ─────────────────────────────────────────────────────

Devvit.addCustomPostType({
  name: 'ModScout Dashboard',
  description: 'Live new-member health dashboard',
  height: 'tall',
  render: (ctx) => {
    const { kvStore } = ctx;
    const [stats, setStats] = ctx.useState<{
      totalNewMembers: number;
      successfulFirstPosts: number;
      removedFirstPosts: number;
      repostsAfterCoaching: number;
    } | null>(null);
    const [pending, setPending] = ctx.useState<string[]>([]);
    const [loaded, setLoaded] = ctx.useState(false);

    ctx.useAsync(async () => {
      const statsRaw = await kvStore.get('stats:v1');
      const s = statsRaw ? JSON.parse(statsRaw as string) : { totalNewMembers: 0, successfulFirstPosts: 0, removedFirstPosts: 0, repostsAfterCoaching: 0 };
      setStats(s);
      const pendingRaw = await kvStore.get('pending_posters:v1');
      const p = pendingRaw ? JSON.parse(pendingRaw as string) : [];
      setPending(p);
      setLoaded(true);
    });

    if (!loaded) {
      return (
        <vstack alignment="center middle" grow>
          <text size="large" weight="bold">Loading…</text>
        </vstack>
      );
    }

    const total = stats?.totalNewMembers ?? 0;
    const success = stats?.successfulFirstPosts ?? 0;
    const removed = stats?.removedFirstPosts ?? 0;
    const reposted = stats?.repostsAfterCoaching ?? 0;

    const successRate = total > 0 ? `${Math.round((success / total) * 100)}%` : '—';
    const removalRate = total > 0 ? `${Math.round((removed / total) * 100)}%` : '—';
    const repostRate = removed > 0 ? `${Math.round((reposted / removed) * 100)}%` : '—';

    return (
      <vstack grow padding="medium" gap="medium">
        <hstack alignment="middle">
          <text size="xlarge" weight="bold">📊 ModScout Dashboard</text>
        </hstack>

        <hstack gap="small">
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

        <vstack backgroundColor="neutral-background-strong" cornerRadius="medium" padding="small" gap="small">
          <text weight="bold">⏳ Members Who Haven't Posted Yet ({String(pending.length)})</text>
          {pending.length === 0 ? (
            <text color="neutral-content-weak">🎉 All tracked new members have posted!</text>
          ) : (
            <vstack gap="xsmall">
              {pending.slice(0, 8).map((u) => (
                <hstack key={u} backgroundColor="neutral-background" cornerRadius="small" padding="xsmall" gap="small">
                  <text size="small">👤 u/{u}</text>
                </hstack>
              ))}
              {pending.length > 8 && <text size="xsmall" color="neutral-content-weak">+ {String(pending.length - 8)} more</text>}
            </vstack>
          )}
        </vstack>

        <text size="xsmall" color="neutral-content-weak">ModScout · Mod-only · Data since install</text>
      </vstack>
    );
  },
});

export default Devvit;
