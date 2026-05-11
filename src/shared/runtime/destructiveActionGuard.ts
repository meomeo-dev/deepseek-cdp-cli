import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

export interface DestructiveActionConfirmationInput {
  actionLabel: string
  allowOptionName: string
  allowOptionEnabled: boolean
  confirmationText: string
  providedConfirmationText?: string | undefined
  interactive?: boolean | undefined
  prompt?:
    | ((message: string) => Promise<string>)
    | undefined
  output?:
    | {
        write(chunk: string): void
      }
    | undefined
}

export async function ensureCliDestructiveActionConfirmed(
  input: DestructiveActionConfirmationInput,
): Promise<void> {
  const interactive = input.interactive ?? (stdin.isTTY === true && stdout.isTTY === true)

  if (!input.allowOptionEnabled) {
    throw new Error(
      `Refusing to ${input.actionLabel}. Pass ${input.allowOptionName} to acknowledge the destructive action.`,
    )
  }

  if (input.providedConfirmationText !== undefined) {
    assertConfirmationTextMatches({
      actionLabel: input.actionLabel,
      confirmationText: input.confirmationText,
      actualConfirmationText: input.providedConfirmationText,
    })
    return
  }

  if (!interactive) {
    throw new Error(
      `Refusing to ${input.actionLabel} without an interactive TTY prompt. Re-run with ${input.allowOptionName} and --confirm-text "${input.confirmationText}".`,
    )
  }

  const output = input.output ?? stdout
  output.write(`Dangerous action: ${input.actionLabel}\n`)
  output.write('This operation cannot be undone.\n')

  const answer = await (input.prompt ?? promptWithReadline)(
    `Type ${input.confirmationText} to continue: `,
  )

  assertConfirmationTextMatches({
    actionLabel: input.actionLabel,
    confirmationText: input.confirmationText,
    actualConfirmationText: answer,
  })
}

async function promptWithReadline(message: string): Promise<string> {
  const prompt = readline.createInterface({
    input: stdin,
    output: stdout,
  })

  try {
    return await prompt.question(message)
  } finally {
    prompt.close()
  }
}

function assertConfirmationTextMatches(input: {
  actionLabel: string
  confirmationText: string
  actualConfirmationText: string
}): void {
  if (input.actualConfirmationText !== input.confirmationText) {
    throw new Error(
      `Destructive action cancelled for ${input.actionLabel}: confirmation text mismatch.`,
    )
  }
}
