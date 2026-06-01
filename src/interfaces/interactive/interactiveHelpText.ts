export function buildInteractiveShellHelpText(): string {
  return [
    'Interactive shell command groups:',
    '  Browser runtime: plan, browser list, browser start [primary|probe|regression|audit], browser status <browserId>, browser stop <browserId> [force], browser restart <browserId> [force], browser cleanup-stale',
    '  Sticky mode/output/retry state: mode, mode chat <instant|expert|vision|unchanged>, mode [deepthink|search|all] <on|off|unchanged>, mode reset, output, output stream <on|off>, output format <text|json|stream-json|auto>, output shape <native|openai-responses|openai-chat-completions|none>, output reset, retry, retry on|off, retry max <count>, retry cooldown <ms|auto>, retry countdown <on|off>, retry reset, files, files add <path>, files remove <path>, files clear',
    '  Conversation and session workflows: inspect-home, inspect-controls, inspect-session <sessionId>, list-branches <sessionId>, reply <text>, reply-session <sessionId> <text>, continue-message <sessionId> <messageId> [branchId] [activeBranchId], edit-message <sessionId> <messageId> <text>, regenerate-message <sessionId> <messageId>, send-first-message <text>',
    '  Exit: exit, quit',
    '',
    'Sticky shell rules:',
    '  mode, output, retry, and queued files remain active until you change or reset them.',
    '  expert chat mode temporarily disables search=on and queued files while DeepSeek capacity recovers.',
    '  vision chat mode uses the same queued files path; image input is browser --file/files queue only, not OpenAI HTTP multimodal content.',
    '  browser start auto-pins newly started primary runtimes; browser stop clears the pin when you stop the bound runtime.',
    '  plan prints the resolved execution plan plus request family / policy preview for the current shell browser flags.',
    '  interactive clone-profile stays on warm runtime reuse; it does not inherit the one-shot CLI auto attach / auto-isolate policy graph.',
    '  current stream status: this shell exposes the unified output matrix and live --stream delivery for the full reply-family.',
    '  retry countdowns and prompt restoration stay line-safe while assistant text is streaming.',
    '',
  ].join('\n')
}
