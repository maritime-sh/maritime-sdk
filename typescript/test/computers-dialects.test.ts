import { describe, expect, it } from 'vitest'
import {
  DialectError,
  KEY_MAP_OPENAI,
  MaritimeError,
  QWEN_TERMINAL_ACTIONS,
  SCROLL_PX_PER_CLICK,
  fromGemini,
  fromOpenAI,
  fromQwen,
  mapKeyToken,
  pxToWheelClicks,
  toOpenAIScreenshot,
} from '../src/index.js'
import type { ComputerAction, Frame } from '../src/index.js'

// The frame every golden row below is computed against: desktopd's default
// model frame (1200 wide, 750 high for a 1280x800 physical screen).
const FRAME: Frame = { width: 1200, height: 750, frameId: 1 }

// Mirror of desktopd's `_KEY_ALIASES` (backend/templates/desktop/desktopd/
// server.py `normalize_key`): the spellings desktopd normalizes. A key name
// the converters emit must be one of these (compared case-insensitively),
// an F-key, or a plain X keysym from the small set desktopd passes through.
const DESKTOPD_ALIASES: Record<string, string> = {
  enter: 'Return', return: 'Return', esc: 'Escape', escape: 'Escape',
  backspace: 'BackSpace', del: 'Delete', delete: 'Delete', tab: 'Tab',
  space: 'space', pageup: 'Prior', page_up: 'Prior', pagedown: 'Next',
  page_down: 'Next', home: 'Home', end: 'End', insert: 'Insert',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right',
  ctrl: 'ctrl', control: 'ctrl', alt: 'alt', shift: 'shift',
  super: 'super', win: 'super', cmd: 'super', meta: 'super',
  caps_lock: 'Caps_Lock', capslock: 'Caps_Lock', printscreen: 'Print',
}
const XDOTOOL_KEYSYMS = new Set([
  'slash', 'backslash', 'minus', 'plus', 'equal', 'period', 'comma', 'semicolon',
  'apostrophe', 'grave', 'bracketleft', 'bracketright', 'Print', 'Menu', 'Pause',
  'Scroll_Lock', 'Num_Lock',
])

function desktopdAccepts(name: string): boolean {
  const low = name.toLowerCase()
  if (low in DESKTOPD_ALIASES) return true
  if (/^f\d{1,2}$/.test(low)) return true
  if (XDOTOOL_KEYSYMS.has(name)) return true
  // Single printable characters are xdotool keysyms as-is.
  return name.length === 1
}

// Every key token the OpenAI computer-use model is documented to emit (the
// CUA_KEY_TO_PLAYWRIGHT_KEY table in openai/openai-cua-sample-app), upper-cased
// the way the model sends them.
const OPENAI_TOKENS = [
  '/', '\\', 'ALT', 'ARROWDOWN', 'ARROWLEFT', 'ARROWRIGHT', 'ARROWUP', 'BACKSPACE',
  'CAPSLOCK', 'CMD', 'CTRL', 'DELETE', 'END', 'ENTER', 'ESC', 'HOME', 'INSERT',
  'OPTION', 'PAGEDOWN', 'PAGEUP', 'SHIFT', 'SPACE', 'SUPER', 'TAB', 'WIN',
]

describe('key map', () => {
  it('is total over the documented OpenAI tokens', () => {
    for (const t of OPENAI_TOKENS) {
      expect(KEY_MAP_OPENAI[t], `token ${t}`).toBeTypeOf('string')
    }
  })

  it('emits only names desktopd normalizes', () => {
    for (const [token, name] of Object.entries(KEY_MAP_OPENAI)) {
      expect(desktopdAccepts(name), `${token} -> ${name}`).toBe(true)
    }
  })

  it('golden rows from the plan', () => {
    const rows: Array<[string, string]> = [
      ['ENTER', 'Return'],
      ['ESCAPE', 'Escape'],
      ['ESC', 'Escape'],
      ['PAGEDOWN', 'Page_Down'],
      ['PAGEUP', 'Page_Up'],
      ['META', 'super'],
      ['CMD', 'super'],
      ['WIN', 'super'],
      ['CTRL', 'ctrl'],
      ['CONTROL', 'ctrl'],
      ['OPTION', 'alt'],
      ['ARROWDOWN', 'Down'],
      ['BACKSPACE', 'BackSpace'],
      ['SPACE', 'space'],
      ['CAPSLOCK', 'Caps_Lock'],
      ['/', 'slash'],
      ['\\', 'backslash'],
    ]
    for (const [token, name] of rows) {
      expect(mapKeyToken(token), token).toBe(name)
    }
  })

  it('mapKeyToken is case-insensitive, lower-cases single letters and passes F-keys and unknown keysyms through', () => {
    expect(mapKeyToken('enter')).toBe('Return')
    expect(mapKeyToken('A')).toBe('a')
    expect(mapKeyToken('7')).toBe('7')
    expect(mapKeyToken('F5')).toBe('F5')
    expect(mapKeyToken('f12')).toBe('F12')
    expect(mapKeyToken('Num_Lock')).toBe('Num_Lock')
  })

  it('rejects an empty token', () => {
    expect(() => mapKeyToken('')).toThrow(DialectError)
    expect(() => mapKeyToken('  ')).toThrow(DialectError)
  })
})

describe('pxToWheelClicks', () => {
  it('uses the documented divisor', () => {
    expect(SCROLL_PX_PER_CLICK).toBe(100)
    const rows: Array<[number, number]> = [
      [300, 3],
      [250, 3],
      [30, 1],
      [1, 1],
      [0, 0],
      [-500, 5],
      [149, 1],
      [150, 2],
      [20000, 100],
    ]
    for (const [px, clicks] of rows) expect(pxToWheelClicks(px), String(px)).toBe(clicks)
  })
})

describe('fromOpenAI', () => {
  it('golden table', () => {
    const rows: Array<[unknown, ComputerAction[]]> = [
      [{ type: 'click', x: 10, y: 20, button: 'left' }, [{ action: 'left_click', coordinate: [10, 20] }]],
      [{ type: 'click', x: 10, y: 20 }, [{ action: 'left_click', coordinate: [10, 20] }]],
      [{ type: 'click', x: 10, y: 20, button: 'right' }, [{ action: 'right_click', coordinate: [10, 20] }]],
      [{ type: 'click', x: 10, y: 20, button: 'wheel' }, [{ action: 'middle_click', coordinate: [10, 20] }]],
      [{ type: 'click', x: 10, y: 20, button: 'back' }, [{ action: 'key', key: 'alt+Left' }]],
      [{ type: 'click', x: 10, y: 20, button: 'forward' }, [{ action: 'key', key: 'alt+Right' }]],
      [
        { type: 'click', x: 10, y: 20, button: 'left', keys: ['CTRL'] },
        [{ action: 'left_click', coordinate: [10, 20], modifier: 'ctrl' }],
      ],
      [
        { type: 'click', x: 10, y: 20, keys: ['CTRL', 'SHIFT'] },
        [{ action: 'left_click', coordinate: [10, 20], modifier: 'ctrl+shift' }],
      ],
      [{ type: 'double_click', x: 5, y: 6 }, [{ action: 'double_click', coordinate: [5, 6] }]],
      [{ type: 'move', x: 5, y: 6 }, [{ action: 'mouse_move', coordinate: [5, 6] }]],
      [{ type: 'screenshot' }, [{ action: 'screenshot' }]],
      [{ type: 'wait' }, [{ action: 'wait', duration: 1 }]],
      [{ type: 'type', text: 'hello' }, [{ action: 'type', text: 'hello' }]],
      [{ type: 'keypress', keys: ['ENTER'] }, [{ action: 'key', key: 'Return' }]],
      [{ type: 'keypress', keys: ['CTRL', 'A'] }, [{ action: 'key', key: 'ctrl+a' }]],
      [{ type: 'keypress', keys: ['PAGEDOWN'] }, [{ action: 'key', key: 'Page_Down' }]],
      [{ type: 'keypress', keys: ['META', 'C'] }, [{ action: 'key', key: 'super+c' }]],
      [{ type: 'keypress', keys: ['F5'] }, [{ action: 'key', key: 'F5' }]],
      // Scroll: pixels to wheel clicks, vertical first, then horizontal.
      [
        { type: 'scroll', x: 100, y: 200, scroll_x: 0, scroll_y: 300 },
        [{ action: 'scroll', coordinate: [100, 200], scrollDirection: 'down', scrollAmount: 3 }],
      ],
      [
        { type: 'scroll', x: 100, y: 200, scroll_x: 0, scroll_y: -250 },
        [{ action: 'scroll', coordinate: [100, 200], scrollDirection: 'up', scrollAmount: 3 }],
      ],
      [
        { type: 'scroll', x: 100, y: 200, scroll_x: 30, scroll_y: 0 },
        [{ action: 'scroll', coordinate: [100, 200], scrollDirection: 'right', scrollAmount: 1 }],
      ],
      [
        { type: 'scroll', x: 100, y: 200, scroll_x: -500, scroll_y: 120 },
        [
          { action: 'scroll', coordinate: [100, 200], scrollDirection: 'down', scrollAmount: 1 },
          { action: 'scroll', coordinate: [100, 200], scrollDirection: 'left', scrollAmount: 5 },
        ],
      ],
      [
        { type: 'scroll', x: 100, y: 200, scroll_x: 0, scroll_y: 20000 },
        [{ action: 'scroll', coordinate: [100, 200], scrollDirection: 'down', scrollAmount: 100 }],
      ],
      [
        { type: 'scroll', x: 100, y: 200, scroll_x: 0, scroll_y: 0 },
        [{ action: 'mouse_move', coordinate: [100, 200] }],
      ],
      // Drag: polyline expansion, intermediate steps skip the screenshot.
      [
        { type: 'drag', path: [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 100 }] },
        [
          { action: 'left_mouse_down', coordinate: [0, 0], noScreenshot: true },
          { action: 'mouse_move', coordinate: [50, 50], noScreenshot: true },
          { action: 'left_mouse_up', coordinate: [100, 100] },
        ],
      ],
      [
        { type: 'drag', path: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
        [
          { action: 'left_mouse_down', coordinate: [1, 2], noScreenshot: true },
          { action: 'left_mouse_up', coordinate: [3, 4] },
        ],
      ],
    ]
    for (const [input, expected] of rows) {
      expect(fromOpenAI(input as never, FRAME), JSON.stringify(input)).toEqual(expected)
    }
  })

  it('rounds fractional coordinates to integers', () => {
    expect(fromOpenAI({ type: 'click', x: 10.4, y: 20.6 } as never)).toEqual([
      { action: 'left_click', coordinate: [10, 21] },
    ])
  })

  it('works without a frame (OpenAI coordinates are already pixels of the screenshot)', () => {
    expect(fromOpenAI({ type: 'move', x: 1, y: 2 })).toEqual([{ action: 'mouse_move', coordinate: [1, 2] }])
  })

  it('unknown action is a typed error', () => {
    const err = (() => {
      try {
        fromOpenAI({ type: 'launch_rocket' } as never)
      } catch (e) {
        return e
      }
      return undefined
    })() as DialectError
    expect(err).toBeInstanceOf(DialectError)
    expect(err).toBeInstanceOf(MaritimeError)
    expect(err.code).toBe('unknown_action')
    expect(err.dialect).toBe('openai')
    expect(err.message).toContain('launch_rocket')
  })

  it('rejects a drag with fewer than two points, empty keypress, empty type, and non-numeric coordinates', () => {
    expect(() => fromOpenAI({ type: 'drag', path: [{ x: 1, y: 1 }] })).toThrow(DialectError)
    expect(() => fromOpenAI({ type: 'drag', path: [] })).toThrow(DialectError)
    expect(() => fromOpenAI({ type: 'keypress', keys: [] })).toThrow(DialectError)
    expect(() => fromOpenAI({ type: 'type', text: '' })).toThrow(DialectError)
    expect(() => fromOpenAI({ type: 'click', x: 'a', y: 1 } as never)).toThrow(DialectError)
    try {
      fromOpenAI({ type: 'drag', path: [] })
    } catch (e) {
      expect((e as DialectError).code).toBe('bad_path')
    }
  })
})

describe('toOpenAIScreenshot', () => {
  it('builds a computer_screenshot with a data URL from the result mime', () => {
    expect(toOpenAIScreenshot({ imageB64: 'AAAA', mime: 'image/jpeg', frameId: 3, width: 1200, height: 750 })).toEqual({
      type: 'computer_screenshot',
      image_url: 'data:image/jpeg;base64,AAAA',
    })
  })

  it('defaults the mime to png', () => {
    expect(toOpenAIScreenshot({ imageB64: 'BBBB' }).image_url).toBe('data:image/png;base64,BBBB')
  })

  it('is a typed error when the result carries no image', () => {
    try {
      toOpenAIScreenshot({ frameId: 1, width: 1200, height: 750 })
      expect.fail('expected a DialectError')
    } catch (e) {
      expect(e).toBeInstanceOf(DialectError)
      expect((e as DialectError).code).toBe('no_screenshot')
    }
  })
})

describe('fromGemini', () => {
  it('denormalizes 0..999 at the frame edges', () => {
    expect(fromGemini({ name: 'click_at', args: { x: 0, y: 0 } }, FRAME)).toEqual([
      { action: 'left_click', coordinate: [0, 0] },
    ])
    expect(fromGemini({ name: 'click_at', args: { x: 999, y: 999 } }, FRAME)).toEqual([
      { action: 'left_click', coordinate: [1198, 749] },
    ])
    expect(fromGemini({ name: 'click_at', args: { x: 500, y: 500 } }, FRAME)).toEqual([
      { action: 'left_click', coordinate: [600, 375] },
    ])
    // int(x / 1000 * w): floor, never round up past the frame.
    expect(fromGemini({ name: 'click_at', args: { x: 1, y: 1 } }, FRAME)).toEqual([
      { action: 'left_click', coordinate: [1, 0] },
    ])
  })

  it('rejects coordinates outside 0..999', () => {
    for (const bad of [{ x: 1000, y: 0 }, { x: 0, y: 1000 }, { x: -1, y: 0 }, { x: 'x', y: 0 }]) {
      try {
        fromGemini({ name: 'click_at', args: bad as never }, FRAME)
        expect.fail(`expected ${JSON.stringify(bad)} to throw`)
      } catch (e) {
        expect(e).toBeInstanceOf(DialectError)
        expect((e as DialectError).code).toBe('bad_coordinate')
      }
    }
  })

  it('golden table', () => {
    const rows: Array<[{ name: string; args?: Record<string, unknown> }, ComputerAction[]]> = [
      [{ name: 'hover_at', args: { x: 500, y: 500 } }, [{ action: 'mouse_move', coordinate: [600, 375] }]],
      [
        { name: 'type_text_at', args: { x: 500, y: 500, text: 'hi', press_enter: true } },
        [
          { action: 'left_click', coordinate: [600, 375], noScreenshot: true },
          { action: 'type', text: 'hi', noScreenshot: true },
          { action: 'key', key: 'Return' },
        ],
      ],
      [
        { name: 'type_text_at', args: { x: 500, y: 500, text: 'hi', press_enter: false } },
        [
          { action: 'left_click', coordinate: [600, 375], noScreenshot: true },
          { action: 'type', text: 'hi' },
        ],
      ],
      [
        { name: 'type_text_at', args: { x: 500, y: 500, text: 'hi', clear_before_typing: true } },
        [
          { action: 'left_click', coordinate: [600, 375], noScreenshot: true },
          { action: 'key', key: 'ctrl+a', noScreenshot: true },
          { action: 'type', text: 'hi' },
        ],
      ],
      [{ name: 'key_combination', args: { keys: 'ctrl+a' } }, [{ action: 'key', key: 'ctrl+a' }]],
      [{ name: 'key_combination', args: { keys: 'Control+Shift+T' } }, [{ action: 'key', key: 'ctrl+shift+t' }]],
      [{ name: 'key_combination', args: { keys: 'Enter' } }, [{ action: 'key', key: 'Return' }]],
      [{ name: 'key_combination', args: { keys: ['ctrl', 'c'] } }, [{ action: 'key', key: 'ctrl+c' }]],
      // scroll_document: default magnitude 800 of the frame axis, then the divisor.
      [{ name: 'scroll_document', args: { direction: 'down' } }, [{ action: 'scroll', scrollDirection: 'down', scrollAmount: 6 }]],
      [{ name: 'scroll_document', args: { direction: 'right' } }, [{ action: 'scroll', scrollDirection: 'right', scrollAmount: 10 }]],
      [
        { name: 'scroll_at', args: { x: 500, y: 500, direction: 'up', magnitude: 250 } },
        [{ action: 'scroll', coordinate: [600, 375], scrollDirection: 'up', scrollAmount: 2 }],
      ],
      [
        { name: 'scroll_at', args: { x: 500, y: 500, direction: 'down' } },
        [{ action: 'scroll', coordinate: [600, 375], scrollDirection: 'down', scrollAmount: 6 }],
      ],
      [
        { name: 'drag_and_drop', args: { x: 100, y: 100, destination_x: 900, destination_y: 900 } },
        [{ action: 'left_click_drag', startCoordinate: [120, 75], coordinate: [1080, 675] }],
      ],
      [{ name: 'wait_5_seconds' }, [{ action: 'wait', duration: 5 }]],
    ]
    for (const [input, expected] of rows) {
      expect(fromGemini(input, FRAME), JSON.stringify(input)).toEqual(expected)
    }
  })

  it('rejects navigation actions with a message pointing the model at the browser UI', () => {
    for (const name of ['navigate', 'go_back', 'go_forward', 'search', 'open_web_browser']) {
      try {
        fromGemini({ name, args: { url: 'https://example.com' } }, FRAME)
        expect.fail(`expected ${name} to throw`)
      } catch (e) {
        expect(e).toBeInstanceOf(DialectError)
        expect((e as DialectError).code).toBe('unsupported_action')
        expect((e as DialectError).message).toMatch(/address bar|browser/i)
      }
    }
  })

  it('emulates navigation through the address bar when asked', () => {
    const opts = { emulateNavigation: true }
    expect(fromGemini({ name: 'navigate', args: { url: 'https://example.com' } }, FRAME, opts)).toEqual([
      { action: 'key', key: 'ctrl+l', noScreenshot: true },
      { action: 'type', text: 'https://example.com', noScreenshot: true },
      { action: 'key', key: 'Return' },
    ])
    expect(fromGemini({ name: 'go_back' }, FRAME, opts)).toEqual([{ action: 'key', key: 'alt+Left' }])
    expect(fromGemini({ name: 'go_forward' }, FRAME, opts)).toEqual([{ action: 'key', key: 'alt+Right' }])
    expect(() => fromGemini({ name: 'navigate', args: {} }, FRAME, opts)).toThrow(DialectError)
  })

  it('unknown action and bad frame are typed errors', () => {
    try {
      fromGemini({ name: 'teleport' }, FRAME)
      expect.fail('expected a DialectError')
    } catch (e) {
      expect((e as DialectError).code).toBe('unknown_action')
      expect((e as DialectError).dialect).toBe('gemini')
    }
    expect(() => fromGemini({ name: 'click_at', args: { x: 1, y: 1 } }, { width: 0, height: 750 })).toThrow(DialectError)
  })
})

describe('fromQwen', () => {
  it('denormalizes 0..1000 at the frame edges (1000 lands on the last pixel)', () => {
    expect(fromQwen({ action: 'left_click', coordinate: [0, 0] }, FRAME)).toEqual([
      { action: 'left_click', coordinate: [0, 0] },
    ])
    expect(fromQwen({ action: 'left_click', coordinate: [1000, 1000] }, FRAME)).toEqual([
      { action: 'left_click', coordinate: [1199, 749] },
    ])
    expect(fromQwen({ action: 'left_click', coordinate: [500, 500] }, FRAME)).toEqual([
      { action: 'left_click', coordinate: [600, 375] },
    ])
    expect(() => fromQwen({ action: 'left_click', coordinate: [1001, 0] }, FRAME)).toThrow(DialectError)
    expect(() => fromQwen({ action: 'left_click', coordinate: [0] } as never, FRAME)).toThrow(DialectError)
  })

  it('golden table', () => {
    const rows: Array<[unknown, ComputerAction[]]> = [
      [{ action: 'right_click', coordinate: [500, 500] }, [{ action: 'right_click', coordinate: [600, 375] }]],
      [{ action: 'middle_click', coordinate: [500, 500] }, [{ action: 'middle_click', coordinate: [600, 375] }]],
      [{ action: 'double_click', coordinate: [500, 500] }, [{ action: 'double_click', coordinate: [600, 375] }]],
      [{ action: 'mouse_move', coordinate: [500, 500] }, [{ action: 'mouse_move', coordinate: [600, 375] }]],
      // Qwen drags from the current cursor position: press, then release at the target.
      [
        { action: 'left_click_drag', coordinate: [500, 500] },
        [
          { action: 'left_mouse_down', noScreenshot: true },
          { action: 'left_mouse_up', coordinate: [600, 375] },
        ],
      ],
      [
        { action: 'left_click_drag', start_coordinate: [0, 0], coordinate: [500, 500] },
        [{ action: 'left_click_drag', startCoordinate: [0, 0], coordinate: [600, 375] }],
      ],
      [{ action: 'key', keys: ['ctrl', 'c'] }, [{ action: 'key', key: 'ctrl+c' }]],
      [{ action: 'key', keys: ['Enter'] }, [{ action: 'key', key: 'Return' }]],
      [{ action: 'key', keys: 'ctrl+shift+t' }, [{ action: 'key', key: 'ctrl+shift+t' }]],
      [{ action: 'type', text: 'hello' }, [{ action: 'type', text: 'hello' }]],
      // Qwen scroll: positive pixels scroll up, negative scroll down.
      [
        { action: 'scroll', coordinate: [500, 500], pixels: 300 },
        [{ action: 'scroll', coordinate: [600, 375], scrollDirection: 'up', scrollAmount: 3 }],
      ],
      [
        { action: 'scroll', coordinate: [500, 500], pixels: -250 },
        [{ action: 'scroll', coordinate: [600, 375], scrollDirection: 'down', scrollAmount: 3 }],
      ],
      [{ action: 'scroll', pixels: -100 }, [{ action: 'scroll', scrollDirection: 'down', scrollAmount: 1 }]],
      [{ action: 'wait', time: 2 }, [{ action: 'wait', duration: 2 }]],
      [{ action: 'wait' }, [{ action: 'wait', duration: 1 }]],
      [{ action: 'screenshot' }, [{ action: 'screenshot' }]],
      // Terminal actions are no-ops for the desktop; the caller closes the session.
      [{ action: 'terminate', status: 'success' }, []],
      [{ action: 'answer', text: 'done' }, []],
    ]
    for (const [input, expected] of rows) {
      expect(fromQwen(input as never, FRAME), JSON.stringify(input)).toEqual(expected)
    }
    expect(QWEN_TERMINAL_ACTIONS.has('terminate')).toBe(true)
    expect(QWEN_TERMINAL_ACTIONS.has('answer')).toBe(true)
  })

  it('unknown action and a zero-pixel scroll are typed errors', () => {
    try {
      fromQwen({ action: 'fly' } as never, FRAME)
      expect.fail('expected a DialectError')
    } catch (e) {
      expect((e as DialectError).code).toBe('unknown_action')
      expect((e as DialectError).dialect).toBe('qwen')
    }
    expect(() => fromQwen({ action: 'scroll', pixels: 0 }, FRAME)).toThrow(DialectError)
    expect(() => fromQwen({ action: 'key', keys: [] }, FRAME)).toThrow(DialectError)
  })
})

describe('converters never carry a screenshot into an action', () => {
  it('no emitted action has an image or frame field', () => {
    const all = [
      ...fromOpenAI({ type: 'drag', path: [{ x: 0, y: 0 }, { x: 9, y: 9 }] }),
      ...fromGemini({ name: 'type_text_at', args: { x: 1, y: 1, text: 'x', press_enter: true } }, FRAME),
      ...fromQwen({ action: 'left_click_drag', coordinate: [9, 9] }, FRAME),
    ]
    for (const a of all) {
      expect(Object.keys(a)).not.toContain('imageB64')
      expect(Object.keys(a)).not.toContain('frameId')
    }
  })
})
