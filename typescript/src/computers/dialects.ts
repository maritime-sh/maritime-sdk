/**
 * Dialect converters: a provider's native computer-use action object to the
 * canonical Maritime action (desktopd's schema, camelCase), and a Maritime
 * action result back to the provider's screenshot shape.
 *
 * Pure functions, no I/O. Use them when your code drives a provider's
 * built-in computer-use tool and holds the provider's action object; the
 * MCP server never needs them because every client calls Maritime's own
 * `computer` tool. Coordinates in every emitted action are pixels of the
 * frame you pass in, which must be the `width` x `height` reported on the
 * last {@link ActionResult} the model saw.
 */
import { MaritimeError } from '../errors.js'
import type { ActionResult, ComputerAction, ScrollDirection } from '../types.js'

export type Dialect = 'openai' | 'gemini' | 'qwen'

export type DialectErrorCode =
  | 'unknown_action'
  | 'unsupported_action'
  | 'bad_coordinate'
  | 'bad_path'
  | 'bad_text'
  | 'bad_key'
  | 'bad_scroll'
  | 'bad_frame'
  | 'no_screenshot'

/** A provider action the converter cannot express as a canonical action. */
export class DialectError extends MaritimeError {
  readonly code: DialectErrorCode
  readonly dialect: Dialect
  /** The offending provider action, for logging. Never contains screenshots. */
  readonly action: unknown

  constructor(dialect: Dialect, code: DialectErrorCode, message: string, action?: unknown) {
    super(message)
    this.name = 'DialectError'
    this.code = code
    this.dialect = dialect
    this.action = action
  }
}

/** The frame the model's coordinates refer to: the last screenshot's size. */
export interface Frame {
  width: number
  height: number
  frameId?: number
}

/** Pixels of scroll per wheel click when a provider reports scroll in pixels. */
export const SCROLL_PX_PER_CLICK = 100

const MAX_WHEEL_CLICKS = 100

/**
 * OpenAI key tokens (upper-cased, as the computer-use model emits them) to
 * the xdotool names desktopd normalizes. Total over the documented token
 * set; anything else passes through {@link mapKeyToken} unchanged (single
 * letters lower-cased, F-keys upper-cased).
 */
export const KEY_MAP_OPENAI: Readonly<Record<string, string>> = Object.freeze({
  '/': 'slash',
  '\\': 'backslash',
  ALT: 'alt',
  OPTION: 'alt',
  ARROWDOWN: 'Down',
  ARROWLEFT: 'Left',
  ARROWRIGHT: 'Right',
  ARROWUP: 'Up',
  DOWN: 'Down',
  LEFT: 'Left',
  RIGHT: 'Right',
  UP: 'Up',
  BACKSPACE: 'BackSpace',
  CAPSLOCK: 'Caps_Lock',
  CMD: 'super',
  COMMAND: 'super',
  META: 'super',
  SUPER: 'super',
  WIN: 'super',
  CTRL: 'ctrl',
  CONTROL: 'ctrl',
  SHIFT: 'shift',
  DELETE: 'Delete',
  DEL: 'Delete',
  END: 'End',
  HOME: 'Home',
  ENTER: 'Return',
  RETURN: 'Return',
  ESC: 'Escape',
  ESCAPE: 'Escape',
  INSERT: 'Insert',
  PAGEDOWN: 'Page_Down',
  PAGEUP: 'Page_Up',
  SPACE: 'space',
  TAB: 'Tab',
  PRINTSCREEN: 'Print',
})

/** Map one provider key token to an xdotool key name. */
export function mapKeyToken(token: string, dialect: Dialect = 'openai'): string {
  const t = String(token ?? '').trim()
  if (!t) throw new DialectError(dialect, 'bad_key', 'Key token is empty.', token)
  const mapped = KEY_MAP_OPENAI[t.toUpperCase()]
  if (mapped) return mapped
  if (/^f\d{1,2}$/i.test(t)) return 'F' + t.slice(1)
  if (t.length === 1) return t.toLowerCase()
  return t
}

/** Join provider key tokens (`['CTRL', 'A']` or `'ctrl+a'`) into one xdotool chord. */
function keyChord(keys: unknown, dialect: Dialect, action: unknown): string {
  const tokens = Array.isArray(keys)
    ? keys.map((k) => String(k))
    : typeof keys === 'string'
      ? keys.split('+')
      : []
  const parts = tokens.map((k) => k.trim()).filter((k) => k.length > 0)
  if (parts.length === 0) {
    throw new DialectError(dialect, 'bad_key', 'A key action needs at least one key.', action)
  }
  return parts.map((k) => mapKeyToken(k, dialect)).join('+')
}

/** Absolute pixels to wheel clicks: `round(|px| / SCROLL_PX_PER_CLICK)`, at least 1 for any non-zero scroll, at most 100. */
export function pxToWheelClicks(px: number): number {
  const abs = Math.abs(px)
  if (!Number.isFinite(abs) || abs === 0) return 0
  return Math.min(MAX_WHEEL_CLICKS, Math.max(1, Math.round(abs / SCROLL_PX_PER_CLICK)))
}

function requireFrame(frame: Frame | undefined, dialect: Dialect): Frame {
  if (
    !frame ||
    !Number.isFinite(frame.width) ||
    !Number.isFinite(frame.height) ||
    frame.width <= 0 ||
    frame.height <= 0
  ) {
    throw new DialectError(
      dialect,
      'bad_frame',
      'A frame {width, height} from the last screenshot is required to denormalize coordinates.',
    )
  }
  return frame
}

function pixel(v: unknown, dialect: Dialect, action: unknown): number {
  const n = typeof v === 'number' ? v : Number.NaN
  if (!Number.isFinite(n)) {
    throw new DialectError(dialect, 'bad_coordinate', 'Coordinates must be finite numbers.', action)
  }
  return Math.round(n)
}

function nonEmptyText(v: unknown, dialect: Dialect, action: unknown): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new DialectError(dialect, 'bad_text', 'A type action needs non-empty text.', action)
  }
  return v
}

function scrollAction(
  direction: ScrollDirection,
  amount: number,
  coordinate?: [number, number],
): ComputerAction {
  const a: ComputerAction = { action: 'scroll' }
  if (coordinate) a.coordinate = coordinate
  a.scrollDirection = direction
  a.scrollAmount = amount
  return a
}

// ---------------------------------------------------------------------------
// OpenAI (Responses API `computer_call.action`)
// ---------------------------------------------------------------------------

export type OpenAIComputerAction =
  | { type: 'click'; x: number; y: number; button?: 'left' | 'right' | 'wheel' | 'back' | 'forward'; keys?: string[] }
  | { type: 'double_click'; x: number; y: number }
  | { type: 'drag'; path: Array<{ x: number; y: number }> }
  | { type: 'keypress'; keys: string[] }
  | { type: 'move'; x: number; y: number }
  | { type: 'screenshot' }
  | { type: 'scroll'; x: number; y: number; scroll_x: number; scroll_y: number }
  | { type: 'type'; text: string }
  | { type: 'wait' }

export interface OpenAIComputerScreenshot {
  type: 'computer_screenshot'
  /** `data:<mime>;base64,...`, ready for `computer_call_output.output`. */
  image_url: string
}

/**
 * OpenAI computer-use action to canonical actions. OpenAI coordinates are
 * already pixels of the screenshot you sent (set `display_width` and
 * `display_height` to the frame's `width` and `height`), so `frame` is
 * optional here. A drag expands to press, moves, release; a pixel scroll
 * becomes wheel clicks ({@link SCROLL_PX_PER_CLICK}); a `wait` is one second.
 */
export function fromOpenAI(action: OpenAIComputerAction, _frame?: Frame): ComputerAction[] {
  const d: Dialect = 'openai'
  const a = action as Record<string, unknown> & { type?: string }
  switch (a.type) {
    case 'click': {
      const button = (a.button as string | undefined) ?? 'left'
      if (button === 'back') return [{ action: 'key', key: 'alt+Left' }]
      if (button === 'forward') return [{ action: 'key', key: 'alt+Right' }]
      const coordinate: [number, number] = [pixel(a.x, d, action), pixel(a.y, d, action)]
      const name: ComputerAction['action'] =
        button === 'right' ? 'right_click' : button === 'wheel' ? 'middle_click' : 'left_click'
      const out: ComputerAction = { action: name, coordinate }
      if (Array.isArray(a.keys) && a.keys.length > 0) out.modifier = keyChord(a.keys, d, action)
      return [out]
    }
    case 'double_click':
      return [{ action: 'double_click', coordinate: [pixel(a.x, d, action), pixel(a.y, d, action)] }]
    case 'move':
      return [{ action: 'mouse_move', coordinate: [pixel(a.x, d, action), pixel(a.y, d, action)] }]
    case 'screenshot':
      return [{ action: 'screenshot' }]
    case 'wait':
      return [{ action: 'wait', duration: 1 }]
    case 'type':
      return [{ action: 'type', text: nonEmptyText(a.text, d, action) }]
    case 'keypress':
      return [{ action: 'key', key: keyChord(a.keys, d, action) }]
    case 'scroll': {
      const coordinate: [number, number] = [pixel(a.x, d, action), pixel(a.y, d, action)]
      const sy = typeof a.scroll_y === 'number' ? a.scroll_y : 0
      const sx = typeof a.scroll_x === 'number' ? a.scroll_x : 0
      const out: ComputerAction[] = []
      const vy = pxToWheelClicks(sy)
      if (vy > 0) out.push(scrollAction(sy > 0 ? 'down' : 'up', vy, coordinate))
      const vx = pxToWheelClicks(sx)
      if (vx > 0) out.push(scrollAction(sx > 0 ? 'right' : 'left', vx, coordinate))
      if (out.length === 0) return [{ action: 'mouse_move', coordinate }]
      return out
    }
    case 'drag': {
      const path = Array.isArray(a.path) ? (a.path as Array<{ x: unknown; y: unknown }>) : []
      if (path.length < 2) {
        throw new DialectError(d, 'bad_path', 'A drag needs a path of at least two points.', action)
      }
      const points = path.map((p): [number, number] => [pixel(p.x, d, action), pixel(p.y, d, action)])
      const out: ComputerAction[] = [{ action: 'left_mouse_down', coordinate: points[0]!, noScreenshot: true }]
      for (const p of points.slice(1, -1)) out.push({ action: 'mouse_move', coordinate: p, noScreenshot: true })
      out.push({ action: 'left_mouse_up', coordinate: points[points.length - 1]! })
      return out
    }
    default:
      throw new DialectError(d, 'unknown_action', `Unknown OpenAI computer action type ${JSON.stringify(a.type)}.`, action)
  }
}

/**
 * A Maritime action result to OpenAI's `computer_screenshot` output block.
 * Splice it into `computer_call_output.output` and pass `result.width`,
 * `result.height` as the tool's display size.
 */
export function toOpenAIScreenshot(result: ActionResult): OpenAIComputerScreenshot {
  const img = result.imageB64
  if (!img) {
    throw new DialectError('openai', 'no_screenshot', 'The action result carries no screenshot (noScreenshot was set, or the capture was blocked).')
  }
  const mime = result.mime || 'image/png'
  return { type: 'computer_screenshot', image_url: `data:${mime};base64,${img}` }
}

// ---------------------------------------------------------------------------
// Gemini (computer_use tool function calls, coordinates 0..999)
// ---------------------------------------------------------------------------

export interface GeminiComputerAction {
  /** The function call name, e.g. `click_at`, `type_text_at`, `scroll_at`. */
  name: string
  args?: Record<string, unknown>
}

export interface GeminiOptions {
  /**
   * Emulate `navigate` (ctrl+l, type the URL, Return), `go_back` (alt+Left)
   * and `go_forward` (alt+Right) through the browser's keyboard shortcuts
   * instead of rejecting them. Off by default: the model is told to use the
   * browser's own UI.
   */
  emulateNavigation?: boolean
}

const GEMINI_DEFAULT_SCROLL_MAGNITUDE = 800
const GEMINI_NAV_ACTIONS = new Set(['navigate', 'go_back', 'go_forward', 'search', 'open_web_browser'])

function geminiCoord(v: unknown, size: number, action: unknown): number {
  const n = typeof v === 'number' ? v : Number.NaN
  if (!Number.isFinite(n) || n < 0 || n > 999) {
    throw new DialectError('gemini', 'bad_coordinate', 'Gemini coordinates must be integers in 0..999.', action)
  }
  return Math.min(size - 1, Math.floor((n / 1000) * size))
}

function geminiDirection(v: unknown, action: unknown): ScrollDirection {
  const s = typeof v === 'string' ? v.toLowerCase() : ''
  if (s === 'up' || s === 'down' || s === 'left' || s === 'right') return s
  throw new DialectError('gemini', 'bad_scroll', 'Scroll direction must be up, down, left or right.', action)
}

/**
 * Gemini computer-use function call to canonical actions. Coordinates are
 * 0..999 on both axes and are denormalized as `int(v / 1000 * size)` against
 * `frame`. Scroll magnitude is on the same 0..999 scale of the scrolled axis
 * (default 800), converted to pixels and then to wheel clicks. Navigation
 * calls are rejected unless `emulateNavigation` is set.
 */
export function fromGemini(action: GeminiComputerAction, frame: Frame, opts: GeminiOptions = {}): ComputerAction[] {
  const d: Dialect = 'gemini'
  const f = requireFrame(frame, d)
  const name = String(action?.name ?? '')
  const args = (action?.args ?? {}) as Record<string, unknown>
  const xy = (): [number, number] => [geminiCoord(args.x, f.width, action), geminiCoord(args.y, f.height, action)]

  if (GEMINI_NAV_ACTIONS.has(name)) {
    if (!opts.emulateNavigation) {
      throw new DialectError(
        d,
        'unsupported_action',
        `${name} is not a desktop action. Use the browser's UI instead: click the address bar (or press ctrl+l), type the URL and press Return; use the back and forward buttons to move through history.`,
        action,
      )
    }
    if (name === 'go_back') return [{ action: 'key', key: 'alt+Left' }]
    if (name === 'go_forward') return [{ action: 'key', key: 'alt+Right' }]
    if (name === 'navigate' || name === 'search') {
      const target = typeof args.url === 'string' ? args.url : typeof args.query === 'string' ? args.query : ''
      if (!target) throw new DialectError(d, 'bad_text', `${name} needs a url (or query).`, action)
      return [
        { action: 'key', key: 'ctrl+l', noScreenshot: true },
        { action: 'type', text: target, noScreenshot: true },
        { action: 'key', key: 'Return' },
      ]
    }
    // open_web_browser: the desktop already has a browser; take a look.
    return [{ action: 'screenshot' }]
  }

  switch (name) {
    case 'click_at':
      return [{ action: 'left_click', coordinate: xy() }]
    case 'hover_at':
      return [{ action: 'mouse_move', coordinate: xy() }]
    case 'type_text_at': {
      const text = nonEmptyText(args.text, d, action)
      const pressEnter = args.press_enter === true
      const clear = args.clear_before_typing === true
      const out: ComputerAction[] = [{ action: 'left_click', coordinate: xy(), noScreenshot: true }]
      if (clear) out.push({ action: 'key', key: 'ctrl+a', noScreenshot: true })
      out.push(pressEnter ? { action: 'type', text, noScreenshot: true } : { action: 'type', text })
      if (pressEnter) out.push({ action: 'key', key: 'Return' })
      return out
    }
    case 'key_combination':
    case 'hotkey':
      return [{ action: 'key', key: keyChord(args.keys, d, action) }]
    case 'scroll_document':
    case 'scroll_at': {
      const direction = geminiDirection(args.direction, action)
      const magnitude = typeof args.magnitude === 'number' ? args.magnitude : GEMINI_DEFAULT_SCROLL_MAGNITUDE
      if (!Number.isFinite(magnitude) || magnitude <= 0) {
        throw new DialectError(d, 'bad_scroll', 'Scroll magnitude must be a positive number.', action)
      }
      const axis = direction === 'up' || direction === 'down' ? f.height : f.width
      const clicks = pxToWheelClicks((magnitude / 1000) * axis)
      const coordinate = name === 'scroll_at' ? xy() : undefined
      return [scrollAction(direction, Math.max(1, clicks), coordinate)]
    }
    case 'drag_and_drop': {
      const start = xy()
      const end: [number, number] = [
        geminiCoord(args.destination_x, f.width, action),
        geminiCoord(args.destination_y, f.height, action),
      ]
      return [{ action: 'left_click_drag', startCoordinate: start, coordinate: end }]
    }
    case 'wait_5_seconds':
      return [{ action: 'wait', duration: 5 }]
    case 'screenshot':
      return [{ action: 'screenshot' }]
    default:
      throw new DialectError(d, 'unknown_action', `Unknown Gemini computer action ${JSON.stringify(name)}.`, action)
  }
}

// ---------------------------------------------------------------------------
// Qwen (computer_use tool, coordinates 0..1000 relative on both axes)
// ---------------------------------------------------------------------------

export interface QwenComputerAction {
  action: string
  /** `[x, y]` on a 0..1000 scale. */
  coordinate?: [number, number] | number[]
  start_coordinate?: [number, number] | number[]
  keys?: string[] | string
  text?: string
  /** Scroll amount in pixels: positive scrolls up, negative scrolls down. */
  pixels?: number
  /** `wait`: seconds. */
  time?: number
  status?: string
}

/** Qwen actions that end the episode; {@link fromQwen} returns no desktop actions for them. Close the session when you see one. */
export const QWEN_TERMINAL_ACTIONS: ReadonlySet<string> = new Set(['terminate', 'answer'])

function qwenPoint(v: unknown, frame: Frame, action: unknown): [number, number] {
  if (!Array.isArray(v) || v.length !== 2) {
    throw new DialectError('qwen', 'bad_coordinate', 'Qwen coordinate must be [x, y] on a 0..1000 scale.', action)
  }
  const one = (n: unknown, size: number): number => {
    const num = typeof n === 'number' ? n : Number.NaN
    if (!Number.isFinite(num) || num < 0 || num > 1000) {
      throw new DialectError('qwen', 'bad_coordinate', 'Qwen coordinates must be in 0..1000.', action)
    }
    return Math.min(size - 1, Math.round((num / 1000) * size))
  }
  return [one(v[0], frame.width), one(v[1], frame.height)]
}

/**
 * Qwen computer-use action to canonical actions. Coordinates are 0..1000
 * relative on both axes (1000 lands on the last pixel of `frame`). A drag
 * without `start_coordinate` starts at the current cursor position (press,
 * then release at the target). `terminate` and `answer` yield no actions.
 */
export function fromQwen(action: QwenComputerAction, frame: Frame): ComputerAction[] {
  const d: Dialect = 'qwen'
  const f = requireFrame(frame, d)
  const name = String(action?.action ?? '')
  if (QWEN_TERMINAL_ACTIONS.has(name)) return []
  switch (name) {
    case 'left_click':
    case 'right_click':
    case 'middle_click':
    case 'double_click':
    case 'mouse_move':
      return [{ action: name, coordinate: qwenPoint(action.coordinate, f, action) }]
    case 'left_click_drag': {
      const end = qwenPoint(action.coordinate, f, action)
      if (action.start_coordinate !== undefined) {
        return [{ action: 'left_click_drag', startCoordinate: qwenPoint(action.start_coordinate, f, action), coordinate: end }]
      }
      return [
        { action: 'left_mouse_down', noScreenshot: true },
        { action: 'left_mouse_up', coordinate: end },
      ]
    }
    case 'key':
      return [{ action: 'key', key: keyChord(action.keys, d, action) }]
    case 'type':
      return [{ action: 'type', text: nonEmptyText(action.text, d, action) }]
    case 'scroll': {
      const px = typeof action.pixels === 'number' ? action.pixels : Number.NaN
      const clicks = pxToWheelClicks(px)
      if (clicks === 0) {
        throw new DialectError(d, 'bad_scroll', 'A scroll needs a non-zero pixels value.', action)
      }
      const coordinate = action.coordinate !== undefined ? qwenPoint(action.coordinate, f, action) : undefined
      return [scrollAction(px > 0 ? 'up' : 'down', clicks, coordinate)]
    }
    case 'wait': {
      const t = typeof action.time === 'number' && action.time > 0 ? action.time : 1
      return [{ action: 'wait', duration: t }]
    }
    case 'screenshot':
      return [{ action: 'screenshot' }]
    default:
      throw new DialectError(d, 'unknown_action', `Unknown Qwen computer action ${JSON.stringify(name)}.`, action)
  }
}
