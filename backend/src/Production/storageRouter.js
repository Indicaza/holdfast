import { createHash } from 'node:crypto'
import { Router } from 'express'
import { requirePermission } from '../Auth/permissions.js'
import { createRateLimiter } from '../Security/httpSecurity.js'

// GET /api/admin/storage/:section, for site administrators only. Read-only
// reports from the storage observatory; no parameters are accepted besides
// the section name. Every request is logged without identifying the user
// beyond a short hash.
export function createStorageRouter({ observatory }) {
  const router = Router()
  router.use(requirePermission('site.admin'), createRateLimiter({ name: 'storage-observatory', windowMs: 60_000, max: 30 }))
  router.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store')
    res.json({ version: 1, sections: observatory.sections })
  })
  router.get('/:section', async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const section = String(req.params.section)
    const actor = createHash('sha256').update(String(req.auth?.user?.id ?? '')).digest('hex').slice(0, 12)
    try {
      const { status, body } = await observatory.report(section)
      console.log(JSON.stringify({ event: 'storage_report', section: observatory.sections.includes(section) ? section : 'unknown', status, actor }))
      if (status === 404) return res.status(404).json({ error: 'unknown_section', sections: observatory.sections })
      return res.status(status).json(body)
    } catch (error) {
      console.error('[storage] report failed', error.message)
      return res.status(500).json({ error: 'report_failed' })
    }
  })
  return router
}
