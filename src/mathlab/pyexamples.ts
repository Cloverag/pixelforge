import type { Param } from './drawings';

/** MATH LAB's PYTHON: real Python with a turtle; the code is the player's. */
export const PYTHON = {
  id: 'python',
  name: 'PYTHON',
  idea: 'Real Python, with a turtle. Write turtle code (or paste some), press RUN, and watch each line of your code light up as it draws.',
  params: [] as Param[],
};

/** Starting points, each a few lines of plain turtle code. */
export const PY_EXAMPLES: { name: string; code: string }[] = [
  {
    name: 'circles',
    code: `import turtle as t

p = t.Turtle()
for i in range(36):
    p.pencolor((1, i / 36, 1 - i / 36))
    p.circle(120)
    p.left(10)
`,
  },
  {
    name: 'square spiral',
    code: `import turtle as t

p = t.Turtle()
for i in range(240):
    p.pencolor((i / 240, 0.7, 1))
    p.forward(i * 1.5)
    p.left(91)
`,
  },
  {
    name: 'tree',
    code: `import turtle as t

p = t.Turtle()
p.penup()
p.goto(0, -250)
p.pendown()
p.left(90)

def tree(length):
    if length < 10:
        return
    p.pencolor('sienna')
    p.forward(length)
    p.pencolor('pink')
    p.circle(2)
    p.left(20)
    tree(length * 0.8)
    p.right(40)
    tree(length * 0.8)
    p.left(20)
    p.backward(length)

tree(90)
`,
  },
  {
    name: 'heart',
    code: `import turtle as t, math as m, random as r

p = t.Turtle()

def heart(a, s):
    x = 16 * m.sin(a) ** 3 * s
    y = (13*m.cos(a) - 5*m.cos(2*a) - 2*m.cos(3*a) - m.cos(4*a)) * s
    return x, y

for i in range(3000):
    a = r.uniform(0, 2 * m.pi)
    x, y = heart(a, r.uniform(0.5, 15.5))
    angle = m.atan2(y, x) + r.uniform(-0.5, 0.5)
    p.penup()
    p.goto(x, y)
    p.pendown()
    p.pencolor((1, r.uniform(0.3, 0.7), r.uniform(0.7, 0.9)))
    p.goto(x + 10 * m.cos(angle), y + 10 * m.sin(angle))
`,
  },
  {
    name: 'star',
    code: `import turtle as t

p = t.Turtle()
for i in range(180):
    p.pencolor((1, 0.8, i / 180))
    p.forward(220)
    p.left(144.5)
`,
  },
];
