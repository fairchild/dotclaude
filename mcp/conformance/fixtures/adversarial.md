# Adversarial rendering fixture

## Raw HTML block

<div onclick="alert('block')">
  <p>Raw HTML block: must render as escaped literal text, not a live element.</p>
</div>

## Raw inline HTML tags

Some <b>bold</b>, <i>italic</i>, and a bare <img src=x onerror=alert('inline')> tag inline.

## HTML inside a heading <script>alert('heading')</script>

Heading text itself carries a script tag; it must stay inert.

## HTML stays inert inside code

Inline code: `<script>alert('inline-code')</script>`

```html
<script>alert('fenced-code')</script>
<img src=x onerror=alert('fenced-code-2')>
```

## javascript: and data: targets markdown-it's own core already refuses

- [plain-js](javascript:alert('plain-js'))
- [plain-data](data:text/html,<script>alert('plain-data')</script>)

![plain-js-img](javascript:alert('plain-js-img'))

## Targets only this renderer's own protocol filter blocks

markdown-it's default denylist only covers `vbscript:`, `javascript:`, `file:`,
and non-image `data:`; these pass its own core validator and reach this
renderer's own href allow-list instead.

- [ftp-scheme](ftp://evil.example.com/steal)
- [tel-scheme](tel:+15555550100)

![allowed-mime-data-img](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB)

## Safe targets the allow-list keeps working

- [safe-mail](mailto:security@example.com)
- [safe-https](https://example.com/safe)
- [relative-sibling](references/guide.md)
- [relative-script](scripts/tool.py)
- [anchor](#level-6-heading-stays-clamped-at-6)

## Autolink-looking bare text stays plain

Visit http://example.com/should-not-autolink or write to nobody@example.com;
neither becomes a link because linkify is disabled.

## Reference-style links: unsafe, renderer-only-blocked, and safe

Read the [reference-unsafe][evil], the [reference-tel][tel], and the
[reference-safe][ok].

[evil]: javascript:alert('reference')

[tel]: tel:+15555550100

[ok]: https://example.com/reference-ok

## Unicode look-alike scheme tricks

Neither trick below produces an active `javascript:` navigation; both fall
back to a safe relative resolution under this skill's own base URL because
the homoglyph breaks scheme parsing rather than disguising it.

- [fullwidth-colon](javascript：alert('fullwidth'))
- [cyrillic-a](jаvascript:alert('cyrillic'))

###### Level 6 heading stays clamped at 6

Nothing below h6 exists; the shift clamps here instead of overflowing to h7.
