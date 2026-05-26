// src/ui/dashboard.tsx
// The ModScout dashboard — a custom post component showing live new-member stats.
// Mods create this via the "📊 ModScout Dashboard" menu item.

import { Devvit, useAsync, useState, Context } from '@devvit/public-api';
import { getStats, getConfig, getPendingPosters } from '../store.js';
import { SubredditStats } from '../types.js';

// ── Helper ────────────────────────────────────────────────────────────────────

function pct(a: number, b: number): string {
  if (b === 0) return '—';
  return `${Math.round((a / b) * 100)}%`;
}

// ── Dashboard render function ─────────────────────────────────────────────────

export function renderDashboard(ctx: Context): JSX.Element {
  const { kvStore } = ctx;

  const [refreshKey, setRefreshKey] = useState(0);

  const { data: stats, loading: statsLoading } = useAsync<SubredditStats>(
    async () => getStats(kvStore),
    { depends: refreshKey }
  );

  const { data: pending, loading: pendingLoading } = useAsync<string[]>(
    async () => getPendingPosters(kvStore),
    { depends: refreshKey }
  );

  const { data: config, loading: configLoading } = useAsync(
    async () => getConfig(kvStore),
    { depends: refreshKey }
  );

  const isLoading = statsLoading || pendingLoading || configLoading;

  if (isLoading || !stats) {
    return (
      <vstack alignment="center middle" grow padding="large">
        <icon name="clock" size="large" color="neutral-content-weak" />
        <spacer size="small" />
        <text size="large" weight="bold" color="neutral-content">
          Loading ModScout…
        </text>
      </vstack>
    );
  }

  const successRate = pct(stats.successfulFirstPosts, stats.totalNewMembers);
  const removalRate = pct(stats.removedFirstPosts, stats.totalNewMembers);
  const repostRate = pct(stats.repostsAfterCoaching, stats.removedFirstPosts);

  return (
    <vstack grow padding="medium" gap="medium" backgroundColor="neutral-background">
      {/* Header */}
      <hstack alignment="start middle" gap="small">
        <icon name="chart-bar" size="medium" color="upvote" />
        <text size="xlarge" weight="bold" color="neutral-content-strong">
          ModScout Dashboard
        </text>
        <spacer grow />
        <button
          appearance="secondary"
          size="small"
          icon="refresh"
          onPress={() => setRefreshKey((k) => k + 1)}
        >
          Refresh
        </button>
      </hstack>

      {/* Stat cards row */}
      <hstack gap="small">
        <StatCard label="New Members" value={String(stats.totalNewMembers)} icon="person-add" />
        <StatCard label="Success Rate" value={successRate} icon="checkmark-circle" />
        <StatCard label="Removal Rate" value={removalRate} icon="mod-shield" />
        <StatCard label="Reposted After DM" value={repostRate} icon="redo" />
      </hstack>

      {/* Feature status */}
      <vstack gap="small" backgroundColor="neutral-background-strong" cornerRadius="medium" padding="small">
        <text size="medium" weight="bold" color="neutral-content">
          Feature Status
        </text>
        <hstack gap="medium">
          <FeaturePill label="Welcome DM" enabled={config?.welcomeEnabled ?? true} />
          <FeaturePill label="Post Coaching" enabled={config?.coachingEnabled ?? true} />
          <FeaturePill label="Removal DM" enabled={config?.removalDmEnabled ?? true} />
        </hstack>
      </vstack>

      {/* Pending posters */}
      <vstack gap="xsmall" backgroundColor="neutral-background-strong" cornerRadius="medium" padding="small">
        <hstack alignment="start middle" gap="xsmall">
          <icon name="clock" size="small" color="neutral-content-weak" />
          <text size="medium" weight="bold" color="neutral-content">
            Members Who Haven't Posted Yet
          </text>
          <spacer grow />
          <text size="small" color="neutral-content-weak">
            {pending?.length ?? 0} total
          </text>
        </hstack>

        {!pending || pending.length === 0 ? (
          <text size="small" color="neutral-content-weak">
            🎉 All tracked new members have posted!
          </text>
        ) : (
          <vstack gap="xsmall">
            {(pending.slice(0, 6)).map((username) => (
              <hstack
                key={username}
                backgroundColor="neutral-background"
                cornerRadius="small"
                padding="xsmall"
                alignment="start middle"
                gap="small"
              >
                <icon name="person" size="small" color="neutral-content-weak" />
                <text size="small" color="neutral-content">
                  u/{username}
                </text>
              </hstack>
            ))}
            {pending.length > 6 && (
              <text size="small" color="neutral-content-weak">
                + {pending.length - 6} more…
              </text>
            )}
          </vstack>
        )}
      </vstack>

      {/* Footer */}
      <text size="xsmall" color="neutral-content-weak" alignment="center">
        ModScout · Data since app install · Mod-only view
      </text>
    </vstack>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: string;
}): JSX.Element {
  return (
    <vstack
      grow
      alignment="center middle"
      backgroundColor="neutral-background-strong"
      cornerRadius="medium"
      padding="small"
      gap="xsmall"
    >
      <icon name={icon as any} size="medium" color="upvote" />
      <text size="large" weight="bold" color="neutral-content-strong">
        {value}
      </text>
      <text size="xsmall" color="neutral-content-weak" alignment="center">
        {label}
      </text>
    </vstack>
  );
}

function FeaturePill({
  label,
  enabled,
}: {
  label: string;
  enabled: boolean;
}): JSX.Element {
  return (
    <hstack
      backgroundColor={enabled ? 'success-background' : 'neutral-background'}
      cornerRadius="full"
      padding="xsmall"
      gap="xsmall"
      alignment="center middle"
    >
      <icon
        name={enabled ? 'checkmark-circle-fill' : 'close-circle'}
        size="small"
        color={enabled ? 'success-plain' : 'neutral-content-weak'}
      />
      <text
        size="xsmall"
        color={enabled ? 'success-plain' : 'neutral-content-weak'}
      >
        {label}
      </text>
    </hstack>
  );
}
