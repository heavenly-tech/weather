import { type ReactNode } from "react";
import { useSearchParams } from "@/client/next-navigation";
import { BriefingView } from "@/components/briefing-view";
import { ForecastView } from "@/components/forecast-view";
import { GametDesk } from "@/components/gamet-desk";
import { GrametDesk } from "@/components/gramet-desk";
import { MetarTafView } from "@/components/metar-taf-view";
import { ProductError, ProductLoading } from "@/components/product-state";
import { SynopticDesk } from "@/components/synoptic-desk";
import { VfrSvfrView } from "@/components/vfr-svfr-view";
import { VizDesk } from "@/components/viz-desk";
import { AndesDesk } from "@/components/andes-desk";
import { clientIcao } from "@/client/icao";
import { useClientQuery } from "@/client/query";
import { useNav } from "@/client/nav";
import { DEFAULT_ICAO, firForStation, getStation } from "@/lib/stations";
import type {
  ChileFirId,
  GametBulletin,
  GrametProduct,
  MetarObservation,
  PointForecast,
  ProductEnvelope,
  SynopticProduct,
  TafForecast,
  OfficialGametProduct,
  OfficialMetarProduct,
  OfficialTafProduct,
  VizStation,
} from "@/lib/types";
import NotFound from "@/app/not-found";

function DeskResult<T>({
  query,
  title,
  children,
}: {
  query: { loading: boolean; error: string | null; data: T | null };
  title: string;
  children: (data: T) => ReactNode;
}) {
  if (query.loading) return <ProductLoading rows={4} />;
  if (query.error || !query.data) {
    return <ProductError title={title} body={query.error ?? "The desk did not return a product."} />;
  }
  return children(query.data);
}

function HomeRoute() {
  const search = useSearchParams();
  const icao = clientIcao(search.get("icao"), DEFAULT_ICAO);
  const metar = useClientQuery<ProductEnvelope<MetarObservation>>(`/api/metar?icao=${icao}`);
  const taf = useClientQuery<ProductEnvelope<TafForecast>>(`/api/taf?icao=${icao}`);
  if (metar.loading || taf.loading) return <ProductLoading rows={4} />;
  if (metar.error || taf.error || !metar.data || !taf.data) {
    return (
      <ProductError
        title="Briefing unavailable"
        body={metar.error ?? taf.error ?? "METAR and TAF did not load."}
      />
    );
  }
  return <BriefingView icao={icao} station={getStation(icao)} metar={metar.data} taf={taf.data} />;
}

function MetarRoute() {
  const search = useSearchParams();
  const icao = clientIcao(search.get("icao"), DEFAULT_ICAO);
  const metar = useClientQuery<ProductEnvelope<MetarObservation>>(`/api/metar?icao=${icao}`);
  const taf = useClientQuery<ProductEnvelope<TafForecast>>(`/api/taf?icao=${icao}`);
  const officialMetar = useClientQuery<OfficialMetarProduct>(`/api/official/metar?icao=${icao}`);
  const officialTaf = useClientQuery<OfficialTafProduct>(`/api/official/taf?icao=${icao}`);
  if (metar.loading || taf.loading) return <ProductLoading rows={4} />;
  if (metar.error || taf.error || !metar.data || !taf.data) {
    return (
      <ProductError title="METAR / TAF unavailable" body={metar.error ?? taf.error ?? "No terminal product."} />
    );
  }
  return (
    <MetarTafView
      icao={icao}
      station={getStation(icao)}
      metar={metar.data}
      taf={taf.data}
      officialMetar={officialMetar.data}
      officialTaf={officialTaf.data}
    />
  );
}

function ForecastRoute() {
  const search = useSearchParams();
  const icao = clientIcao(search.get("icao"), DEFAULT_ICAO);
  const product = useClientQuery<ProductEnvelope<PointForecast>>(`/api/forecast?icao=${icao}`);
  return (
    <DeskResult query={product} title="Forecast unavailable">
      {(data) => <ForecastView icao={icao} station={getStation(icao)} product={data} />}
    </DeskResult>
  );
}

function GrametRoute() {
  const search = useSearchParams();
  const icao = clientIcao(search.get("icao"), DEFAULT_ICAO);
  const from = clientIcao(search.get("from"), icao);
  const to = clientIcao(search.get("to"), "SCTE");
  const envelope = useClientQuery<ProductEnvelope<GrametProduct>>(`/api/gramet?from=${from}&to=${to}`);
  return (
    <DeskResult query={envelope} title="GRAMET unavailable">
      {(data) => <GrametDesk from={from} to={to} envelope={data} />}
    </DeskResult>
  );
}

function parseFir(value: string | null): ChileFirId {
  const fir = (value ?? "SANTIAGO").toUpperCase();
  if (fir === "ANTOFAGASTA" || fir === "SANTIAGO" || fir === "PUERTO_MONTT") return fir;
  return "SANTIAGO";
}

function GametRoute() {
  const search = useSearchParams();
  const icao = clientIcao(search.get("icao"), DEFAULT_ICAO);
  const fir = parseFir(search.get("fir") ?? firForStation(icao));
  const envelope = useClientQuery<ProductEnvelope<GametBulletin>>(`/api/gamet?fir=${fir}`);
  const official = useClientQuery<OfficialGametProduct>(`/api/official/gamet?fir=${fir}`);
  return (
    <DeskResult query={envelope} title="GAMET unavailable">
      {(data) => (
        <GametDesk fir={fir} envelope={data} officialGamet={official.loading ? null : official.data} />
      )}
    </DeskResult>
  );
}

function SynopticRoute() {
  const envelope = useClientQuery<ProductEnvelope<SynopticProduct[]>>("/api/synoptic");
  return (
    <DeskResult query={envelope} title="Synoptic charts unavailable">
      {(data) => <SynopticDesk envelope={data} />}
    </DeskResult>
  );
}

function VizRoute() {
  const search = useSearchParams();
  const icao = clientIcao(search.get("icao"), DEFAULT_ICAO);
  const envelope = useClientQuery<ProductEnvelope<VizStation[]>>(`/api/viz?icao=${icao}`);
  return (
    <DeskResult query={envelope} title="3D field unavailable">
      {(data) => <VizDesk icao={icao} envelope={data} />}
    </DeskResult>
  );
}

function VfrRoute() {
  const search = useSearchParams();
  const icao = clientIcao(search.get("icao"), DEFAULT_ICAO);
  const metar = useClientQuery<ProductEnvelope<MetarObservation>>(`/api/metar?icao=${icao}`);
  return (
    <DeskResult query={metar} title="VFR margins unavailable">
      {(data) => <VfrSvfrView icao={icao} station={getStation(icao)} metar={data} />}
    </DeskResult>
  );
}

export function DeskRoutes() {
  const { pathname } = useNav();
  switch (pathname) {
    case "/":
      return <HomeRoute />;
    case "/metar-taf":
      return <MetarRoute />;
    case "/forecast":
      return <ForecastRoute />;
    case "/gramet":
      return <GrametRoute />;
    case "/gamet":
      return <GametRoute />;
    case "/synoptic":
      return <SynopticRoute />;
    case "/viz":
      return <VizRoute />;
    case "/vfr-svfr":
      return <VfrRoute />;
    case "/andes":
      return <AndesDesk />;
    default:
      return <NotFound />;
  }
}
