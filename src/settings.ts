// src/settings.ts
import { SettingScope } from '@devvit/public-api';

export const settingsFields = [
  {
    name: 'welcomeEnabled',
    label: 'Welcome DM',
    helpText: 'Send a friendly welcome message to new members.',
    type: 'boolean' as const,
    defaultValue: true,
    scope: SettingScope.Installation,
  },
  {
    name: 'coachingEnabled',
    label: 'First-post coaching',
    helpText: "Show a rule checklist comment on new members' first posts.",
    type: 'boolean' as const,
    defaultValue: true,
    scope: SettingScope.Installation,
  },
  {
    name: 'removalDmEnabled',
    label: 'Removal coaching DM',
    helpText: 'DM new members with guidance when their first post is removed.',
    type: 'boolean' as const,
    defaultValue: true,
    scope: SettingScope.Installation,
  },
];
