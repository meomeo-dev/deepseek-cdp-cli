import { randomUUID } from 'node:crypto'
import {
  chmod,
  mkdir,
  open,
  rename,
  unlink,
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export type PrivateAtomicWrite = (
  filePath: string,
  content: string,
) => Promise<void>

export async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
}

export async function writePrivateFileAtomically(
  filePath: string,
  content: string,
): Promise<void> {
  const directory = dirname(filePath)
  await ensurePrivateDirectory(directory)
  const temporaryPath = join(
    directory,
    `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  let handle: Awaited<ReturnType<typeof open>> | null = null

  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temporaryPath, filePath)
    await chmod(filePath, 0o600)
    await syncDirectory(directory)
  } catch (error) {
    await handle?.close().catch(() => {})
    await unlink(temporaryPath).catch(unlinkError => {
      if (!isNodeError(unlinkError, 'ENOENT')) {
        throw unlinkError
      }
    })
    throw error
  }
}

export async function writePrivateFileExclusively(
  filePath: string,
  content: string,
): Promise<void> {
  const directory = dirname(filePath)
  await ensurePrivateDirectory(directory)
  const handle = await open(filePath, 'wx', 0o600)
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await syncDirectory(directory)
}

export async function withPrivateFileLock<T>(
  lockPath: string,
  action: () => Promise<T>,
): Promise<T> {
  await ensurePrivateDirectory(dirname(lockPath))
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(lockPath, 'wx', 0o600)
  } catch (error) {
    if (isNodeError(error, 'EEXIST')) {
      throw new Error(
        `Preferences update is locked by another process: ${lockPath}`,
      )
    }
    throw error
  }

  try {
    await handle.writeFile(`${process.pid}\n`, 'utf8')
    await handle.sync()
    return await action()
  } finally {
    await handle.close()
    await unlink(lockPath).catch(error => {
      if (!isNodeError(error, 'ENOENT')) {
        throw error
      }
    })
  }
}

export function isNodeError(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
