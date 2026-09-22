# Pip's Pond

Meal plan tracker for swipes and retail points. There's a frog named Pip. He gets sad if you overspend.

Live: https://gayoreo.github.io/pips-pond/

## Running it
Plain HTML, CSS and JS, no build step. Open the folder in VS Code, right-click `index.html`, pick Open with Live Server.

## Tests
Run Live Server and open `/tests/calc.test.html`.

## What's where
- `js/core/` the budget math (calc, weights, semesters)
- `js/data/` saving, syncing, import and export
- `js/pip/` the frog: drawing, moods, lines
- `js/ui/` shared bits (popups, sounds, widgets, report card)
- `js/views/` the screens, one file each
- `supabase/` database schema and functions for accounts, friends and reminders
- `sw.js` offline cache. Bump `VERSION` when you add or rename files.

## Shortcut links
`?log=swipe`, `?log=exchange`, `?log=guest`, `?log=points`, `?log=points&amount=5.45`, `?fav=Latte`
