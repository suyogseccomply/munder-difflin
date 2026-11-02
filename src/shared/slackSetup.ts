/** Slack channel rules and the app manifest. No imports, so main and renderer share it. */

/** The setting holds one id or several, separated by commas or spaces. */
export function parseChannelList(raw: unknown): string[] {
  return typeof raw === 'string' ? raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean) : [];
}

/** An empty list means every channel the bot is in. */
export function channelAllowed(allowed: readonly string[], channel: unknown): boolean {
  return allowed.length === 0 || (typeof channel === 'string' && allowed.includes(channel));
}

/** A manifest to paste into Slack's "Create an app from a manifest". */
export function slackManifest(requestUrl: string | undefined): string {
  return JSON.stringify({
    display_information: { name: 'Munder Difflin', description: 'Sends Slack messages to your agents and posts their replies.' },
    features: { bot_user: { display_name: 'Munder Difflin', always_online: false } },
    oauth_config: {
      scopes: { bot: ['app_mentions:read', 'channels:history', 'groups:history', 'im:history', 'chat:write', 'files:read'] }
    },
    settings: {
      event_subscriptions: {
        request_url: requestUrl || 'https://replace-with-your-url.example.com/slack/events',
        bot_events: ['app_mention', 'message.channels', 'message.groups', 'message.im']
      },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false
    }
  }, null, 2);
}
