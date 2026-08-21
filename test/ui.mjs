/* UI regression test. Drives every control on the board and reports what
 * broke. Needs a server already running:
 *
 *   npm run dev &
 *   node test/ui.mjs http://localhost:5173
 *
 * It clears the board's IndexedDB first, so do not point it at a browser
 * profile holding work you want to keep.
 */
import { chromium } from 'playwright'
const BASE = process.argv[2] || 'http://localhost:5173'
const results = []
const ok = (name, pass, detail='') => { results.push({name, pass, detail}); console.log(`${pass?'PASS':'FAIL'}  ${name}${detail?'  — '+detail:''}`) }

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => { if (m.type()==='error' && !m.text().includes('favicon')) errors.push('console: '+m.text()) })
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
await page.evaluate(() => indexedDB.deleteDatabase('ideation.board.db'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

const surfaceT = () => page.evaluate(() => document.querySelector('.surface').style.transform)
const addImages = (n) => page.evaluate(async (n) => {
  const dt = new DataTransfer()
  for (let i=0;i<n;i++){
    const c=document.createElement('canvas'); c.width=800;c.height=600
    const x=c.getContext('2d'); const g=x.createLinearGradient(0,0,800,600)
    g.addColorStop(0,`hsl(${i*60%360} 70% 30%)`); g.addColorStop(1,`hsl(${(i*60+80)%360} 70% 70%)`)
    x.fillStyle=g; x.fillRect(0,0,800,600)
    for(let k=0;k<20;k++){x.fillStyle=`hsl(${(i*31+k*29)%360} 60% 45%)`;x.fillRect((k*77)%740,(k*53)%540,60,60)}
    const b=await new Promise(r=>c.toBlob(r,'image/jpeg',0.9))
    dt.items.add(new File([b],`img-${i}.jpg`,{type:'image/jpeg'}))
  }
  const vp=document.querySelector('.viewport')
  const ev=new DragEvent('drop',{bubbles:true,cancelable:true,clientX:250,clientY:220})
  Object.defineProperty(ev,'dataTransfer',{value:dt}); vp.dispatchEvent(ev)
}, n)

// ---------- 1. toolbar add buttons ----------
for (const [label, kind] of [['Note','note'],['Label','label'],['Section','section']]) {
  const before = await page.locator('.card').count()
  await page.getByRole('button',{name:label,exact:true}).click()
  await page.waitForTimeout(350)
  const after = await page.locator('.card').count()
  ok(`toolbar: ${label} adds a card`, after === before+1, `${before} -> ${after}`)
}
// link via prompt
page.once('dialog', d => d.accept('https://example.com/thing'))
await page.getByRole('button',{name:'Link',exact:true}).click()
await page.waitForTimeout(350)
ok('toolbar: Link adds a link card', await page.locator('.card[data-kind="link"]').count() === 1)

// ---------- 2. images ----------
await addImages(3)
await page.waitForTimeout(2500)
ok('drop: 3 images ingested', await page.locator('.card[data-kind="image"]').count() === 3,
   `${await page.locator('.card[data-kind="image"]').count()} present`)

// ---------- 3. zoom bar ----------
const t0 = await surfaceT()
await page.locator('.zoombar button', {hasText:'+'}).first().click()
await page.waitForTimeout(500)
const t1 = await surfaceT()
const zoomLabel = await page.locator('.zoomval').innerText()
ok('zoom: + button moves the surface transform', t0 !== t1, `"${t0}" -> "${t1}" (label ${zoomLabel})`)

await page.locator('.zoomval').click()   // reset to 100%
await page.waitForTimeout(400)
const t2 = await surfaceT()
ok('zoom: reset restores 100%', (await page.locator('.zoomval').innerText()).includes('100'), `transform now "${t2}"`)

// ---------- 4. wheel pan ----------
const before = await surfaceT()
await page.locator('.viewport').hover({position:{x:600,y:400}})
await page.mouse.wheel(0, 120)
await page.waitForTimeout(400)
ok('pan: wheel moves the surface', before !== await surfaceT(), `-> ${await surfaceT()}`)

// ---------- 5. selection ----------
const firstImg = page.locator('.card[data-kind="image"]').first()
await firstImg.click({position:{x:60,y:10}})
await page.waitForTimeout(300)
ok('select: click selects one card', await page.locator('.card[data-sel]').count() === 1)
await page.keyboard.press('Control+a')
await page.waitForTimeout(300)
const selAll = await page.locator('.card[data-sel]').count()
ok('select: Cmd+A selects all non-section cards', selAll >= 5, `${selAll} selected`)
await page.keyboard.press('Escape')
await page.waitForTimeout(250)
ok('select: Escape clears selection', await page.locator('.card[data-sel]').count() === 0)

// ---------- 6. resize handles ----------
await firstImg.click({position:{x:60,y:10}})
await page.waitForTimeout(300)
ok('select: resize handles appear', await page.locator('.handle').count() === 4,
   `${await page.locator('.handle').count()} handles`)

const box0 = await firstImg.boundingBox()
const se = page.locator('.handle-se').first()
const seBox = await se.boundingBox()
await page.mouse.move(seBox.x+5, seBox.y+5)
await page.mouse.down()
await page.mouse.move(seBox.x+85, seBox.y+65, {steps:8})
await page.mouse.up()
await page.waitForTimeout(400)
const box1 = await firstImg.boundingBox()
ok('resize: SE handle grows the card', box1.width > box0.width+30 && box1.height > box0.height+20,
   `${Math.round(box0.width)}x${Math.round(box0.height)} -> ${Math.round(box1.width)}x${Math.round(box1.height)}`)

// ---------- 7. drag ----------
const dbox = await firstImg.boundingBox()
await page.mouse.move(dbox.x+dbox.width/2, dbox.y+8)
await page.mouse.down()
await page.mouse.move(dbox.x+dbox.width/2+120, dbox.y+8+70, {steps:10})
await page.mouse.up()
await page.waitForTimeout(400)
const dbox2 = await firstImg.boundingBox()
ok('drag: card moves', Math.abs(dbox2.x-dbox.x)>80 && Math.abs(dbox2.y-dbox.y)>40,
   `moved ${Math.round(dbox2.x-dbox.x)},${Math.round(dbox2.y-dbox.y)}`)

// ---------- 8. undo / redo ----------
await page.keyboard.press('Control+z')
await page.waitForTimeout(400)
const dbox3 = await firstImg.boundingBox()
ok('undo: Cmd+Z reverts the drag', Math.abs(dbox3.x-dbox.x)<25 && Math.abs(dbox3.y-dbox.y)<25,
   `back to ${Math.round(dbox3.x-dbox.x)},${Math.round(dbox3.y-dbox.y)} of origin`)
await page.keyboard.press('Control+Shift+z')
await page.waitForTimeout(400)
const dbox4 = await firstImg.boundingBox()
ok('redo: Shift+Cmd+Z reapplies', Math.abs(dbox4.x-dbox2.x)<25 && Math.abs(dbox4.y-dbox2.y)<25,
   `at ${Math.round(dbox4.x-dbox2.x)},${Math.round(dbox4.y-dbox2.y)} of redone pos`)

// ---------- 9. duplicate & delete ----------
const cnt0 = await page.locator('.card').count()
await firstImg.click({position:{x:60,y:10}})
await page.waitForTimeout(200)
await page.keyboard.press('Control+d')
await page.waitForTimeout(500)
const cnt1 = await page.locator('.card').count()
ok('duplicate: Cmd+D copies the selection', cnt1 === cnt0+1, `${cnt0} -> ${cnt1}`)
await page.keyboard.press('Delete')
await page.waitForTimeout(400)
ok('delete: Delete removes the selection', await page.locator('.card').count() === cnt0,
   `${cnt1} -> ${await page.locator('.card').count()}`)

// ---------- 10. arrow nudge ----------
await firstImg.click({position:{x:60,y:10}})
await page.waitForTimeout(200)
const nb0 = await firstImg.boundingBox()
for (let i=0;i<5;i++) await page.keyboard.press('ArrowRight')
await page.waitForTimeout(400)
const nb1 = await firstImg.boundingBox()
ok('keyboard: arrow nudges the card', nb1.x > nb0.x+2, `moved ${Math.round(nb1.x-nb0.x)}px`)

// ---------- 11. effects panel ----------
ok('panel: effects panel is open', await page.locator('.panel').count() === 1)
const thumbs = await page.locator('.fx-thumb').count()
ok('panel: all 24 effects listed', thumbs === 24, `${thumbs} thumbnails`)
await page.waitForTimeout(2500)
const thumbShot = await page.locator('.fx-thumb').nth(5).screenshot()
ok('panel: previews render real pixels', thumbShot.length > 1500, `${thumbShot.length} bytes`)

await page.locator('.fx-thumb[title="Halftone"]').click()
await page.waitForTimeout(2000)
const ctlCount = await page.locator('.fx-controls .ctl').count()
ok('panel: effect controls appear', ctlCount >= 5, `${ctlCount} controls`)

// slider drag
const slider = page.locator('.fx-controls input[type=range]').first()
const sv0 = await slider.inputValue()
await slider.fill(String(Number(sv0)+3))
await page.waitForTimeout(1200)
const sv1 = await slider.inputValue()
ok('panel: effect slider changes value', sv0 !== sv1, `${sv0} -> ${sv1}`)

// colour input present
ok('panel: colour controls render', await page.locator('.ctl-color input[type=color]').count() >= 1)
// enum segmented
ok('panel: enum controls render', await page.locator('.seg').count() >= 1)

// reset
await page.getByRole('button',{name:/^Reset /}).first().click()
await page.waitForTimeout(800)
ok('panel: reset restores defaults', (await slider.inputValue()) === sv0, `back to ${await slider.inputValue()}`)

// ---------- 12. adjust tab ----------
await page.getByRole('button',{name:'Adjust',exact:true}).click()
await page.waitForTimeout(500)
ok('panel: Adjust tab opens', await page.locator('.preset-row').count() === 1)
await page.getByRole('button',{name:'Noir',exact:true}).click()
await page.waitForTimeout(700)
const filt = await page.evaluate(() => {
  const b = document.querySelector('.card[data-sel] .card-body')
  return b ? getComputedStyle(b).filter : 'none'
})
ok('adjust: preset applies a CSS filter', filt !== 'none' && filt.length > 4, filt.slice(0,60))

const flipBtn = page.getByRole('button',{name:'Flip H',exact:true})
await flipBtn.click()
await page.waitForTimeout(500)
const tr = await page.evaluate(() => {
  const f = document.querySelector('.card[data-sel] .card-frame')
  return f ? f.style.transform : ''
})
ok('adjust: Flip H sets a transform', tr.includes('scaleX(-1)'), `"${tr}"`)

await page.getByRole('button',{name:'Reset adjustments'}).click()
await page.waitForTimeout(600)
const filt2 = await page.evaluate(() => {
  const b = document.querySelector('.card[data-sel] .card-body')
  return b ? getComputedStyle(b).filter : 'none'
})
ok('adjust: reset clears the filter', filt2 === 'none', filt2.slice(0,40))

await page.getByRole('button',{name:'Effect',exact:true}).click()
await page.waitForTimeout(400)

// ---------- 13. note editor ----------
// add a fresh note so it is on top and not covered by cards moved earlier
await page.getByRole('button',{name:'Note',exact:true}).click()
await page.waitForTimeout(500)
const note = page.locator('.card[data-kind="note"]').last()
await note.dblclick()
await page.waitForTimeout(500)
ok('editor: double click opens the sheet', await page.locator('.sheet').count() === 1)
await page.locator('.sheet textarea').fill('hello from the audit')
await page.locator('.swatches button').nth(2).click()
await page.waitForTimeout(200)
await page.locator('.tag-row button').nth(2).click()
await page.waitForTimeout(200)
await page.getByRole('button',{name:'Save',exact:true}).click()
await page.waitForTimeout(500)
ok('editor: sheet closes on save', await page.locator('.sheet').count() === 0)
ok('editor: note text saved', (await note.innerText()).includes('hello from the audit'),
   JSON.stringify((await note.innerText()).slice(0,40)))
ok('editor: tag dot shows on card', await note.locator('.card-tag').count() === 1)

// ---------- 14. marquee ----------
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await page.mouse.move(1000, 700)
await page.mouse.down()
await page.mouse.move(200, 150, {steps:12})
const marqueeVisible = await page.locator('.marquee').count()
await page.mouse.up()
await page.waitForTimeout(500)
const selAfter = await page.locator('.card[data-sel]').count()
ok('marquee: rectangle renders while dragging', marqueeVisible === 1)
ok('marquee: selects the cards inside it', selAfter > 0, `${selAfter} selected`)

// ---------- 15. panel toggle ----------
await page.getByRole('button',{name:'Effects',exact:true}).click()
await page.waitForTimeout(400)
ok('panel: Effects button closes the panel', await page.locator('.panel').count() === 0)
await page.getByRole('button',{name:'Effects',exact:true}).click()
await page.waitForTimeout(400)
ok('panel: Effects button reopens it', await page.locator('.panel').count() === 1)

// ---------- 16. board name ----------
await page.locator('.board-name').fill('Audit Board')
await page.waitForTimeout(900)
ok('board: name field accepts input', await page.locator('.board-name').inputValue() === 'Audit Board')

// ---------- 17. persistence ----------
const countBefore = await page.locator('.card').count()
await page.waitForTimeout(1200)
await page.reload({ waitUntil:'domcontentloaded' })
await page.waitForTimeout(3000)
const countAfter = await page.locator('.card').count()
ok('persist: cards survive reload', countAfter === countBefore, `${countBefore} -> ${countAfter}`)
ok('persist: board name survives reload', (await page.locator('.board-name').inputValue()) === 'Audit Board',
   await page.locator('.board-name').inputValue())

// ---------- 18. stats ----------
ok('stats: readout renders', (await page.locator('.stats').innerText()).includes('items'),
   (await page.locator('.stats').innerText()).replace(/\n/g,' | '))

console.log('\npage errors:', errors.length ? errors.slice(0,10) : 'none')
const failed = results.filter(r=>!r.pass)
console.log(`\n${results.length-failed.length}/${results.length} checks passed`)
if (failed.length) console.log('FAILURES:\n' + failed.map(f=>`  - ${f.name}${f.detail?'  ('+f.detail+')':''}`).join('\n'))
await browser.close()
process.exit(failed.length ? 1 : 0)
