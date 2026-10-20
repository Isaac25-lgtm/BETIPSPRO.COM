import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, RouterProvider } from "react-router";
import { AuthProvider } from "./auth";
import { Layout } from "./Layout";
import Home from "../pages/Home";
import { Skeleton } from "../components/ui";

const Matches = lazy(() => import("../pages/Matches"));
const MatchCentreHub = lazy(() => import("../pages/Matches").then((m) => ({ default: m.MatchCentreHub })));
const MatchDetail = lazy(() => import("../pages/MatchDetail"));
const MarketEvidence = lazy(() => import("../pages/MarketEvidence"));
const Leagues = lazy(() => import("../pages/Leagues"));
const LeagueDetail = lazy(() => import("../pages/Leagues").then((m) => ({ default: m.LeagueDetail })));
const Statistics = lazy(() => import("../pages/Statistics"));
const MatchReport = lazy(() => import("../pages/Report"));
const Archive = lazy(() => import("../pages/Statistics").then((m) => ({ default: m.Archive })));
const InfoPages = lazy(() => import("../pages/Info"));
const Auth = lazy(() => import("../pages/Auth"));
const Join = lazy(() => import("../pages/Auth").then((m) => ({ default: m.Join })));
const Account = lazy(() => import("../pages/Account"));
const Admin = lazy(() => import("../pages/Admin"));
const NotFound = lazy(() => import("../pages/Info").then((m) => ({ default: m.NotFound })));

function PageFallback() {
  return (
    <div className="container" style={{ padding: "28px var(--gutter)" }} aria-busy="true" aria-label="Loading">
      <Skeleton h={34} w="40%" />
      <Skeleton h={18} w="65%" style={{ marginTop: 12 }} />
      <Skeleton h={260} style={{ marginTop: 24 }} r={12} />
    </div>
  );
}

const S = (el: ReactNode) => <Suspense fallback={<PageFallback />}>{el}</Suspense>;

const router = createBrowserRouter([
  {
    element: (
      <AuthProvider>
        <Layout />
      </AuthProvider>
    ),
    children: [
      { path: "/", element: <Home /> },
      { path: "/matches", element: S(<Matches />) },
      { path: "/match-centre", element: S(<MatchCentreHub />) },
      { path: "/matches/:id", element: S(<MatchDetail />) },
      { path: "/matches/:id/markets/:marketId", element: S(<MarketEvidence />) },
      { path: "/leagues", element: S(<Leagues />) },
      { path: "/leagues/:id", element: S(<LeagueDetail />) },
      { path: "/statistics", element: S(<Statistics />) },
      { path: "/report", element: S(<MatchReport />) },
      { path: "/predictions/archive", element: S(<Archive />) },
      { path: "/research/how-it-works", element: S(<InfoPages page="how" />) },
      { path: "/pricing", element: S(<InfoPages page="pricing" />) },
      { path: "/about", element: S(<InfoPages page="about" />) },
      { path: "/responsible-use", element: S(<InfoPages page="responsible" />) },
      { path: "/legal/privacy", element: S(<InfoPages page="privacy" />) },
      { path: "/legal/terms", element: S(<InfoPages page="terms" />) },
      { path: "/legal/data-rights", element: S(<InfoPages page="data" />) },
      { path: "/login", element: S(<Auth />) },
      { path: "/join", element: S(<Join />) },
      { path: "/app/*", element: S(<Account />) },
      { path: "/admin/*", element: S(<Admin />) },
      { path: "*", element: S(<NotFound />) },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
