# Equals Calc

A SiYuan plugin: type an expression ending with `=` and **press Enter** to get the result
appended right after the equals sign.

## Features

| Type | After Enter |
| --- | --- |
| `12*5=` | `12*5=60` |
| `测试12*5=` | `测试12*5=60` |
| `12×5=` | `12×5=60` |
| `12×5=60*3=` | `12×5=60*3=180` |

Only text **before the caret** that ends with a complete expression plus `=` is evaluated.
Any leading words or units are left untouched.

## Linear equations

When the same unknown appears on both sides of `=`, the expression is solved as an
equation (terms are moved to one side and solved with exact rational coefficients):

| Type | After Enter |
| --- | --- |
| `x+3=5=` | `x+3=5=2` |
| `a+3=5;a=` | `a+3=5;a=2` |
| `2x=10=` | `2x=10=5` |
| `2x+3=7=` | `2x+3=7=2` |
| `x/2=3=` | `x/2=3=6` |
| `x^2=4=` | `x^2=4=-2 或 2` |
| `x^2+1=0=` | `x^2+1=0=1i 或 -1i` (complex roots) |
| `x^3=2=` | `x^3=2=1.25992105` (numeric) |

- **Linear**: solved exactly by moving terms
- **Quadratic**: root formula; negative discriminant yields conjugate complex roots
- **Cubic and higher**: one real root via Newton iteration
- **Implicit multiplication** is supported: `2x`, `2(x+1)`, `(x+1)(x-1)`
- Inline assignments combine with equations: `n=2;n*x=6=` -> `n=2;n*x=6=3`
- Equations with no solution report it (e.g. `3=5`)

## Result precision

The settings panel controls how results are displayed:

- **Exact** (default): terminating values print as-is — `12*5=` -> `60`, `1/8=` -> `0.125`
- **Decimal places**: round to N places, trailing zeros dropped
- **Significant digits**: round to N significant digits; `1234.5678` with 2 -> `1200`

Range 0–15 (1–15 for significant digits). The setting also applies to equation
solutions: with 2 decimal places, `3x=1=` -> `3x=1=0.33`.

Rounding is **exact in decimal**: `1.005` to 2 places gives `1.01`, not `1.00`
as binary floating point would.

## Supported syntax

- **Arithmetic**: `+` `-` `*` `/`, plus `×` `÷` `·`
- **Precedence**: standard precedence (multiplication before addition) with parentheses
- **Power and modulo**: `2^10`, `2**8`, `7%2`
- **Percent**: `50%` = 0.5, `200*10%` = 20
- **Thousand separators**: `1,000+1=` -> `1,000+1=1001`
- **Full-width symbols**: `１２＋３=`, `（２＋３）＊４=`
- **Constants**: `pi`, `e`
- **Functions**: `sqrt` `abs` `round` `floor` `ceil` `trunc` `min` `max` `sum` `avg` `log` `ln` `exp` `sin` `cos` `tan` `asin` `acos` `atan` `pow`
- **Inline assignment**: `a=3;a*2=` -> `a=3;a*2=6`
- **Negatives and complex numbers**: `-5+3=` -> `-5+3=-2`; `sqrt(-4)=` -> `sqrt(-4)=2i`

## Precision

The plugin never uses `eval` / `new Function`; it implements its own expression parser and
**decimal, high-precision arithmetic**:

- `0.1+0.2=` yields a clean `0.3` (not `0.30000000000000004`)
- Large integers keep full precision: `99999999999999999999+1=`
- Non-terminating divisions keep 40 fractional digits

## Settings

Click the calculator icon in the top bar to toggle, right-click it and choose
"Open plugin settings":

- **Auto calculate** — master switch
- **Also trigger on Space** — off by default (Space is a common typing key)
- **Support Ctrl/Cmd + Enter** — on by default, for forcing a calculation while auto mode is off
- **Result precision** — exact / decimal places / significant digits

> The top bar uses an SVG symbol registered by the plugin itself (SiYuan's built-in
> icon set has no calculator). `addTopBar` renders `<use xlink:href="#iconName">`,
> so the matching symbol must be registered with `addIcons` first — otherwise the
> slot shows up empty.
>
> `Setting` must be constructed with a `confirmCallback`: SiYuan's implementation
> looks up `.b3-dialog__action .b3-button` and calls `btnsElement[0].addEventListener`.
> Without `confirmCallback` that button row is hidden, the lookup yields `undefined`,
> and the resulting TypeError stops the dialog from ever appearing — which looks
> like "clicking settings does nothing".

## Behaviour notes

- The plugin only acts when the text before the caret ends with `=` preceded by a complete
  expression; otherwise Enter keeps its normal new-block behaviour.
- The caret lands after the result. Changes are written back through SiYuan's transaction API,
  so they are **undoable** and stay in sync with the kernel.
- Comparison operators such as `==`, `>=`, `<=` are ignored.
- A bare `a=` is not evaluated (no value typed yet).
- Code blocks, tables and read-only documents are never modified.

## Development

```bash
node build.mjs                 # build index.js from src/ (zero dependencies)
node test/number.probe.mjs     # arithmetic self-tests
node test/precision.test.mjs   # result precision
node test/polynomial.test.mjs  # polynomials and equation solving
node test/calc.test.mjs        # expression-layer tests
node test/plugin.test.mjs      # plugin integration tests (minimal DOM / SiYuan stubs)
node tools/pack.mjs            # build package.zip
node tools/verify-zip.mjs      # verify package.zip
```

Source layout:

```
src/index.js              plugin body (lifecycle, key interception, DOM write-back, settings)
src/lib/number.mjs        decimal arithmetic (digit arrays, rationals, fixed point, complex)
src/lib/precision.mjs     display precision (exact decimal rounding to places/digits)
src/lib/polynomial.mjs    polynomial arithmetic and univariate equation solving
src/lib/expr.mjs          tokenizer, parser, evaluator, settlement rules
build.mjs                 bundles the ESM sources into the CommonJS plugin entry
```

## Packaging

`package.zip` must contain:

- `plugin.json`
- `index.js`
- `index.css`
- `i18n/*`
- `icon.png`
- `README.md`, `README.zh-CN.md`

## License

MIT
