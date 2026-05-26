import { Devvit, TriggerContext } from '@devvit/public-api';
import { handleNewMember } from './triggers/onMemberJoin.js';
import { handlePostCreate } from './triggers/onPostCreate.js';
import { handlePostRemove } from './triggers/onPostRemove.js';
import { renderDashboard } from './ui/dashboard.js';
import { settingsFields } from './settings.js';

Devvit.configure({
  redditAPI: true,
  kvStore: true,
  scheduler: true,
});

Devvit.addSettings(settingsFields);

Devvit.addTrigger({
  event: 'ModAction',
  onEvent: async (event, ctx) => {
    if (event.action === 'community_subscribed') {
      await handleNewMember(event, ctx as unknown as TriggerContext);
    }
  },
});

Devvit.addTrigger({
  event: 'PostSubmit',
  onEvent: async (event, ctx) => {
    await handlePostCreate(event, ctx as unknown as TriggerContext);
  },
});

Devvit.addTrigger({
  event: 'PostDelete',
  onEvent: async (event, ctx) => {
    await handlePostRemove(event, ctx as unknown as TriggerContext);
  },
});

Devvit.addSchedulerJob({
  name: 'modscout_daily_cleanup',
  onRun: async (_event, ctx) => {
    const { kvStore, reddit } = ctx;
    const subredditName = (await reddit.getCurrentSubreddit()).name;
    console.log(`[ModScout] Daily cleanup running for r/${subredditName}`);
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
    console.log(`[ModScout] Cleanup done. Kept ${stillPending.length} pending posters.`);
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
          <text size="large" weight="bold">Loading ModScout Dashboard…</text>
        </vstack>
      ),
    });
    ui.showToast({ text: 'Dashboard created!', appearance: 'success' });
    ui.navigateTo(post);
  },
});

const configForm = Devvit.createForm(
  {
    title: 'ModScout Configuration',
    fields: [
      { name: 'welcomeEnabled', label: 'Send welcome DM to new members', type: 'boolean', defaultValue: true },
      { name: 'coachingEnabled', label: 'Show pre-post checklist to new members', type: 'boolean', defaultValue: true },
      { name: 'removalDmEnabled', label: 'Send coaching DM when first post is removed', type: 'boolean', defaultValue: true },
      { name: 'rule1', label: 'Most-broken rule #1', type: 'string', defaultValue: 'Read the subreddit rules before posting.' },
      { name: 'rule2', label: 'Most-broken rule #2', type: 'string', defaultValue: 'Use the correct post flair.' },
      { name: 'rule3', label: 'Most-broken rule #3', type: 'string', defaultValue: 'Search before posting to avoid duplicates.' },
      { name: 'customWelcomeSuffix', label: 'Custom welcome message closing (optional)', type: 'string', defaultValue: '' },
    ],
  },
  async (values, ctx) => {
    const { kvStore, ui } = ctx;
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
    await kvStore.put('config:v1', JSON.stringify(config));
    ui.showToast({ text: 'ModScout settings saved!', appearance: 'success' });
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

Devvit.addCustomPostType({
  name: 'ModScout Dashboard',
  description: 'Live new-member health dashboard for moderators',
  height: 'tall',
  render: renderDashboard,
});

export default Devvit;
