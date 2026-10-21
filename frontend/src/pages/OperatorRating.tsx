import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { SegmentedControl } from "../components/ui";
import { MonthContest } from "./MonthContest";
import {
  ChannelsCard,
  CompareError,
  CompareFilters,
  CompareLoading,
  CompareSheet,
  CompareSummary,
  CompareTable,
  MetricsCompare,
  RatingHead,
  TeamsCard,
  useCompare,
} from "./RatingCompare";

/**
 * The operator's «Рейтинг» opens on the month's contest: the top three, the nominations and the month's table, as
 * leaders see it without their buttons. «Сравнение» is the comparison with everyone; its links (?view=weeks, ?week=,
 * ?period=, ?month=, ?with=) open it directly.
 */
export function OperatorRatingPage() {
  const [params, setParams] = useSearchParams();
  const compare = ["compare", "weeks"].includes(params.get("view") ?? "") || ["week", "period", "month", "with"].some((key) => params.has(key));
  const toggle = <div data-tour="rating-views"><SegmentedControl label="Вид рейтинга" value={compare ? "compare" : "contest"}
    options={[{ value: "contest", label: "Конкурс месяца" }, { value: "compare", label: "Сравнение" }]}
    onChange={(value) => setParams(value === "compare" ? { view: "compare" } : {})} /></div>;
  if (compare) return <OperatorRating toggle={toggle} />;
  return <div className="stack">
    <header className="page-head"><div><h1 className="page-title">Рейтинг</h1><p className="page-subtitle">Места и номинации месяца среди всех операторов</p></div></header>
    {toggle}
    <MonthContest />
  </div>;
}

/**
 * The comparison in the operator's «Рейтинг» (docs/RATING_COMPARE.md): your place and the teams, then every operator with their places
 * week by week, and each metric against everyone. A row opens the comparison with that operator.
 */
export function OperatorRating({ toggle }: { toggle?: ReactNode }) {
  const state = useCompare();
  const { data, colleague, set } = state;
  return <div className="stack rating-compare">
    <RatingHead><CompareFilters state={state} /></RatingHead>
    {toggle}
    {state.query.isLoading ? <CompareLoading />
      : state.query.isError || !data ? <CompareError state={state} />
      : <>
        <div className="compare-grid">
          <CompareSummary data={data} />
          <TeamsCard data={data} />
        </div>
        <ChannelsCard data={data} />
        <CompareTable data={data} colleague={colleague} onPick={(row) => set({ with: String(row.user_id) }, true)} />
        <MetricsCompare data={data} />
        {colleague && <CompareSheet data={data} colleague={colleague} onClose={() => set({ with: undefined }, true)} />}
      </>}
  </div>;
}
