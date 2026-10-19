import {
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
 * The operator's «Рейтинг» (docs/RATING_COMPARE.md): your place and the teams, then every operator with their places
 * week by week, and each metric against everyone. A row opens the comparison with that operator.
 */
export function OperatorRating() {
  const state = useCompare();
  const { data, colleague, set } = state;
  return <div className="stack rating-compare">
    <RatingHead><CompareFilters state={state} /></RatingHead>
    {state.query.isLoading ? <CompareLoading />
      : state.query.isError || !data ? <CompareError state={state} />
      : <>
        <div className="compare-grid">
          <CompareSummary data={data} />
          <TeamsCard data={data} />
        </div>
        <CompareTable data={data} colleague={colleague} onPick={(row) => set({ with: String(row.user_id) }, true)} />
        <MetricsCompare data={data} />
        {colleague && <CompareSheet data={data} colleague={colleague} onClose={() => set({ with: undefined }, true)} />}
      </>}
  </div>;
}
