"use client";

import { useEffect, useRef, useState } from "react";
import type { Viewer } from "cesium";
import { ANDES_DOMAIN, SCTB_FOCUS } from "@/lib/andes/domain";
import { categoryColor } from "@/lib/andes/ceiling";
import type { CeilingCell } from "@/lib/andes/fetch-field";

type SliceValue = { lat: number; lon: number; tempC: number | null; cloudPct: number | null };

function cellsToCanvas(
  cells: CeilingCell[] | SliceValue[],
  mode: "ceiling" | "slice"
): { dataUrl: string; rectangle: [number, number, number, number] } {
  const lats = cells.map((c) => c.lat);
  const lons = cells.map((c) => c.lon);
  const west = Math.min(...lons);
  const east = Math.max(...lons);
  const south = Math.min(...lats);
  const north = Math.max(...lats);

  const cols = 9;
  const rows = 8;
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d")!;

  cells.forEach((cell, i) => {
    const x = i % cols;
    const y = Math.floor(i / cols);
    let color = "#334155";
    if (mode === "ceiling" && "category" in cell) {
      const c = cell as CeilingCell;
      color = c.obscured ? "#78716c" : categoryColor(c.category);
    } else if (mode === "slice") {
      const s = cell as SliceValue;
      const t = s.tempC ?? 0;
      const norm = Math.max(0, Math.min(1, (t + 10) / 30));
      const r = Math.round(40 + norm * 180);
      const b = Math.round(200 - norm * 120);
      color = `rgb(${r},120,${b})`;
    }
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  });

  return { dataUrl: canvas.toDataURL(), rectangle: [west, south, east, north] };
}

export function AndesScene({
  ceilingCells,
  sliceValues,
  showSlice,
  pressureHpa,
}: {
  ceilingCells: CeilingCell[];
  sliceValues: SliceValue[];
  showSlice: boolean;
  pressureHpa: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const overlayKey = useRef(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;

    const boot = async () => {
      try {
        (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = "/cesium/";
        const Cesium = await import("cesium");
        if (cancelled) return;

        if (!document.querySelector("link[data-cesium-widgets]")) {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = "/cesium/Widgets/widgets.css";
          link.setAttribute("data-cesium-widgets", "true");
          document.head.appendChild(link);
        }

        const ionToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
        if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;

        let terrainProvider: import("cesium").TerrainProvider = new Cesium.EllipsoidTerrainProvider();
        if (ionToken) {
          try {
            terrainProvider = await Cesium.createWorldTerrainAsync();
          } catch {
            /* ellipsoid fallback */
          }
        }

        const viewer = new Cesium.Viewer(el, {
          animation: false,
          timeline: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: true,
          baseLayerPicker: false,
          navigationHelpButton: false,
          fullscreenButton: true,
          terrainProvider,
          baseLayer: new Cesium.ImageryLayer(
            new Cesium.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" })
          ),
        });
        viewer.scene.globe.depthTestAgainstTerrain = true;
        viewerRef.current = viewer;

        viewer.entities.add({
          name: "SCTB",
          position: Cesium.Cartesian3.fromDegrees(SCTB_FOCUS.lon, SCTB_FOCUS.lat, 800),
          point: { pixelSize: 10, color: Cesium.Color.YELLOW },
          label: {
            text: "SCTB",
            font: "14px monospace",
            fillColor: Cesium.Color.WHITE,
            pixelOffset: new Cesium.Cartesian2(0, -14),
          },
        });

        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(
            (ANDES_DOMAIN.lonMin + ANDES_DOMAIN.lonMax) / 2,
            (ANDES_DOMAIN.latMin + ANDES_DOMAIN.latMax) / 2,
            180_000
          ),
          duration: 0.8,
        });

        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    };

    void boot();
    return () => {
      cancelled = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ceilingCells.length) return;

    let cancelled = false;
    const id = `andes-overlay-${overlayKey.current++}`;

    const paint = async () => {
      const Cesium = await import("cesium");
      const v = viewerRef.current;
      if (cancelled || !v) return;
    v.entities.removeById(id);
    v.entities.removeById(`${id}-slice`);
    v.entities.removeById(`${id}-plane`);

    const { dataUrl, rectangle } = cellsToCanvas(ceilingCells, "ceiling");
    v.entities.add({
      id,
      name: "Ceiling (ft AGL)",
      rectangle: {
        coordinates: Cesium.Rectangle.fromDegrees(rectangle[0], rectangle[1], rectangle[2], rectangle[3]),
        material: new Cesium.ImageMaterialProperty({ image: dataUrl, transparent: true }),
        height: 50,
      },
    });

    ceilingCells
      .filter((c) => c.obscured)
      .forEach((c, i) => {
        v.entities.add({
          id: `${id}-obs-${i}`,
          rectangle: {
            coordinates: Cesium.Rectangle.fromDegrees(c.lon - 0.08, c.lat - 0.08, c.lon + 0.08, c.lat + 0.08),
            material: Cesium.Color.fromCssColorString("#57534e").withAlpha(0.65),
            height: c.elevM,
          },
        });
      });

    if (showSlice && sliceValues.length) {
      const sliceImg = cellsToCanvas(sliceValues, "slice");
      v.entities.add({
        id: `${id}-slice`,
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(
            sliceImg.rectangle[0],
            sliceImg.rectangle[1],
            sliceImg.rectangle[2],
            sliceImg.rectangle[3]
          ),
          material: new Cesium.ImageMaterialProperty({ image: sliceImg.dataUrl, transparent: true }),
          height: 8000 + pressureHpa * 2,
        },
      });
    }
    };

    void paint();
    return () => {
      cancelled = true;
    };
  }, [ceilingCells, sliceValues, showSlice, pressureHpa]);

  return (
    <div className="relative h-[560px] w-full overflow-hidden rounded-xl ring-1 ring-foreground/10">
      <div ref={containerRef} className="h-full w-full" />
      {status === "loading" ? (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/60 text-sm">
          Loading Andes terrain…
        </p>
      ) : null}
      {status === "error" ? (
        <p className="absolute inset-0 flex items-center justify-center bg-background/80 text-sm text-destructive">
          Cesium failed to start.
        </p>
      ) : null}
    </div>
  );
}