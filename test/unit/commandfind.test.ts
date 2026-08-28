import { describe, expect, it } from 'vitest'
import { FLOOR, findCommands, rate, score } from '../../src/ui/commandFind'

/* Finding a command by typing at it.
 *
 * The looseness is the feature — "tdy" has to find "Tidy up the whole board" —
 * and the looseness is also the problem, because a subsequence match will take
 * letters scattered across a whole sentence. Every command the app grows makes
 * every query match a little more, until the list stops narrowing anything.
 * That is not hypothetical: it is how this was found. */

const c = (name: string, keywords?: string) => ({ name, keywords })

describe('the letters, in order', () => {
  it('finds a command from the middle of its words', () => {
    expect(score('Tidy up the whole board', 'tdy')).toBeGreaterThan(0)
    expect(score('Export the selected pictures', 'expic')).toBeGreaterThan(0)
  })

  it('says no when a letter is missing', () => {
    expect(score('Tidy up the whole board', 'tdyz')).toBe(0)
  })

  it('prefers the thing you meant to the thing with the same letters in it', () => {
    /* Both contain n, o, t, e in order. Only one of them is a note. */
    expect(score('Note', 'note')).toBeGreaterThan(score('Clear up files nothing uses any more', 'note'))
  })

  it('lets a keyword find a command, without outranking a name', () => {
    const named = c('Note')
    const keyworded = c('Label', 'note text writing')
    expect(rate(keyworded, 'note')).toBeGreaterThan(0)
    expect(rate(named, 'note')).toBeGreaterThan(rate(keyworded, 'note'))
  })
})

describe('the floor under it', () => {
  /* The real list, near enough: the names that actually collide on "note". */
  const list = [
    c('Note', 'text write checklist'),
    c('Label', 'title heading caption'),
    c('Clear up files nothing uses any more', 'storage space free disk clean unused orphan'),
    c('Delete a board and everything in it', 'remove board destroy nested'),
    c('Connect to Claude', 'mcp agent relay attach'),
    c('Tidy up the whole board', 'grid align layout sort'),
    c('Export this board and everything in it', 'zip backup save download'),
    c('Present the board', 'slideshow full screen show'),
  ]

  it('puts what you asked for first', () => {
    expect(findCommands(list, 'note')[0].name).toBe('Note')
  })

  it('drops the ones that only have the letters in the right order', () => {
    const found = findCommands(list, 'note').map((f) => f.name)
    /* This one matches n-o-t-e across four separate words and is the reason
     * the list stopped narrowing when three commands were added. */
    expect(found).not.toContain('Clear up files nothing uses any more')
    expect(found.length).toBeLessThan(list.length / 2)
  })

  it('still finds a real second choice', () => {
    /* A floor that only ever returned one answer would be a worse list, not a
     * better one. */
    const found = findCommands([c('Export this board'), c('Export the selected pictures')], 'export')
    expect(found).toHaveLength(2)
  })

  it('shows everything when nothing has been typed', () => {
    expect(findCommands(list, '')).toHaveLength(list.length)
    expect(findCommands(list, '   ')).toHaveLength(list.length)
  })

  it('shows nothing rather than everything when nothing matches', () => {
    expect(findCommands(list, 'zzzz')).toEqual([])
  })

  it('is a fraction of the best rather than a number of points', () => {
    /* An absolute cutoff would empty the list for a query that is a weak but
     * honest match for everything. Measured against the best answer, a weak
     * query keeps its weak answers. */
    expect(FLOOR).toBeGreaterThan(0)
    expect(FLOOR).toBeLessThan(1)
    const weak = findCommands([c('Aaaa bbbb cccc'), c('Aaaa bbbb dddd')], 'ab')
    expect(weak.length).toBe(2)
  })
})

describe('a word you actually typed', () => {
  /* Found by the help screen the moment it existed. Typing "help" put
     "Export the selected pictures as PNG" first — e, h, l, p really are in
     that order in it — and the command called Help second. Four letters in
     the right order is a coincidence; a whole word is not. */
  it('beats the same letters scattered through a sentence', () => {
    const list = [
      { name: 'Export the selected pictures as PNG', keywords: 'save download' },
      { name: 'How this works', keywords: 'help guide manual docs explain keys shortcuts' },
    ]
    expect(findCommands(list, 'help')[0].name).toBe('How this works')
  })

  it('counts the start of a word, not only a whole one', () => {
    const list = [
      { name: 'Clear up files nothing uses any more' },
      { name: 'Note', keywords: 'text write checklist' },
    ]
    expect(findCommands(list, 'not')[0].name).toBe('Note')
  })

  it('does not count a word buried inside another', () => {
    /* "png" is in "opngroup" and starts nothing. */
    const list = [{ name: 'Export as PNG' }, { name: 'The opngroup thing' }]
    expect(findCommands(list, 'png')[0].name).toBe('Export as PNG')
  })

  it('still prefers the name over the keywords', () => {
    const list = [
      { name: 'Something else entirely', keywords: 'present slideshow' },
      { name: 'Present the board' },
    ]
    expect(findCommands(list, 'present')[0].name).toBe('Present the board')
  })

  it("leaves a query that is nobody\'s word to the ordinary scoring", () => {
    const list = [{ name: 'Export the selected pictures' }, { name: 'Tidy up the whole board' }]
    expect(findCommands(list, 'expic')[0].name).toBe('Export the selected pictures')
  })
})
