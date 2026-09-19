"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Viewer } from "cesium";
import type { VizStation } from "@/lib/types";
import { CHILE_COAST } from "@/lib/geo";

function catColor(cat: VizStation["flightCategory"]): string {
  switch (cat) {
    case "VFR":
      return "#6ee7b7";
    case "MVFR":
      return "#7dd3fc";
    case "IFR":
      return "#fbbf24";
    case "LIFR":
      return "#fb7185";
    default:
      return "#94a3b8";
  }
}

function exaggerationM(station: VizStation, focus: boolean): number {
  const cloud = station.cloudPct ?? 20;
  const base = 18_000 + station.elevM * 12 + cloud * 180;
  return focus ? base * 1.35 : base;
}

export function WeatherScene({
  stations,
  focusIcao,
}: {
  stations: VizStation[];
  focusIcao: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const stationKey = useMemo(
    () => stations.map((s) => `${s.icao}:${s.flightCategory}:${s.windKt ?? ""}`).join("|"),
    [stations]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;

    const start = async () => {
      try {
        (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = "/cesium/";
        const Cesium = await import("cesium");
        if (cancelled || !containerRef.current) return;

        if (!document.querySelector("link[data-cesium-widgets]")) {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = "/cesium/Widgets/widgets.css";
          link.setAttribute("data-cesium-widgets", "true");
          document.head.appendChild(link);
        }

        const ionToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
        if (ionToken) {
          Cesium.Ion.defaultAccessToken = ionToken;
        }

        const canvas = document.createElement("canvas");
        const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
        if (!gl) {
          throw new Error("This browser has no WebGL, so the Cesium globe cannot start.");
        }

        const viewer = new Cesium.Viewer(containerRef.current, {
          animation: false,
          timeline: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: true,
          baseLayerPicker: false,
          navigationHelpButton: false,
          fullscreenButton: true,
          infoBox: true,
          selectionIndicator: true,
          terrainProvider: new Cesium.EllipsoidTerrainProvider(),
          baseLayer: new Cesium.ImageryLayer(
            new Cesium.OpenStreetMapImageryProvider({
              url: "https://tile.openstreetmap.org/",
            })
          ),
        });
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#0b1220");
        viewer.scene.globe.enableLighting = true;
        viewerRef.current = viewer;

        viewer.entities.add({
          name: "Chile coast",
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(CHILE_COAST.flatMap((p) => [p.lon, p.lat])),
            width: 2,
            material: Cesium.Color.fromCssColorString("#f3d39a"),
            clampToGround: true,
          },
        });

        stations.forEach((station) => {
          const focus = station.icao === focusIcao;
          const length = exaggerationM(station, focus);
          const color = Cesium.Color.fromCssColorString(catColor(station.flightCategory));
          viewer.entities.add({
            name: `${station.icao} ${station.name}`,
            description: `<p>${station.name} · ${station.flightCategory} · ${station.tempC ?? "—"} °C · ${station.windKt ?? "—"} kt</p>`,
            position: Cesium.Cartesian3.fromDegrees(station.lon, station.lat, length / 2),
            cylinder: {
              length,
              topRadius: focus ? 6_000 : 4_000,
              bottomRadius: focus ? 9_000 : 6_500,
              material: color.withAlpha(focus ? 0.92 : 0.72),
              outline: true,
              outlineColor: color,
            },
            label: {
              text: station.icao,
              font: "12px ui-monospace, monospace",
              fillColor: Cesium.Color.fromCssColorString("#fde68a"),
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cesium.Cartesian2(0, -28),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });

          if (focus) {
            station.levels.slice(0, 5).forEach((level, i) => {
              const alt = 22_000 + i * 12_000;
              viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(station.lon, station.lat, alt),
                box: {
                  dimensions: new Cesium.Cartesian3(8_000 + (level.windKt ?? 0) * 80, 2_000, 2_000),
                  material: Cesium.Color.fromCssColorString("#7dd3fc").withAlpha(0.85),
                },
                orientation: Cesium.Transforms.headingPitchRollQuaternion(
                  Cesium.Cartesian3.fromDegrees(station.lon, station.lat, alt),
                  new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(level.windDirDeg ?? 0), 0, 0)
                ),
              });
            });
          }
        });

        const focus = stations.find((s) => s.icao === focusIcao) ?? stations[0];
        if (!cancelled) setStatus("ready");
        if (focus && !cancelled) {
          void viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(focus.lon, focus.lat, 1_350_000),
            duration: 1.4,
          });
        }
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : "The Cesium globe failed to start.");
      }
    };

    const timeout = window.setTimeout(() => {
      if (!cancelled) {
        setStatus((current) => (current === "loading" ? "error" : current));
        setError((current) => current ?? "The Cesium globe did not finish starting.");
      }
    }, 10_000);

    void start();

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
    // stationKey captures METAR-driven visual changes without restarting on array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationKey, focusIcao]);

  return (
    <div className="relative h-[520px] w-full overflow-hidden rounded-xl ring-1 ring-foreground/10">
      <div ref={containerRef} className="h-full w-full" />
      {status === "loading" ? (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/70 text-sm text-muted-foreground">
          Loading Cesium globe over Chile…
        </p>
      ) : null}
      {status === "error" ? (
        <p className="absolute inset-0 flex items-center justify-center bg-background/90 p-6 text-center text-sm text-muted-foreground">
          {error} Station columns below still show live METAR flight categories.
        </p>
      ) : null}
    </div>
  );
}
