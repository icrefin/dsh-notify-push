/**
 * The panel's copy, in the two languages the shipped web client ships.
 *
 * `dshNotifyPush` is this plugin's locale namespace: `ctx.locale.register`
 * publishes the dictionaries and `ctx.locale.bind` hands out a translate seat
 * bound to them. A locale revision re-renders every registered slot, so the
 * panel never caches a translated string.
 *
 * @module dsh-notify-push/client/locales
 */

/** English copy. */
export const en = {
  panel: 'Notify Push',
  title: 'Notify Push',
  intro: 'Pushes every finished turn, error and approval request to your phone through the configured backend.',

  refresh: 'Refresh',
  sendTest: 'Send test notification',
  sending: 'Sending…',
  loading: 'Contacting the host…',
  requestFailed: 'The host refused the request',
  testSent: 'Test notification accepted by the provider — it should reach your phone now.',
  testBlocked: 'The test notification was not delivered.',

  statusHeading: 'Delivery',
  provider: 'Provider',
  target: 'Destination',
  host: 'Host',
  state: 'State',
  stateOn: 'Armed',
  stateOff: 'Disabled',
  notConfigured: 'Not configured',

  triggersHeading: 'Triggers',
  triggerIdle: 'Turn finished',
  triggerError: 'Agent error',
  triggerApproval: 'Approval needed',
  triggerQuestion: 'Question asked',
  armed: 'on',
  disarmed: 'off',

  sampleHeading: 'What your phone will show',
  sampleNote: 'Event type and host go in the title; session and detail go in the body.',

  subscribeHeading: 'Subscribe on your phone',
  subscribeServer: 'Server',
  subscribeTopic: 'Topic',
  subscribeNote: 'Add this topic in the ntfy app. Click a value to select all of it. On a public server the topic name is the password, so keep it to yourself.',

  configHeading: 'Configuration',
  configIntro: 'Saved values apply immediately — no restart — and are reapplied on the next boot.',
  configSave: 'Save',
  configSaving: 'Saving…',
  configSaved: 'Saved. It is in effect now.',
  configFailed: 'Could not save',
  configNoChange: 'Nothing changed.',
  secretReveal: 'Show this value',
  secretHide: 'Hide this value',
  configReadOnly: 'This deployment has no settings service, so values cannot be saved here. Set them in the profile’s cordis.patch.yml instead.',
  configSecretStored: 'stored — leave blank to keep',
  configSecretEmpty: 'not set',

  field_enabled: 'Enabled',
  field_provider: 'Provider',
  field_notifyOnIdle: 'Notify on turn finished',
  field_notifyOnError: 'Notify on agent error',
  field_notifyOnApproval: 'Notify when approval is needed',
  field_notifyOnQuestion: 'Notify when the agent asks a question',
  field_minTurnDurationMs: 'Minimum turn length (ms)',
  field_ntfyServer: 'ntfy server',
  field_ntfyTopic: 'ntfy topic',
  field_ntfyToken: 'ntfy access token',
  field_ntfyClick: 'Tap-through URL',
  field_barkServer: 'Bark server',
  field_barkKey: 'Bark device key',
  field_barkGroup: 'Bark group',
  field_barkSound: 'Bark sound',
  field_gotifyServer: 'Gotify server',
  field_gotifyToken: 'Gotify app token',
  field_telegramBotToken: 'Telegram bot token',
  field_telegramChatId: 'Telegram chat id',
  field_webhookUrl: 'Webhook URL',

  recentHeading: 'Recent deliveries',
  recentEmpty: 'Nothing delivered yet. Use “Send test notification” to check the path.',
  colTime: 'Time',
  colEvent: 'Event',
  colOutcome: 'Outcome',
  colDetail: 'Detail',
  outcomeSent: 'sent',
  outcomeFailed: 'failed',
  outcomeSuppressed: 'suppressed',

  sent: 'Delivered',
  failed: 'Failed',
  suppressed: 'Suppressed',
}

/** Simplified Chinese copy. Typed against `en`, so a missing key fails the build. */
export const zh: typeof en = {
  panel: '推送通知',
  title: '推送通知',
  intro: '把每一次完成的回合、错误与审批请求，通过配置的后端推送到你的手机。',

  refresh: '刷新',
  sendTest: '发送测试通知',
  sending: '发送中…',
  loading: '正在请求主机…',
  requestFailed: '主机拒绝了该请求',
  testSent: '服务商已接受测试通知，稍后应到达手机。',
  testBlocked: '测试通知未能送达。',

  statusHeading: '投递',
  provider: '服务商',
  target: '目标',
  host: '主机',
  state: '状态',
  stateOn: '已启用',
  stateOff: '已停用',
  notConfigured: '未配置',

  triggersHeading: '触发条件',
  triggerIdle: '回合完成',
  triggerError: 'Agent 错误',
  triggerApproval: '需要审批',
  triggerQuestion: '提问',
  armed: '开',
  disarmed: '关',

  sampleHeading: '手机上会显示的内容',
  sampleNote: '事件类型与主机会出现在标题，会话与详情出现在正文。',

  subscribeHeading: '在手机上订阅',
  subscribeServer: '服务器',
  subscribeTopic: '主题',
  subscribeNote: '在 ntfy 应用中添加此主题。点击数值即可全选。在公共服务器上主题名即密码，请勿外泄。',

  configHeading: '配置',
  configIntro: '保存后立即生效，无需重启；下次启动时也会重新应用。',
  configSave: '保存',
  configSaving: '保存中…',
  configSaved: '已保存，现已生效。',
  configFailed: '保存失败',
  configNoChange: '没有改动。',
  secretReveal: '显示此值',
  secretHide: '隐藏此值',
  configReadOnly: '当前部署没有 settings 服务，无法在此保存。请在配置档的 cordis.patch.yml 中设置。',
  configSecretStored: '已存储 — 留空表示保持不变',
  configSecretEmpty: '未设置',

  field_enabled: '启用',
  field_provider: '服务商',
  field_notifyOnIdle: '回合完成时通知',
  field_notifyOnError: 'Agent 出错时通知',
  field_notifyOnApproval: '需要审批时通知',
  field_notifyOnQuestion: 'Agent 提问时通知',
  field_minTurnDurationMs: '最短回合时长（毫秒）',
  field_ntfyServer: 'ntfy 服务器',
  field_ntfyTopic: 'ntfy 主题',
  field_ntfyToken: 'ntfy 访问令牌',
  field_ntfyClick: '点击跳转地址',
  field_barkServer: 'Bark 服务器',
  field_barkKey: 'Bark 设备密钥',
  field_barkGroup: 'Bark 分组',
  field_barkSound: 'Bark 提示音',
  field_gotifyServer: 'Gotify 服务器',
  field_gotifyToken: 'Gotify 应用令牌',
  field_telegramBotToken: 'Telegram 机器人令牌',
  field_telegramChatId: 'Telegram 会话 ID',
  field_webhookUrl: 'Webhook 地址',

  recentHeading: '最近投递',
  recentEmpty: '尚无投递记录。可用“发送测试通知”验证链路。',
  colTime: '时间',
  colEvent: '事件',
  colOutcome: '结果',
  colDetail: '详情',
  outcomeSent: '已送达',
  outcomeFailed: '失败',
  outcomeSuppressed: '已抑制',

  sent: '已送达',
  failed: '失败',
  suppressed: '已抑制',
}

/**
 * Translate one key of this panel's dictionary.
 *
 * Every child component accepts exactly this shape, so the panel can pass its
 * translate seat down without repeating the framework's generic machinery.
 */
export type PanelTranslate = (key: keyof typeof en) => string

/** Every key of this dictionary. */
export type PanelKey = keyof typeof en

/**
 * The dictionary key for one config field's label.
 *
 * The host sends a config `key` with each field rather than a rendered label, so
 * the wording stays in the dictionary and follows the language setting. A field
 * with no entry falls back to the raw key at the call site.
 *
 * @param key - config key, e.g. `ntfyTopic`.
 * @returns the dictionary key for its label.
 */
export function fieldLabelKey(key: string): PanelKey {
  return `field_${key}` as PanelKey
}