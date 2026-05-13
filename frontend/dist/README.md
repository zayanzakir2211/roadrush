# public/

Place static assets here. They are served as-is by Vite.

## Suggested assets to add

- `favicon.ico` — browser tab icon
- `vehicles/sports.glb` — Sports Car GLTF model
- `vehicles/truck.glb` — Truck GLTF model
- `vehicles/suv.glb` — SUV GLTF model

## Free GLTF vehicle models

Browse free-to-use car models at:
- https://sketchfab.com/3d-models/categories/cars-vehicles?sort_by=-relevance&features=downloadable&license=cc4
- https://poly.pizza (CC0 models)
- https://kenney.nl/assets (CC0 game assets, includes vehicles)

## Loading models

Once you have .glb files, update the `modelUrl` fields in `src/vehicle.js`:

```js
const VEHICLE_DEFS = [
  { name: 'Sports Car', modelUrl: '/vehicles/sports.glb', ... },
  { name: 'Truck',      modelUrl: '/vehicles/truck.glb',  ... },
  { name: 'SUV',        modelUrl: '/vehicles/suv.glb',    ... },
];
```

If no model is found, the game falls back to procedural placeholder geometry automatically.
