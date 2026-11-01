# Template gallery thumbnails

`public/resume-templates/<id>.png` is each template rendered with one sample
résumé, in the fonts the PDF embeds. Rebuild them after changing a template:

```sh
cd apps/api
.venv/Scripts/python.exe -I ../web/scripts/template-thumbnails/dump_html.py <out-html-dir>
node ../web/scripts/template-thumbnails/shoot.mjs <out-html-dir> ../web/public/resume-templates
```

`dump_html.py` renders the real templates (`app.services.pdf`) and adds the
`@font-face` rules and page margin a browser needs; `shoot.mjs` screenshots
each at A4 (794×1123 CSS px, ×1.05 → 834×1179), using the Playwright install
under `.claude/skills/run-ai-copilot`.
