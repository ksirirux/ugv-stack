# UGV Field Vision Backend

FastAPI endpoint for analyzing the satellite imagery under the polygon drawn by the user.

## Files

- `vision_api.py` — API and image-analysis pipeline
- `requirements.txt` — Python dependencies
- `.env.example` — configuration example

## Install on Raspberry Pi / Ubuntu

```bash
cd ugv_vision_backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env
```

Load `.env` into the shell and start the API:

```bash
set -a
source .env
set +a

uvicorn vision_api:app --host 0.0.0.0 --port 8001
```

Health check:

```bash
curl http://127.0.0.1:8001/api/vision/health
```

## Test request

```bash
curl -X POST http://127.0.0.1:8001/api/vision/analyze-field   -H 'Content-Type: application/json'   -d '{
    "boundary": [
      [16.5381, 99.4525],
      [16.5388, 99.4532],
      [16.5378, 99.4535]
    ],
    "obstacles": [],
    "bounds": {
      "north": 16.5388,
      "south": 16.5378,
      "east": 99.4535,
      "west": 99.4525
    },
    "zoom": 19
  }'
```

## Vite development proxy

The frontend currently calls `/api/vision/analyze-field`. During development, proxy `/api` to port 8001:

```js
// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8001",
        changeOrigin: true
      }
    }
  }
});
```

Restart `npm run dev` after editing `vite.config.js`.

## Response

```json
{
  "angle": 57.4,
  "spacing": 3.45,
  "confidence": 0.82,
  "rows": [
    [[16.53791, 99.45242], [16.53862, 99.45308]]
  ],
  "analysisZoom": 19,
  "tileCount": 6,
  "imageSize": {"width": 768, "height": 512}
}
```

`spacing` can be `null` when the image provides a clear direction but insufficient repeating texture for a reliable spacing estimate.

## Important

The satellite image is used to suggest row direction and spacing only. The final mission must still be verified by the user and executed using RTK positioning and live obstacle sensors.


## Orchard analysis fields

The same endpoint now also returns detected tree centers and estimated orchard spacing:

```json
{
  "treeCount": 214,
  "treeSpacing": {
    "alongRow": 8.4,
    "betweenRows": 7.9,
    "recommendedPathSpacing": 7.9
  },
  "treeCenters": [
    {
      "latitude": 16.53781234,
      "longitude": 99.45262145,
      "crownRadius": 1.35,
      "suggestedRadius": 1.95,
      "confidence": 0.81
    }
  ]
}
```

`treeCenters` are suggestions derived from satellite imagery. Review them on the map before converting them to safety obstacles.
