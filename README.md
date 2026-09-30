# FACF Cinematic Flight v4.1.0

This revision keeps the single integrated aircraft and upgrades the flight, atmosphere and destination worlds without replacing the existing experience.

## Visual quality upgrades

* Layered 3D cloud volume fields across near, mid and far atmosphere
* Denser sky coverage with faster depth parallax during exterior and window flight
* Continuous aircraft bank, pitch, altitude and lateral micro motion while airborne
* Subtle camera drift and airflow streaks for stronger speed perception
* Higher fidelity fuselage paint, glass, metal and rubber response
* Procedural micro normal and roughness detail on aircraft materials
* Structured city grids with roads, lane lighting and denser skylines
* More varied building silhouettes including low rise, tower and cylindrical forms
* Existing landmarks, cinematic sequence and single aircraft coordinate system preserved
* Existing runway touchdown safety clamp preserved

## Run locally

```bash
npm install
npm run dev
```

The complete cinematic scene is restored automatically before development and production builds.

The integrated aircraft itself must be available in one of these ways:

1. Place the GLB at `public/assets/facf-787-single.glb`
2. Set `AIRCRAFT_MODEL_URL` for the build environment
3. Set `VITE_AIRCRAFT_MODEL_URL` for a browser fallback during local development

The temporary signed model URL from the previous build is intentionally not stored in GitHub source.

## Production

```bash
npm install
npm run build
npm run preview
```

Stack: React, Three.js, GSAP ScrollTrigger, Lenis, Tailwind CSS and Vite.
