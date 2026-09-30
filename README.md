# FACF Cinematic Flight v4.1.0

This build keeps the single integrated aircraft and upgrades the visual fidelity of the flight itself.

## v4.1.0 quality pass

- Layered 3D cloud volume fields across near, mid and far atmosphere
- Faster cloud parallax during exterior flight and window sequences
- Continuous aircraft bank, pitch and altitude micro motion during airborne exterior scenes
- Subtle exterior camera motion and airflow streaks for speed perception
- Higher fidelity fuselage paint, glass, metal and rubber material tuning
- Procedural micro normal and roughness detail on aircraft surfaces
- Structured city grids, road networks, lane lighting and denser skylines
- More varied building silhouettes
- Preserved single aircraft coordinate system and runway safety clamp

## Run locally

```bash
npm install
npm run dev
```

The app checks for the integrated aircraft at `public/assets/facf-787-single.glb` before Vite starts.