import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

// A local, S3-compatible object store for tests: the multipart commands
// and GetObject that off-site backups use, with objects and parts kept on
// disk (so large archives do not live in memory). `failOn` injects
// failures, `tamper` changes an object after upload. It is not a real S3
// and proves nothing about a production bucket.
export function createFakeObjectStorage(directory, { failOn = () => null, tamper = null } = {}) {
  const uploads = new Map()
  const calls = []
  let nextUpload = 1
  const objectPath = (key) => path.join(directory, 'objects', encodeURIComponent(key))
  return {
    calls,
    uploads,
    async objectKeys() {
      try { return (await readdir(path.join(directory, 'objects'))).map(decodeURIComponent) } catch { return [] }
    },
    async send(command) {
      const name = command.constructor.name
      const input = command.input
      calls.push({ name, key: input.Key, part: input.PartNumber })
      const failure = failOn({ name, input, calls: calls.length })
      if (failure) throw failure
      if (name === 'CreateMultipartUploadCommand') {
        const id = `upload-${nextUpload++}`
        await mkdir(path.join(directory, 'parts', id), { recursive: true })
        uploads.set(id, { key: input.Key, state: 'open' })
        return { UploadId: id }
      }
      if (name === 'UploadPartCommand') {
        const upload = uploads.get(input.UploadId)
        if (upload?.state !== 'open') throw new Error('NoSuchUpload')
        await writeFile(path.join(directory, 'parts', input.UploadId, String(input.PartNumber).padStart(5, '0')), input.Body)
        return { ETag: `"etag-${input.PartNumber}"` }
      }
      if (name === 'CompleteMultipartUploadCommand') {
        const upload = uploads.get(input.UploadId)
        if (upload?.state !== 'open') throw new Error('NoSuchUpload')
        await mkdir(path.join(directory, 'objects'), { recursive: true })
        const target = objectPath(input.Key)
        await writeFile(target, '')
        for (const part of input.MultipartUpload.Parts) {
          await writeFile(target, await readFile(path.join(directory, 'parts', input.UploadId, String(part.PartNumber).padStart(5, '0'))), { flag: 'a' })
        }
        await rm(path.join(directory, 'parts', input.UploadId), { recursive: true, force: true })
        upload.state = 'complete'
        if (tamper) await tamper(target)
        return {}
      }
      if (name === 'AbortMultipartUploadCommand') {
        const upload = uploads.get(input.UploadId)
        if (upload) upload.state = 'aborted'
        await rm(path.join(directory, 'parts', input.UploadId), { recursive: true, force: true })
        return {}
      }
      if (name === 'GetObjectCommand') {
        const target = objectPath(input.Key)
        const { size } = await stat(target)
        return { ContentLength: size, Body: createReadStream(target) }
      }
      throw new Error(`Unsupported command ${name}`)
    },
  }
}
