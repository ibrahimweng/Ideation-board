/* Writes dist/sw.js, with the list of what this build produced written into
 * it.
 *
 * The alternative is a service worker that caches whatever happens to be
 * fetched, which works right up until the first offline load needs a file
 * nobody happened to ask for while online. Naming them means the app is whole
 * the moment it is installed.
 *
 * Run after `vite build`. If it does not run, there is no sw.js and the app
 * behaves exactly as it did before — which is the failure this should have.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const DIST = path.join(process.cwd(), 'dist')
const TEMPLATE = path.join(process.cwd(), 'sw', 'sw.js')

if (!fs.existsSync(DIST)) {
  console.error('build-sw: no dist/ — run vite build first')
  process.exit(1)
}

/* Everything a cold start needs, and nothing else. Not og.png, which only
 * matters to whatever is unfurling a link and is 300KB of nothing to somebody
 * opening the app. */
const SKIP = /^(og\.png|sw\.js)$/

const walk = (dir, base = '') => {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel))
    else if (!SKIP.test(rel)) out.push(rel)
  }
  return out
}

const files = walk(DIST).sort()
const shell = ['/', ...files.map((f) => '/' + f)]

/* The build's own fingerprint. A deploy that produced identical files keeps
 * its cache rather than making everybody fetch the same thing again. */
const sum = createHash('sha1')
for (const f of files) sum.update(f).update(fs.readFileSync(path.join(DIST, f)))
const version = sum.digest('hex').slice(0, 12)

const template = fs.readFileSync(TEMPLATE, 'utf8')
const out = template
  .replace("'__VERSION__'", JSON.stringify(version))
  .replace('__SHELL__', JSON.stringify(shell, null, 1))

if (out.includes('__SHELL__') || out.includes('__VERSION__')) {
  console.error('build-sw: the template did not take its replacements')
  process.exit(1)
}

fs.writeFileSync(path.join(DIST, 'sw.js'), out)
console.log(`build-sw: ${shell.length} files, version ${version}`)
