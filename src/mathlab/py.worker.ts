/// <reference lib="webworker" />
/**
 * MATH LAB's Python: real Python (Pyodide, CPython in WebAssembly) in its
 * own worker, so a loop that never ends cannot freeze the game - the page
 * just ends the worker. Loaded from the CDN the first time someone presses
 * RUN (several MB), then cached by the browser.
 *
 * Python's own `turtle` needs a window, so a small stand-in takes its place:
 * the same names (Screen, Turtle, forward, circle, pencolor, goto...), and
 * instead of drawing it records each line it would draw, with the line of
 * the player's code that drew it, for the page to draw.
 */

const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';

const TURTLE = String.raw`
import sys, math, types, json, time

_strokes = []
_LIMIT = 200000

class _Limit(Exception):
    pass

def _user_line():
    f = sys._getframe(2)
    while f is not None and f.f_code.co_filename != '<exec>':
        f = f.f_back
    return f.f_lineno - 1 if f is not None else -1

def _css(c):
    if isinstance(c, str):
        return c
    r, g, b = (list(c) + [0, 0, 0])[:3]
    if max(r, g, b) <= 1:
        r, g, b = r * 255, g * 255, b * 255
    return 'rgb(%d,%d,%d)' % (max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)))

class Turtle:
    def __init__(self, *a, **k):
        self.x = 0.0; self.y = 0.0; self.h = 0.0
        self.down = True; self.col = 'white'; self.w = 1.0
    def _to(self, x, y):
        if self.down:
            if len(_strokes) >= _LIMIT:
                raise _Limit('more than %d lines - draw fewer' % _LIMIT)
            _strokes.append((self.x, self.y, x, y, self.col, self.w, _user_line()))
        self.x, self.y = float(x), float(y)
    def forward(self, d):
        a = math.radians(self.h)
        self._to(self.x + d * math.cos(a), self.y + d * math.sin(a))
    fd = forward
    def backward(self, d): self.forward(-d)
    bk = back = backward
    def left(self, a): self.h += a
    lt = left
    def right(self, a): self.h -= a
    rt = right
    def setheading(self, a): self.h = a
    seth = setheading
    def heading(self): return self.h
    def goto(self, x, y=None):
        if y is None: x, y = x
        self._to(x, y)
    setpos = setposition = goto
    def setx(self, x): self._to(x, self.y)
    def sety(self, y): self._to(self.x, y)
    def pos(self): return (self.x, self.y)
    position = pos
    def xcor(self): return self.x
    def ycor(self): return self.y
    def home(self): self.goto(0, 0); self.h = 0
    def penup(self): self.down = False
    pu = up = penup
    def pendown(self): self.down = True
    pd = down = pendown
    def isdown(self): return self.down
    def pencolor(self, *c):
        if c: self.col = _css(c[0] if len(c) == 1 else c)
        return self.col
    def color(self, *c):
        if c: self.pencolor(c[0] if len(c) <= 2 else c)
    fillcolor = lambda self, *c: None
    def width(self, w=None):
        if w is not None: self.w = float(w)
        return self.w
    pensize = width
    def circle(self, r, extent=360, steps=None):
        n = steps or max(8, min(120, int(abs(r) * abs(extent) / 120) + 8))
        step = extent / n
        length = 2 * r * math.sin(math.radians(abs(step)) / 2)
        self.left(step / 2)
        for _ in range(n):
            self.forward(length)
            self.left(step)
        self.left(-step / 2)
    def dot(self, size=4, *c):
        keep = (self.col, self.w, self.down)
        if c: self.pencolor(*c)
        self.w = size; self.down = True
        self._to(self.x + 0.01, self.y)
        self.col, self.w, self.down = keep
    def write(self, *a, **k): pass
    def hideturtle(self): pass
    ht = hideturtle
    def showturtle(self): pass
    st = showturtle
    def speed(self, *a): pass
    def begin_fill(self): pass
    def end_fill(self): pass
    def shape(self, *a): pass
    def clear(self): pass

class Screen:
    def __init__(self, *a, **k): pass
    def setup(self, *a, **k): pass
    def bgcolor(self, *a): pass
    def title(self, *a): pass
    def tracer(self, *a, **k): pass
    def update(self): pass
    def colormode(self, *a): pass
    def mainloop(self): pass
    def exitonclick(self): pass
    def ontimer(self, f, t=0): pass
    def getcanvas(self): raise RuntimeError('there is no tkinter canvas here - use turtle lines')

_t = Turtle()
turtle = types.ModuleType('turtle')
for _name in ['Turtle', 'Screen']:
    setattr(turtle, _name, globals()[_name])
for _name in dir(Turtle):
    if not _name.startswith('_'):
        setattr(turtle, _name, getattr(_t, _name))
for _name in ['setup', 'bgcolor', 'title', 'tracer', 'update', 'colormode', 'mainloop', 'exitonclick']:
    setattr(turtle, _name, getattr(Screen(), _name))
turtle.done = lambda: None
turtle.Pen = turtle.RawTurtle = Turtle
turtle.Terminator = Exception
turtle.TurtleGraphicsError = Exception
sys.modules['turtle'] = turtle
time.sleep = lambda s: None   # no waiting: the page animates the drawing itself
`;

interface Py {
  runPythonAsync(code: string, o?: object): Promise<unknown>;
  runPython(code: string, o?: object): unknown;
  setStdout(o: object): void;
  globals: { get(name: string): (...a: unknown[]) => { destroy(): void } };
}
let ready: Promise<Py> | null = null;

function load() {
  ready ??= (async () => {
    const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE}pyodide.mjs`);
    const py = await loadPyodide({ indexURL: PYODIDE });
    return py;
  })();
  return ready;
}

self.onmessage = async (e: MessageEvent<{ code: string }>) => {
  const prints: string[] = [];
  try {
    self.postMessage({ t: 'status', text: 'loading Python...' });
    const py = await load();
    py.setStdout({ batched: (line: string) => prints.length < 200 && prints.push(line) });
    // a fresh turtle and stroke list every run; the stand-in under its own
    // filename, so a stroke's line is looked up in the player's code
    py.runPython(TURTLE, { filename: '<turtle>' });
    self.postMessage({ t: 'status', text: 'running...' });
    // the player's code in fresh variables: nothing left over from the last run
    const scope = py.globals.get('dict')();
    try {
      await py.runPythonAsync(e.data.code, { globals: scope, filename: '<exec>' });
    } finally {
      scope.destroy();
    }
    const json = py.runPython('json.dumps(_strokes)') as string;
    self.postMessage({ t: 'done', strokes: JSON.parse(json), prints });
  } catch (err) {
    // the last line of a traceback is the one that says what went wrong
    const msg = String((err as Error)?.message ?? err).trim().split('\n');
    const where = msg.reverse().find((l) => /line \d+/.test(l));
    self.postMessage({ t: 'error', error: msg[0] + (where ? ` (${where.trim()})` : ''), prints });
  }
};
