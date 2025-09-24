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
    const q = (req.query.q || req.query.search || '').toString().toLowerCase().trim()
    const race = (req.query.race || '').toString().toLowerCase().trim().split(',').filter(Boolean)

    let list = router.db.get('characters').value() || []

    // Apply full-text search across a few useful fields
    if (q) {
      const nq = norm(q)
      list = list.filter((item) => {
        return norm(item.name).includes(nq)
      })
    }

    if (race.length) {
      list = list.filter((item) => {
        const races = item?.appearance?.race?.toLowerCase().split('/') ?? []
        return race.some((r) => races.includes(r))
      })
    }

    const total = list.length
    const pages = Math.max(1, Math.ceil(total / limit))
    const currentPage = Math.min(page, pages)
    const start = (currentPage - 1) * limit
    const end = start + limit
    const data = list.slice(start, end)

    console.log(race)

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
