# Pip's Pond

A meal plan tracker (swipes + retail points) with a frog who keeps you on pace.
Plain HTML/CSS/JS, no build step. Works offline and installs to your home screen.

**Live app:** https://gayoreo.github.io/pips-pond/

## Run locally
Open the folder in VS Code → right-click `index.html` → **Open with Live Server**.

## Tests
With Live Server running, open `/tests/calc.test.html`.

## Folders
- `js/core/` budget math (calc, weights, semesters), no screen code
- `js/data/` storage on this device, import/export
- `js/pip/` the frog: drawing, moods, lines
- `js/ui/` shared UI helpers (info popups, sounds, widgets, report card)
- `js/views/` one file per screen
- `sw.js` offline cache. **Bump `VERSION` when you add or rename files.**

## Shortcut links
`?log=swipe`, `?log=exchange`, `?log=guest`, `?log=points`, `?log=points&amount=5.45`, `?fav=Latte`
