import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const kebabName = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+)+$/

async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '__pycache__') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await check(path)
    } else if (
      path !== join('src', 'routes', '__root.tsx') &&
      !kebabName.test(entry.name)
    ) {
      console.error('文件名应使用 kebab-case：' + path)
      process.exitCode = 1
    }
  }
}

for (const directory of ['src', 'scripts', 'tests']) await check(directory)
