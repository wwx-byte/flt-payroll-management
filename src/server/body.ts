// Read at most the endpoint's limit, including requests sent without Content-Length.
export async function limitedBody(
  request: Request,
  limit: number,
): Promise<Buffer<ArrayBuffer> | null> {
  if (Number(request.headers.get('content-length')) > limit) return null
  const reader = request.body?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  if (reader)
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  return Buffer.concat(chunks)
}
