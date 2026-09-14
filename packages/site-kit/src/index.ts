export { AgentInstall, type AgentInstallProps } from './agent-install/AgentInstall';
export {
  DEFAULT_TOOL_ORDER,
  TOOL_BUILDERS,
  buildTools,
  cursorInstallLink,
  stdioArgs,
  stdioServer,
  vscodeInstallLink,
  type AgentProject,
  type AgentTool,
  type InstallStep,
  type ToolId,
} from './agent-install/tools';
export { CopyCommand, copyText } from './copy';
export { SupportProject, type SupportProjectProps } from './support/SupportProject';
export {
  SUPPORT_PROVIDERS,
  resolveSupportLinks,
  supportMessage,
  type ResolvedSupportLink,
  type SupportLinks,
  type SupportMessageInput,
  type SupportProvider,
  type SupportProviderId,
} from './support/providers';
export { MaxiChat, historyFor, type MaxiChatProps } from './maxi/MaxiChat';
export { parseInline, parseMarkdown, safeHref, type Block, type Inline } from './maxi/markdown';
export { createSseParser, type SseMessage } from './maxi/sse';
export { TutorAvatar, type TutorMood } from './maxi/TutorAvatar';
