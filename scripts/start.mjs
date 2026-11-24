// Nitro reads these variables when its Node listener starts.
process.umask(0o077)
process.env.HOST ??= '127.0.0.1'
process.env.PORT ??= '8765'
await import('../.output/server/index.mjs')
