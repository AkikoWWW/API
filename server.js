const path = require('path')

async function loadJsonServer() {
  try {
    // Try CommonJS require first
    return require('json-server')
  } catch (err) {
    // Fallback to ESM dynamic import
    const mod = await import('json-server')
    return mod.default || mod
  }
}

async function bootstrap() {
  const jsonServer = await loadJsonServer()

  const server = jsonServer.create()
  const db = { characters: require('./characters.json') }
  const router = jsonServer.router(db)
  const middlewares = jsonServer.defaults({
    static: './public',
    logger: true,
  })

  // Default middlewares: logger, static, CORS, and no-cache
  server.use(middlewares)

  // Ensure robust CORS support (json-server enables CORS by default, but we add explicit headers)
  server.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')
    if (req.method === 'OPTIONS') return res.sendStatus(200)
    next()
  })

  // Handle JSON bodies
  server.use(jsonServer.bodyParser)

  // Rewrite /api/* to /* BEFORE custom routes so they match too
  server.use(
    jsonServer.rewriter({
      '/api/*': '/$1',
    }),
  )

  // Example custom routes
  server.get('/health', (req, res) => {
    res.json({ status: 'ok' })
  })

  // You can add more custom endpoints here, e.g.:
  // server.get('/characters/search', (req, res) => { /* implement search */ });

  // Unique list of races
  server.get(['/races', '/api/races'], (req, res) => {
    const list = router.db.get('characters').value() || []
    const racesSet = new Set()
    const addRace = (val) => {
      const r = String(val || '').trim()
      if (!r || r === '-' || r.toLowerCase() === 'null' || r.toLowerCase() === 'n/a') return
      racesSet.add(r)
    }
    for (const ch of list) {
      const race = ch?.appearance?.race
      if (!race) continue
      const raw = String(race)
      // Split by '/' and include all parts
      const parts = raw
        .split('/')
        .map((p) => p.trim())
        .filter(Boolean)
      if (parts.length > 1) {
        for (const p of parts) addRace(p)
      } else {
        addRace(raw)
      }
    }
    const races = Array.from(racesSet).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    )
    res.json(races)
  })

  // Helper to get nested value by path like "powerstats.power"
  const getByPath = (obj, path) => {
    if (!path) return undefined
    return String(path)
      .split('.')
      .reduce((acc, key) => (acc != null ? acc[key] : undefined), obj)
  }

  // Helper: normalize for case-insensitive search
  const norm = (v) => (v == null ? '' : String(v).toLowerCase())

  // Helper to set nested value by path into target object
  const setByPath = (target, path, value) => {
    const keys = String(path).split('.')
    let node = target
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]
      if (i === keys.length - 1) {
        node[k] = value
      } else {
        if (typeof node[k] !== 'object' || node[k] === null) node[k] = {}
        node = node[k]
      }
    }
  }

  // prepareCharacter: pick only requested fields; if fields === '*', return original character
  function prepareCharacter(character, fields) {
    if (!character) return character
    if (fields === '*' || (Array.isArray(fields) && fields.includes('*'))) {
      return character
    }
    const list = Array.isArray(fields)
      ? fields
          .filter(Boolean)
          .map((s) => String(s).trim())
          .filter(Boolean)
      : []
    if (!list.length) return {}
    const out = {}
    for (const p of list) {
      const val = getByPath(character, p)
      if (typeof val !== 'undefined') setByPath(out, p, val)
    }
    return out
  }

  // Pagination + filtering + search + sorting for characters endpoint
  server.get(['/characters', '/api/characters'], (req, res) => {
    const page = Math.max(1, parseInt(req.query.page || req.query._page || '1', 10) || 1)
    const limit = Math.max(1, parseInt(req.query.limit || req.query._limit || '20', 10) || 20)

    const sortKey = (req.query.sort || req.query._sort || '').trim()
    const sortOrder =
      (req.query.order || req.query._order || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc'
    const q = (req.query.q || '').toString().trim()

    // Build filter map from remaining query params (excluding pagination/sorting/search keys)
    const excluded = new Set([
      'page',
      '_page',
      'limit',
      '_limit',
      'sort',
      '_sort',
      'order',
      '_order',
      'q',
      'race',
    ])
    const filters = Object.keys(req.query)
      .filter((k) => !excluded.has(k))
      .reduce((acc, k) => {
        acc[k] = req.query[k]
        return acc
      }, {})

    let list = router.db.get('characters').value() || []

    // Apply full-text search across a few useful fields
    if (q) {
      const nq = norm(q)
      list = list.filter((item) => {
        return (
          norm(item.name).includes(nq) ||
          norm(item.slug).includes(nq) ||
          norm(getByPath(item, 'biography.fullName')).includes(nq) ||
          norm(getByPath(item, 'biography.publisher')).includes(nq)
        )
      })
    }

    // Apply race filter supporting multi-value races split by '/' and comma-separated query values
    if (typeof req.query.race !== 'undefined') {
      const racesWanted = String(req.query.race)
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
      if (racesWanted.length) {
        list = list.filter((item) => {
          const raw = item?.appearance?.race
          if (!raw) return false
          const parts = String(raw)
            .split('/')
            .map((p) => p.trim().toLowerCase())
            .filter(Boolean)
          // match if any of the requested races is present in parts
          return parts.some((p) => racesWanted.includes(p))
        })
      }
    }

    // Apply field filters; support dot-paths (e.g., powerstats.power=100)
    const filterKeys = Object.keys(filters)
    if (filterKeys.length) {
      list = list.filter((item) => {
        return filterKeys.every((key) => {
          const expected = filters[key]
          const actual = getByPath(item, key)

          if (Array.isArray(actual)) {
            return actual.map((v) => String(v)).includes(String(expected))
          }
          // Try numeric equality if both are numeric
          const expNum = Number(expected)
          const actNum = Number(actual)
          if (!Number.isNaN(expNum) && !Number.isNaN(actNum)) {
            return actNum === expNum
          }
          // Fallback to case-insensitive substring for strings
          return norm(actual).includes(norm(expected))
        })
      })
    }

    // Sorting
    if (sortKey) {
      list = [...list].sort((a, b) => {
        const va = getByPath(a, sortKey)
        const vb = getByPath(b, sortKey)
        if (va == null && vb == null) return 0
        if (va == null) return sortOrder === 'asc' ? -1 : 1
        if (vb == null) return sortOrder === 'asc' ? 1 : -1

        const na = Number(va)
        const nb = Number(vb)
        let cmp
        if (!Number.isNaN(na) && !Number.isNaN(nb)) {
          cmp = na - nb
        } else {
          cmp = String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' })
        }
        return sortOrder === 'asc' ? cmp : -cmp
      })
    }

    const total = list.length
    const pages = Math.max(1, Math.ceil(total / limit))
    const currentPage = Math.min(page, pages)
    const start = (currentPage - 1) * limit
    const end = start + limit
    const data = list.slice(start, end)

    res.setHeader('X-Total-Count', String(total))
    res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count')

    let payload = data.map((c) => prepareCharacter(c, ['id', 'name', 'images', 'appearance.race']))

    res.json({ data: payload, meta: { total, page: currentPage, limit, pages } })
  })

  // (Rewriter placed earlier before routes)

  // Mount the router (CRUD routes derived from characters.json)
  server.use(router)

  const PORT = process.env.PORT || 3001
  server.listen(PORT, () => {
    console.log(`JSON Server is running at http://localhost:${PORT}`)
  })
}

bootstrap().catch((e) => {
  console.error('Failed to start JSON Server:', e)
  process.exit(1)
})




