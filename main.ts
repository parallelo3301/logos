import 'https://deno.land/std@0.213.0/dotenv/load.ts'
import { Hono } from 'https://deno.land/x/hono@v3.12.0/mod.ts'
import { Context } from 'https://deno.land/x/hono@v3.12.0/context.ts'
import { cors, logger, secureHeaders } from 'https://deno.land/x/hono@v3.12.0/middleware.ts'
import { DB } from 'https://deno.land/x/sqlite@v3.8/mod.ts'
import * as bcrypt from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts'

const log = (...args: any[]) => console.log(`[${new Date().toISOString()}]`, ...args)
const errorLog = (...args: any[]) => console.error(`[${new Date().toISOString()}]`, ...args)

const stripTrailingSlash = (str: string) => {
	return str.endsWith('/') ? str.slice(0, -1) : str
}

const dbFile = Deno.env.get('DB_FILE') || './logosdb.sqlite'
const maxFileSizeBytes = parseInt(Deno.env.get('MAX_FILE_SIZE_BYTES') || '2000000', 10)
const publicUrl = stripTrailingSlash(Deno.env.get('PUBLIC_URL') || 'http://localhost:3000')
const defaultExpirationMinutes = parseInt(Deno.env.get('DEFAULT_EXPIRATION_MINUTES') || '1440', 10)

const db = new DB(dbFile)
db.execute(`
  CREATE TABLE IF NOT EXISTS bins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    password VARCHAR(255),
    attempts INTEGER DEFAULT 10,
    value TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`)

const template = (content: string) => {
	const style = `@media (prefers-color-scheme: dark) { body { background: #36393d; color: #fff; } }`
	return `<!DOCTYPE html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>📝 logos</title><style>${style}</style></head><body><pre>${content}</pre></body></html>`
}

const app = new Hono()
app.use('*', secureHeaders())
app.use('*', logger())
app.use('*', cors())

app.get('/', (c: Context) =>
	c.html(template(`<div style="padding: 10px">👋 logos<br>
<form method="POST" action="/"><label>Password (optional)<br><input type="password" name="password" placeholder="anything..." /></label><br>
<textarea name="file" placeholder="your text" style="width: 100%; height: 50vh"></textarea><br>
<input type="hidden" name="isBrowser" value="1" />
<input type="submit" value="Submit" />
</form></div>`)))

app.post('/', async (c: Context) => {
	try {
		const { password, file, isBrowser }: { password?: string; file: File | string; isBrowser?: any } = await c.req.parseBody()

		const fileData = file instanceof File
			? {
				size: file.size,
				content: await file.text(),
			}
			: {
				size: file?.length,
				content: file,
			}

		if (!file || fileData.size === 0 || fileData.size > maxFileSizeBytes) {
			return c.text(`No file, empty, or too big (max ${maxFileSizeBytes} bytes; ${fileData?.size || 0} provided) is not allowed\n`, 400)
		}

		const pass = password && password.length ? await bcrypt.hashSync(password) : null
		const [[id]] = db.query('INSERT INTO bins (password, value) VALUES (?, ?) RETURNING id', [pass, fileData.content])

		const url = `${publicUrl}/${id}`
		if (isBrowser) {
			return c.html(`<a href="${url}">${url}</a>\n`)
		}

		return c.text(`${url}\n`)
	} catch (e) {
		errorLog(e)
		return c.text(`Unexpected error\n`, 500)
	}
})

app.get('/:id', async (c: Context) => {
	try {
		const id = c.req.param('id')
		const [pass, dbId] = db.query('SELECT password, id FROM bins WHERE id = ?', [id])[0] || [null, null]

		if (!dbId) {
			return c.text(`Bin was not found\n`, 404)
		}

		if (pass) {
			return c.html(template(`<form method="POST" action="/${id}">Password: <input type="password" name="password" /><input type="submit" value="Submit" /></form>`))
		}

		const content = db.query('SELECT value FROM bins WHERE id = ?', [id])[0][0]
		return c.text(`${content}\n`)
	} catch (e) {
		errorLog(e)
		return c.text(`Unexpected error\n`, 500)
	}
})

app.post('/:id', async (c: Context) => {
	try {
		const id = c.req.param('id')
		const providedPassword = ((await c.req.parseBody())?.password || '').toString()

		const [pass, attempts] = db.query<[string, number]>('SELECT password, attempts FROM bins WHERE id = ?', [id])[0] || [null, 0]

		if (attempts <= 0) {
			db.query('DELETE FROM bins WHERE id = ?', [id])
			return c.text(`No attempts left, bin removed\n`, 400)
		}

		if (pass && !bcrypt.compareSync(providedPassword, pass)) {
			db.query('UPDATE bins SET attempts = attempts - 1 WHERE id = ?', [id])
			return c.html(
				template(
					`<form method="POST" action="/${id}">Password: <input type="password" name="password" /><input type="submit" value="Submit" /><br>Wrong password, try again (you have limited number of tries before the bin will be removed).</form>`,
				),
			)
		}

		const content = db.query('SELECT value FROM bins WHERE id = ?', [id])[0][0]
		return c.text(`${content}\n`)
	} catch (e) {
		errorLog(e)
		return c.text(`Unexpected error\n`, 500)
	}
})

Deno.cron('auto-remove old bins', { minute: { every: 1 } }, () => {
	try {
		db.query(`DELETE FROM bins WHERE created_at <= datetime('now', '-' || ? || ' minutes')`, [defaultExpirationMinutes])
	} catch (e) {
		errorLog(e)
	}
})

// initiate web server
const port = parseInt(Deno.env.get('PORT') || '3000', 10)
Deno.serve({ port }, app.fetch)
