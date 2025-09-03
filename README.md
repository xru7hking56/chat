# AnonChat (mobile chat behavior)
- Sticky header kept as-is (no UI changes beyond your existing top bar).
- Chat auto-scrolls to the newest line.
- Input stays above mobile keyboard (VisualViewport + CSS safe-area).
- Admin panel at /admin (set ADMIN_KEY env).

## Run
npm install
ADMIN_KEY=your-strong-key npm start

Then open http://localhost:3000
