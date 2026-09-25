"use client";

import { ArrowDownRight, ArrowUpRight, BarChart3, Globe2, MousePointerClick, Smartphone, Sparkles, Users, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, MiniBar, PageHeader, SectionTitle, SelectBox } from "@/components/ui";
import { emptyAnalytics, formatChange, loadAnalytics, peekAnalytics, socialColor, type AnalyticsRange, type AnalyticsSummary } from "@/lib/analytics";
import { useT } from "@/lib/i18n";

const RANGES: AnalyticsRange[] = ["3D", "7D", "30D", "90D"];

export function AnalyticsView() {
  const t = useT();
  const [range, setRange] = useState<AnalyticsRange>("7D");
  const [data, setData] = useState<AnalyticsSummary>(() => peekAnalytics("7D") || emptyAnalytics("7D"));
  const [status, setStatus] = useState<"loading" | "ready" | "error">(() => peekAnalytics("7D") ? "ready" : "loading");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const cached = peekAnalytics(range);
    if (cached) {
      setData(cached);
      setStatus("ready");
    } else {
      setData(emptyAnalytics(range));
      setStatus("loading");
    }
    void loadAnalytics(range).then((next) => {
      if (cancelled) return;
      setData(next);
      setStatus("ready");
    }).catch(() => {
      if (cancelled) return;
      if (!cached) setStatus("error");
    });
    return () => { cancelled = true; };
  }, [range, reloadKey]);

  const empty = status === "ready" && data.views === 0 && data.clicks === 0;
  const deviceTotal = data.devices.desktop + data.devices.mobile + data.devices.tablet;
  const referrerTotal = data.referrers.reduce((sum, item) => sum + item.count, 0);
  const countryTotal = data.countries.reduce((sum, item) => sum + item.count, 0);
  const stats = [
    { label: t("analytics.views"), value: formatNumber(data.views), change: data.viewsChange, icon: Users },
    { label: t("analytics.clicks"), value: formatNumber(data.clicks), change: data.clicksChange, icon: MousePointerClick },
    { label: t("analytics.clickRate"), value: `${data.clickRate.toFixed(1)}%`, change: data.clickRateChange, icon: Zap },
    { label: t("analytics.avgDaily"), value: data.avgDailyViews.toFixed(1), change: data.avgDailyViewsChange, icon: BarChart3 },
  ];

  return (
    <main className="mx-auto min-h-screen max-w-[1350px] px-5 py-8 sm:px-8 sm:py-11 xl:px-12">
      <PageHeader eyebrow={t("analytics.eyebrow")} title={t("analytics.title")} description={t("analytics.description")} action={<SelectBox value={range} options={RANGES} onChange={(value) => setRange(value as AnalyticsRange)} />} />
      {status === "error" ? <div role="alert" className="mb-5 flex items-center justify-between gap-4 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200"><span>Could not load analytics.</span><Button onClick={() => setReloadKey((value) => value + 1)}>Retry</Button></div> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, change, icon: Icon }) => (
          <div key={label} className="surface rounded-2xl p-5">
            <div className="flex items-start justify-between"><span className="text-xs text-zinc-500">{label}</span><Icon size={16} className="text-[#fb7185]" /></div>
            <p className="mt-5 text-2xl font-semibold tracking-[-.04em]">{status === "loading" ? "—" : value}</p>
            <ChangeLine value={change} />
          </div>
        ))}
      </div>
      {empty ? (
        <div className="mt-8 rounded-2xl border border-white/[.06] bg-white/[.02] px-6 py-16 text-center">
          <p className="text-sm font-medium text-white">{t("analytics.emptyTitle")}</p>
          <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-zinc-500">{t("analytics.emptyDesc")}</p>
        </div>
      ) : null}
      <div className="mt-8 grid gap-6 xl:grid-cols-[1.35fr_.65fr]">
        <section className="surface rounded-2xl p-5 sm:p-6">
          <SectionTitle icon={BarChart3} title={t("analytics.views")} description={t("analytics.viewsOver", { range: range.toLowerCase() })} />
          <ViewsChart series={data.series} />
        </section>
        <section className="surface rounded-2xl p-5 sm:p-6">
          <SectionTitle icon={Smartphone} title={t("analytics.devices")} description={t("analytics.devicesDesc")} />
          <DeviceChart devices={data.devices} total={deviceTotal} />
        </section>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="surface rounded-2xl p-5 sm:p-6">
          <SectionTitle icon={Sparkles} title={t("analytics.referrers")} />
          <BarList items={data.referrers.map((item) => ({ label: item.label, value: item.count }))} total={referrerTotal} empty={t("analytics.noReferrers")} />
        </section>
        <section className="surface rounded-2xl p-5 sm:p-6">
          <SectionTitle icon={MousePointerClick} title={t("analytics.socials")} />
          {data.socials.length === 0 ? (
            <p className="mt-4 text-xs text-zinc-600">{t("analytics.noClicks")}</p>
          ) : (
            <div className="space-y-2">
              {data.socials.map((item, index) => (
                <div key={`${item.id}-${index}`} className="flex items-center gap-3 rounded-xl px-2 py-2.5">
                  <span className="w-4 font-mono text-[10px] text-zinc-700">{String(index + 1).padStart(2, "0")}</span>
                  <span className="h-8 w-8 rounded-lg" style={{ background: `${socialColor(item.label)}18` }} />
                  <span className="flex-1 text-sm text-zinc-300">{item.label}</span>
                  <span className="text-xs text-zinc-600">{item.clicks} {item.clicks === 1 ? "click" : "clicks"}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <div className="mt-6">
        <section className="surface rounded-2xl p-5 sm:p-6">
          <SectionTitle icon={Globe2} title={t("analytics.countries")} />
          <BarList items={data.countries.map((item) => ({ label: item.label, value: item.count }))} total={countryTotal} empty="Country data appears when visitors arrive through the live domain." />
        </section>
      </div>
    </main>
  );
}

function ChangeLine({ value }: { value: number }) {
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <p className={`mt-2 flex items-center gap-1 text-xs ${up ? "text-emerald-400" : "text-rose-400"}`}>
      <Icon size={13} />
      {formatChange(value)}
      <span className="text-zinc-600">vs previous period</span>
    </p>
  );
}

function ViewsChart({ series }: { series: AnalyticsSummary["series"] }) {
  const values = series.map((item) => item.views);
  const max = Math.max(1, ...values, 4);
  const top = niceMax(max);
  const ticks = [top, Math.round(top * 0.75), Math.round(top * 0.5), Math.round(top * 0.25), 0];
  return (
    <div className="relative mt-8 h-[240px] w-full">
      <div className="absolute inset-0 flex flex-col justify-between text-[10px] text-zinc-700">
        {ticks.map((tick) => <span key={tick}>{tick}</span>)}
      </div>
      <div className="absolute inset-0 ml-7 flex flex-col justify-between">
        {ticks.map((tick) => <span key={tick} className="border-t border-dashed border-white/[.06]" />)}
      </div>
      {values.length > 0 ? (
        <svg viewBox="0 0 700 220" preserveAspectRatio="none" className="absolute inset-x-8 bottom-5 top-0 h-[220px] w-[calc(100%-2rem)] overflow-visible">
          <defs>
            <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#e11d48" stopOpacity=".27" />
              <stop offset="1" stopColor="#e11d48" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath(values, top)} fill="url(#chartFill)" />
          <path d={linePath(values, top)} fill="none" stroke="#fb7185" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          {values.map((value, index) => (
            <circle key={index} cx={values.length === 1 ? 350 : (index / (values.length - 1)) * 700} cy={220 - (value / top) * 220} r="3.5" fill="#0d0d12" stroke="#bdb3ff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      ) : null}
      <div className="absolute bottom-0 left-8 right-0 flex justify-between text-[10px] text-zinc-700">
        {series.map((item) => <span key={item.label}>{item.label}</span>)}
      </div>
    </div>
  );
}

function DeviceChart({ devices, total }: { devices: AnalyticsSummary["devices"]; total: number }) {
  const t = useT();
  const desktop = percent(devices.desktop, total);
  const mobile = percent(devices.mobile, total);
  const tablet = percent(devices.tablet, total);
  const endDesktop = desktop;
  const endMobile = desktop + mobile;
  return (
    <>
      <div className="mt-6 flex items-center justify-center">
        <div className="relative flex h-36 w-36 items-center justify-center rounded-full" style={{ background: `conic-gradient(#e11d48 0 ${endDesktop}%, #69cbb6 ${endDesktop}% ${endMobile}%, #e5a36f ${endMobile}% 100%)` }}>
          <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-[#111116]">
            <span className="text-xl font-semibold">{total}</span>
            <span className="text-[10px] text-zinc-600">visitors</span>
          </div>
        </div>
      </div>
      <div className="mt-6 space-y-3">
        {[[t("analytics.desktop"), desktop, "#e11d48"], [t("analytics.mobile"), mobile, "#69cbb6"], [t("analytics.tablet"), tablet, "#e5a36f"]].map(([label, value, color]) => (
          <div key={String(label)} className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 rounded-full" style={{ background: String(color) }} />
            <span className="flex-1 text-zinc-400">{label}</span>
            <span className="font-mono text-zinc-300">{value}%</span>
          </div>
        ))}
      </div>
    </>
  );
}

function BarList({ items, total, empty }: { items: Array<{ label: string; value: number }>; total: number; empty: string }) {
  if (items.length === 0) return <p className="mt-4 text-xs text-zinc-600">{empty}</p>;
  return (
    <div className="space-y-5">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-2 flex justify-between text-xs">
            <span className="text-zinc-400">{item.label}</span>
            <span className="text-zinc-500">{percent(item.value, total)}%</span>
          </div>
          <MiniBar value={percent(item.value, total)} />
        </div>
      ))}
    </div>
  );
}

function formatNumber(value: number) {
  return value.toLocaleString();
}

function percent(value: number, total: number) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function niceMax(value: number) {
  if (value <= 4) return 4;
  if (value <= 10) return 10;
  if (value <= 20) return 20;
  if (value <= 40) return 40;
  if (value <= 80) return 80;
  return Math.ceil(value / 10) * 10;
}

function linePath(values: number[], top: number) {
  if (values.length === 1) return `M 350 ${220 - (values[0] / top) * 220}`;
  return values.map((value, index) => `${index === 0 ? "M" : "L"} ${(index / (values.length - 1)) * 700} ${220 - (value / top) * 220}`).join(" ");
}

function areaPath(values: number[], top: number) {
  if (values.length === 1) return `M 350 ${220 - (values[0] / top) * 220} L 350 220 L 350 220 Z`;
  return `${linePath(values, top)} L 700 220 L 0 220 Z`;
}
