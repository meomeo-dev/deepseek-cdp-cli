import type { Command } from 'commander'
import requestControlContract from '../../infrastructure/openai/openaiHttpRequestControlContract.json' with { type: 'json' }

interface HelpSection {
  title: string
  lines: string[]
}

function renderHelpSections(sections: HelpSection[]): string {
  const renderedSections = sections.map(section =>
    `${section.title}:\n${section.lines.map(line => `  ${line}`).join('\n')}`,
  )
  return `\n${renderedSections.join('\n\n')}\n`
}

function appendHelpSections(command: Command, sections: HelpSection[]): Command {
  command.addHelpText('after', renderHelpSections(sections))
  return command
}

function setSummary(command: Command, summary: string): void {
  command.summary(summary)
}

function requireCommand(command: Command | undefined, name: string): Command {
  if (!command) {
    throw new Error(`CLI help setup could not find command: ${name}`)
  }
  return command
}

function findTopLevelCommand(program: Command, name: string): Command {
  return requireCommand(program.commands.find(command => command.name() === name), name)
}

function findSubcommand(parent: Command, name: string): Command {
  return requireCommand(parent.commands.find(command => command.name() === name), name)
}

export function applyCliCommandSummaries(program: Command): void {
  setSummary(findTopLevelCommand(program, 'plan'), 'Preview browser runtime resolution and auto-management policy')
  setSummary(findTopLevelCommand(program, 'auth'), 'Manage the dedicated DeepSeek auth profile')
  setSummary(findTopLevelCommand(program, 'browser'), 'Manage browser runtimes and cleanup')
  setSummary(findTopLevelCommand(program, 'delete-session'), 'Delete one DeepSeek session')
  setSummary(findTopLevelCommand(program, 'endpoints'), 'Print DeepSeek route and API catalog')
  setSummary(findTopLevelCommand(program, 'release-diff'), 'Diff current vs known-good release artifacts')
  setSummary(findTopLevelCommand(program, 'release-triage'), 'Build a release upgrade SOP')
  setSummary(findTopLevelCommand(program, 'release-boundaries'), 'Describe UI/API/output boundaries')
  setSummary(findTopLevelCommand(program, 'release-revalidate'), 'Describe post-adaptation revalidation')
  setSummary(findTopLevelCommand(program, 'release-change-ledger'), 'Build a change ledger and unresolved matrix')
  setSummary(findTopLevelCommand(program, 'release-handoff-matrix'), 'Build the Wave 21/Wave 22 handoff matrix')
  setSummary(findTopLevelCommand(program, 'release-audit'), 'Build the final release audit and publish gate')
  setSummary(findTopLevelCommand(program, 'inspect-home'), 'Wait for the home composer to be ready')
  setSummary(findTopLevelCommand(program, 'reply'), 'Send or continue a DeepSeek reply')
  setSummary(findTopLevelCommand(program, 'continue-message'), 'Continue a stopped assistant message')
  setSummary(findTopLevelCommand(program, 'prepare-continue-target'), 'Create and verify a resumable target')
  setSummary(findTopLevelCommand(program, 'edit-message'), 'Edit a stored user message')
  setSummary(findTopLevelCommand(program, 'regenerate-message'), 'Regenerate a stored assistant message')
  setSummary(findTopLevelCommand(program, 'inspect-session'), 'Restore a stored session by sessionId')
  setSummary(findTopLevelCommand(program, 'send-first-message'), 'Send the first message from home')
  setSummary(findTopLevelCommand(program, 'inspect-controls'), 'Inspect composer controls')
  setSummary(findTopLevelCommand(program, 'mode-audit'), 'Audit Instant/Expert/Vision mode surfaces')
  setSummary(findTopLevelCommand(program, 'selector-drift-audit'), 'Audit mode-aware selector drift')
  setSummary(findTopLevelCommand(program, 'endpoint-drift-audit'), 'Audit endpoint drift and mode signal delivery')
  setSummary(findTopLevelCommand(program, 'output-drift-audit'), 'Audit output, citations, and export drift')
  setSummary(findTopLevelCommand(program, 'list-sessions'), 'List locally stored DeepSeek sessions')
  setSummary(findTopLevelCommand(program, 'sync-session'), 'Reconcile the session catalog or sync one stored session')
  setSummary(findTopLevelCommand(program, 'list-branches'), 'List stored session branches')
  setSummary(findTopLevelCommand(program, 'export-session'), 'Export one branch or a full session')
  setSummary(findTopLevelCommand(program, 'interactive'), 'Open the interactive shell')
  setSummary(findTopLevelCommand(program, 'serve'), 'Run the JSON-RPC / HTTP service')
  setSummary(findTopLevelCommand(program, 'version'), 'Print version, GitHub URL, and license')
  setSummary(findTopLevelCommand(program, 'skillbook'), 'Print the packaged user guide')
  setSummary(findTopLevelCommand(program, 'show-plan'), 'Print the rollout plan markdown (maintainer)')

  const browser = findTopLevelCommand(program, 'browser')
  setSummary(findSubcommand(browser, 'start'), 'Start or reuse a warm runtime')
  setSummary(findSubcommand(browser, 'list'), 'List runtime registry entries')
  setSummary(findSubcommand(browser, 'status'), 'Show one runtime by browserId')
  setSummary(findSubcommand(browser, 'stop'), 'Stop one managed runtime')
  setSummary(findSubcommand(browser, 'restart'), 'Restart one managed warm runtime')
  setSummary(findSubcommand(browser, 'cleanup-stale'), 'Sweep stale runtimes and dead attach metadata')

  const auth = findTopLevelCommand(program, 'auth')
  setSummary(findSubcommand(auth, 'login'), 'Open Chrome and persist DeepSeek login state')
  setSummary(findSubcommand(auth, 'logout'), 'Remove the dedicated auth profile')
}

export function attachCliRootHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'Workflow Guide',
      lines: [
        'Browser runtime and recovery: plan, auth login, auth logout, browser start, browser list, browser status, browser stop, browser restart, browser cleanup-stale.',
        'Chat delivery and session workflows: inspect-home, send-first-message, sync-session, list-sessions, reply, inspect-session, continue-message, edit-message, regenerate-message, list-branches, export-session, delete-session.',
        'Mode, controls, and release diagnostics: inspect-controls, mode-audit, selector-drift-audit, endpoint-drift-audit, output-drift-audit, endpoints, release-diff, release-triage, release-boundaries, release-revalidate, release-change-ledger, release-handoff-matrix, release-audit.',
        'Docs, long-lived entrypoints, and maintainer utilities: version, skillbook, interactive, serve, show-plan.',
      ],
    },
    {
      title: 'Browser Mode Defaults',
      lines: [
        'One-shot CLI fully implicit requests on the shared default endpoint are auto-managed conservatively.',
        'Without managed-only constraints, the request stays attach-compatible: reuse a registered runtime first, otherwise attach an active DevTools endpoint if one is detected.',
        'If deepseek auth login has created a dedicated auth profile, ordinary one-shot commands use it by default as managed-required.',
        'Explicit --clone-chrome-profile is legacy Chrome source profile cloning: reuse managed runtime, launch managed Chrome on the requested endpoint, or auto-isolate; it never auto-attaches to an external browser.',
        'The only default clone contract copies Local State plus the DeepSeek cookie domain slice and DeepSeek localStorage origin slice from one detected source profile; it is not a whole-profile or full-root clone.',
        '--chrome-user-data-dir pins the source user-data-dir root; when multiple profiles exist, DeepSeek cookies are used to auto-select one source profile or fail closed if ambiguous.',
        '--chrome-profile-directory is only an override for ambiguous multi-profile roots, for example Default or "Profile 4".',
        'interactive/RPC still default to attach; auth profile or legacy --clone-chrome-profile upgrades them to warm runtime reuse instead of the one-shot CLI policy graph.',
        '--browser-id, explicit --browser-mode, and explicit custom --cdp-url pin intent and keep conflicts fail closed instead of being silently rerouted.',
      ],
    },
    {
      title: 'Output Mode Rules',
      lines: [
        'Buffered output: omit --stream and use --format text or --format json.',
        'Streaming output: add --stream and use --format text or --format stream-json.',
        '--json-shape only applies to JSON-compatible output families and is rejected for plain text.',
        'Current stream status: one-shot CLI, interactive shell, and JSON-RPC reply-family surfaces are live; deepseek.stream.event is the authoritative RPC live notification method.',
      ],
    },
    {
      title: 'Quick Starts',
      lines: [
        'deepseek auth login',
        'deepseek version',
        'deepseek plan',
        'deepseek skillbook',
        'deepseek sync-session --headless',
        'deepseek list-sessions',
        'deepseek sync-session --session-id ds_session_123 --headless',
        'deepseek reply --message "用三句话介绍 DeepSeek" --headless --quiet --format text',
        'deepseek browser start --headless --browser-purpose primary',
        'deepseek interactive',
      ],
    },
  ])
}

export function attachPlanHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'What It Shows',
      lines: [
        'Prints the resolved execution plan plus requestIntent and policyPreview for the current browser flags.',
        'requestIntent tells you whether the request is explicit-intent, fully-implicit-attach-compatible, or fully-implicit-managed-required.',
        'policyPreview shows the bounded action graph that is legal before any live endpoint probe happens.',
      ],
    },
    {
      title: 'Policy Rules',
      lines: [
        'Fully implicit attach-compatible one-shot CLI: reuse-registered-runtime -> attach-existing-devtools-endpoint -> fail-closed.',
        'Fully implicit managed-required one-shot CLI: reuse-registered-runtime -> launch-managed-on-requested-endpoint -> allocate-isolated-managed-runtime -> fail-closed.',
        'Explicit --browser-id, explicit --browser-mode, and explicit cdp-url pin the request and disable silent reroute.',
      ],
    },
    {
      title: 'Examples',
      lines: [
        'deepseek plan',
        'deepseek plan --clone-chrome-profile',
        'deepseek plan --browser-id warm-primary-1234abcd',
      ],
    },
  ])
}

export function attachBrowserHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'Command Roles',
      lines: [
        'start: create or reuse a managed warm runtime and return its browserId.',
        'list/status: inspect runtime ownership, purpose, state, TTL, and lease details.',
        'stop/restart: managed runtimes only; attach/external runtimes fail closed instead of killing user Chrome.',
        'cleanup-stale: remove stale managed runtimes and forget dead attach metadata without claiming external browser ownership.',
      ],
    },
    {
      title: 'Examples',
      lines: [
        'deepseek browser start --headless --browser-purpose regression',
        'deepseek browser list',
        'deepseek browser stop --browser-id warm-primary-1234abcd',
      ],
    },
  ])
}

export function attachAuthHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'Profile Contract',
      lines: [
        'login creates a dedicated DeepSeek Chrome user-data-dir under ~/.deepseek-cdp-cli/auth/chrome-profile.',
        'After login succeeds, future commands use that dedicated profile by default unless browser/profile options are explicitly provided.',
        '--clone-chrome-profile keeps its original meaning: clone a normal Chrome source profile, optionally selected by --chrome-user-data-dir and --chrome-profile-directory.',
        'logout removes only this dedicated local auth profile; it does not delete remote DeepSeek sessions or touch your normal Chrome profiles.',
      ],
    },
    {
      title: 'Examples',
      lines: [
        'deepseek auth login',
        'deepseek auth login --force',
        'deepseek auth logout',
      ],
    },
  ])
}

export function attachBrowserStartHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'Lifecycle Notes',
      lines: [
        'browser start always creates or reuses a managed warm runtime; it does not attach to an existing user Chrome.',
        '--chrome-user-data-dir points at a Chrome user-data-dir root; browser start auto-detects the DeepSeek source profile from cookies and copies only DeepSeek cookie/localStorage state.',
        '--chrome-profile-directory selects a source profile only when auto-detection is ambiguous.',
        '--idle-ttl-ms only matters after the runtime becomes idle.',
        'Use --browser-purpose probe, regression, or audit to isolate non-primary work from user-facing runtimes.',
      ],
    },
    {
      title: 'Examples',
      lines: [
        'deepseek browser start --headless',
        'deepseek browser start --browser-purpose audit --idle-ttl-ms 300000',
      ],
    },
  ])
}

export function attachDeleteSessionHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'Safety Rules',
      lines: [
        'This command deletes the remote DeepSeek session for the logged-in account; it is not just a local file cleanup.',
        'Non-interactive use requires both --allow-destructive-delete-session and the exact confirmation text derived from the authoritative session id.',
        'Resolve the target by --session-id or --session-file before the browser is opened.',
      ],
    },
    {
      title: 'Example',
      lines: [
        'deepseek delete-session --session-id ds_session_123 --allow-destructive-delete-session --confirm-text "DELETE SESSION ds_session_123"',
      ],
    },
  ])
}

export function attachReplyHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'Session Targeting',
      lines: [
        'Omit --session-id and --session-file to start a new session from home.',
        'Provide --session-id or --session-file to continue an existing stored/authenticated session.',
        'Use list-sessions first when you need to recover a stored sessionId from the local session catalog.',
        'reply does not auto-sync the stored transcript from the webpage; if browser state may be newer, run sync-session --session-id <id> explicitly first.',
      ],
    },
    {
      title: 'Browser Defaults',
      lines: [
        'If deepseek auth login has created a dedicated auth profile, reply uses it by default as managed-required.',
        'Without auth profile or managed-only constraints, the fully implicit default stays attach-compatible on the shared endpoint.',
        'That attach-compatible path may reuse a registered runtime first or attach an active DevTools endpoint when it is safe.',
        'Legacy --clone-chrome-profile also makes reply managed-required: it only reuses managed runtime, launches managed Chrome, or auto-isolates to another local port; it does not auto-attach.',
        'The legacy clone contract copies only Local State plus the DeepSeek cookie domain slice and DeepSeek localStorage origin slice from one detected source profile; it does not copy whole Local Storage, whole IndexedDB, or whole Service Worker stores.',
        '--browser-id, explicit --browser-mode, and explicit custom --cdp-url pin the request and keep endpoint conflicts fail closed.',
      ],
    },
    {
      title: 'Mode, Files, and Output',
      lines: [
        '--chat-mode targets Instant, Expert, Vision, or unchanged before sending.',
        '--file can be repeated; attachment uploads fail closed whenever the settled mode surface lacks a real file input.',
        'Buffered text/json omit --stream; streaming text/stream-json add --stream; --json-shape requires a JSON-compatible output family.',
        '--quiet silences runtime logs; text replies still print a sessionId footer so you can continue the same session without rereading stderr.',
      ],
    },
    {
      title: 'Examples',
      lines: [
        'deepseek reply --message "用三句话介绍 DeepSeek" --headless --quiet --format text',
        'deepseek reply --message "继续总结一下上一个会话" --session-id ds_session_123 --stream --format text',
        'deepseek reply --message "比较这两个文件" --headless --chat-mode expert --file ./notes.pdf --file ./diff.txt --format text',
      ],
    },
  ])
}

export function attachModeAuditHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'Audit Scope',
      lines: [
        'Covers the default home surface plus explicit Instant, Expert, and Vision image runs, authority signals, and downstream mode-fact delivery surfaces.',
        'File capability only counts when a real input[type=file] is present; icon visibility alone is not enough.',
        'Vision uses --vision-file when provided, otherwise mode-audit creates a temporary PNG probe and expects upload/ref_file_ids evidence.',
        'This does not claim OpenAI-compatible HTTP image input; Vision is currently a browser --chat-mode + --file path.',
      ],
    },
    {
      title: 'Runtime Rules',
      lines: [
        'mode-audit can run as a normal one-shot CLI browser flow, or reuse a dedicated warm audit runtime by browserId.',
        'If you pass --browser-id, that runtime must have purpose=audit; start one first with browser start --browser-purpose audit.',
        'If you do not pass --browser-id, mode-audit keeps the normal one-shot CLI browser defaults; auth profile is preferred over legacy clone-profile isolation.',
      ],
    },
    {
      title: 'Examples',
      lines: [
        'deepseek mode-audit --headless --output artifacts/deepseek-mode-audit.real.json',
        'deepseek mode-audit --vision-file ./vision-probe.png --output artifacts/deepseek-mode-audit.vision.json',
        'deepseek browser start --browser-purpose audit --headless',
        'deepseek mode-audit --browser-id warm-audit-1234abcd --output artifacts/deepseek-mode-audit.real.json',
      ],
    },
  ])
}

export function attachContinueMessageHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'Target Rules',
      lines: [
        '--message-id identifies the assistant message to continue.',
        'Use --branch-id and --active-branch-id when the same message id appears in multiple branches.',
        'Provide --session-id or --session-file so the command can resolve authoritative session context before opening the browser.',
      ],
    },
    {
      title: 'Preflight Hint',
      lines: [
        'Use prepare-continue-target when you need to create a fresh stopped message and verify it is resumable before calling continue-message.',
      ],
    },
  ])
}

export function attachPrepareContinueHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'What It Does',
      lines: [
        'Sends a prompt, waits for generation to become stoppable, clicks stop, and records authoritative continue evidence.',
        'Use this when you want a reproducible continue target instead of guessing whether an existing stopped message is resumable.',
      ],
    },
    {
      title: 'Example',
      lines: [
        'deepseek prepare-continue-target --message "Write a long draft" --stop-after-ms 800 --chat-mode instant',
      ],
    },
  ])
}

export function attachListSessionsHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'Boundary',
      lines: [
        'Lists locally stored DeepSeek session files only; this is not a remote account history browser.',
        'Scans top-level *.json files under --session-store-dir and ignores nested artifacts such as openai-http/**.',
      ],
    },
    {
      title: 'Filter and Output Rules',
      lines: [
        '--query matches sessionId, title, and userPromptPreview with case-insensitive substring search.',
        '--limit truncates the matched catalog after persistedAt-desc sorting.',
        '--format text writes the human-readable catalog to stdout and warnings to stderr; --format json prints the authoritative machine envelope unchanged.',
      ],
    },
    {
      title: 'Examples',
      lines: [
        'deepseek list-sessions',
        'deepseek list-sessions --query "预算" --limit 10',
        'deepseek list-sessions --format json',
      ],
    },
  ])
}

export function attachSyncSessionHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'Boundary',
      lines: [
        'Omit --session-id and --session-file to reconcile only the browser-observed fetch_page session catalog back into the local session store.',
        'Provide --session-id or --session-file for an explicit targeted sync of one already-known local stored session.',
        'The no-target catalog comes from the authenticated browser context only; it is not a stable public HTTP API or a proven complete account-history directory.',
      ],
    },
    {
      title: 'Persistence Rules',
      lines: [
        'No-target mode only imports or refreshes local catalog snapshots; it does not enter each discovered session page or sync transcript, branches, or messages.',
        'Targeted mode resolves one known target before browser restore and saves the merged transcript back to that stored session file.',
        'Use sync-session -> list-sessions to refresh local discoverability, then run reply/export/list-branches separately. If you want a fresh transcript first, run sync-session --session-id <id> explicitly.',
      ],
    },
    {
      title: 'Output Rules',
      lines: [
        'No-target --format text prints discovered/imported/refreshed/unchanged/skipped counts plus warningCount/hasMore/partial; warnings go to stderr.',
        'Targeted --format text prints the synced session id, session file, context source, recovery outcome, and branch/message deltas.',
        '--format json prints the authoritative result envelope for either mode without inventing a second CLI-only shape.',
      ],
    },
    {
      title: 'Examples',
      lines: [
        'deepseek sync-session --headless',
        'deepseek list-sessions',
        'deepseek sync-session --session-id ds_session_123 --headless',
        'deepseek sync-session --session-file ./.deepseek-cdp-cli/sessions/ds_session_123.json --format json',
      ],
    },
  ])
}

export function attachExportSessionHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'Format Contract',
      lines: [
        'text: transcript-first human-readable export aligned with reply --format text.',
        'markdown: document-oriented export that keeps audit sections such as Search Results and Inline References Observed.',
        'json: richest structured export with branch lineage, provenance, search artifacts, citations, and attachments.',
      ],
    },
    {
      title: 'Scope Rules',
      lines: [
        'Provide --branch-id to export one branch.',
        'Omit --branch-id to export the full session across every branch.',
        'export-session reads the local stored session only; it does not auto-sync from the webpage.',
        'Run sync-session first when the webpage transcript may be newer than the local stored session file.',
      ],
    },
    {
      title: 'Examples',
      lines: [
        'deepseek export-session --session-id ds_session_123 --branch-id main --format text --output ./reply.txt',
        'deepseek export-session --session-file ./.deepseek-cdp-cli/sessions/ds_session_123.json --format json --output ./session.json',
      ],
    },
  ])
}

export function attachListBranchesHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'Boundary',
      lines: [
        'Lists branches from the local stored session file only; this command does not auto-sync branch state from the webpage.',
        'Use list-sessions to recover a local sessionId first when needed.',
      ],
    },
    {
      title: 'Sync Hint',
      lines: [
        'If the webpage transcript or branch graph may be newer than the local file, run sync-session --session-id <id> explicitly before list-branches.',
      ],
    },
    {
      title: 'Example',
      lines: [
        'deepseek list-branches --session-id ds_session_123',
      ],
    },
  ])
}

export function attachSelectorDriftAuditHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'Audit Scope',
      lines: [
        'Captures Instant/Expert/Vision home/session/reopen surfaces, message actions, sidebar hover controls, delete-session secondary menu path, and the retained search retry selector baseline.',
        'Vision selector coverage uses the same --vision-file image probe contract as mode-audit and accepts Search as hidden/unavailable in image mode.',
        'This command is for Wave 22 selector drift evidence, not for endpoint or output drift diagnosis.',
      ],
    },
    {
      title: 'Isolation Rules',
      lines: [
        'selector-drift-audit always uses an isolated managed runtime purpose=audit unless you explicitly reuse an audit --browser-id.',
        'Current search retry evidence stays fixture-backed and observation-pending; the command does not force a fresh rate-limit reproduction.',
      ],
    },
    {
      title: 'Example',
      lines: [
        'deepseek selector-drift-audit --output artifacts/deepseek-selector-drift-audit.real.json',
      ],
    },
  ])
}

export function attachEndpointDriftAuditHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'Audit Scope',
      lines: [
        'Combines current mode-audit authority signals with endpoint registry coverage, fixture presence, pending internal audit boundaries, and retained search rate-limit hint/close baseline.',
        'This command is for Wave 22 endpoint drift evidence, not for text/json/export/render drift diagnosis.',
      ],
    },
    {
      title: 'Isolation Rules',
      lines: [
        'endpoint-drift-audit always uses an isolated managed runtime purpose=audit unless you explicitly reuse an audit --browser-id.',
        'Current search rate-limit evidence stays fixture-backed and observation-pending; the command does not force a fresh rate-limit reproduction.',
      ],
    },
    {
      title: 'Boundary Notes',
      lines: [
        'Authoritative mode facts come from request payload, ready SSE, and history_messages; output/render revalidation remains a separate B70A concern.',
        'chat_session/delete_all stays pending internal audit and never becomes a productized command through this audit.',
      ],
    },
    {
      title: 'Example',
      lines: [
        'deepseek endpoint-drift-audit --output artifacts/deepseek-endpoint-drift-audit.real.json',
      ],
    },
  ])
}

export function attachOutputDriftAuditHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'Audit Scope',
      lines: [
        'Combines bounded current Instant/Expert live output smoke with fixture-backed search/citation/lineage rendering baselines for reply and export-session.',
        'Vision image output/export is intentionally not a live output-drift smoke yet; mode-audit and release-diff own Vision image-mode evidence until a dedicated image output wave is added.',
        'This command is for Wave 22 output drift evidence, not for selector or endpoint diagnosis.',
      ],
    },
    {
      title: 'Isolation Rules',
      lines: [
        'output-drift-audit always uses an isolated managed runtime purpose=audit unless you explicitly reuse an audit --browser-id.',
        'Current citation/search rendering baselines stay fixture-backed on purpose; the command does not force fresh search pressure just to regenerate evidence.',
      ],
    },
    {
      title: 'Boundary Notes',
      lines: [
        'reply --format text must stay plain while export-session --format text stays transcript-first; neither surface should silently drift into markdown.',
        'When present, --attachment-file verifies the current Expert attachment-aware contract; otherwise the command warns instead of fabricating attachment evidence.',
      ],
    },
    {
      title: 'Example',
      lines: [
        'deepseek output-drift-audit --attachment-file README.md --output artifacts/deepseek-output-drift-audit.real.json',
      ],
    },
  ])
}

export function attachReleaseAuditHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'Evidence Contract',
      lines: [
        'current proof: current-window gate artifacts whose fingerprints match the authoritative release window.',
        'current audit evidence: selector/endpoint/output drift audits that are current-window and green enough to inform the publish gate without promoting compatibility on their own.',
        'baseline-only: older or stale-window artifacts that remain useful for diff context but cannot stand in as current proof.',
      ],
    },
    {
      title: 'Mixed Window Rules',
      lines: [
        'If selected current artifacts are mixed, trust authoritativeCurrentWindow first; do not hand-merge conclusions across raw mixed selections.',
        'Gate-backed current-window anchors win over audit-only anchors; stale-window mode/mutation/runtime evidence must stay baseline-only until rerun.',
      ],
    },
    {
      title: 'Boundary Categories',
      lines: [
        'rate_limit_observation_pending: the current window still keeps rate-limit evidence fixture-backed or warning-only.',
        'search_only_confirmed: only the search-path retry boundary is confirmed; general retry/failure surfaces remain unresolved.',
        'pending_internal_audit: catalogued endpoints such as delete_all still remain intentionally blocked from productization.',
      ],
    },
    {
      title: 'Failure Triage',
      lines: [
        'If future failures cluster around citations, export rendering, or response formatting, classify them as output drift first before assuming a local regression.',
        'warning-only search/rate-limit observations can keep the publish gate unknown without invalidating the authoritative current-window anchor.',
      ],
    },
    {
      title: 'Example',
      lines: [
        'deepseek release-audit --output evidence/deepseek-release-triage/release-audit.json',
      ],
    },
  ])
}

export function attachReleaseRevalidateHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'Current Window Rules',
      lines: [
        'When selected current artifacts are mixed, release-revalidate reanchors to the authoritative current window instead of trusting the raw latest-artifact list.',
        'The authoritative current window prefers the freshest gate-backed cluster; audit-backed windows are only a fallback when no gate-backed current evidence exists.',
      ],
    },
    {
      title: 'Stage Semantics',
      lines: [
        'wave21EntryAllowed only turns true after layer-specific probes and the targeted gate are complete on the authoritative current window.',
        'wave22AuditAllowed only turns true after full-release regression and docs/spec updates are complete on that same current window.',
      ],
    },
    {
      title: 'Example',
      lines: [
        'deepseek release-revalidate --output evidence/deepseek-release-triage/release-revalidation.json',
      ],
    },
  ])
}

export function attachReleaseHandoffMatrixHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'Current Window Rules',
      lines: [
        'Mode-sensitive reuse only counts when the artifact belongs to the authoritative current window; stale-window evidence stays historical even if it is the newest file on disk.',
        'If no current-window mode-audit exists, mode-sensitive Wave 21/Wave 22 entries fail closed to pending-rerun instead of silently inheriting old coverage.',
      ],
    },
    {
      title: 'What It Emits',
      lines: [
        'Per-task mode coverage, required permutations, current status, suggested commands, and historical invalidation boundaries for Wave 21 and Wave 22.',
        'Use this report to decide which scenarios must be rerun on the current window, not to promote audit-only evidence into publish-gate passes.',
      ],
    },
    {
      title: 'Example',
      lines: [
        'deepseek release-handoff-matrix --output evidence/deepseek-release-triage/release-handoff-matrix.json',
      ],
    },
  ])
}

export function attachSendFirstMessageHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'What It Does',
      lines: [
        'Always starts from home, sends the first user message, and waits for the authoritative session URL jump.',
        'Use reply instead when you may need to continue an existing session by --session-id or --session-file.',
      ],
    },
    {
      title: 'Browser and Output Rules',
      lines: [
        'If deepseek auth login has created a dedicated auth profile, send-first-message uses it by default as managed-required.',
        'Without auth profile or managed-only constraints, the fully implicit default stays attach-compatible on the shared endpoint.',
        'Legacy --clone-chrome-profile makes the command managed-required: it stays inside the managed family and never auto-attaches to an external browser.',
        'The legacy clone contract keeps Local State plus the DeepSeek cookie domain slice and DeepSeek localStorage origin slice from one detected source profile, not a full-root copy.',
        'Buffered text/json omit --stream; streaming text/stream-json add --stream; --json-shape requires a JSON-compatible output family.',
      ],
    },
    {
      title: 'Example',
      lines: [
        'deepseek send-first-message --message "Start a new research thread" --headless --chat-mode expert --file ./brief.pdf',
      ],
    },
  ])
}

export function attachEditMessageHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'Target Rules',
      lines: [
        '--message-id selects the stored user message to edit.',
        'Use --branch-id and --active-branch-id when the same message id appears in multiple branches.',
        'Provide --session-id or --session-file so the command can resolve authoritative session context before editing.',
      ],
    },
    {
      title: 'Mutation Notes',
      lines: [
        'Editing materializes a new branch; it does not overwrite every stored branch in place.',
        'Mode and output flags apply to the new delivery produced by the edit action.',
      ],
    },
    {
      title: 'Example',
      lines: [
        'deepseek edit-message --session-id ds_session_123 --message-id user_msg_7 --message "Rewrite with stricter sourcing" --format text',
      ],
    },
  ])
}

export function attachRegenerateMessageHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'Target Rules',
      lines: [
        '--message-id selects the stored assistant message to regenerate.',
        'Use --branch-id and --active-branch-id when the same message id appears in multiple branches.',
        'Provide --session-id or --session-file so the command can resolve authoritative session context before regenerating.',
      ],
    },
    {
      title: 'Mutation Notes',
      lines: [
        'Regenerate materializes a new assistant branch rather than mutating every historical branch in place.',
        'Mode and output flags apply to the regenerated delivery produced by this action.',
      ],
    },
    {
      title: 'Example',
      lines: [
        'deepseek regenerate-message --session-id ds_session_123 --message-id assistant_msg_9 --chat-mode instant --format json --json-shape native',
      ],
    },
  ])
}

export function attachInteractiveHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'Browser Defaults',
      lines: [
        'interactive defaults to attach unless a dedicated auth profile is ready.',
        'Auth profile or legacy --clone-chrome-profile upgrades interactive to warm runtime reuse across shell commands; it does not inherit one-shot CLI auto attach / auto-isolate routing.',
        'When interactive uses legacy clone, it uses the same single default contract: Local State plus DeepSeek-only cookie/localStorage state from one detected source profile, and it fails closed on ambiguous DeepSeek profile roots.',
        '--browser-id binds an existing warm runtime instead of launching a new browser.',
      ],
    },
    {
      title: 'Shell State',
      lines: [
        'mode, output, retry, and queued files stay resident until you change or reset them inside the shell.',
        'Use help inside the shell for grouped command families and sticky-state commands.',
      ],
    },
    {
      title: 'Current Streaming Status',
      lines: [
        'interactive reply-family commands now share the same live --stream delivery contract as one-shot CLI commands.',
        'Retry countdowns and prompt boundaries stay line-safe while assistant text is streaming.',
      ],
    },
    {
      title: 'Examples',
      lines: [
        'deepseek interactive',
        'deepseek interactive --browser-id warm-primary-1234abcd --chat-mode expert',
      ],
    },
  ])
}

export function attachServeHelp(command: Command): Command {
  return appendHelpSections(command, [
    {
      title: 'Service Notes',
      lines: [
        'serve selects transport, bind host, HTTP surfaces, optional wrapper auth, and when openai routes are enabled, a process-wide `--openai-*` browser execution profile.',
        'RPC browser lifecycle is still chosen per request; OpenAI-compatible requests use the startup-time OpenAI execution profile instead.',
        'The process-wide OpenAI execution profile stays rpc-scoped and does not inherit one-shot CLI auto attach / auto-isolate rerouting.',
        'When `--openai-clone-chrome-profile` is enabled, the process-wide managed browser uses the same single default contract: Local State plus DeepSeek-only cookie/localStorage state from one detected source profile; it is not a whole-profile clone.',
        'Current OpenAI HTTP subset: create routes `POST /v1/chat/completions` and `POST /v1/responses` support buffered + streaming; minimal stored-object routes for `chat.completions` and `responses` are also registered. Use model aliases `deepseek-chat-browser` or `deepseek-expert-browser`.',
        'Official ingress currently accepted: chat `web_search_options`/`reasoning_effort` and responses `tools[].type=web_search_preview*`/`reasoning`; `deepseek_options` plus legacy top-level `/v1/responses.input[]` `input_file { filename, file_data }` remain migration/fallback compatibility only.',
        `Precision boundary: chat \`${requestControlContract.chat.officialSearch.coarseHintFields.join('`/`')}\` and responses \`${requestControlContract.responses.officialSearch.coarseHintFields.join('`/`')}\` are hint-only fields, not full-fidelity browser controls.`,
        `Reasoning boundary: chat \`reasoning_effort\` and responses \`reasoning.effort\` are many-to-one mappings onto a binary DeepThink toggle; responses \`reasoning.${requestControlContract.responses.officialReasoning.rejectedFields.join('`/`reasoning.')}\` remain explicit reject.`,
        'Release tiers: truthful subset release covers the supported/transition/future-wave split; GA hardening additionally requires the official SDK live matrix and request-control anti-overclaim proof to stay current.',
        'Evidence commands: `npm run proof:openai-http`, `OPENAI_HTTP_LIVE_SDK=1 npm run test:openai-sdk-live`, and `npm run proof:openai-http-request-controls`.',
        'OpenAI HTTP is fail-closed: unsupported routes such as `/v1/models`, unknown models, and unsupported request fields are rejected instead of silently ignored.',
        'Future-wave surfaces stay explicit unsupported instead of framework 404: `/v1/conversations*`, `POST /v1/responses/input_tokens`, `POST /v1/responses/compact`, `/v1/files*`, background/include-only responses semantics, and unsupported multimodal/tool families.',
        'Call system.describe first to inspect methods, output modes, current live streaming statuses, composer mode options, and session export formats.',
        'RPC stream=true is live: deepseek.stream.event is flushed incrementally over both stdio and HTTP before the final success envelope.',
        'HTTP defaults to host 127.0.0.1 and surface rpc; openai/both requires --http-api-key or DEEPSEEK_HTTP_API_KEY.',
      ],
    },
    {
      title: 'Examples',
      lines: [
        'deepseek serve --transport stdio',
        'deepseek serve --transport http --port 8787',
        'deepseek serve --transport http --host 127.0.0.1 --http-surface both --http-api-key local-dev-key',
        'deepseek serve --transport http --http-surface openai --http-api-key local-dev-key --openai-cdp-url http://127.0.0.1:9222',
      ],
    },
  ])
}
